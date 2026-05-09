-- Cutover F1 — Crypto subtype reclassification (PR #17).
--
-- Adds two new subtypes ('crypto_input', 'crypto_output') and reclassifies
-- 9 existing accounts in-place. NO new accounts — Москва Вася office has no
-- crypto wallets per owner's final decision (2026-05-09).
--
-- Subtype semantics:
--   • crypto_input  — primary purpose = receive USDT.
--                     Office hot wallets (per office) + company-level large
--                     incoming wallets (office_id IS NULL allowed).
--   • crypto_output — primary purpose = send USDT (OUT-ONLY).
--                     Currently only 1350 (TRC20-GasFree, default
--                     destination_account для create_withdrawal клиентам).
--
-- Subtype = bookkeeping classification, NOT an RPC blocker. Bidirectional
-- accounts still allow both directions in operations.

ALTER TABLE ledger.accounts DROP CONSTRAINT IF EXISTS accounts_subtype_check;
ALTER TABLE ledger.accounts ADD CONSTRAINT accounts_subtype_check
  CHECK (subtype IS NULL OR subtype = ANY (ARRAY[
    'cash', 'bank', 'crypto', 'exchange', 'receivable', 'clearing',
    'customer_liab', 'partner_liab', 'provider_liab', 'unearned',
    'opening_balance', 'retained_earnings', 'owner_contribution',
    'fx_clearing', 'commission', 'spread', 'fx_gain',
    'bank_fee', 'exchange_fee', 'network_fee', 'office_expense', 'fx_loss',
    'inter_office',
    'crypto_input', 'crypto_output'
  ]));

-- Office hot wallets (TRC20+ERC20) — Mark/Terra/Istanbul
UPDATE ledger.accounts
   SET subtype = 'crypto_input'
 WHERE code IN ('1316','1317','1318','1326','1327','1328')
   AND subtype = 'crypto';

-- Company-level large incoming (Treasury SafePal TRC20/ERC20)
UPDATE ledger.accounts
   SET subtype = 'crypto_input'
 WHERE code IN ('1340','1341')
   AND subtype = 'crypto';

-- Cash-out OUT-ONLY (TronLink GasFree)
UPDATE ledger.accounts
   SET subtype = 'crypto_output'
 WHERE code = '1350'
   AND subtype = 'crypto';

-- Lookup index for create_opening_from_inventory (4-param)
CREATE INDEX IF NOT EXISTS accounts_crypto_input_output_lookup_idx
  ON ledger.accounts (office_id, subtype)
  WHERE subtype IN ('crypto_input', 'crypto_output');
