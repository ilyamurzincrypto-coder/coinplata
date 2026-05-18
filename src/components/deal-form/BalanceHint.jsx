// src/components/deal-form/BalanceHint.jsx
//
// Подсказка под суммой в DealLeg: текущий баланс счёта + баланс после
// сделки. Поведение:
//   • direction="in" + after >= 0 → text-success «прибавилось»
//   • direction="out" + after >= 0 → нейтральный text-ink («хватает»)
//   • after < 0 → text-danger + ⚠ «не хватает X»
//
// Если accountId не выбран — рендерим placeholder.

import React from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAccounts } from "../../store/accounts.jsx";
import { fmt, curSymbol } from "../../utils/money.js";

export default function BalanceHint({
  accountId,
  amount,         // string-input (parsed внутри)
  direction,      // "in" | "out"
  currency,
}) {
  const { balanceOf } = useAccounts();

  if (!accountId) {
    return (
      <span className="text-tiny text-muted-soft">
        выбери счёт чтобы увидеть баланс
      </span>
    );
  }

  const current = Number(balanceOf(accountId)) || 0;
  const amt = parseFloat(amount);
  const hasAmount = Number.isFinite(amt) && amt > 0;
  const delta = hasAmount ? (direction === "in" ? amt : -amt) : 0;
  const after = current + delta;
  const shortage = after < 0 ? Math.abs(after) : 0;

  const fmtCur = (n) => `${curSymbol(currency)}${fmt(Math.abs(n), currency)}${n < 0 ? "" : ""}`;
  const signedFmt = (n) => `${n < 0 ? "−" : ""}${fmtCur(n)}`;

  const afterTone =
    shortage > 0 ? "text-danger" :
    direction === "in" && hasAmount ? "text-success" :
    "text-ink";

  return (
    <span className="text-tiny font-mono tabular inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-muted">баланс</span>
      <span className="text-ink-soft">{fmtCur(current)}</span>
      {hasAmount && (
        <>
          <ArrowRight className="w-2.5 h-2.5 text-muted-soft" strokeWidth={2.2} />
          <span className={`font-semibold ${afterTone}`}>{signedFmt(after)}</span>
          {shortage > 0 && (
            <span className="inline-flex items-center gap-0.5 text-danger font-semibold ml-1">
              <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.2} />
              не хватает {fmtCur(shortage)}
            </span>
          )}
        </>
      )}
    </span>
  );
}
