// src/pages/treasury_v2/parts/PeriodCloseModal.jsx
// "Close period": folds every non-zero revenue/expense account into the per-currency
// Retained Earnings via a series of ledger.create_adjustment('reconciliation', …) calls
// (one per account). Not atomic — on a mid-loop error the modal stays open showing how
// many succeeded; re-running is safe (already-zeroed accounts drop out of periodCloseLines).
import React, { useMemo, useState } from "react";
import Modal from "../../../components/ui/Modal.jsx";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useLedger } from "../../../store/ledger.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { rpcCreateAdjustmentV2 } from "../../../lib/newLedger.js";
import { periodCloseLines } from "../../../lib/treasury/periodClose.js";

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PeriodCloseModal({ open, onClose }) {
  const { t } = useTranslation();
  const ctx = useLedger();
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);

  const { lines, netByCurrency } = useMemo(() => (open ? periodCloseLines(ctx) : { lines: [], netByCurrency: {} }), [open, ctx]);
  const today = new Date().toISOString().slice(0, 10);
  const canSubmit = lines.length > 0 && !busy;

  async function run() {
    if (!canSubmit) return;
    if (!confirmStep) { setConfirmStep(true); return; }
    setBusy(true);
    let done = 0;
    try {
      for (const l of lines) {
        await rpcCreateAdjustmentV2({
          accountCode: l.accountCode,
          amount: l.amount,
          currencyCode: l.currency,
          reason: `${t("trv2_pc_title")} ${today}`,
          adjustmentKind: "reconciliation",
          metadata: { period_close: true, as_of: today, kind: l.kind },
        });
        done += 1;
      }
      emitToast("success", `${t("trv2_pc_done")}`.replace("{n}", String(done)));
      onClose?.();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/42501|permission|authenticated|role/i.test(msg)) emitToast("error", t("trv2_pm_err_forbidden"));
      else emitToast("error", `${t("trv2_pc_partial").replace("{n}", String(done)).replace("{m}", String(lines.length))} — ${msg}`);
      setConfirmStep(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const netEntries = Object.entries(netByCurrency);

  return (
    <Modal open={open} onClose={onClose} title={t("trv2_pc_title")} subtitle={t("trv2_pc_date_note") + ` (${today})`} width="md">
      <div className="p-5 space-y-4">
        {lines.length === 0 ? (
          <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-4 text-[12.5px] text-slate-500 text-center">
            {t("trv2_pc_nothing")}
          </div>
        ) : (
          <>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="py-1.5">{t("trv2_pc_col_account")}</th>
                  <th className="py-1.5">{t("trv2_to_col_currency")}</th>
                  <th className="py-1.5 text-right">{t("trv2_pc_col_balance")}</th>
                  <th className="py-1.5">{t("trv2_pc_to_re")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.accountCode} className="border-b border-slate-50">
                    <td className="py-1.5"><span className="font-mono text-[11px] text-slate-400">{l.accountCode}</span> {l.accountName}</td>
                    <td className="py-1.5 text-slate-500">{l.currency}</td>
                    <td className={`py-1.5 text-right tabular-nums ${l.kind === "revenue" ? "text-emerald-700" : "text-rose-700"}`}>{fmtNum(l.balance)}</td>
                    <td className="py-1.5 text-slate-400">{l.kind === "revenue" ? "→ +" : "→ −"}{fmtNum(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px]">
              <span className="font-semibold text-slate-700">{t("trv2_pc_net")}: </span>
              {netEntries.map(([cur, v], i) => (
                <span key={cur} className={`tabular-nums font-bold ${v >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {i > 0 ? ", " : ""}{v >= 0 ? "+" : ""}{fmtNum(v)} {cur}
                </span>
              ))}
            </div>
            {confirmStep && (
              <div className="rounded-[10px] border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
                {t("trv2_pc_confirm_warn").replace("{n}", String(lines.length))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 disabled:opacity-60">
          {t("trv2_pm_reverse_cancel")}
        </button>
        <button onClick={run} disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${canSubmit ? (confirmStep ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-slate-900 text-white hover:bg-slate-800") : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
          {busy ? "…" : confirmStep ? t("trv2_pc_confirm") : t("trv2_pc_button")}
        </button>
      </div>
    </Modal>
  );
}
