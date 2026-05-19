// src/pages/treasury_v2/tabs/PostingTab.jsx
// Posting Master — manual N-leg journal-entry editor (Spec C.1), now multi-currency:
// each line carries its own currency; for a mixed-currency entry the balance check is
// Σ(Dr·fx) ≈ Σ(Cr·fx) in the base/reference currency (fx from ctx.toBase). Renders only
// when the host (TreasuryShell) decides the user has accounting:edit; it does no extra
// permission check of its own (the RPC also enforces owner/accountant).
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
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";
import { POSTING_TEMPLATES, resolveTemplate } from "../../../lib/treasury/postingTemplates.js";

let _lineSeq = 0;
const newLine = (cur = "USD") => ({ id: `pm${++_lineSeq}`, accountCode: "", side: "dr", amount: "", clientId: null, partnerId: null, currency: cur });
const todayInputValue = () => new Date().toISOString().slice(0, 10);
// DB tx_backdate_sanity allows effective_date >= created_at - 90d.
const minDateInputValue = () => new Date(Date.now() - 89 * 24 * 3600 * 1000).toISOString().slice(0, 10);

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// `onDone` (optional) — called after a successful post (used by the host modal in
// JournalTab to close itself; the data-version bump fired by the RPC reloads the
// ledger so the new entry shows up in the Журнал list immediately).
export default function PostingTab({ ctx, onDone }) {
  const { t, lang } = useTranslation();
  const accounts = ctx?.accounts || [];
  const currencies = useMemo(() => deriveCurrencies(accounts), [accounts]);
  // Reference currency for fx (the rates passed to the RPC are relative to it) = the base
  // currency. fxOf(c) = how many base units per 1 unit of c.
  const refCurrency = ctx?.baseCurrency || currencies[0] || "USD";
  const fxOf = useMemo(() => (ctx?.toBase ? ((c) => ctx.toBase(1, c)) : (() => 1)), [ctx]);
  const defaultLineCur = currencies.includes(refCurrency) ? refCurrency : (currencies[0] || refCurrency);

  const templateOpts = useMemo(
    () => POSTING_TEMPLATES.map((tpl) => ({
      id: tpl.id,
      name: (tpl.name && (tpl.name[lang] || tpl.name.ru || tpl.name.en)) || tpl.id,
      searchText: [tpl.name?.ru, tpl.name?.en, tpl.name?.tr, tpl.description?.ru, tpl.description?.en, tpl.description?.tr].filter(Boolean).join(" "),
    })),
    [lang]
  );

  const [defaultCur, setDefaultCur] = useState(defaultLineCur);
  const [dateStr, setDateStr] = useState(todayInputValue);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState(() => [newLine(defaultLineCur), { ...newLine(defaultLineCur), side: "cr" }]);
  const [submitting, setSubmitting] = useState(false);

  const accByCode = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.code, a]));
    return (code) => m.get(code) || null;
  }, [accounts]);

  const effectiveDateIso = (dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date()).toISOString();
  const draft = { effectiveDate: effectiveDateIso, reason, description, lines };
  const lineCurs = [...new Set(lines.map((l) => l.currency).filter(Boolean))];
  const multi = lineCurs.length > 1;
  const { dr, cr, delta } = multi ? postingBalance(lines, fxOf) : postingBalance(lines);
  const balanceTol = multi ? 0.5 : 0.01;
  const balanced = Math.abs(delta) < balanceTol && dr > 0;
  const balCur = multi ? refCurrency : (lineCurs[0] || "");
  const validation = validatePostingDraft(draft, accByCode, fxOf);
  const lineErr = (id, field) => validation.errors.find((e) => e.lineId === id && e.field === field);

  function patchLine(id, patch) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function setAmount(id, side, raw) {
    patchLine(id, { side, amount: raw });
  }
  function setLineCurrency(id, c) {
    // changing a line's currency invalidates its account/counterparty pick
    patchLine(id, { currency: c, accountCode: "", clientId: null, partnerId: null });
  }
  function addLine() { setLines((ls) => [...ls, newLine(defaultCur)]); }
  function removeLine(id) { setLines((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.id !== id))); }

  // Change the default currency — and switch every line to it (clearing accounts). This is
  // the "make the whole entry in currency X" gesture; per-line selects override afterwards.
  function changeDefaultCurrency(c) {
    setDefaultCur(c);
    setLines((ls) => ls.map((l) => (l.currency === c ? l : { ...l, currency: c, accountCode: "", clientId: null, partnerId: null })));
  }

  function resetForm() {
    _lineSeq = 0;
    setLines([newLine(defaultCur), { ...newLine(defaultCur), side: "cr" }]);
    setReason(""); setDescription(""); setDateStr(todayInputValue());
  }

  function applyTemplate(tplId) {
    const tpl = POSTING_TEMPLATES.find((x) => x.id === tplId);
    if (!tpl) return;
    const { lines: tplLines, nextSeed } = resolveTemplate(tpl, accounts, defaultCur, _lineSeq);
    _lineSeq = nextSeed;
    setLines(tplLines.map((l) => ({ ...l, currency: defaultCur })));
    setReason(tpl.name?.[lang] || tpl.name?.ru || tpl.name?.en || tpl.id);
  }

  async function submit() {
    if (!validation.ok || submitting) return;
    setSubmitting(true);
    try {
      await rpcCreateManualEntryV2(buildManualEntryPayload(draft, refCurrency, fxOf));
      emitToast("success", t("trv2_pm_posted"));
      resetForm();
      onDone?.();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/42501|permission|authenticated|Not authenticated|role/i.test(msg)) emitToast("error", t("trv2_pm_err_forbidden"));
      else if (/balance|fx rate/i.test(msg)) emitToast("error", `${t("trv2_pm_err_unbalanced")} (${msg})`);
      else emitToast("error", `${t("trv2_pm_err_generic")}: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  const previewEntries = lines
    .filter((l) => l.accountCode && Number(l.amount) > 0)
    .map((l, i) => {
      const a = accByCode(l.accountCode);
      return { id: `prev${i}`, direction: l.side, amount: Number(l.amount), currency: l.currency, accountCode: a?.code || l.accountCode, accountName: a?.name || "?" };
    });

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-bold">{t("trv2_pm_title")}</h2>

      <div className="bg-white border border-border-soft rounded-[12px] p-4 space-y-4">
        {/* header: date + default currency + template */}
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-muted">{t("trv2_pm_effective_date")}</span>
            <input type="date" value={dateStr} min={minDateInputValue()} max={todayInputValue()}
              onChange={(e) => setDateStr(e.target.value)}
              className="bg-surface-soft border border-border-soft rounded-[8px] px-2 py-1.5 outline-none" />
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-muted">{t("trv2_pm_currency")}</span>
            <select value={defaultCur} onChange={(e) => changeDefaultCurrency(e.target.value)}
              className="bg-surface-soft border border-border-soft rounded-[8px] px-2 py-1.5 outline-none">
              {[...new Set([defaultCur, ...currencies])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 text-[12.5px] ml-auto min-w-[260px]">
            <span className="text-muted shrink-0">{t("trv2_pm_template")}</span>
            <div className="flex-1 min-w-0">
              <SearchableSelect
                value={null}
                options={templateOpts}
                onChange={applyTemplate}
                placeholder={t("trv2_pm_template_pick")}
                emptyText={t("trv2_pm_template_empty")}
              />
            </div>
          </div>
        </div>

        {/* lines table */}
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-muted-soft text-[10px] uppercase tracking-wider">
              <th className="text-left px-2 py-1 w-20">{t("trv2_pm_currency")}</th>
              <th className="text-left px-2 py-1">{t("trv2_pm_col_account")}</th>
              <th className="text-left px-2 py-1">{t("trv2_pm_col_counterparty")}</th>
              <th className="text-right px-2 py-1 w-32">{t("trv2_pm_col_dr")}</th>
              <th className="text-right px-2 py-1 w-32">{t("trv2_pm_col_cr")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const acc = accByCode(l.accountCode);
              const needsClient = !!acc?.clientDimRequired;
              const needsPartner = !!acc?.partnerDimRequired;
              const cpKind = needsPartner ? "partner" : "client";
              const cpOpts = (needsClient || needsPartner) && ctx?.counterpartyOptions ? ctx.counterpartyOptions(cpKind) : [];
              const cpVal = needsPartner ? (l.partnerId || "") : needsClient ? (l.clientId || "") : "";
              const cpErr = lineErr(l.id, "counterparty");
              const curErr = lineErr(l.id, "currency");
              return (
              <tr key={l.id} className="border-t border-border-soft align-top">
                <td className="px-2 py-1.5">
                  <select value={l.currency || defaultCur} onChange={(e) => setLineCurrency(l.id, e.target.value)}
                    className={`w-full bg-surface-soft border rounded-[8px] px-1.5 py-1 text-[12px] outline-none ${curErr ? "border-danger/40" : "border-border-soft"}`}>
                    {[...new Set([l.currency || defaultCur, ...currencies])].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {curErr && <div className="text-[10px] text-danger mt-0.5">{curErr.message}</div>}
                </td>
                <td className="px-2 py-1.5">
                  <AccountPicker accounts={accounts} currency={l.currency || defaultCur} value={l.accountCode}
                    onChange={(code) => patchLine(l.id, { accountCode: code, clientId: null, partnerId: null })} />
                  {(lineErr(l.id, "account")) && <div className="text-[10px] text-danger mt-0.5">{lineErr(l.id, "account").message}</div>}
                </td>
                <td className="px-2 py-1.5">
                  {(needsClient || needsPartner) && (
                    <>
                      <SearchableSelect
                        value={cpVal || null}
                        options={cpOpts}
                        placeholder={t("trv2_pm_pick_counterparty")}
                        error={!!cpErr}
                        onChange={(id) => patchLine(l.id, needsPartner ? { partnerId: id } : { clientId: id })}
                      />
                      {cpErr && <div className="text-[10px] text-danger mt-0.5">{t("trv2_pm_err_counterparty")}</div>}
                    </>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input inputMode="decimal" value={l.side === "dr" ? l.amount : ""}
                    onChange={(e) => setAmount(l.id, "dr", e.target.value)}
                    className={`w-28 text-right bg-surface-soft border rounded-[8px] px-2 py-1 outline-none ${l.side === "dr" && lineErr(l.id, "amount") ? "border-danger/40" : "border-border-soft"}`} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input inputMode="decimal" value={l.side === "cr" ? l.amount : ""}
                    onChange={(e) => setAmount(l.id, "cr", e.target.value)}
                    className={`w-28 text-right bg-surface-soft border rounded-[8px] px-2 py-1 outline-none ${l.side === "cr" && lineErr(l.id, "amount") ? "border-danger/40" : "border-border-soft"}`} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button type="button" title={t("trv2_pm_remove_line")} disabled={lines.length <= 2}
                    onClick={() => removeLine(l.id)}
                    className="p-1 rounded text-muted-soft hover:text-danger disabled:opacity-30 disabled:hover:text-muted-soft">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" onClick={addLine} className="text-[12px] text-indigo-600 hover:underline">{t("trv2_pm_add_line")}</button>

        {/* balance indicator */}
        <div className={`rounded-[10px] px-3 py-2 text-[12.5px] font-medium ${balanced ? "bg-success-soft text-emerald-800" : "bg-warning-soft text-amber-800"}`}>
          {multi
            ? `${t("trv2_pm_balance_base")}: ${fmtNum(dr)} / ${fmtNum(cr)} ${balCur} (Δ ${fmtNum(delta)})`
            : t("trv2_pm_balance").replace("{dr}", fmtNum(dr)).replace("{cr}", fmtNum(cr)).replace("{delta}", fmtNum(delta))}
          {" — "}{balanced ? t("trv2_pm_balanced") : t("trv2_pm_unbalanced")}
        </div>

        {/* reason + description */}
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={t("trv2_pm_reason_ph")}
            className="w-full bg-surface-soft border border-border-soft rounded-[8px] px-2.5 py-2 text-[12.5px] outline-none" />
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={t("trv2_pm_description")}
            className="w-full bg-surface-soft border border-border-soft rounded-[8px] px-2.5 py-1.5 text-[12.5px] outline-none" />
        </div>

        {/* preview */}
        {previewEntries.length >= 2 && (
          <div className="border border-border-soft rounded-[10px]">
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-soft border-b border-border-soft">{t("trv2_pm_preview")}</div>
            <TransactionEntries entries={previewEntries} />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="button" disabled={!validation.ok || submitting} onClick={submit}
            className="px-4 py-2 rounded-[10px] text-[13px] font-semibold bg-ink text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {t("trv2_pm_post")}
          </button>
        </div>
      </div>
    </div>
  );
}
