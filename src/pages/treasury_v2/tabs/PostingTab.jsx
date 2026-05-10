// src/pages/treasury_v2/tabs/PostingTab.jsx
// Posting Master — manual N-leg journal-entry editor (Spec C.1). Renders only
// when the host (TreasuryShell) decides the user has accounting:edit; it does no
// extra permission check of its own (the RPC also enforces owner/accountant).
import React, { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { emitToast } from "../../../lib/toast.jsx";
import { rpcCreateManualEntryV2 } from "../../../lib/newLedger.js";
import {
  deriveCurrencies, postingBalance, validatePostingDraft, buildManualEntryPayload,
} from "../../../lib/treasury/postingEntry.js";
import AccountPicker from "../parts/AccountPicker.jsx";
import TransactionEntries from "../parts/TransactionEntries.jsx";

let _lineSeq = 0;
const newLine = () => ({ id: `pm${++_lineSeq}`, accountCode: "", side: "dr", amount: "" });
const todayInputValue = () => new Date().toISOString().slice(0, 10);
// DB tx_backdate_sanity allows effective_date >= created_at - 90d.
const minDateInputValue = () => new Date(Date.now() - 89 * 24 * 3600 * 1000).toISOString().slice(0, 10);

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function PostingTab({ ctx }) {
  const { t } = useTranslation();
  const accounts = ctx?.accounts || [];
  const currencies = useMemo(() => deriveCurrencies(accounts), [accounts]);

  const [currency, setCurrency] = useState(() => currencies[0] || "USD");
  const [dateStr, setDateStr] = useState(todayInputValue);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState(() => [newLine(), { ...newLine(), side: "cr" }]);
  const [submitting, setSubmitting] = useState(false);

  const accByCode = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.code, a]));
    return (code) => m.get(code) || null;
  }, [accounts]);

  // dateStr can be "" if the user clears the native date input — fall back to now()
  // so this never throws RangeError during render.
  const effectiveDateIso = (dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date()).toISOString();
  const draft = { currency, effectiveDate: effectiveDateIso, reason, description, lines };
  const { dr, cr, delta } = postingBalance(lines);
  const validation = validatePostingDraft(draft, accByCode);
  const lineErr = (id, field) => validation.errors.find((e) => e.lineId === id && e.field === field);

  function patchLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function setAmount(id, side, raw) {
    // a line is either Dr or Cr — typing in one column flips `side`, so the
    // other column's <input> (which reads `l.side === <other> ? l.amount : ""`) clears
    patchLine(id, { side, amount: raw });
  }
  function addLine() { setLines((ls) => [...ls, newLine()]); }
  function removeLine(id) { setLines((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.id !== id))); }

  // When the currency changes, drop any line whose account no longer matches.
  function changeCurrency(c) {
    setCurrency(c);
    setLines((ls) => ls.map((l) => {
      const a = accByCode(l.accountCode);
      return a && a.currency === c ? l : { ...l, accountCode: "" };
    }));
  }

  function resetForm() {
    _lineSeq = 0;
    setLines([newLine(), { ...newLine(), side: "cr" }]);
    setReason(""); setDescription(""); setDateStr(todayInputValue());
  }

  async function submit() {
    if (!validation.ok || submitting) return;
    setSubmitting(true);
    try {
      await rpcCreateManualEntryV2(buildManualEntryPayload(draft));
      emitToast("success", t("trv2_pm_posted"));
      resetForm();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/42501|permission|authenticated|Not authenticated|role/i.test(msg)) emitToast("error", t("trv2_pm_err_forbidden"));
      else if (/balance/i.test(msg)) emitToast("error", t("trv2_pm_err_unbalanced"));
      else emitToast("error", `${t("trv2_pm_err_generic")}: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  // Preview rows in the TransactionEntries shape (accountCode/accountName/direction/amount/currency).
  const previewEntries = lines
    .filter((l) => l.accountCode && Number(l.amount) > 0)
    .map((l, i) => {
      const a = accByCode(l.accountCode);
      return { id: `prev${i}`, direction: l.side, amount: Number(l.amount), currency, accountCode: a?.code || l.accountCode, accountName: a?.name || "?" };
    });

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-bold">{t("trv2_pm_title")}</h2>

      <div className="bg-white border border-slate-200/70 rounded-[12px] p-4 space-y-4">
        {/* header: date + currency */}
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-slate-500">{t("trv2_pm_effective_date")}</span>
            <input type="date" value={dateStr} min={minDateInputValue()} max={todayInputValue()}
              onChange={(e) => setDateStr(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1.5 outline-none" />
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-slate-500">{t("trv2_pm_currency")}</span>
            <select value={currency} onChange={(e) => changeCurrency(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1.5 outline-none">
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {/* lines table */}
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
              <th className="text-left px-2 py-1">{t("trv2_pm_col_account")}</th>
              <th className="text-right px-2 py-1 w-32">{t("trv2_pm_col_dr")}</th>
              <th className="text-right px-2 py-1 w-32">{t("trv2_pm_col_cr")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1.5">
                  <AccountPicker accounts={accounts} currency={currency} value={l.accountCode}
                    onChange={(code) => patchLine(l.id, { accountCode: code })} />
                  {(lineErr(l.id, "account")) && <div className="text-[10px] text-rose-600 mt-0.5">{lineErr(l.id, "account").message}</div>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input inputMode="decimal" value={l.side === "dr" ? l.amount : ""}
                    onChange={(e) => setAmount(l.id, "dr", e.target.value)}
                    className={`w-28 text-right bg-slate-50 border rounded-[8px] px-2 py-1 outline-none ${l.side === "dr" && lineErr(l.id, "amount") ? "border-rose-300" : "border-slate-200"}`} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input inputMode="decimal" value={l.side === "cr" ? l.amount : ""}
                    onChange={(e) => setAmount(l.id, "cr", e.target.value)}
                    className={`w-28 text-right bg-slate-50 border rounded-[8px] px-2 py-1 outline-none ${l.side === "cr" && lineErr(l.id, "amount") ? "border-rose-300" : "border-slate-200"}`} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button type="button" title={t("trv2_pm_remove_line")} disabled={lines.length <= 2}
                    onClick={() => removeLine(l.id)}
                    className="p-1 rounded text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:hover:text-slate-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={addLine} className="text-[12px] text-indigo-600 hover:underline">{t("trv2_pm_add_line")}</button>

        {/* balance indicator */}
        <div className={`rounded-[10px] px-3 py-2 text-[12.5px] font-medium ${Math.abs(delta) < 0.01 && (dr > 0) ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {t("trv2_pm_balance").replace("{dr}", fmtNum(dr)).replace("{cr}", fmtNum(cr)).replace("{delta}", fmtNum(delta))}
          {" — "}{Math.abs(delta) < 0.01 && dr > 0 ? t("trv2_pm_balanced") : t("trv2_pm_unbalanced")}
        </div>

        {/* reason + description */}
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={t("trv2_pm_reason_ph")}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-2 text-[12.5px] outline-none" />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={t("trv2_pm_description")}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none" />
        </div>

        {/* preview */}
        {previewEntries.length >= 2 && (
          <div className="border border-slate-100 rounded-[10px]">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">{t("trv2_pm_preview")}</div>
            <TransactionEntries entries={previewEntries} />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="button" disabled={!validation.ok || submitting} onClick={submit}
            className="px-4 py-2 rounded-[10px] text-[13px] font-semibold bg-slate-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {t("trv2_pm_post")}
          </button>
        </div>
      </div>
    </div>
  );
}
