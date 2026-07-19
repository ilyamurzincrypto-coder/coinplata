-- accounts_kind_column.sql — применено в прод 2026-07-19.
-- Признак типа счёта fiat|crypto для разреза «Все/Фиат/Крипто» в разделе «Счета».
-- GENERATED-колонка (авто из type/network_id) — без бэкфилла/триггеров, всегда
-- консистентна. НЕ хардкодим список валют: крипта = type='crypto' ИЛИ есть сеть.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS kind text
  GENERATED ALWAYS AS (CASE WHEN type = 'crypto' OR network_id IS NOT NULL THEN 'crypto' ELSE 'fiat' END) STORED;
