// src/pages/treasury_v2/tabs/JournalTab.jsx
import React, { useState, useMemo, useEffect } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { transactionTree, nodeMatchesSearch } from "../../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TransactionRow from "../parts/TransactionRow.jsx";
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";
import Modal from "../../../components/ui/Modal.jsx";
import PostingTab from "./PostingTab.jsx";
import { exportCSV } from "../../../utils/csv.js";

const TYPES = ["all", "deal", "transfer", "topup", "adjustment", "manual", "reversal"];

export default function JournalTab({ ctx, officeFilter, onOpenSource }) {
  const { t } = useTranslation();
  const can = useCan();
  const canPost = can("accounting", "edit");
  const [postingOpen, setPostingOpen] = useState(false);
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_journal_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_journal_period", v); } catch {} };
  const [typeFilter, setTypeFilter] = useState("all");
  const [counterpartyId, setCounterpartyId] = useState(null);

  // Free-text search across the (already period/type/counterparty-filtered) tree.
  // Debounced ~200ms so typing doesn't re-filter on every keystroke.
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchRaw]);

  // Client + partner options merged into one picker (single id-space — `transactionTree`
  // matches either client_id or partner_id on entries against this id). The label
  // gets a "(клиент)"/"(партнёр)" suffix so the accountant can disambiguate.
  const cpOptions = useMemo(() => {
    if (!ctx.counterpartyOptions) return [];
    const clients = ctx.counterpartyOptions("client").map((o) => ({ ...o, name: `${o.name} (${t("trv2_cp_kind_client")})`, searchText: o.name }));
    const partners = ctx.counterpartyOptions("partner").map((o) => ({ ...o, name: `${o.name} (${t("trv2_cp_kind_partner")})`, searchText: o.name }));
    return [...clients, ...partners];
  }, [ctx, t]);

  const win = useMemo(() => presetWindow(period), [period]);
  // If the chosen window reaches further back than what LedgerProvider has loaded,
  // ask it to extend the rolling window so the report isn't silently truncated.
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) {
      ctx.extendWindow(win.from);
    }
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  const tree = useMemo(
    () => transactionTree(ctx, { type: typeFilter, officeFilter, counterpartyId, period: { from: win.from, to: win.to } }),
    [ctx, typeFilter, officeFilter, counterpartyId, win.from, win.to]
  );
  const accById = useMemo(() => new Map((ctx.accounts || []).map((a) => [a.id, a])), [ctx.accounts]);
  const filtered = useMemo(
    () => (search ? tree.filter((n) => nodeMatchesSearch(n, search, ctx, accById)) : tree),
    [tree, search, ctx, accById]
  );

  // Flatten the filtered tree into one row per journal entry, then hand off to exportCSV.
  // Columns chosen so an auditor can reconstruct each transaction: tx_id + effective_date
  // + kind/source group entries; side + code + name + amount + currency are the entry
  // itself; client/partner ids preserve subconto; note carries free-text; reverses_tx_id
  // ties storno rows to the original.
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
      { key: "tx_id", label: "tx_id" },
      { key: "effective_date", label: "effective_date" },
      { key: "kind", label: "kind" },
      { key: "source_ref_id", label: "source_ref_id" },
      { key: "side", label: "side" },
      { key: "account_code", label: "account_code" },
      { key: "account_name", label: "account_name" },
      { key: "amount", label: "amount" },
      { key: "currency", label: "currency" },
      { key: "client_id", label: "client_id" },
      { key: "partner_id", label: "partner_id" },
      { key: "note", label: "note" },
      { key: "reverses_tx_id", label: "reverses_tx_id" },
    ];
    const f = win.from.slice(0, 10), tt = win.to.slice(0, 10);
    exportCSV({ filename: `journal_${f}_${tt}.csv`, columns: cols, rows });
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-card p-3 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setP} />
        <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
          {TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setTypeFilter(tp)}
              className={`h-7 px-2.5 rounded-pill text-tiny font-semibold transition-all duration-150 ease-apple whitespace-nowrap ${
                typeFilter === tp
                  ? "bg-surface text-ink shadow-seg"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t(`trv2_journal_type_${tp}`)}
            </button>
          ))}
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
        {canPost && (
          <button
            type="button"
            onClick={() => setPostingOpen(true)}
            className="shrink-0 h-7 px-2.5 rounded-button text-caption font-semibold bg-ink text-white shadow-cta-glow hover:bg-black hover:-translate-y-px transition-all"
          >{t("trv2_journal_new_manual")}</button>
        )}
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
      <section className="bg-surface rounded-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-card py-8 text-center text-body-sm text-muted">
            {search ? t("trv2_search_no_results") : t("trv2_journal_no_tx")}
          </div>
        ) : (
          filtered.map((node) => <TransactionRow key={node.tx.id} node={node} onOpenSource={onOpenSource} />)
        )}
      </section>

      {postingOpen && (
        <Modal open onClose={() => setPostingOpen(false)} title={t("trv2_pm_title")} width="4xl">
          <div className="px-5 py-4">
            <PostingTab
              ctx={ctx}
              onDone={() => {
                setPostingOpen(false);
                // make the freshly-posted `manual` tx visible regardless of the type chip
                setTypeFilter((tp) => (tp === "all" || tp === "manual" ? tp : "all"));
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
