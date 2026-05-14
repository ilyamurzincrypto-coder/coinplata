// Helper для inline-редактирования итогового остатка прямо в Казначействе
// (AssetsTab / LiabilitiesTab / EquityTab). Пользователь вводит «сколько
// должно быть» (в формате отображения, с учётом displayMul), хелпер считает
// дельту относительно текущего балансового сальдо и собирает 2-leg manual
// journal entry против Opening Equity по валюте.
//
// Соглашение знаков (memory: feedback_kirill_accounting):
//   asset:      display = Dr−Cr     (displayMul = +1)
//   liability:  display = −(Dr−Cr)  (displayMul = −1)  → обязательство 500 показывается как −500
//   equity:     display = Cr−Dr или Dr−Cr — зависит от подтипа, ниже edit
//               на самом Opening Equity заблокирован отдельно.
//
// internalDelta = displayMul * (newDisplayed − oldDisplayed)
//   > 0 → Dr target / Cr opening   (магнитудой = |delta|)
//   < 0 → Cr target / Dr opening
//   = 0 → no-op

import { rpcCreateManualEntryV2 } from "../newLedger.js";

export class SetBalanceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Округление до 2 знаков для денежного сравнения (избавляемся от float-шумов
// при пересчёте дельты — ввод и стор хранят 2 знака максимум).
const round2 = (x) => Math.round(Number(x) * 100) / 100;

// Найти счёт Opening Equity 3100 по валюте таргета.
// Returns the account row from ctx.accounts (chart-of-accounts) or null.
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

// Построить payload для rpcCreateManualEntryV2.
//   target: { code, currency, type, subtype }    — счёт, который правим
//   oldDisplayed, newDisplayed: number           — старое и новое значение в формате отображения
//   displayMul: 1 | -1                            — мультипликатор отображения (asset=+1, liability=−1)
//   accounts: array из ctx.accounts               — нужен чтобы найти Opening Equity
//   clientId, partnerId: uuid|null                — субконто-измерение для target-линии
//                                                  (нужно когда target — dimensioned счёт, например
//                                                  «Обязательства перед клиентами» по конкретному клиенту).
//                                                  Opening Equity 3100 — plain, dim ему не передаём.
//
// Бросает SetBalanceError при невалидном вводе / отсутствии 3100 / попытке
// править сам Opening Equity (его правят через прибыль/убыток в Журнале).
export function buildSetBalancePayload({
  target,
  oldDisplayed,
  newDisplayed,
  displayMul = 1,
  accounts,
  effectiveDate,
  clientId = null,
  partnerId = null,
}) {
  if (!target?.code || !target?.currency) {
    throw new SetBalanceError("bad_target", "Bad target account");
  }
  if (!Number.isFinite(Number(newDisplayed))) {
    throw new SetBalanceError("bad_input", "Введи число");
  }

  // Блок: править Opening Equity через эту фичу нельзя — корр-счёт совпадает
  // с таргетом, проводка вырождается. Капитал-перезалив идёт через Журнал.
  if (target.type === "equity" && (target.subtype || "") === "opening_balance") {
    throw new SetBalanceError(
      "opening_equity_self",
      "Opening Equity правится через Журнал (прибыль/убыток), не inline."
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

  // Target-линия получает client/partner dim, если он передан (для субконто).
  // Counter (Opening Equity 3100) — всегда без dim, это plain equity счёт.
  const targetLine = {
    accountCode: target.code,
    direction: targetDir,
    amount,
    currencyCode: target.currency,
  };
  if (clientId) targetLine.clientId = clientId;
  if (partnerId) targetLine.partnerId = partnerId;

  const dimSuffix = clientId
    ? ` · client=${String(clientId).slice(0, 8)}`
    : partnerId
    ? ` · partner=${String(partnerId).slice(0, 8)}`
    : "";

  return {
    noop: false,
    payload: {
      lines: [
        targetLine,
        { accountCode: opening.code, direction: openingDir, amount, currencyCode: target.currency },
      ],
      currencyCode: target.currency,
      reason: `Set balance ${target.code}${dimSuffix} → ${newD}`,
      description: `Inline-correction · ${oldD} → ${newD} (${target.currency})${dimSuffix}`,
      effectiveDate: effectiveDate || new Date().toISOString(),
      metadata: {
        source: "treasury_inline_set_balance",
        ...(clientId ? { client_id: clientId } : {}),
        ...(partnerId ? { partner_id: partnerId } : {}),
      },
    },
  };
}

// Шорткат — собрать payload и сразу выстрелить RPC.
export async function setAccountBalance(args) {
  const built = buildSetBalancePayload(args);
  if (built.noop) return { noop: true };
  const txId = await rpcCreateManualEntryV2(built.payload);
  return { noop: false, txId };
}
