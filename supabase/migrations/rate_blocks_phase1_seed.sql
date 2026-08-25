-- rate_blocks_phase1_seed.sql — сиды четырёх блоков по целевой структуре.
-- Идемпотентно (on conflict do nothing) — повторный прогон не двоит строки.
--
-- ДОПУЩЕНИЯ (обратимы одним update, помечены ниже по месту):
--  • SPB-строки заведены, но enabled=false: активного питерского офиса нет
--    (St.pt неактивен и без coinpoint_office_code), публиковать некуда.
--  • scopes блока QR ₽ = {MSK,SPB} — блок рублёвый; в спеке города для него
--    не заданы.
--  • Конкретный набор пар взят из того, что реально ходит: Толунай отдаёт
--    USD/EUR/RUB→TRY, утренний текст Paramon даёт USDT↔USD в процентах и
--    USDT↔TRY/EUR абсолютом.

-- ── 1. Нал (auto, Толунай, ANT+IST, 1:1) ─────────────────────────────────
insert into public.rate_blocks (code, title, kind, config, scopes, position)
values ('cash', 'Нал', 'auto',
        '{"provider":"tolunay","spread_pct":0}'::jsonb,
        array['ANT','IST'], 1)
on conflict (code) do nothing;

-- scope null = обе стороны блока (Толунай общий для Турции).
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position)
select b.id, null, v.f, v.t, 'source', v.pos
from public.rate_blocks b
cross join (values
  ('USD','TRY',1), ('TRY','USD',2),
  ('EUR','TRY',3), ('TRY','EUR',4),
  ('RUB','TRY',5), ('TRY','RUB',6)
) as v(f,t,pos)
where b.code = 'cash'
on conflict do nothing;

-- ── 2. USDT (manual, вводится утром) ─────────────────────────────────────
insert into public.rate_blocks (code, title, kind, config, scopes, position)
values ('usdt', 'USDT', 'manual', '{}'::jsonb,
        array['ANT','IST','MSK','SPB'], 2)
on conflict (code) do nothing;

-- ANT/IST: USD в процентах (пара ~1:1), TRY и EUR абсолютом. Обе стороны.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position)
select b.id, s.city, v.f, v.t, v.mode, v.pos
from public.rate_blocks b
cross join (values ('ANT'), ('IST')) as s(city)
cross join (values
  ('USDT','USD','pct',1), ('USD','USDT','pct',2),
  ('USDT','TRY','abs',3), ('TRY','USDT','abs',4),
  ('USDT','EUR','abs',5), ('EUR','USDT','abs',6)
) as v(f,t,mode,pos)
where b.code = 'usdt'
on conflict do nothing;

-- MSK/SPB: пары к рублю абсолютом. SPB выключен — активного офиса нет.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position, enabled)
select b.id, s.city, v.f, v.t, 'abs', v.pos, (s.city <> 'SPB')
from public.rate_blocks b
cross join (values ('MSK'), ('SPB')) as s(city)
cross join (values ('USDT','RUB',1), ('RUB','USDT',2)) as v(f,t,pos)
where b.code = 'usdt'
on conflict do nothing;

-- ── 3. Перестановки (derived от USDT × (1 + маржа)) ──────────────────────
insert into public.rate_blocks (code, title, kind, config, scopes, position)
values ('perestanovka', 'Перестановки', 'derived',
        '{"base_block_code":"usdt","margin_pct":1.5}'::jsonb,
        array['ANT','IST','MSK','SPB'], 3)
on conflict (code) do nothing;

-- Зеркало включённых строк базового блока: те же направления, но derived.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position, enabled)
select d.id, r.scope, r.from_ccy, r.to_ccy, 'derived', r.position, r.enabled
from public.rate_rows r
join public.rate_blocks base on base.id = r.block_id and base.code = 'usdt'
cross join public.rate_blocks d
where d.code = 'perestanovka'
on conflict do nothing;

-- ── 4. QR ₽ (auto, ЦБ × (1 + спред)) ─────────────────────────────────────
insert into public.rate_blocks (code, title, kind, config, scopes, position)
values ('qr', 'QR ₽', 'auto',
        '{"provider":"cbr","spread_pct":1}'::jsonb,
        array['MSK','SPB'], 4)
on conflict (code) do nothing;

-- Якорь USDT→RUB считается от ЦБ USD/RUB; остальные — через USDT (пивот).
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position)
select b.id, null, v.f, 'RUB', 'source', v.pos
from public.rate_blocks b
cross join (values ('USDT',1), ('USD',2), ('EUR',3), ('TRY',4)) as v(f,pos)
where b.code = 'qr'
on conflict do nothing;
