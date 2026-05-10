// src/pages/treasury_v2/parts/AccountPicker.jsx
// Native grouped <select> over postable ledger accounts for a given currency.
// "Postable" = active, currency matches, no required client/partner dimension
// (see postingEntry.accountsForCurrency). Shows an informational chip when the
// selected account is a system-driven subtype (crypto/clearing) that's usually
// moved by automated flows.
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { accountsForCurrency, SYSTEM_DRIVEN_SUBTYPES } from "../../../lib/treasury/postingEntry.js";

export default function AccountPicker({ accounts, currency, value, onChange }) {
  const { t } = useTranslation();
  const options = useMemo(() => accountsForCurrency(accounts, currency), [accounts, currency]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const a of options) {
      const k = a.subtype || "other";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const selected = options.find((a) => a.code === value) || null;
  const showSystemHint = selected && SYSTEM_DRIVEN_SUBTYPES.has(selected.subtype);

  if (options.length === 0) {
    return <span className="text-[12px] text-slate-400">{t("trv2_pm_no_accounts")}</span>;
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[8px] px-2 py-1.5 text-[12.5px] outline-none"
      >
        <option value="">— {t("trv2_pm_col_account")} —</option>
        {groups.map(([subtype, accts]) => (
          <optgroup key={subtype} label={subtype}>
            {accts.map((a) => (
              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {showSystemHint && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
          {t("trv2_pm_system_account_hint")}
        </span>
      )}
    </div>
  );
}
