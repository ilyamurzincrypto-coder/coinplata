// src/components/cashier/ledger/ObligationsPanel.jsx
// Витрина «Незавершённое» — открытые долги по отложенным сделкам.
// Слева «клиенты должны нам», справа «мы должны клиентам». По валютам + список
// с подсветкой сроков (просрочено / сегодня / скоро). Read-only.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase.js";
import { loadOpenObligations } from "../../../lib/cashierDealsReader.js";
import { fmtRu } from "../../balances/currencyMeta.js";

const p2 = (n) => String(n).padStart(2, "0");
function dueInfo(s) {
  if (!s) return { label: "", cls: "text-muted" };
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  if (Number.isNaN(d.getTime())) return { label: "", cls: "text-muted" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const label = `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;
  if (days < 0) return { label: `просрочено ${label}`, cls: "text-[#cf3b40]" };
  if (days === 0) return { label: `сегодня`, cls: "text-[#b8923a]" };
  if (days <= 2) return { label: `до ${label}`, cls: "text-[#b8923a]" };
  return { label: `до ${label}`, cls: "text-muted" };
}

function totalsByCcy(items) {
  const m = {};
  items.forEach((i) => {
    m[i.currency] = (m[i.currency] || 0) + i.amount;
  });
  return Object.entries(m); // [[ccy, sum], ...]
}

function Block({ title, items, accent }) {
  const totals = totalsByCcy(items);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{title}</span>
        <span className="flex flex-wrap gap-x-2 gap-y-0.5 justify-end">
          {totals.map(([c, s]) => (
            <span key={c} className={`text-[11px] font-bold font-mono ${accent}`}>
              {fmtRu(s)} {c}
            </span>
          ))}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-muted-soft py-1">—</div>
      ) : (
        <div className="flex flex-col gap-px">
          {items.map((i) => {
            const du = dueInfo(i.dueDate);
            return (
              <div
                key={i.dealId}
                className="flex items-center gap-2 px-2 py-1 rounded-[7px] hover:bg-[#f6f7fb]"
                title={i.comment || ""}
              >
                <span className="text-[12px] font-semibold text-ink truncate flex-1 min-w-0">{i.party}</span>
                <span className={`text-[11px] font-bold font-mono shrink-0 ${accent}`}>
                  {fmtRu(i.amount)} {i.currency}
                </span>
                <span className={`text-[10px] font-bold shrink-0 w-[80px] text-right ${du.cls}`}>{du.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ObligationsPanel({ officeId }) {
  const [data, setData] = useState({ weOwe: [], theyOwe: [] });
  const sinceIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 120);
    return d.toISOString();
  }, []);

  const refetch = useCallback(async () => {
    try {
      setData(await loadOpenObligations({ officeId, sinceIso }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[obligations] load failed", e);
    }
  }, [officeId, sinceIso]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!supabase) return undefined;
    const ch = supabase
      .channel("cashier-obligations")
      .on("postgres_changes", { event: "*", schema: "ledger", table: "transactions" }, refetch)
      .on("postgres_changes", { event: "*", schema: "ledger", table: "journal_entries" }, refetch)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [refetch]);

  const total = data.weOwe.length + data.theyOwe.length;
  if (total === 0) return null; // нет открытых долгов — не показываем

  return (
    <div className="bg-surface border border-[#e7e9f1] rounded-[16px] overflow-hidden">
      <div className="px-[18px] py-[11px] border-b border-[#e7e9f1] flex items-center justify-between gap-3">
        <span className="text-[12px] font-extrabold tracking-[1.3px] uppercase text-[#454a66]">
          Незавершённое · долги
        </span>
        <span className="text-[11.5px] font-semibold text-muted">{total} открытых</span>
      </div>
      <div className="p-[14px] flex flex-col sm:flex-row gap-5">
        <Block title="Клиенты должны нам" items={data.theyOwe} accent="text-[#0b8a54]" />
        <div className="hidden sm:block w-px bg-[#eef0f4]" />
        <Block title="Мы должны клиентам" items={data.weOwe} accent="text-[#cf3b40]" />
      </div>
    </div>
  );
}
