-- Cutover E1 — Inter-office accounts seed (bilateral, Approach A).
--
-- Sign convention: положительный баланс = ЛЕВЫЙ офис (lex first) должен
-- ПРАВОМУ. Например `Inter-office · mark↔terra · USD = +3000` значит
-- Mark должен Terra 3000 USD.
--
-- 6 pairs × 7 currencies = 42 accounts. ON CONFLICT DO NOTHING для idempotency.
-- Code structure: 14<pair_idx><cur_suffix>
--   pair_idx: 1=ist-mark, 2=ist-mos, 3=ist-tc, 4=mark-mos, 5=mark-tc, 6=mos-tc
--   cur_suffix: 0=USD, 1=EUR, 2=TRY, 3=RUB, 4=GBP, 5=CHF, 6=USDT

ALTER TABLE ledger.accounts DROP CONSTRAINT IF EXISTS accounts_subtype_check;
ALTER TABLE ledger.accounts ADD CONSTRAINT accounts_subtype_check
  CHECK (subtype IS NULL OR subtype = ANY (ARRAY[
    'cash', 'bank', 'crypto', 'exchange', 'receivable', 'clearing',
    'customer_liab', 'partner_liab', 'provider_liab', 'unearned',
    'opening_balance', 'retained_earnings', 'owner_contribution',
    'fx_clearing', 'commission', 'spread', 'fx_gain',
    'bank_fee', 'exchange_fee', 'network_fee', 'office_expense', 'fx_loss',
    'inter_office'
  ]));

INSERT INTO ledger.accounts
  (code, name, type, subtype, currency_code, allow_negative, active, description)
VALUES
  ('1410', 'Inter-office · istanbul↔mark · USD',  'asset', 'inter_office', 'USD',  true, true, '+ = istanbul owes mark'),
  ('1411', 'Inter-office · istanbul↔mark · EUR',  'asset', 'inter_office', 'EUR',  true, true, '+ = istanbul owes mark'),
  ('1412', 'Inter-office · istanbul↔mark · TRY',  'asset', 'inter_office', 'TRY',  true, true, '+ = istanbul owes mark'),
  ('1413', 'Inter-office · istanbul↔mark · RUB',  'asset', 'inter_office', 'RUB',  true, true, '+ = istanbul owes mark'),
  ('1414', 'Inter-office · istanbul↔mark · GBP',  'asset', 'inter_office', 'GBP',  true, true, '+ = istanbul owes mark'),
  ('1415', 'Inter-office · istanbul↔mark · CHF',  'asset', 'inter_office', 'CHF',  true, true, '+ = istanbul owes mark'),
  ('1416', 'Inter-office · istanbul↔mark · USDT', 'asset', 'inter_office', 'USDT', true, true, '+ = istanbul owes mark'),
  ('1420', 'Inter-office · istanbul↔moscow · USD',  'asset', 'inter_office', 'USD',  true, true, '+ = istanbul owes moscow'),
  ('1421', 'Inter-office · istanbul↔moscow · EUR',  'asset', 'inter_office', 'EUR',  true, true, '+ = istanbul owes moscow'),
  ('1422', 'Inter-office · istanbul↔moscow · TRY',  'asset', 'inter_office', 'TRY',  true, true, '+ = istanbul owes moscow'),
  ('1423', 'Inter-office · istanbul↔moscow · RUB',  'asset', 'inter_office', 'RUB',  true, true, '+ = istanbul owes moscow'),
  ('1424', 'Inter-office · istanbul↔moscow · GBP',  'asset', 'inter_office', 'GBP',  true, true, '+ = istanbul owes moscow'),
  ('1425', 'Inter-office · istanbul↔moscow · CHF',  'asset', 'inter_office', 'CHF',  true, true, '+ = istanbul owes moscow'),
  ('1426', 'Inter-office · istanbul↔moscow · USDT', 'asset', 'inter_office', 'USDT', true, true, '+ = istanbul owes moscow'),
  ('1430', 'Inter-office · istanbul↔terra · USD',  'asset', 'inter_office', 'USD',  true, true, '+ = istanbul owes terra'),
  ('1431', 'Inter-office · istanbul↔terra · EUR',  'asset', 'inter_office', 'EUR',  true, true, '+ = istanbul owes terra'),
  ('1432', 'Inter-office · istanbul↔terra · TRY',  'asset', 'inter_office', 'TRY',  true, true, '+ = istanbul owes terra'),
  ('1433', 'Inter-office · istanbul↔terra · RUB',  'asset', 'inter_office', 'RUB',  true, true, '+ = istanbul owes terra'),
  ('1434', 'Inter-office · istanbul↔terra · GBP',  'asset', 'inter_office', 'GBP',  true, true, '+ = istanbul owes terra'),
  ('1435', 'Inter-office · istanbul↔terra · CHF',  'asset', 'inter_office', 'CHF',  true, true, '+ = istanbul owes terra'),
  ('1436', 'Inter-office · istanbul↔terra · USDT', 'asset', 'inter_office', 'USDT', true, true, '+ = istanbul owes terra'),
  ('1440', 'Inter-office · mark↔moscow · USD',  'asset', 'inter_office', 'USD',  true, true, '+ = mark owes moscow'),
  ('1441', 'Inter-office · mark↔moscow · EUR',  'asset', 'inter_office', 'EUR',  true, true, '+ = mark owes moscow'),
  ('1442', 'Inter-office · mark↔moscow · TRY',  'asset', 'inter_office', 'TRY',  true, true, '+ = mark owes moscow'),
  ('1443', 'Inter-office · mark↔moscow · RUB',  'asset', 'inter_office', 'RUB',  true, true, '+ = mark owes moscow'),
  ('1444', 'Inter-office · mark↔moscow · GBP',  'asset', 'inter_office', 'GBP',  true, true, '+ = mark owes moscow'),
  ('1445', 'Inter-office · mark↔moscow · CHF',  'asset', 'inter_office', 'CHF',  true, true, '+ = mark owes moscow'),
  ('1446', 'Inter-office · mark↔moscow · USDT', 'asset', 'inter_office', 'USDT', true, true, '+ = mark owes moscow'),
  ('1450', 'Inter-office · mark↔terra · USD',  'asset', 'inter_office', 'USD',  true, true, '+ = mark owes terra'),
  ('1451', 'Inter-office · mark↔terra · EUR',  'asset', 'inter_office', 'EUR',  true, true, '+ = mark owes terra'),
  ('1452', 'Inter-office · mark↔terra · TRY',  'asset', 'inter_office', 'TRY',  true, true, '+ = mark owes terra'),
  ('1453', 'Inter-office · mark↔terra · RUB',  'asset', 'inter_office', 'RUB',  true, true, '+ = mark owes terra'),
  ('1454', 'Inter-office · mark↔terra · GBP',  'asset', 'inter_office', 'GBP',  true, true, '+ = mark owes terra'),
  ('1455', 'Inter-office · mark↔terra · CHF',  'asset', 'inter_office', 'CHF',  true, true, '+ = mark owes terra'),
  ('1456', 'Inter-office · mark↔terra · USDT', 'asset', 'inter_office', 'USDT', true, true, '+ = mark owes terra'),
  ('1460', 'Inter-office · moscow↔terra · USD',  'asset', 'inter_office', 'USD',  true, true, '+ = moscow owes terra'),
  ('1461', 'Inter-office · moscow↔terra · EUR',  'asset', 'inter_office', 'EUR',  true, true, '+ = moscow owes terra'),
  ('1462', 'Inter-office · moscow↔terra · TRY',  'asset', 'inter_office', 'TRY',  true, true, '+ = moscow owes terra'),
  ('1463', 'Inter-office · moscow↔terra · RUB',  'asset', 'inter_office', 'RUB',  true, true, '+ = moscow owes terra'),
  ('1464', 'Inter-office · moscow↔terra · GBP',  'asset', 'inter_office', 'GBP',  true, true, '+ = moscow owes terra'),
  ('1465', 'Inter-office · moscow↔terra · CHF',  'asset', 'inter_office', 'CHF',  true, true, '+ = moscow owes terra'),
  ('1466', 'Inter-office · moscow↔terra · USDT', 'asset', 'inter_office', 'USDT', true, true, '+ = moscow owes terra')
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS accounts_inter_office_idx
  ON ledger.accounts(currency_code, code)
  WHERE subtype = 'inter_office';
