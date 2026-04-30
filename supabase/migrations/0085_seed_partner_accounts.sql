-- ============================================================================
-- CoinPlata · 0085_seed_partner_accounts.sql
--
-- Демо-счета для всех активных партнёров.
--
-- Для каждого active партнёра создаём стандартный набор счетов:
--   USD     — cash + bank
--   EUR     — bank
--   TRY     — cash + bank
--   RUB     — bank
--   USDT    — crypto (network TRC20)
--
-- Имя счёта: '<Partner.name> · <Channel hint>' для удобства поиска в UI.
-- opening_balance = 0 (можно скорректировать через UI «⚖ Скорректировать баланс»).
--
-- ИДЕМПОТЕНТНО: проверяем NOT EXISTS перед каждым INSERT через комбинацию
-- (partner_id, name) — повторный запуск безопасен.
-- ============================================================================

-- 0. Pre-check: убедиться что нужные currencies и networks есть.
do $$
declare
  v_missing text[];
  v_curr text;
  v_codes text[] := array['USD','EUR','TRY','RUB','USDT'];
begin
  v_missing := array[]::text[];
  foreach v_curr in array v_codes loop
    if not exists (select 1 from public.currencies where code = v_curr) then
      v_missing := v_missing || v_curr;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    raise exception 'Missing currencies: %. Apply 0074_extend_currencies first.', v_missing;
  end if;
  if not exists (select 1 from public.networks where id = 'TRC20') then
    raise warning 'Network TRC20 not found — USDT crypto accounts будут с network_id=null';
  end if;
end $$;

-- 1. Sample data: набор счетов для каждого партнёра.
--    (currency, type, name_suffix, network_id, note)
with template (currency_code, type, name_suffix, network_id, note) as (
  values
    ('USD',  'cash',   'USD cash',   null::text,  'Наличные USD'),
    ('USD',  'bank',   'USD bank',   null,        'Банковский USD счёт'),
    ('EUR',  'bank',   'EUR bank',   null,        'Банковский EUR счёт'),
    ('TRY',  'cash',   'TRY cash',   null,        'Наличные TRY'),
    ('TRY',  'bank',   'TRY bank',   null,        'Банковский TRY счёт'),
    ('RUB',  'bank',   'RUB bank',   null,        'Банковский RUB счёт'),
    ('USDT', 'crypto', 'USDT TRC20', 'TRC20',     'Криптокошелёк USDT TRC20')
),
-- 2. Для каждого active партнёра берём template и фильтруем уже существующие
new_accounts as (
  select
    p.id as partner_id,
    p.name as partner_name,
    p.created_by,
    t.currency_code,
    t.type,
    p.name || ' · ' || t.name_suffix as account_name,
    t.network_id,
    t.note
  from public.partners p
  cross join template t
  where p.active = true
    -- network должен существовать (если задан)
    and (t.network_id is null or exists (select 1 from public.networks n where n.id = t.network_id))
    -- ещё не создан (по комбинации partner_id + name)
    and not exists (
      select 1 from public.partner_accounts pa
      where pa.partner_id = p.id and pa.name = (p.name || ' · ' || t.name_suffix)
    )
)
insert into public.partner_accounts
  (partner_id, name, currency_code, type, network_id, note, active, opening_balance, created_by)
select
  partner_id, account_name, currency_code, type, network_id, note,
  true, 0, created_by
from new_accounts;

-- 3. Verify: посчитаем сколько создалось и распределение
select
  p.name as partner,
  count(pa.id) as accounts,
  string_agg(pa.currency_code || ' (' || pa.type || ')', ', ' order by pa.currency_code, pa.type) as breakdown
from public.partners p
left join public.partner_accounts pa on pa.partner_id = p.id and pa.active = true
where p.active = true
group by p.id, p.name
order by p.name;

-- 4. Total созданных партнёрских счетов
select count(*) as total_partner_accounts from public.partner_accounts where active = true;
