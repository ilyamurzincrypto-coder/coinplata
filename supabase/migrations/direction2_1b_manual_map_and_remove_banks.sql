-- Direction 2 — финализация ШАГ 1:
--   • Manual map W88/W92 (USDT crypto, Q1.c)
--   • Cleanup банков (1210-1213) + bank_fee (5110-5113) из ledger.accounts
--     — банков фактически нет, бизнес-модель крипто-обменник
--   • legacy_only флаг + пометить все public.accounts.type='bank'

DO $$
BEGIN
  -- ── 1. W88/W92 manual map (Q1.c решения owner) ──
  UPDATE public.accounts
     SET ledger_account_code = '1316'
   WHERE id = 'ef6b9348-09b1-49a7-842b-6b33b654a4b3'  -- W88 Mark (TRC20 hot)
     AND ledger_account_code IS NULL;

  UPDATE public.accounts
     SET ledger_account_code = '1350'
   WHERE id = '613e0552-e6b9-45a1-97ea-c4fda5d2b1a6'  -- W92 USDT (Cash-out GasFree)
     AND ledger_account_code IS NULL;

  -- ── 2. Обнулить FK на 1210-1213 (банки которые сейчас удалим) ──
  -- ON DELETE RESTRICT не пустит DELETE с активными FK, поэтому
  -- сначала очищаем references.
  UPDATE public.accounts
     SET ledger_account_code = NULL
   WHERE ledger_account_code IN ('1210','1211','1212','1213');
END $$;

-- ── 3. DELETE bank + bank_fee accounts из ledger ──
-- Pre-check verified: 0 balances, 0 journal_entries на эти codes.
DELETE FROM ledger.accounts
 WHERE code IN ('1210','1211','1212','1213','5110','5111','5112','5113');

-- ── 4. legacy_only флаг ──
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS legacy_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.legacy_only IS
  'Direction 2: marker for accounts that exist only in legacy and are not '
  'usable in new ledger. Adapter raises error when used with USE_NEW_LEDGER=true.';

UPDATE public.accounts
   SET legacy_only = true
 WHERE type = 'bank';
