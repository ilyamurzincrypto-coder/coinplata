-- ============================================================================
-- CoinPlata · 0074_extend_currencies.sql
--
-- Расширяет список currencies для OTC и обычных сделок. Юзер: "В OTC может
-- быть любая валюта, не только USDT". БД уже поддерживает любую currency_code
-- (references public.currencies), но в seed были только базовые. Добавляем
-- популярные стейблы и крипту.
--
-- Idempotent — ON CONFLICT DO NOTHING. Можно прогнать повторно.
-- ============================================================================

insert into public.currencies (code, type, symbol, name, decimals, active)
values
  -- Stablecoins (in addition to USDT which seeded в 0001)
  ('USDC', 'crypto', '$', 'USD Coin',          2, true),
  ('DAI',  'crypto', '$', 'Dai Stablecoin',    2, true),
  ('BUSD', 'crypto', '$', 'Binance USD',       2, true),
  -- Major coins
  ('BTC',  'crypto', '₿', 'Bitcoin',           8, true),
  ('ETH',  'crypto', 'Ξ', 'Ethereum',          6, true),
  ('TON',  'crypto', '◇', 'Toncoin',           4, true),
  ('SOL',  'crypto', '◎', 'Solana',            4, true),
  -- Дополнительные fiat (на всякий случай)
  ('AED', 'fiat', 'د.إ', 'UAE Dirham',         2, true),
  ('KZT', 'fiat', '₸',   'Kazakhstani Tenge',  2, true),
  ('UAH', 'fiat', '₴',   'Ukrainian Hryvnia',  2, true)
on conflict (code) do nothing;

-- Networks для крипты (если их ещё нет)
insert into public.networks (id, name, native_currency, explorer_url, required_confirmations)
values
  ('SOL',     'Solana',         'SOL', 'https://solscan.io/tx/',          32),
  ('TON',     'TON',            'TON', 'https://tonscan.org/tx/',         16),
  ('BTC',     'Bitcoin',        'BTC', 'https://blockstream.info/tx/',     6),
  ('POLYGON', 'Polygon',        'MATIC','https://polygonscan.com/tx/',   128)
on conflict (id) do nothing;

-- Проверка
select code, type, name, active from public.currencies order by type, code;
