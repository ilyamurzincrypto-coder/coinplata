// src/pages/treasury_v2/tabs/JournalTab.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { transactionTree } from "../../../lib/treasury/v2selectors.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TransactionRow from "../parts/TransactionRow.jsx";
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";

const TYPES = ["all", "deal", "transfer", "topup", "adjustment", "manual", "reversal"];

export default function JournalTab({ ctx, officeFilter, onOpenSource }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_journal_period") || "30d"; } catch { return "30d"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_journal_period", v); } catch {} };
  const [typeFilter, setTypeFilter] = useState("all");
  const [counterpartyId, setCounterpartyId] = useState(null);

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
        <div className="flex items-center gap-1.5 ml-auto min-w-[220px]">
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
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_journal_no_tx")}</div>
        ) : (
          tree.map((node) => <TransactionRow key={node.tx.id} node={node} onOpenSource={onOpenSource} />)
        )}
      </section>
    </div>
  );
}
