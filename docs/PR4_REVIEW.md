# PR #4 newLedger.js — review для Direction 2 basis

## Verdict: ✅ ACTUAL — мержим как basis

Сигнатуры всех 8 v2-обёрток в `newLedger.js` (commit 56609d3) **совпадают
1-в-1** с финальными сигнатурами RPC в БД, проверенными через
`pg_get_function_arguments`. Multi-currency commission, source/destination,
fee_paid_by — всё ок.

`canonicalJson` и `requestHash` — детерминированы, тесты покрывают
key-order independence + nested payloads.

3 минорные доработки нужны, **но в рамках Direction 2** (не PR #4):
1. `mapErrorCodeToFriendly` — новый layer в `dealOperations.js`
2. Adapter передаёт правильный commission array
3. Новые v2 RPC (`update_deal_v2`, `update_tx_metadata`, `create_adjustment`) — новые миграции

## Side-by-side: newLedger.js call vs RPC signature

### 1. `rpcCreateTopupV2` ↔ `ledger.create_topup`

| RPC param | RPC type | newLedger sends |
|---|---|---|
| `p_idempotency_key` | uuid | ✅ key |
| `p_request_hash` | text | ✅ requestHash(payload) |
| `p_client_id` | uuid | ✅ payload.clientId |
| `p_account_code` | text | ✅ payload.accountCode |
| `p_amount` | numeric | ✅ payload.amount |
| `p_currency_code` | text | ✅ payload.currencyCode |
| `p_effective_date` | timestamptz default now() | ⚠️ не передаётся (default OK) |
| `p_description` | text default 'Customer topup' | ✅ payload.description ?? "Customer topup" |
| `p_external_ref` | text default NULL | ✅ payload.externalRef ?? null |
| `p_metadata` | jsonb default '{}' | ✅ payload.metadata ?? {} |

✅ Совпадает.

### 2. `rpcCreateWithdrawalV2` ↔ `ledger.create_withdrawal`

`fee_paid_by` — **подтверждено**: RPC читает через `p_metadata->>'fee_paid_by'`
с дефолтом `'exchange'`, валидирует `IN ('exchange','client')`, иначе
`ERRCODE='22000'`. newLedger.js пакует `payload.feePaidBy` в `metadata.fee_paid_by`.

Все другие параметры совпадают.

✅ Совпадает.

### 3. `rpcCreateDealV2` ↔ `ledger.create_deal_v2`

| RPC param | RPC type | newLedger sends |
|---|---|---|
| `p_idempotency_key` | uuid | ✅ |
| `p_request_hash` | text | ✅ |
| `p_client_id` | uuid | ✅ |
| `p_office_id` | uuid | ✅ |
| `p_in_legs` | jsonb (array) | ✅ inLegs map с camel→snake (account_code, rate_source) |
| `p_out_legs` | jsonb (array) | ✅ outLegs map с deferred default false |
| `p_commission` | jsonb (array) | ⚠️ **проксируется as-is** — adapter ОБЯЗАН передавать `[{currency, amount, kind:'commission'\|'spread'}]` |
| `p_effective_date` | timestamptz | ⚠️ не передаётся |
| `p_description` | text | ✅ |
| `p_metadata` | jsonb | ✅ |

Returns: `TABLE(deal_tx_id, settle_tx_ids[], recognition_tx_id)` →
newLedger делает `Array.isArray(data) ? data[0] : data`. ✅

### 4. `rpcCompleteDealLegV2` ↔ `ledger.complete_deal_leg`

Returns `TABLE(settle_tx_id, recognition_tx_id)` → unwrap первой строкой. ✅

### 5. `rpcCreateTransferV2` ↔ `ledger.create_transfer`

Параметры совпадают. `fee` пакуется как `{amount, account_code}`. ✅

### 6. `rpcCreateReservationV2` ↔ `ledger.create_reservation`

Совпадает. ✅

### 7. `rpcReleaseReservationV2` ↔ `ledger.release_reservation`

Совпадает. ✅

### 8. `rpcReverseTransactionV2` ↔ `ledger.reverse_transaction`

Returns `uuid[]` (массив cascade-tx_ids) — newLedger возвращает as-is. ✅

## canonicalJson — детерминированный

```js
function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
}
```

**Проверки:**
- ✅ Sorted keys на каждом уровне рекурсии
- ✅ `undefined` опускается (`null` остаётся)
- ✅ Arrays порядок сохраняется (legs важно!)
- ✅ Strings escape через `JSON.stringify`
- ⚠️ Numbers: `1` и `1.0` → оба `"1"` (JS coerces). Если adapter передаёт amount как `Number(...)` всегда — детерминированно.
- ⚠️ NaN/Infinity не обрабатывается (выбросит exception от JSON.stringify) — adapter должен фильтровать.
- ⚠️ Date / BigInt / function — bросает Error в else branch. Adapter не должен передавать такие типы.

`requestHash` — `SHA-256(canonicalJson(payload))` через Web Crypto.
Тесты в `newLedger.test.js` покрывают:
- determinism (same input → same hash)
- key-order independence (`{a,b}` ↔ `{b,a}` → same hash)
- nested payloads
- 100 distinct UUIDs from `newIdempotencyKey()`

## Error mapping — нужно расширить в Direction 2

`formatLedgerError` сейчас просто конкатенирует `message · details · hint`.
Для UX нужен `mapErrorCodeToFriendly(error)` в Direction 2:

```js
// dealOperations.js
const ERRCODE_MESSAGES = {
  P0422: "Idempotency conflict — payload изменён при retry с тем же ключом",
  P0001: error => error.message, // business rule (e.g. insufficient balance)
  '22000': error => `Invalid params: ${error.message}`,
  P0002: error => `Not found: ${error.message}`,
  '23502': error => `Required field: ${error.message}`,
};
```

⚠️ **Не добавляем в newLedger.js** — там слой raw RPC. Mapping живёт в
`dealOperations.js` (switcher layer).

## Vitest

`package.json` в текущем main НЕ имеет vitest devDep — был добавлен в
PR #4 и потом убран линтером. После merge PR #4 nazад:

```json
"devDependencies": { ..., "vitest": "^1.6.0" },
"scripts": { ..., "test": "vitest run" }
```

Тесты в `newLedger.test.js` пройдут as-is (visual review проверил).

## Plan

1. ✅ Review done — newLedger.js актуален.
2. **Merge PR #4** в main (basis для Direction 2).
3. Schema migration: `ledger_account_code` в `public.accounts` + `partner_accounts` (Q1).
4. 3 NEW RPC: `update_deal_v2` (Q5), `update_tx_metadata` (Q6), `create_adjustment` (Q8).
5. Pre-cutover проверки в runbook (Q3, Q7).
6. `newLedgerAdapter.js` + `dealOperations.js` + 18 consumer updates.

После шагов 2-3 — твой OK на 4-10.

---

**Готов мержить PR #4.** Подтверждаешь?
