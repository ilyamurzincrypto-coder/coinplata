// src/pages/treasury_v2/tabs/PaymentCalendarTab.jsx
// «Платёжный календарь» — open obligations (deferred deal legs we still owe to clients)
// bucketed by due date: overdue / today / next 7 days / later / no date. Read-only;
// closing an obligation happens from the dashboard widget «Открытые обязательства» or
// «Контрагенты → обязательства». Source: operations.v_open_deals (useOpenObligations).
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOpenObligations } from "../../../store/openObligations.js";
import { bucketObligations, PC_BUCKETS, obligationLegTotals } from "../../../lib/treasury/paymentCalendar.js";

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const BUCKET_STYLE = {
  overdue: "bg-danger-soft text-danger border-danger/20",
  today:   "bg-warning-soft text-warning border-warning/20",
  week:    "bg-info-soft text-info border-info/20",
  later:   "bg-surface-soft text-ink-soft border-border-soft",
  no_date: "bg-surface-soft text-muted border-border-soft",
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—");

export default function PaymentCalendarTab({ officeFilter }) {
  const { t } = useTranslation();
  const { items, loading } = useOpenObligations();
  const filtered = useMemo(
    () => (items || []).filter((it) => !officeFilter || officeFilter === "all" || !it.office_id || it.office_id === officeFilter),
    [items, officeFilter]
  );
  const buckets = useMemo(() => bucketObligations(filtered), [filtered]);
  const total = filtered.length;

  if (loading) return <div className="bg-surface rounded-card px-card py-8 text-center text-body-sm text-muted">…</div>;
  if (total === 0) return <div className="bg-surface rounded-card px-card py-8 text-center text-body-sm text-muted">{t("trv2_cal_empty")}</div>;

  return (
    <div className="space-y-3">
      {PC_BUCKETS.map((k) => {
        const rows = buckets[k];
        if (rows.length === 0) return null;
        return (
          <section key={k} className="bg-surface rounded-card overflow-hidden">
            <header className={`px-card py-2 border-b text-caption font-bold flex items-center justify-between ${BUCKET_STYLE[k]}`}>
              <span>{t(`trv2_cal_${k}`)}</span>
              <span className="text-tiny font-mono tabular opacity-80">{t("trv2_cal_count").replace("{n}", String(rows.length))}</span>
            </header>
            <table className="w-full text-caption">
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id} className="border-t border-border-soft hover:bg-surface-soft transition-colors">
                    <td className="px-card py-1.5 text-muted w-24 font-mono tabular">{fmtDate(it.due_date)}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.counterparty_name || "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular text-ink-soft">
                      {obligationLegTotals(it).map((lt, i) => (
                        <span key={lt.currency}>{i > 0 ? " · " : ""}{fmtNum(lt.amount)} {lt.currency}</span>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-right text-micro uppercase tracking-wider text-muted-soft w-20">{it.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="text-tiny text-muted-soft">{t("trv2_cal_note")}</p>
    </div>
  );
}
