-- rate_blocks_phase2a_model.sql — модель под решения владельца (фаза 2а).
-- Схема НЕ меняется: только config (jsonb), scopes и наполнение rate_rows.
--
-- Решение №1: перестановки — маржа по МАРШРУТАМ офисов, не по городам.
--   В Анталье три офиса, и у «Москва → Mark Antalya» 0%, а у «→ Liman» 1%.
--   Схлопывание в город ANT убило бы эту разницу молча. Поэтому
--   scope = '<office_id>→<office_id>', пара валют — в from_ccy/to_ccy,
--   маржа — в value строки, config.margin_pct — дефолт для маршрутов без
--   своей строки.
--
-- Решение №2: спред нала — КОПЕЙКИ. Меняла думает в курушах, а не в
--   процентах: «5 копеек» вместо «0,1055%». config.spread_mode: 'abs'|'pct'.
--   Нал — abs, QR — pct.
--
-- Решение №3: НЕРЕЗ — пятый блок. Сетка Прод./Покуп. × TOD/TOM в строки
--   USDT не ложится (у rate_rows только направление пары), а
--   scope = 'TOD-TOD'|'TOD-TOM'|'TOM-TOM' ложится без правки схемы.
--
-- ВАЖНО ДЛЯ БУДУЩЕГО МОСТА: scope — это ИЗМЕРЕНИЕ БЛОКА, а не обязательно
--   город. Веер «город → офисы» применяется ТОЛЬКО к блокам, чей scope —
--   город (cash, usdt, qr). Для perestanovka scope — маршрут офисов, для
--   nerez — расчётный базис. Развернуть НЕРЕЗ по офисам Антальи = ошибка.

-- ── Решение №2: режим спреда ──────────────────────────────────────────────
update public.rate_blocks
set config = config || '{"spread_mode":"abs"}'::jsonb, updated_at = now()
where code = 'cash';

-- ── Сид QR: поправка ошибки фазы 1 ────────────────────────────────────────
-- Было {MSK,SPB} и 1%. Рассуждение «QR рублёвый → российские города» неверно:
-- рубли по QR принимают в ТУРЕЦКИХ офисах. Боевой спред — 8%.
-- 8% — дефолт архитектора; меняется в редакторе, миграция не нужна.
update public.rate_blocks
set scopes = array['ANT','IST'],
    config = config || '{"spread_pct":8,"spread_mode":"pct"}'::jsonb,
    updated_at = now()
where code = 'qr';

-- ── Решение №1: перестановки — маршруты офисов ────────────────────────────
update public.rate_blocks
set config = '{"base_block_code":"usdt","margin_pct":0.9}'::jsonb, updated_at = now()
where code = 'perestanovka';

-- Старые зеркальные строки (копия строк USDT по городам) больше не модель.
delete from public.rate_rows
where block_id = (select id from public.rate_blocks where code = 'perestanovka');

-- Маршруты между РАЗНЫМИ странами (правило старого редактора): Москва ↔
-- турецкие офисы. Депозит в валюте отправителя, выплата — получателя.
-- value = null → берётся config.margin_pct блока; своя маржа вписывается
-- в редакторе и переопределяет дефолт.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, value, position)
select b.id,
       o_from.id::text || '→' || o_to.id::text,
       case when o_from.city = 'Москва' then 'RUB' else 'TRY' end,
       case when o_to.city   = 'Москва' then 'RUB' else 'TRY' end,
       'derived', null,
       row_number() over (order by o_from.name, o_to.name)
from public.rate_blocks b
cross join public.offices o_from
cross join public.offices o_to
where b.code = 'perestanovka'
  and o_from.active and o_to.active
  and o_from.id <> o_to.id
  and (o_from.city = 'Москва') <> (o_to.city = 'Москва')  -- только разные страны
on conflict do nothing;

-- ── Решение №3: пятый блок НЕРЕЗ ──────────────────────────────────────────
insert into public.rate_blocks (code, title, kind, config, scopes, position)
values ('nerez', 'НЕРЕЗ', 'manual', '{"source":"paramon"}'::jsonb,
        array['TOD-TOD','TOD-TOM','TOM-TOM'], 5)
on conflict (code) do nothing;

-- Прод./Покуп. кодируются направлением пары: продажа USDT за RUB и покупка.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position)
select b.id, s.basis, v.f, v.t, 'abs', v.pos
from public.rate_blocks b
cross join (values ('TOD-TOD'), ('TOD-TOM'), ('TOM-TOM')) as s(basis)
cross join (values ('USDT','RUB',1), ('RUB','USDT',2)) as v(f,t,pos)
where b.code = 'nerez'
on conflict do nothing;

comment on column public.rate_rows.scope is
  'Измерение блока, НЕ обязательно город: cash/usdt/qr — город (ANT/IST/MSK/SPB), perestanovka — маршрут "<office_id>→<office_id>", nerez — расчётный базис (TOD-TOD/TOD-TOM/TOM-TOM). Веер город→офисы применять только к блокам с городским scope.';
