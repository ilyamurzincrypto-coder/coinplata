-- Direction 2 — schema migration: добавляем legacy.id → ledger.code map
-- через колонку ledger_account_code в public.accounts.
--
-- FK на ledger.accounts(code) гарантирует что значения валидны.
-- Backfill — отдельным DO-блоком (см. ниже).
--
-- Backfill стратегия:
--   • cash: subtype='cash' AND currency_code AND office_id (точный match)
--   • bank: subtype='bank' AND currency_code (ledger banks без office_id —
--           public banks привязаны к "International Office", связь чисто
--           legacy)
--   • crypto: НЕ автоматический. Owner решает manually для каждого USDT
--             wallet (TRC20 vs ERC20, hot vs treasury).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS ledger_account_code text;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_ledger_account_code_fkey
  FOREIGN KEY (ledger_account_code) REFERENCES ledger.accounts(code)
  ON UPDATE CASCADE ON DELETE RESTRICT
  NOT VALID;

CREATE INDEX IF NOT EXISTS accounts_ledger_code_idx
  ON public.accounts(ledger_account_code)
  WHERE ledger_account_code IS NOT NULL;

COMMENT ON COLUMN public.accounts.ledger_account_code IS
  'Direction 2: link to ledger.accounts.code. Backfill on cutover, used by '
  'newLedgerAdapter for resolving legacy account_id → ledger account_code. '
  'NULL means account is legacy_only (post-cutover read-only).';

-- ── Backfill (transactional) ──
DO $$
BEGIN
  -- 1) Cash: match по subtype+currency+office
  UPDATE public.accounts pa
     SET ledger_account_code = la.code
    FROM ledger.accounts la
   WHERE pa.type = 'cash'
     AND la.active
     AND la.type = 'asset'
     AND la.subtype = 'cash'
     AND la.currency_code = pa.currency_code
     AND la.office_id = pa.office_id;

  -- 2) Bank: ledger banks без office_id, public banks с office_id
  --    (International Office). Match только по currency.
  UPDATE public.accounts pa
     SET ledger_account_code = la.code
    FROM ledger.accounts la
   WHERE pa.type = 'bank'
     AND la.active
     AND la.type = 'asset'
     AND la.subtype = 'bank'
     AND la.currency_code = pa.currency_code
     AND la.office_id IS NULL;

  -- 3) Crypto USDT: НЕ автоматический. Owner manually UPDATE'ит каждую row.
END $$;

-- Validate FK после backfill (ловит случайные ошибки в backfill UPDATE)
ALTER TABLE public.accounts VALIDATE CONSTRAINT accounts_ledger_account_code_fkey;
