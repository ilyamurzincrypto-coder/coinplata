// src/pages/treasury_v2/parts/AccountInlineEntries.jsx
// Visual refresh на DS-токены. Логика accountEntries() и onOpenTx — не тронуты.

import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { accountEntries } from "../../../lib/treasury/v2selectors.js";

// Какая сторона (dr/cr) УВЕЛИЧИВАЕТ остаток счёта данного типа.
// Активы/расходы — дебетовые (растут по дебету); пассивы/капитал/доходы —
// кредитовые (растут по кредиту). Знак/цвет суммы в проводке показываем не по
// «голому» Дт/Кт, а по тому, прибавилось на счёт или убыло.
const CREDIT_NORMAL = new Set(["liability", "equity", "revenue"]);
function increaseDir(accType) {
  return CREDIT_NORMAL.has(accType) ? "cr" : "dr";
}

export default function AccountInlineEntries({ ctx, accountId, period, dim, onOpenTx }) {
  const { t } = useTranslation();
  const rows = accountEntries(ctx, accountId, 50, period, dim);
  if (rows.length === 0) {
    return <div className="px-card py-3 text-caption text-muted bg-surface-soft/60">{t("trv2_no_entries")}</div>;
  }
  const acc = (ctx.accounts || []).find((a) => a.id === accountId);
  const incDir = increaseDir(acc && acc.type);
  return (
    <table className="w-full text-caption bg-surface-soft/60">
      <tbody>
        {rows.map((e) => {
          const grows = e.direction === incDir;
          return (
            <tr key={e.id} className="border-t border-border-soft hover:bg-surface-sunk/60 transition-colors">
              <td className="px-card py-1.5 text-muted w-24 font-mono tabular">
                {new Date(e.createdAt).toISOString().slice(0, 10)}
              </td>
              <td className="px-2 py-1.5 w-10 font-semibold text-ink-soft uppercase tracking-wider text-tiny">
                {e.direction === "dr" ? t("trv2_col_dr") : t("trv2_col_cr")}
              </td>
              <td className={`px-2 py-1.5 font-mono tabular text-right w-28 font-bold ${grows ? "text-success" : "text-danger"}`}>
                {grows ? "+" : "−"}{Number(e.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {e.currency}
              </td>
              <td className="px-2 py-1.5 text-muted-soft uppercase tracking-wider w-24 text-tiny">{e.txKind}</td>
              <td className="px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => onOpenTx?.(e.txId)}
                  className="text-accent hover:text-accent-hover transition-colors font-mono text-tiny"
                >
                  {e.sourceRefId || e.txId.slice(0, 8)} →
                </button>
              </td>
            </tr>
          );
        })}
        {rows.length === 50 && (
          <tr>
            <td colSpan={5} className="px-card py-2 text-tiny text-muted-soft text-center">
              {t("trv2_entries_truncated")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
