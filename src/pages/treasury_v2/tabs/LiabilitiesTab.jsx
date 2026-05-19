// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
//
// «Пассивы» — два режима группировки:
//   counterparty (default) — Контрагент → Валюта → Source account leaf
//     (зеркало AssetsTab — оператор видит имена клиентов/партнёров, а не
//     технические коды subtype). Реферальные клиенты сверху.
//   type (legacy) — старая разбивка по subtype (customer_liab /
//     partner_liab / unearned), оставлена как fallback / для бух-отчётов.
//
// Состояние режима persist через localStorage "coinplata:liabilities-grouping".
// Фильтр client / partner / all только в counterparty-режиме.

import React, { useState, useMemo } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import {
  groupByClass,
  liabilitiesByCounterparty,
} from "../../../lib/treasury/v2selectors.js";
import ClassSection from "../parts/ClassSection.jsx";
import AccountRow from "../parts/AccountRow.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import CounterpartyGroup from "../parts/CounterpartyGroup.jsx";

const GROUPING_KEY = "coinplata:liabilities-grouping";
const CP_FILTER_KEY = "coinplata:liabilities-cp-filter";

export default function LiabilitiesTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const [addOpen, setAddOpen] = useState(false);

  const [grouping, setGrouping] = useState(() => {
    try {
      return localStorage.getItem(GROUPING_KEY) === "type" ? "type" : "counterparty";
    } catch {
      return "counterparty";
    }
  });
  const setGroupingPersist = (g) => {
    setGrouping(g);
    try { localStorage.setItem(GROUPING_KEY, g); } catch {}
  };

  const [cpFilter, setCpFilter] = useState(() => {
    try {
      const v = localStorage.getItem(CP_FILTER_KEY);
      return v === "client" || v === "partner" || v === "all" ? v : "all";
    } catch {
      return "all";
    }
  });
  const setCpFilterPersist = (v) => {
    setCpFilter(v);
    try { localStorage.setItem(CP_FILTER_KEY, v); } catch {}
  };

  const clientGroups = useMemo(() => liabilitiesByCounterparty(ctx, "client"), [ctx]);
  const partnerGroups = useMemo(() => liabilitiesByCounterparty(ctx, "partner"), [ctx]);
  const subtypeSections = useMemo(() => groupByClass(ctx, "liability"), [ctx]);

  const visibleGroups = useMemo(() => {
    if (cpFilter === "client") return clientGroups;
    if (cpFilter === "partner") return partnerGroups;
    return [...clientGroups, ...partnerGroups];
  }, [cpFilter, clientGroups, partnerGroups]);

  const grandTotalInBase = useMemo(() => {
    const all = [...clientGroups, ...partnerGroups];
    return all.reduce((s, g) => s + g.totalInBase, 0);
  }, [clientGroups, partnerGroups]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-[12px] text-slate-500">
            {t("trv2_tab_liabilities")} · {formatBase(grandTotalInBase, baseCurrency)}
          </span>
          <span className="text-tiny text-muted-soft">
            {clientGroups.length} клиентов · {partnerGroups.length} партнёров
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Grouping switcher */}
          <SegmentedSmall
            value={grouping}
            onChange={setGroupingPersist}
            options={[
              { id: "counterparty", label: "По контрагенту" },
              { id: "type", label: "По типу" },
            ]}
          />
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
      </div>

      {/* CP-type filter (только counterparty-режим) */}
      {grouping === "counterparty" && (
        <div className="flex items-center gap-2">
          <SegmentedSmall
            value={cpFilter}
            onChange={setCpFilterPersist}
            options={[
              { id: "all",     label: `Все · ${clientGroups.length + partnerGroups.length}` },
              { id: "client",  label: `Клиенты · ${clientGroups.length}` },
              { id: "partner", label: `Партнёры · ${partnerGroups.length}` },
            ]}
          />
        </div>
      )}

      <div className="text-[11.5px] text-slate-400">{t("trv2_liab_sign_note")}</div>

      {grouping === "counterparty" ? (
        visibleGroups.length === 0 ? (
          <div className="p-5 text-slate-400 text-[13px]">{t("trv2_no_accounts")}</div>
        ) : (
          <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
            {visibleGroups.map((cp) => (
              <CounterpartyGroup
                key={`${cp.kind}:${cp.id}`}
                cp={cp}
                formatBase={formatBase}
                baseCurrency={baseCurrency}
              />
            ))}
          </div>
        )
      ) : subtypeSections.length === 0 ? (
        <div className="p-5 text-slate-400 text-[13px]">{t("trv2_no_accounts")}</div>
      ) : (
        subtypeSections.map((s) => (
          <ClassSection key={s.subtype} labelKey={s.labelKey} totalInBase={s.totalInBase} formatBase={formatBase} baseCurrency={baseCurrency} displayMul={-1}>
            {s.accounts.map((a) => (
              <AccountRow key={`${a.accountId}-${a.currency}`} account={a} ctx={ctx} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} displayMul={-1} />
            ))}
          </ClassSection>
        ))
      )}

      {addOpen && <ChartAccountModal open defaultType="liability" onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// Inline segmented mini (без подключения общего SegmentedControl — он pure-prop).
function SegmentedSmall({ value, onChange, options }) {
  return (
    <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`h-7 px-2.5 rounded-pill text-tiny font-semibold transition-all duration-150 ease-apple whitespace-nowrap ${
            value === opt.id
              ? "bg-surface text-ink shadow-seg"
              : "text-muted hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
