// Helper для inline-редактирования итогового остатка в Казначействе.
// Использует уже работающий ledger.create_manual_entry (2-leg pair):
// target-линия с client/partner dim против Opening Equity {currency}.
//
// internalDelta = displayMul * (newDisplayed − oldDisplayed)
//   > 0 → Dr target / Cr opening
//   < 0 → Cr target / Dr opening

import { rpcCreateManualEntryV2 } from "../newLedger.js";

export class SetBalanceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const round2 = (x) => Math.round(Number(x) * 100) / 100;

export function findOpeningEquityFor(accounts, currency) {
  if (!Array.isArray(accounts) || !currency) return null;
  return (
    accounts.find(
      (a) =>
        a.active !== false &&
        a.type === "equity" &&
        (a.subtype || "") === "opening_balance" &&
        a.currency === currency
    ) || null
  );
}

// Build payload + call RPC. Все параметры из UI:
//   target: { code, currency, type, subtype }
//   oldDisplayed, newDisplayed: number (в формате отображения)
//   displayMul: 1 (asset/equity-other) | -1 (liability)
//   accounts: ctx.accounts (chart of accounts) — нужен для Opening Equity
//   clientId/partnerId: для субконто-target
//   effectiveDate: ISO string (default = now)
//   reason: required — попадает в audit trail
export async function setAccountBalance({
  target,
  oldDisplayed,
  newDisplayed,
  displayMul = 1,
  accounts,
  clientId = null,
  partnerId = null,
  effectiveDate = null,
  reason,
}) {
  if (!target?.code || !target?.currency) {
    throw new SetBalanceError("bad_target", "Bad target account");
  }
  if (!Number.isFinite(Number(newDisplayed))) {
    throw new SetBalanceError("bad_input", "Введи число");
  }
  if (!reason || !String(reason).trim()) {
    throw new SetBalanceError("no_reason", "Укажи причину корректировки");
  }
  if (target.type === "equity" && (target.subtype || "") === "opening_balance") {
    throw new SetBalanceError(
      "opening_equity_self",
      "Opening Equity правится только через ручную проводку в Журнале"
    );
  }

  const opening = findOpeningEquityFor(accounts, target.currency);
  if (!opening) {
    throw new SetBalanceError(
      "no_opening_equity",
      `Нет счёта Opening Equity ${target.currency} (3100). Заведи в плане счетов.`
    );
  }
  if (opening.code === target.code) {
    throw new SetBalanceError("opening_equity_self", "Корр-счёт совпадает с таргетом");
  }

  const oldD = round2(oldDisplayed || 0);
  const newD = round2(newDisplayed);
  const internalDelta = round2(displayMul * (newD - oldD));

  if (Math.abs(internalDelta) < 0.005) {
    return { noop: true };
  }

  const amount = Math.abs(internalDelta).toFixed(2);
  const targetDir = internalDelta > 0 ? "dr" : "cr";
  const openingDir = internalDelta > 0 ? "cr" : "dr";

  const targetLine = {
    accountCode: target.code,
    direction: targetDir,
    amount,
    currencyCode: target.currency,
  };
  if (clientId) targetLine.clientId = clientId;
  if (partnerId) targetLine.partnerId = partnerId;

  const cleanReason = String(reason).trim();
  const dimSuffix = clientId
    ? ` · client=${String(clientId).slice(0, 8)}`
    : partnerId
    ? ` · partner=${String(partnerId).slice(0, 8)}`
    : "";

  const txId = await rpcCreateManualEntryV2({
    lines: [
      targetLine,
      {
        accountCode: opening.code,
        direction: openingDir,
        amount,
        currencyCode: target.currency,
      },
    ],
    currencyCode: target.currency,
    reason: cleanReason,
    description: `Treasury · ${target.code}${dimSuffix}: ${oldD} → ${newD}`,
    effectiveDate: effectiveDate || new Date().toISOString(),
    metadata: {
      source: "treasury_inline_set_balance",
      old_displayed: oldD,
      new_displayed: newD,
      display_mul: displayMul,
      ...(clientId ? { client_id: clientId } : {}),
      ...(partnerId ? { partner_id: partnerId } : {}),
    },
  });
  return { noop: false, txId };
}
