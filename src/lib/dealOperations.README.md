# dealOperations.js — feature-flag switcher

Все consumers (CashierPage, ExchangeForm, TransferModal, etc.) импортируют
из `dealOperations.js`, не напрямую из `supabaseWrite.js`. Switcher по
`VITE_USE_NEW_LEDGER` решает: legacy `rpc*` или v2 `ledger.*` RPC.

## Feature-flag combos

| `VITE_USE_NEW_LEDGER` | `VITE_USE_NEW_DEAL_FORM` | Use case |
|:---:|:---:|---|
| `false` | `false` | **Production legacy** (default) |
| `true`  | `false` | **Test new ledger** через legacy form (integration test перед cutover) |
| `false` | `true`  | **Test new form** через legacy ledger (UI этап 2-5 verify) |
| `true`  | `true`  | **Production-ready** после cutover |

`.env.local`:
```
VITE_USE_NEW_LEDGER=true
VITE_USE_NEW_DEAL_FORM=false
```

## Switched operations (CREATE)

| Function | Legacy RPC | v2 RPC | Notes |
|---|---|---|---|
| `createDeal` | `rpcCreateDeal` | `ledger.create_deal_v2` | через `adaptLegacyDealPayload` |
| `createTransfer` | `rpcCreateTransfer` | `ledger.create_transfer` | only same-currency |
| `createTopup` | `rpcTopUp` | `ledger.create_adjustment` | sourceKind=opening → kind='opening', else 'reconciliation' |
| `createBalanceAdjustment` | `rpcCreateBalanceAdjustment` | `ledger.create_adjustment` | delta-based, kind='reconciliation' |

## Always-legacy passthroughs (EDIT/DELETE)

`updateDeal`, `deleteDeal`, `completeDeal`, `deleteTransfer`,
`settleObligation*`, `receivePayment`, `cancelObligation`,
`recordPartnerInflow/Outflow` — ВСЕГДА legacy.

Причина: legacy bigint deal_id ≠ ledger.transactions.id (uuid). Mapping
будет добавлен в Direction 3 (v2 readers).

## Limitations при `VITE_USE_NEW_LEDGER=true` + legacy form

Adapter throws explicit error для:
- **Partner accounts** (OTC) — partner_id dim в IN/OUT не реализован в v2
- **Cross-currency transfer** — `ledger.create_transfer` принимает single currency
- **Legacy_only banks** (Bank · CHF/GBP/USD/EUR/TRY/RUB) — нет ledger mapping
- **One-sided IN-only** или **OUT-only** deals — v2 требует non-empty in_legs+out_legs

Обходы: отключить flag для конкретной операции (`<button disabled={USE_NEW_LEDGER}>`)
или использовать legacy form до Direction 3.

## Adapter helpers (`newLedgerAdapter.js`)

- `resolveAccountCode(legacyId)` — public.accounts.id → ledger.accounts.code, throws на legacy_only
- `adaptLegacyDealPayload` — full deal с deferredIn handling
- `adaptLegacyTopupPayload` — topup → adjustment
- `adaptLegacyTransferPayload` — transfer → v2 transfer
- `adaptLegacyAdjustmentPayload` — balance set → delta adjustment
- `inferCommissionFromLegacy` — commission USD из customFeeUsd/commissionUsd

## Integration test plan

```bash
# 1. Set flags
echo 'VITE_USE_NEW_LEDGER=true' >> .env.local

# 2. Start dev server
npm run dev

# 3. Open Cashier, create test operations через legacy ExchangeForm:
#    - top up 100 USD на любой Cash account
#    - transfer 50 USD between cash accounts (same currency)
#    - deal 1000 USDT → 30000 TRY

# 4. Verify в Supabase:
SELECT id, source_kind, status, description, metadata->>'legacy_form' AS legacy_marker
FROM ledger.transactions
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

# Expected: 3 rows, source_kind ∈ {adjustment, transfer, deal}
# All have metadata.legacy_form = 'true'

SELECT * FROM ledger.v_balance_check WHERE ABS(diff) > 0.00000001;
# Expected: 0 rows (balanced)
```
