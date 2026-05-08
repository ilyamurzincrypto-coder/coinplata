-- Direction 2 — ШАГ 2.3a: seed Retained Earnings × 6 active currencies
--
-- USD (3200) уже сеян. Добавляем для 6 active legacy currencies.
-- USDC/BTC/ETH не сеем (inactive — добавим когда понадобится).
--
-- После: 7 Retained Earnings accounts. Total ledger.accounts: 132.

INSERT INTO ledger.accounts (code, name, type, subtype, currency_code,
                             allow_negative, active)
VALUES
  ('3201', 'Retained Earnings · EUR',  'equity', 'retained_earnings', 'EUR',  true, true),
  ('3202', 'Retained Earnings · TRY',  'equity', 'retained_earnings', 'TRY',  true, true),
  ('3203', 'Retained Earnings · RUB',  'equity', 'retained_earnings', 'RUB',  true, true),
  ('3204', 'Retained Earnings · GBP',  'equity', 'retained_earnings', 'GBP',  true, true),
  ('3205', 'Retained Earnings · CHF',  'equity', 'retained_earnings', 'CHF',  true, true),
  ('3206', 'Retained Earnings · USDT', 'equity', 'retained_earnings', 'USDT', true, true);
