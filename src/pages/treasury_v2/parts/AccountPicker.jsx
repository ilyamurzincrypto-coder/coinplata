// src/pages/treasury_v2/parts/AccountPicker.jsx
// Searchable single-select over postable ledger accounts for a given currency.
// "Postable" = active, currency matches, no required client/partner dimension
// (see postingEntry.accountsForCurrency). Display label = `code · name`, with
// the subtype kept in `searchText` so accountants can type either the code,
// the name fragment, or the subtype (e.g. "5210", "rent", or "expense").
// Shows an informational chip when the selected account is a system-driven
// subtype (crypto/clearing) that's usually moved by automated flows.
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { accountsForCurrency, SYSTEM_DRIVEN_SUBTYPES } from "../../../lib/treasury/postingEntry.js";
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";

export default function AccountPicker({ accounts, currency, value, onChange }) {
  const { t } = useTranslation();
  const options = useMemo(() => accountsForCurrency(accounts, currency), [accounts, currency]);
  const ssOptions = useMemo(
    () => options.map((a) => ({
      id: a.code,
      name: `${a.code} · ${a.name}`,
      searchText: `${a.code} ${a.name} ${a.subtype || ""}`,
    })),
    [options]
  );
  const selected = options.find((a) => a.code === value) || null;
  const showSystemHint = selected && SYSTEM_DRIVEN_SUBTYPES.has(selected.subtype);

  if (options.length === 0) {
    return <span className="text-[12px] text-muted-soft">{t("trv2_pm_no_accounts")}</span>;
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="min-w-0 flex-1">
        <SearchableSelect
          value={value || null}
          onChange={(id) => onChange(id || "")}
          options={ssOptions}
          placeholder={`— ${t("trv2_pm_col_account")} —`}
        />
      </div>
      {showSystemHint && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-warning-soft text-amber-700 border border-amber-200 whitespace-nowrap">
          {t("trv2_pm_system_account_hint")}
        </span>
      )}
    </div>
  );
}
