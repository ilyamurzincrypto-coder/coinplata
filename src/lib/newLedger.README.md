# newLedger.js — RPC integration с новым ledger

Обёртки над `ledger.*` RPC (миграции 2.a-2.e). Изолированный namespace
от legacy `supabaseWrite.js` — чтобы не пачкать существующий контракт.

## API

| Function | RPC |
|---|---|
| `rpcCreateTopupV2` | `ledger.create_topup` |
| `rpcCreateWithdrawalV2` | `ledger.create_withdrawal` |
| `rpcCreateDealV2` | `ledger.create_deal_v2` |
| `rpcCompleteDealLegV2` | `ledger.complete_deal_leg` |
| `rpcCreateTransferV2` | `ledger.create_transfer` |
| `rpcCreateReservationV2` | `ledger.create_reservation` |
| `rpcReleaseReservationV2` | `ledger.release_reservation` |
| `rpcReverseTransactionV2` | `ledger.reverse_transaction` |

## Helpers (exported)

- `newIdempotencyKey()` — UUID v4
- `canonicalJson(value)` — детерминированный stringify (sorted keys, omit undefined)
- `requestHash(payload)` — SHA-256 hex от canonical JSON
- `USE_NEW_LEDGER` — `true` если `import.meta.env.VITE_USE_NEW_LEDGER === "true"`

## Idempotency

Каждая обёртка автоматически:
- генерирует `idempotencyKey` если не передан явно;
- считает `requestHash` от payload (без поля `idempotencyKey`);
- передаёт `(p_idempotency_key, p_request_hash, ...)` в RPC.

При повторном вызове с тем же ключом + тем же hash → возвращает
закешированный результат (replay). При том же ключе + другом hash →
RPC бросает `P0422`.

## Включение

В `.env.local` (НЕ коммитим):
```
VITE_USE_NEW_LEDGER=true
```

После — перезапустить dev-сервер.

В `CashierPage.jsx` (или другом потребителе) — switch:
```js
import { USE_NEW_LEDGER, rpcCreateDealV2 } from "../lib/newLedger.js";
import { rpcCreateDeal } from "../lib/supabaseWrite.js";

const createDeal = USE_NEW_LEDGER ? rpcCreateDealV2 : rpcCreateDeal;
```

## Контракты payload

### `rpcCreateDealV2`

Frontend payload (camelCase) → RPC params (snake_case).

```js
await rpcCreateDealV2({
  clientId: "uuid",
  officeId: "uuid",
  inLegs: [
    { currency: "USDT", amount: 1000, source: "fresh", accountCode: "1316" }
  ],
  outLegs: [
    { currency: "TRY", amount: 33000, destination: "physical", accountCode: "1112" }
  ],
  commission: [
    { currency: "TRY", amount: 330, kind: "commission" }
  ],
  // optional:
  description, metadata, idempotencyKey,
});
// → { deal_tx_id, settle_tx_ids, recognition_tx_id }
```

`source ∈ {"fresh", "from_balance"}`, `destination ∈ {"physical", "to_balance"}`.

### `rpcCreateWithdrawalV2`

```js
await rpcCreateWithdrawalV2({
  clientId, currencyCode, amount, destinationAccount,
  networkFee: { amount: 2, accountCode: "5136" },  // optional
  feePaidBy: "client",                              // optional, default "exchange"
  externalRef,                                      // optional
});
```

### `rpcReverseTransactionV2`

```js
await rpcReverseTransactionV2({
  targetTxId,
  reason: "обоснование (обязательно)",
  cascade: true,        // default; для deal/leg_settle false — RAISE 22000
});
// → string[] (array of reverse-tx_ids; включая cascade-reverses)
```

## Tests

```bash
npm run test          # один проход
npm run test:watch    # watch mode
```

Тесты: `src/lib/newLedger.test.js`. Покрывают:
- `canonicalJson` — детерминированность, сортировка ключей, omit undefined
- `requestHash` — детерминированность, key-order independence
- `newIdempotencyKey` — формат UUID v4, uniqueness

Integration-тесты с реальной БД — отдельная задача (требует Supabase test
project + cleanup).

## Не трогаем legacy

`rpcCreateDeal`, `rpcUpdateDeal` в `supabaseWrite.js` остаются неизменными.
После cutover (≥48 часов production-проверки нового ledger) можно будет
удалить legacy.

## Cutover ready-list

- [x] Все 8 RPC реализованы и протестированы (~50 тестов)
- [x] Frontend wrappers + feature-flag
- [x] Unit-тесты для request_hash determinism
- [ ] Cutover scripts (generate_opening_transaction.sql) — Direction 1
- [ ] Verification SQL (3 сверки) — Direction 1
- [ ] freeze_legacy.sql — Direction 1
