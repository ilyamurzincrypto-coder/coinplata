# Direction 2 — Project audit

Аудит перед реализацией обёрток v2 + feature-flag в `src/lib/`.
**Этот документ — только анализ. Кода нет до OK от owner.**

## 1. Текущее состояние

### Legacy `rpcCreate*` живут в `src/lib/supabaseWrite.js` (2017 строк, 86 exports)

Релевантные для Direction 2 (movement-creating, audit-affected):

| Wrapper | Line | Legacy RPC | v2 mapping |
|---|---|---|---|
| `rpcCreateDeal` | 212 | `create_deal` | `ledger.create_deal_v2` |
| `rpcUpdateDeal` | 298 | `update_deal_v2` | reverse + create_deal_v2 |
| `rpcAddDealInPayment` | 377 | `add_deal_in_payment` | (?) deal extra leg |
| `rpcAddDealLegPayment` | 400 | `add_deal_leg_payment` | `complete_deal_leg` |
| `rpcCompleteDeal` | 423 | `complete_deal` | `complete_deal_leg` × N |
| `rpcDeleteDeal` | 433 | `delete_deal` | `reverse_transaction` |
| `rpcHardDeleteDeal` | 448 | `hard_delete_deal` | НЕ нужно (immutable) |
| `rpcConfirmDealLeg` | 458 | `confirm_deal_leg` | metadata-only, no v2 |
| `rpcMarkDealSent` | 473 | `mark_deal_sent` | metadata-only |
| `rpcSettleObligation` | 495 | `settle_obligation` | `complete_deal_leg` |
| `rpcSettleObligationPartial` | 512 | `settle_obligation_partial` | `complete_deal_leg` (partial) |
| `rpcReceivePayment` | 530 | `receive_payment` | `create_topup` (от клиента) |
| `rpcCancelObligation` | 546 | `cancel_obligation` | `release_reservation` |
| `rpcCreateTransfer` | 560 | `create_transfer` | `ledger.create_transfer` |
| `rpcCreateBalanceAdjustment` | 763 | `create_balance_adjustment` | НЕ wrap (опасно — open вопрос) |
| `rpcRecordPartnerInflow` | 788 | `record_partner_inflow` | `create_topup` (partner_id dim) |
| `rpcRecordPartnerOutflow` | 808 | `record_partner_outflow` | `create_withdrawal` |
| `rpcTopUp` | 849 | `topup_account` | `ledger.create_topup` |
| `rpcCreateCashClosure` | 720 | `create_cash_closure` | (?) опционально |
| `rpcDeleteTransfer` | 700 | `delete_transfer` | `reverse_transaction` |

### v2-обёртки уже существуют в `src/lib/newLedger.js` (PR #4, ledger/stage3-rpc-integration)

Готовый namespace из 8 функций (`commit 56609d3`):
- `rpcCreateTopupV2`
- `rpcCreateWithdrawalV2`
- `rpcCreateDealV2`
- `rpcCompleteDealLegV2`
- `rpcCreateTransferV2`
- `rpcCreateReservationV2`
- `rpcReleaseReservationV2`
- `rpcReverseTransactionV2`

Готовые helpers: `newIdempotencyKey`, `canonicalJson`, `requestHash`, `USE_NEW_LEDGER` const.

⚠️ **Эта ветка ещё не merged**. Нужно либо смержить её сначала, либо взять диффом сюда.
Я предлагаю — **смержить stage3 в main первым**, потом продолжить Direction 2 поверх.

## 2. Список консумеров (18 файлов)

```
src/pages/CashierPage.jsx         — rpcCreateDeal (137)
src/components/ExchangeForm.jsx   — собирает payload, не вызывает RPC
src/components/EditTransactionModal.jsx — rpcUpdateDeal (49)
src/components/OtcDealWizard.jsx  — rpcCreateDeal (431)
src/components/OtcDealModal.jsx   — rpcCreateDeal (103)
src/components/DeleteDealButton.jsx — rpcDeleteDeal (38)
src/components/TransactionsTable.jsx — rpcDeleteDeal (218), rpcCompleteDeal (275, 626)
src/components/accounts/TransferModal.jsx — rpcCreateTransfer (118)
src/components/accounts/TopUpModal.jsx — rpcTopUp (68)
src/components/accounts/BalanceAdjustmentModal.jsx — (не входит в Direction 2)
src/components/CashClosureModal.jsx — rpcCreateCashClosure
src/components/DeleteTransferButton.jsx — rpcDeleteTransfer
src/components/ObligationsModal.jsx — settle/receive/cancel
src/pages/counterparties/ObligationsTab.jsx — settle/receive/cancel
src/components/settings/PartnerSettlementModal.jsx — partner inflow/outflow
src/pages/capital/AccountingTab.jsx — rpcDeleteEntity, rpcAccountingReview
src/lib/supabaseWrite.js          — определения
src/store/audit.jsx               — рефлектор аудита
```

Самые горячие точки (где будут writes в новый ledger):
1. **CashierPage.handleCreate** — главный путь сделок
2. **EditTransactionModal.handleSubmit** — редактирование сделок
3. **TransferModal.handleSubmit** — переводы
4. **TopUpModal.handleSubmit** — пополнения
5. **OtcDealWizard / OtcDealModal** — OTC через `rpcCreateDeal`
6. **DeleteDealButton + TransactionsTable.delete** — `rpcDeleteDeal` → reverse
7. **CompleteDeal (TransactionsTable.complete)** — `rpcCompleteDeal` → `complete_deal_leg × N`

## 3. Формат legacy payload (типичный для `rpcCreateDeal`)

```js
{
  // dim
  officeId, managerId, clientId, clientNickname,

  // IN side
  currencyIn, amountIn,
  inAccountId,         // UUID наш счёт ИЛИ
  inPartnerAccountId,  // UUID партнёра (взаимоисключающее)
  inKind,              // ours_now/ours_later/partner_now/partner_later
  inPayments[],        // multi-currency: {amount, currency, kind, accountId, partnerAccountId}
  inTxHash,
  deferredIn,          // boolean

  // OUT side
  outputs: [
    {
      currency, amount, rate,
      outKind,            // ours_now/ours_later/partner_now/partner_later
      accountId,          // ours_now → наш счёт UUID
      partnerAccountId,   // partner_now → партнёр UUID
      address, network,   // crypto leg
      payments[],         // multi-payment per leg
      payNow,             // partial payout
    }
  ],

  // commission/fee
  commissionUsd,    // явная брокерская
  customFeeUsd,     // override fee_usd, null=auto
  applyMinFee,      // применять ли min_fee офиса

  // metadata
  status,         // completed/pending/checking/deleted
  kind,           // regular/otc/broker
  comment, referral, plannedAt,
}
```

## 4. Формат v2 payload (для `create_deal_v2`)

```js
{
  clientId, officeId,
  inLegs: [
    { currency, amount, source: 'fresh'|'from_balance',
      accountCode, rate?, rateSource? }
  ],
  outLegs: [
    { currency, amount, destination: 'physical'|'to_balance',
      accountCode, rate?, rateSource?, deferred? }
  ],
  commission: [
    { currency, amount, kind: 'commission'|'spread' }
  ],
  description, metadata,
}
```

## 5. Маппинг legacy → v2 (адаптер)

### 5.1 inLegs

| Legacy field | v2 inLeg | Notes |
|---|---|---|
| `{currencyIn, amountIn, inAccountId}` | `{currency, amount, source:'fresh', accountCode: <map(inAccountId)>}` | главный leg |
| `{currencyIn, amountIn, inPartnerAccountId}` | `{currency, amount, source:'fresh', accountCode: '2210/2212/...' (partner liab)}` + `metadata.partner_id=<id>` | OTC: партнёр сдал |
| `inKind == 'ours_later'` | `inLegs=[]` (не сдавал ещё) + `metadata.deferred_in=true` | односторонняя OUT |
| `inPayments[]` | дополнительные `inLegs` с другими валютами | |

### 5.2 outLegs

| Legacy field | v2 outLeg | Notes |
|---|---|---|
| `{currency, amount, rate, accountId, outKind:'ours_now'}` | `{currency, amount, destination:'physical', accountCode: <map(accountId)>, rate, deferred:false}` | стандарт |
| `{currency, amount, rate, partnerAccountId, outKind:'partner_now'}` | `{currency, amount, destination:'physical', accountCode: '2210/2212 partner liab', deferred:false}` + `metadata.partner_id` | OTC: партнёр выдал |
| `outKind == 'ours_later'` или `'partner_later'` | `{currency, amount, destination:'physical', deferred:true}` (без accountCode) | deferred → закроется через `complete_deal_leg` |
| `outputs.length == 0` | `outLegs=[]` | односторонняя IN |

### 5.3 commission

| Legacy | v2 commission |
|---|---|
| `commissionUsd > 0` | `[{currency:'USD', amount: commissionUsd, kind:'commission'}]` |
| `customFeeUsd > 0` | `[{currency:'USD', amount: customFeeUsd, kind:'commission'}]` (override margin) |
| Ни того ни другого | `[]` (margin от rates автоматически идёт через `spread`) |

### 5.4 description & metadata

```js
description: legacy.comment
metadata: {
  legacy_deal_id: <after-create>, // для tracing
  manager_id: legacy.managerId,
  client_nickname: legacy.clientNickname,
  status: legacy.status,
  kind: legacy.kind || 'regular',
  referral: !!legacy.referral,
  in_kind: legacy.inKind,
  apply_min_fee: legacy.applyMinFee !== false,
  deferred_in: !!legacy.deferredIn,
}
```

## 6. КРИТИЧЕСКИЙ blocker — `account_id (UUID) → account_code` map

**legacy CashierPage передаёт UUID** из `public.accounts.id` (например `accountId: 'a1b2c3d4-...'`).
**v2 ждёт `account_code`** (например `'1110'` для Cash·Mark·USD).

Без маппинга rpcCreateDealV2 не сможет принять legacy payload.

### Варианты решения

**Вариант A — колонка `ledger_account_code` в `public.accounts`**

```sql
ALTER TABLE public.accounts ADD COLUMN ledger_account_code text;
-- backfill manually для каждого legacy account → его ledger code
```

Плюсы: просто, читается через existing readers, мап на стороне БД.
Минусы: дублирование source-of-truth (если ledger.accounts добавили новый — synced вручную).

**Вариант B — JS-таблица map в `src/lib/accountCodeMap.js`**

```js
export const LEGACY_TO_LEDGER = {
  'a1b2c3...': '1110',
  // ...
};
```

Плюсы: ноль миграций, контролируется кодом.
Минусы: легко забыть обновить; читается отдельно от accounts; не видна в DB.

**Вариант C — view + RPC `ledger.resolve_account_code(uuid)`**

```sql
CREATE FUNCTION ledger.resolve_account_code(p_legacy_id uuid)
  RETURNS text;
```

Плюсы: source-of-truth в БД, frontend получает на лету.
Минусы: roundtrip per call.

**Моя рекомендация — Вариант A**:
- Single column в `public.accounts` (видна в `supabaseReaders` без extra RPC)
- Backfill один раз на cutover-day (часть Шаг 0 в runbook)
- Frontend resolver: `account.ledger_account_code || throw "Account X not mapped"`

Аналогично для `partner_accounts` → `2210/2212/...` partner liab по валюте партнёра + `partner_id`.

## 7. Семантические различия (нужны решения owner)

### 7.1 Customer Liab dim
В legacy obligations используется `client_id` через отдельную таблицу `obligations` с `they_owe`/`we_owe`. В v2 — это просто `2110/2112/...` Customer Liability с `client_id` в journal_entries.

`rpcReceivePayment(obligationId, accountId, amount)` (clients pays back debt) → в v2 это `create_topup` с `metadata.legacy_obligation_id` для tracing.

⚠️ **Open вопрос**: legacy обязательства привязаны к `obligation.id`. Новый ledger не имеет obligations table, только Customer Liab balance. Резолвинг "уменьшить obligation X" → "уменьшить Customer Liab клиента X в валюте Y на amount" — простое, но нужно убедиться что legacy и v2 ведут одинаковый счёт за тот же период.

**На cutover** — legacy obligations не переезжают, opening transaction берёт final balance из inventory (Шаг 1 в runbook). После cutover — только v2 Customer Liab.

### 7.2 deferred_in/out lifecycle
Legacy: `deferredIn=true` → IN movements не создаются, deal остаётся `pending`, потом `add_deal_in_payment` создаёт фактические IN movements.

В v2: deferred_out через `metadata.deferred_legs` + `complete_deal_leg`.
**Deferred IN (legacy) в v2 пока нет** — нужно либо:
- (a) сразу пишем Customer Liab Cr (мы должны клиенту полный амаунт сразу) и потом `create_topup` уменьшает
- (b) добавить `deferred=true` в `inLegs` (зеркально outLegs)

Решение для адаптера: **выбрать (a)** — модель чище. Legacy `deferredIn=true` → в v2 `inLegs=[]`, `metadata.deferred_in=true`, дальше отдельный `create_topup` когда клиент сдаёт.

### 7.3 status='pending' / 'checking'
Legacy сохраняет это в `deals.status`. В v2 — нет статусов на tx (immutable). Нужно решение:
- (a) переносим в metadata (`metadata.legacy_status`) — для отчётов и UI
- (b) `pending` → resolve через `create_reservation` + later `complete`
- (c) deals.status стал чисто визуальным флагом в UI; ledger не следит

**Рекомендую (a)** — простое, не ломает UI. Решение для (b) — отдельный ticket.

### 7.4 Partner accounts (OTC)
Legacy: `partnerAccountId` (UUID `partner_accounts.id`).
v2: Customer Liab кодирована как `2210/2212/...` Partner Liab с `partner_id` в journal_entries.

Нужен **второй map**: `legacy_partner_accounts.id → {accountCode, partnerId, currency}`.

## 8. План работы (порядок реализации)

После OK от owner:

1. **Сначала смержить PR #4 (`ledger/stage3-rpc-integration`)** в main, чтобы `newLedger.js` стал доступен.

2. **Schema migration** — добавить `ledger_account_code` в `public.accounts` + `public.partner_accounts`. Миграция backfill на cutover-day.

3. **`src/lib/newLedgerAdapter.js`** — pure mapping функций без supabase-зависимостей:
   - `adaptLegacyDealPayload(legacy, accountResolver)` → `v2Payload`
   - `adaptLegacyTransferPayload(...)`
   - `adaptLegacyTopupPayload(...)`
   - `inferCommissionFromLegacy(legacy)` — commissionUsd / customFeeUsd / margin
   - Account-code resolver — функция `resolveAccountCode(legacyId, accounts)` → throw or string

4. **`src/lib/dealOperations.js`** (или дополнить supabaseWrite.js — open вопрос ниже):
   - `createDeal(payload)` — switcher: legacy `rpcCreateDeal` или `rpcCreateDealV2(adapt(payload))`
   - `updateDeal(...)` — для v2 = reverse + new (immutable model)
   - `deleteDeal(...)` — switcher
   - `completeDeal(...)`, `addDealLegPayment(...)`
   - `createTransfer(...)`, `topUp(...)`
   - `settleObligation(...)`, `receivePayment(...)`, `cancelObligation(...)`

5. **Обновить consumers** — заменить вызовы `rpcCreateDeal` → `createDeal` в 7 точках:
   - CashierPage.jsx:138
   - EditTransactionModal.jsx:49
   - OtcDealWizard.jsx:431
   - OtcDealModal.jsx:103
   - TransferModal.jsx:118
   - TopUpModal.jsx:68
   - DeleteDealButton.jsx:38, TransactionsTable.jsx:218, 275, 626
   - DeleteTransferButton, ObligationsModal etc.

6. **Vitest unit tests** для адаптера:
   - `canonicalJson` deterministic (уже есть)
   - `adaptLegacyDealPayload` — все 8 сценариев
   - `inferCommissionFromLegacy` — edge cases
   - `resolveAccountCode` — found/missing
   - `requestHash` стабильный для одинакового payload

7. **Manual integration test**:
   - `VITE_USE_NEW_LEDGER=true npm run dev`
   - Создать тест-deal через legacy ExchangeForm
   - Verify в БД: `SELECT * FROM ledger.transactions WHERE source_kind='deal' ORDER BY created_at DESC LIMIT 1`
   - Реверсивный тест: delete → `ledger.transactions.status='reversed'`

8. **README** — `src/lib/README.md` или `src/lib/newLedger.README.md` (уже есть в stage3) дополнить раздел Feature-flag combos.

## 9. Open вопросы owner

Нужны решения до старта impl:

1. **Account-code map** — Вариант A / B / C? *(я голосую за A)*
2. **`deferredIn` в v2** — adapter выбирает (a) сразу Customer Liab Cr + later topup. Подтверждаешь?
3. **legacy `status='pending'`** — переносим как `metadata.legacy_status` (вариант a)?
4. **Где живёт `createDeal` switcher** — добавить в `supabaseWrite.js` (одна точка) ИЛИ в новый `dealOperations.js` (cleaner separation)? *(я склоняюсь ко второму, потому что v2 — async + другой shape ответа)*
5. **rpcUpdateDeal v2** — реверсивный (reverse + new) ИЛИ просто metadata-edit когда возможно? Reverse-and-replay сложнее, но **immutable** — рекомендую.
6. **rpcConfirmDealLeg/rpcMarkDealSent** — это metadata-only флаги (mark_sent адрес записывает в deal_legs.tx_hash). В v2 нет deal_legs table. Куда писать tx_hash? *(я предлагаю — в metadata оригинального deal-tx через `update_metadata` RPC если такой будет, или хранить в legacy таблице read-only после cutover)*
7. **legacy obligations** на cutover — physical inventory уже учитывает их в Customer Liab opening. Подтверждаешь что отдельная миграция obligations НЕ нужна?
8. **`rpcCreateBalanceAdjustment`** — admin-only ручка. Wrap в v2 или оставить только legacy? *(я бы исключил из Direction 2 — это редкое admin действие, можно оставить через legacy + warn в UI)*

## 10. Estimate

После твоего OK:
- Migration + accountCodeMap backfill: 0.5 день
- newLedgerAdapter.js + tests: 1 день
- dealOperations.js switcher + 18 consumer updates: 1 день
- Manual integration testing: 0.5 день

**Total: 2-3 дня.** Параллельно UI Stage 2 не блокируется.

---

**Готов к OK от owner. После OK — начинаю с merge PR #4 → schema migration → adapter → switcher → consumers.**
