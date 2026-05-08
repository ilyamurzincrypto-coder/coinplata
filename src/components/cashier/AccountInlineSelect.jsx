// src/components/cashier/AccountInlineSelect.jsx
// Inline dropdown для выбора account из активных.
// Filter: тот же офис + та же валюта (если currency задана).
//
// Под USE_NEW_LEDGER:
//   • legacy_only=true accounts → показываем grey + " (legacy only)" + не выбираемы
//   • ledger_account_code IS NULL → показываем + " (no ledger map)" предупреждение
// Под USE_NEW_LEDGER=false — показываем все active accounts без флагов.

import React, { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { USE_NEW_LEDGER } from "../../lib/newLedger.js";

export default function AccountInlineSelect({
  value,
  onChange,
  currency,
  officeId,
  placeholder = "— счёт —",
  ariaLabel,
  onKeyDown,
  inputRef,
  disabled = false,
}) {
  const { accounts, balanceOf } = useAccounts();
  const { activeOffices } = useOffices();

  const options = useMemo(() => {
    return accounts
      .filter((a) => a.active)
      .filter((a) => !currency || a.currency === currency)
      // Bank-type accounts могут быть без office (International) — не отбрасываем
      .filter((a) => !officeId || a.officeId === officeId || !a.officeId)
      .map((a) => {
        const officeName =
          activeOffices.find((o) => o.id === a.officeId)?.name ||
          (a.officeId ? a.officeId : "—");
        // Под USE_NEW_LEDGER оба случая = "не работает с новым ledger" → disabled
        const isLegacyOnly = USE_NEW_LEDGER && a.legacyOnly;
        const isUnmapped = USE_NEW_LEDGER && !a.ledgerAccountCode && !a.legacyOnly;
        const blocked = isLegacyOnly || isUnmapped;
        const tag = isLegacyOnly
          ? " · ⚠ legacy-only"
          : isUnmapped
            ? " · ⚠ no ledger map"
            : "";
        return {
          value: a.id,
          label: a.name,
          currency: a.currency,
          officeName,
          balance: balanceOf(a.id),
          blocked,
          tag,
        };
      });
  }, [accounts, balanceOf, activeOffices, currency, officeId]);

  return (
    <div className="relative w-full">
      <select
        ref={inputRef}
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
        disabled={disabled}
        className={
          `w-full appearance-none bg-transparent border-0 outline-none ` +
          `text-[13px] text-slate-700 ` +
          `focus:bg-white focus:ring-1 focus:ring-slate-300 rounded-[var(--radius-cell)] ` +
          `pl-2 pr-7 py-1.5 cursor-pointer ` +
          `disabled:cursor-not-allowed disabled:opacity-50`
        }
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.blocked}>
            {o.officeName} · {o.label} · {curSymbol(o.currency)}
            {fmt(o.balance, o.currency)}
            {o.tag}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none"
      />
    </div>
  );
}
