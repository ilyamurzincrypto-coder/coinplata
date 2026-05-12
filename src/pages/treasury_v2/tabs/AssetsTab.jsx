// src/pages/treasury_v2/tabs/AssetsTab.jsx
// «Активы» — иерархическое дерево Офис → Валюта → счета плана.
// Уровень 1 — офис (acc.officeId; null → «Без офиса»), total всех его asset-счетов в базе.
// Уровень 2 — валюта внутри офиса (native total + ≈ base).
// Уровень 3 (листья) — конкретные ledger.accounts; клик по листу разворачивает его проводки.
// В шапке — кнопка «+ Счёт в план» (только can("accounting","edit")) → ChartAccountModal.
import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { assetsByOfficeCurrency } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import AccountInlineEntries from "../parts/AccountInlineEntries.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

export default function AssetsTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { findOffice } = useOffices();
  const tree = useMemo(() => assetsByOfficeCurrency(ctx), [ctx]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grandTotal = tree.reduce((s, o) => s + o.totalInBase, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[12px] text-slate-500">
          {t("trv2_tab_assets")} · {formatBase(grandTotal, baseCurrency)}
        </span>
        {can("accounting", "edit") && (
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[12.5px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            {t("trv2_chart_add_btn")}
          </button>
        )}
      </div>

      {tree.length === 0 ? (
        <div className="p-5 text-slate-400 text-[13px]">{t("trv2_no_accounts")}</div>
      ) : (
        <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
          {tree.map((office) => {
            const officeKey = `office:${office.officeId || "none"}`;
            const officeOpen = expanded.has(officeKey);
            const officeName = office.officeId
              ? (findOffice(office.officeId)?.name || office.officeId)
              : t("trv2_assets_no_office");
            return (
              <div key={officeKey} className="border-t border-slate-100 first:border-t-0">
                {/* Level 1 — office */}
                <div
                  className="px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-slate-50 bg-slate-50/40"
                  onClick={() => toggle(officeKey)}
                >
                  {officeOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                  <span className="flex-1 text-[13px] font-bold text-slate-900 truncate">{officeName}</span>
                  <span className="text-[13px] font-semibold tabular-nums">{formatBase(office.totalInBase, baseCurrency)}</span>
                </div>

                {officeOpen && office.currencies.map((cur) => {
                  const curKey = `${officeKey}|cur:${cur.currency}`;
                  const curOpen = expanded.has(curKey);
                  const isBase = cur.currency === baseCurrency;
                  return (
                    <div key={curKey}>
                      {/* Level 2 — currency */}
                      <div
                        className="pl-9 pr-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50 border-t border-slate-100"
                        onClick={() => toggle(curKey)}
                      >
                        {curOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                        <span className="flex-1 text-[12.5px] font-semibold text-slate-800 tracking-wider">{cur.currency}</span>
                        <span className="text-[12px] text-slate-700 tabular-nums">{nativeFmt(cur.total, cur.currency)}</span>
                        {!isBase && (
                          <span className="text-[11.5px] text-slate-400 tabular-nums">(≈ {formatBase(cur.totalInBase, baseCurrency)})</span>
                        )}
                      </div>

                      {curOpen && cur.accounts.map((a) => {
                        const accKey = `${curKey}|acc:${a.accountId}`;
                        const accOpen = expanded.has(accKey);
                        return (
                          <React.Fragment key={accKey}>
                            {/* Level 3 — leaf account */}
                            <div
                              className="pl-16 pr-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-slate-50 border-t border-slate-100"
                              onClick={() => toggle(accKey)}
                            >
                              {accOpen ? <ChevronDown className="w-3 h-3 text-slate-300" /> : <ChevronRight className="w-3 h-3 text-slate-300" />}
                              <span className="font-mono text-[11px] text-slate-400 w-12 shrink-0">{a.code}</span>
                              <span className="flex-1 text-[12.5px] text-slate-900 truncate">{a.name}</span>
                              <span className="text-[12px] text-slate-600 tabular-nums">{nativeFmt(a.balance, a.currency)}</span>
                            </div>
                            {accOpen && <AccountInlineEntries ctx={ctx} accountId={a.accountId} onOpenTx={onOpenTx} />}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <ChartAccountModal
          open
          onClose={() => setAddOpen(false)}
          defaultOfficeId={officeFilter && officeFilter !== "all" ? officeFilter : null}
        />
      )}
    </div>
  );
}
