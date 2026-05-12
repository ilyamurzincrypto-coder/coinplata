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
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex items-center gap-1.5">
          {TYPES.map((tp) => (
            <button
              key={tp}
              onClick={() => setTypeFilter(tp)}
              className={`px-2 py-1 rounded-[8px] text-[11px] font-medium ${typeFilter === tp ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t(`trv2_journal_type_${tp}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 min-w-[200px] flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder={t("trv2_search_placeholder")}
            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[12px] outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 min-w-[220px]">
          <span className="text-[11px] text-slate-500 shrink-0">{t("trv2_journal_filter_cp")}</span>
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
              onClick={() => setCounterpartyId(null)}
              className="shrink-0 text-[11px] text-slate-500 hover:text-slate-900 px-1.5 py-1 rounded hover:bg-slate-100"
              title={t("trv2_journal_filter_cp_clear")}
            >×</button>
          )}
        </div>
        {canPost && (
          <button
            onClick={() => setPostingOpen(true)}
            className="shrink-0 px-2.5 py-1 rounded-[8px] text-[12px] font-medium bg-slate-900 text-white hover:bg-slate-800"
          >{t("trv2_journal_new_manual")}</button>
        )}
        <button
          onClick={doExport}
          disabled={filtered.length === 0}
          className="shrink-0 px-2.5 py-1 rounded-[8px] text-[12px] bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
        >{t("trv2_journal_export_csv")}</button>
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">
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
