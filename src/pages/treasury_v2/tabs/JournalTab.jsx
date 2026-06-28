// src/pages/treasury_v2/tabs/JournalTab.jsx
// «Транзакции» — таб с двумя view-modes:
//   • Проводки (default) — плоский журнал по проводкам (по одной строке на dr/cr leg)
//   • Транзакции — групированный вид (одна строка на tx, expand → проводки)
// + Inline-форма «+ Ручная проводка» сверху, развёрнута по умолчанию.

import React, { useState, useMemo, useEffect } from "react";
import { Search, Plus, ChevronDown, ChevronUp, Check, Undo2 } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { transactionTree, nodeMatchesSearch } from "../../../lib/treasury/v2selectors.js";
import { rpcConfirmLedgerTransaction, rpcUnconfirmLedgerTransaction, withToast } from "../../../lib/supabaseWrite.js";
import { emitToast } from "../../../lib/toast.jsx";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TransactionRow from "../parts/TransactionRow.jsx";
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";
import PostingTab from "./PostingTab.jsx";
import { exportCSV } from "../../../utils/csv.js";

const VIEW_MODE_KEY = "coinplata:journal-view-mode";
const POSTING_OPEN_KEY = "coinplata:journal-posting-open";

export default function JournalTab({ ctx, officeFilter, onOpenSource }) {
  const { t } = useTranslation();
  const can = useCan();
  const canPost = can("accounting", "edit");

  // View mode: "entries" (Проводки) — default; "tx" (Транзакции) — grouped
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem(VIEW_MODE_KEY) || "entries"; } catch { return "entries"; }
  });
  const setViewModePersist = (v) => { setViewMode(v); try { localStorage.setItem(VIEW_MODE_KEY, v); } catch {} };

  // Inline PostingTab — открыт по умолчанию для пользователей с accounting:edit
  const [postingOpen, setPostingOpen] = useState(() => {
    try { const v = localStorage.getItem(POSTING_OPEN_KEY); return v === null ? true : v === "1"; } catch { return true; }
  });
  const setPostingOpenPersist = (v) => { setPostingOpen(v); try { localStorage.setItem(POSTING_OPEN_KEY, v ? "1" : "0"); } catch {} };

  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_journal_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_journal_period", v); } catch {} };

  const [counterpartyId, setCounterpartyId] = useState(null);
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchRaw]);

  const cpOptions = useMemo(() => {
    if (!ctx.counterpartyOptions) return [];
    const clients = ctx.counterpartyOptions("client").map((o) => ({ ...o, name: `${o.name} (${t("trv2_cp_kind_client")})`, searchText: o.name }));
    const partners = ctx.counterpartyOptions("partner").map((o) => ({ ...o, name: `${o.name} (${t("trv2_cp_kind_partner")})`, searchText: o.name }));
    return [...clients, ...partners];
  }, [ctx, t]);

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) {
      ctx.extendWindow(win.from);
    }
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  const tree = useMemo(
    () => transactionTree(ctx, { type: "all", officeFilter, counterpartyId, period: { from: win.from, to: win.to } }),
    [ctx, officeFilter, counterpartyId, win.from, win.to]
  );
  const accById = useMemo(() => new Map((ctx.accounts || []).map((a) => [a.id, a])), [ctx.accounts]);
  const filtered = useMemo(
    () => (search ? tree.filter((n) => nodeMatchesSearch(n, search, ctx, accById)) : tree),
    [tree, search, ctx, accById]
  );

  // Плоский view: одна строка на leg. Для contra-счёта берём sibling-leg
  // противоположного направления с максимальной суммой.
  const flatEntries = useMemo(() => {
    if (viewMode !== "entries") return [];
    const out = [];
    for (const node of filtered) {
      const entries = node.entries || [];
      for (const e of entries) {
        let contra = null, contraAmt = -Infinity;
        for (const other of entries) {
          if (other.id === e.id) continue;
          if (other.direction === e.direction) continue;
          const amt = Number(other.amount) || 0;
          if (amt > contraAmt) { contra = other; contraAmt = amt; }
        }
        out.push({ ...e, tx: node.tx, contra });
      }
    }
    return out.sort((a, b) => new Date(b.tx.effectiveDate) - new Date(a.tx.effectiveDate));
  }, [filtered, viewMode]);

  function doExport() {
    const rows = [];
    for (const node of filtered) {
      for (const e of node.entries) {
        rows.push({
          tx_id: node.tx.id,
          effective_date: (node.tx.effectiveDate || "").slice(0, 10),
          kind: node.tx.reversesTransactionId ? `${node.tx.kind} (reversal)` : node.tx.kind,
          source_ref_id: node.tx.sourceRefId || "",
          side: e.direction === "dr" ? "Дт" : "Кт",
          account_code: e.accountCode,
          account_name: e.accountName,
          amount: e.amount,
          currency: e.currency,
          client_id: e.clientId || "",
          partner_id: e.partnerId || "",
          note: e.note || "",
          reverses_tx_id: node.tx.reversesTransactionId || "",
        });
      }
    }
    const cols = [
      { key: "tx_id", label: "tx_id" }, { key: "effective_date", label: "effective_date" },
      { key: "kind", label: "kind" }, { key: "source_ref_id", label: "source_ref_id" },
      { key: "side", label: "side" }, { key: "account_code", label: "account_code" },
      { key: "account_name", label: "account_name" }, { key: "amount", label: "amount" },
      { key: "currency", label: "currency" }, { key: "client_id", label: "client_id" },
      { key: "partner_id", label: "partner_id" }, { key: "note", label: "note" },
      { key: "reverses_tx_id", label: "reverses_tx_id" },
    ];
    const f = win.from.slice(0, 10), tt = win.to.slice(0, 10);
    exportCSV({ filename: `journal_${f}_${tt}.csv`, columns: cols, rows });
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-surface rounded-card p-3 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setP} />
        {/* View mode toggle */}
        <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
          <button
            type="button"
            onClick={() => setViewModePersist("entries")}
            className={`h-7 px-3 rounded-pill text-caption font-semibold transition-all whitespace-nowrap ${
              viewMode === "entries" ? "bg-ink text-white" : "text-muted hover:text-ink"
            }`}
          >
            {t("trv2_journal_view_entries")}
          </button>
          <button
            type="button"
            onClick={() => setViewModePersist("tx")}
            className={`h-7 px-3 rounded-pill text-caption font-semibold transition-all whitespace-nowrap ${
              viewMode === "tx" ? "bg-ink text-white" : "text-muted hover:text-ink"
            }`}
          >
            {t("trv2_journal_view_tx")}
          </button>
        </div>
        <div className="flex items-center gap-1.5 min-w-[200px] flex-1">
          <Search className="w-3.5 h-3.5 text-muted-soft shrink-0" />
          <input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder={t("trv2_search_placeholder")}
            className="flex-1 min-w-0 h-7 px-2 rounded-input bg-surface-sunk text-ink text-caption border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5 min-w-[220px]">
          <span className="text-micro text-muted uppercase shrink-0">{t("trv2_journal_filter_cp")}</span>
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={counterpartyId}
              options={cpOptions}
              onChange={setCounterpartyId}
              placeholder={t("trv2_journal_filter_cp_any")}
              emptyText={t("trv2_journal_filter_cp_empty")}
            />
          </div>
          {counterpartyId && (
            <button
              type="button"
              onClick={() => setCounterpartyId(null)}
              className="shrink-0 text-tiny text-muted hover:text-ink p-1 rounded-badge hover:bg-surface-soft transition-colors"
              title={t("trv2_journal_filter_cp_clear")}
            >×</button>
          )}
        </div>
        <button
          type="button"
          onClick={doExport}
          disabled={filtered.length === 0}
          className="shrink-0 h-7 px-2.5 rounded-button text-caption font-semibold bg-surface-sunk text-ink-soft hover:bg-surface-soft disabled:opacity-40 transition-colors"
        >{t("trv2_journal_export_csv")}</button>
      </div>

      {truncated && (
        <div className="rounded-card px-card py-2 text-caption bg-warning-soft text-warning border border-warning/20">{t("trv2_window_partial")}</div>
      )}

      {/* Main content — таблица проводок или дерево транзакций */}
      <section className="bg-surface rounded-card overflow-hidden">
        {viewMode === "entries" ? (
          flatEntries.length === 0 ? (
            <div className="px-card py-8 text-center text-body-sm text-muted">
              {search ? t("trv2_search_no_results") : t("trv2_journal_no_tx")}
            </div>
          ) : (
            <EntriesTable rows={flatEntries} onOpenSource={onOpenSource} t={t} canConfirm={canPost} />
          )
        ) : (
          filtered.length === 0 ? (
            <div className="px-card py-8 text-center text-body-sm text-muted">
              {search ? t("trv2_search_no_results") : t("trv2_journal_no_tx")}
            </div>
          ) : (
            filtered.map((node) => <TransactionRow key={node.tx.id} node={node} onOpenSource={onOpenSource} />)
          )
        )}
      </section>

      {/* Spacer чтобы sticky-bottom PostingTab card не перекрывала последние строки списка */}
      {canPost && postingOpen && <div className="h-[420px]" aria-hidden />}
      {canPost && !postingOpen && <div className="h-[52px]" aria-hidden />}

      {/* PostingTab — sticky к низу экрана для быстрого ввода. Collapsible. */}
      {canPost && (
        <div className="fixed bottom-0 left-0 right-0 z-[800] bg-surface border-t-2 border-border-soft shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
          <div className="max-w-screen-2xl mx-auto">
            <button
              type="button"
              onClick={() => setPostingOpenPersist(!postingOpen)}
              className="w-full px-card py-2.5 flex items-center gap-2 hover:bg-surface-soft transition-colors text-left"
            >
              <Plus className="w-4 h-4 text-accent" strokeWidth={2.5} />
              <span className="text-body-sm font-semibold text-ink">{t("trv2_journal_new_manual")}</span>
              <span className="ml-auto">
                {postingOpen
                  ? <ChevronDown className="w-4 h-4 text-muted" strokeWidth={2.2} />
                  : <ChevronUp className="w-4 h-4 text-muted" strokeWidth={2.2} />}
              </span>
            </button>
            {postingOpen && (
              <div className="px-5 pt-2 pb-4 border-t border-border-soft max-h-[480px] overflow-y-auto">
                <PostingTab ctx={ctx} onDone={() => { /* остаёмся в Проводках; новая запись появится сверху */ }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Flat-entries table — 1С-стиль: жёсткая сетка, vertical dividers, zebra.
function EntriesTable({ rows, onOpenSource, t, canConfirm = false }) {
  // Подтверждать можно только всю tx целиком; чтобы кнопка не дублилась
  // на каждой ножке одной транзакции, рисуем её только на ПЕРВОЙ строке
  // каждой tx (по txId), у остальных — checkmark или empty.
  const firstSeen = React.useMemo(() => {
    const set = new Set();
    const first = new Set();
    for (const r of rows) {
      const txId = r.tx?.id;
      if (txId && !set.has(txId)) {
        set.add(txId);
        first.add(r.id);
      }
    }
    return first;
  }, [rows]);

  const onConfirm = async (txId) => {
    await withToast(
      () => rpcConfirmLedgerTransaction(txId),
      { success: "Транзакция подтверждена", errorPrefix: "Подтверждение" }
    );
  };
  const onUnconfirm = async (txId) => {
    await withToast(
      () => rpcUnconfirmLedgerTransaction(txId),
      { success: "Подтверждение снято", errorPrefix: "Undo" }
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-caption border-collapse table-fixed">
        <colgroup>
          <col className="w-[110px]" />
          <col className="w-[88px]" />
          <col />
          <col className="w-[220px]" />
          <col className="w-[140px]" />
          <col className="w-[140px]" />
          <col className="w-[100px]" />
          <col className="w-[130px]" />
        </colgroup>
        <thead className="bg-surface">
          <tr className="border-b-2 border-border-soft">
            <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 border-r border-border-soft">{t("trv2_detail_col_date")}</th>
            <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">Тип</th>
            <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_detail_col_descr")}</th>
            <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_detail_col_contra")}</th>
            <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_col_dr")}</th>
            <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_col_cr")}</th>
            <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_detail_col_doc")}</th>
            <th className="text-center text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2">Подтв.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isDr = row.direction === "dr";
            const amtStr = `${Number(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${row.currency}`;
            const dt = new Date(row.tx.effectiveDate);
            const sourceLabel = (row.tx.sourceRefId || row.tx.id).slice(0, 8);
            return (
              <tr key={row.id} className={`border-b border-border-soft transition-colors ${idx % 2 === 1 ? "bg-surface-soft/40" : ""} hover:bg-surface-soft`}>
                <td className="px-3 py-1.5 text-muted-soft font-mono tabular text-tiny whitespace-nowrap border-r border-border-soft">
                  {dt.toISOString().slice(0, 10)}
                </td>
                <td className="px-2 py-1.5 border-r border-border-soft">
                  <span className="text-tiny font-bold uppercase tracking-wider text-ink-soft">{row.tx.kind}</span>
                </td>
                <td className="px-2 py-1.5 border-r border-border-soft overflow-hidden">
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-mono text-tiny text-muted-soft shrink-0">{row.accountCode || ""}</span>
                    <span className="text-body-sm text-ink truncate">{row.accountName || row.note || ""}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 border-r border-border-soft overflow-hidden">
                  {row.contra ? (
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <span className="font-mono text-tiny text-muted-soft shrink-0">{row.contra.accountCode || ""}</span>
                      <span className="text-body-sm text-ink-soft truncate">{row.contra.accountName || ""}</span>
                    </span>
                  ) : <span className="text-muted-soft">—</span>}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono tabular whitespace-nowrap border-r border-border-soft ${isDr ? "text-success font-bold" : "text-muted-soft"}`}>
                  {isDr ? amtStr : "—"}
                </td>
                <td className={`px-2 py-1.5 text-right font-mono tabular whitespace-nowrap border-r border-border-soft ${!isDr ? "text-danger font-bold" : "text-muted-soft"}`}>
                  {!isDr ? amtStr : "—"}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap border-r border-border-soft">
                  {row.tx.sourceRefId && onOpenSource ? (
                    <button
                      type="button"
                      onClick={() => onOpenSource(row.tx)}
                      className="text-accent hover:text-accent-hover transition-colors font-mono text-tiny"
                    >
                      {sourceLabel} →
                    </button>
                  ) : (
                    <span className="text-muted-soft font-mono text-tiny">{sourceLabel}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center whitespace-nowrap">
                  {firstSeen.has(row.id) ? (
                    row.tx.metadata?.confirmed_at ? (
                      canConfirm ? (
                        <button
                          type="button"
                          onClick={() => onUnconfirm(row.tx.id)}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded-button bg-success-soft text-success hover:bg-danger-soft hover:text-danger text-tiny font-bold transition-colors group"
                          title={`Подтверждено ${new Date(row.tx.metadata.confirmed_at).toLocaleString()} · Клик чтобы снять`}
                        >
                          <Check className="w-3 h-3 group-hover:hidden" strokeWidth={3} />
                          <Undo2 className="w-3 h-3 hidden group-hover:inline" strokeWidth={3} />
                          <span className="group-hover:hidden">Подтв.</span>
                          <span className="hidden group-hover:inline">Снять</span>
                        </button>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-tiny font-bold text-success"
                          title={`Подтверждено ${new Date(row.tx.metadata.confirmed_at).toLocaleString()}`}
                        >
                          <Check className="w-3 h-3" strokeWidth={3} />
                          Подтв.
                        </span>
                      )
                    ) : canConfirm ? (
                      <button
                        type="button"
                        onClick={() => onConfirm(row.tx.id)}
                        className="h-6 px-2 rounded-button bg-accent-bg text-accent hover:bg-accent/15 text-tiny font-bold transition-colors"
                        title="Подтвердить транзакцию (видно в Кассе)"
                      >
                        Подтвердить
                      </button>
                    ) : (
                      <span className="text-tiny text-muted-soft">—</span>
                    )
                  ) : (
                    <span className="text-tiny text-muted-soft">·</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
