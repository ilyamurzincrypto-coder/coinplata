-- qr_anchor_and_spb.sql — разворот блока QR на якорь + включение SPB (2026-09-01).
--
-- РЕШЕНИЕ ВЛАДЕЛЬЦА: «QR всегда 1 строка, дополнительные — это уже наш
-- подсчёт», и «QR в другие валюты будет разный по цене, так как в Анталии
-- цена за USDT одна, а в Стамбуле другая».
--
-- ЧТО БЫЛО НЕ ТАК. Блок QR состоял из строк USD→RUB, EUR→RUB, TRY→RUB,
-- USDT→RUB — направление «клиент отдаёт валюту, получает рубли». В жизни QR
-- работает наоборот: клиент ПЛАТИТ РУБЛЯМИ по СБП и получает валюту. Поэтому
-- строка Paramon «RUB QR СБП>> USDT 93,45» не находила себе места в модели,
-- хотя приходит каждое утро.
--
-- ЧТО СТАЛО:
--   якорь   RUB → USDT  (scope null, ручной ввод из вставки) — одна строка,
--           та самая, что присылает Paramon;
--   подсчёт RUB → TRY / EUR / USD, ОТДЕЛЬНО ПО ГОРОДАМ (ANT, IST):
--           курс = якорь / (X за 1 USDT в этом городе).
--
-- Города обязательны: общий курс QR на Анталью и Стамбул был бы ценой из
-- воздуха, потому что USDT в этих городах стоит по-разному.
--
-- ЦБ И СПРЕД 8% УХОДЯТ ИЗ РАСЧЁТА. Якорь приходит от Paramon готовым, и
-- вычислять его вторым способом из ЦБ значило бы держать две правды об одной
-- цене — ровно та болезнь, что была со спредом в localStorage. provider и
-- spread_pct снимаются с блока.
--
-- ВНИМАНИЕ, РАСХОЖДЕНИЕ НА ПЕРЕХОДНЫЙ ПЕРИОД: старая боевая панель
-- (QrRubPanel) продолжает считать QR как «ЦБ USD/RUB × (1 + спред)» — она
-- не читает публикации. До моста два числа будут жить рядом: 93,45 в модели
-- v2 и 93,29 из ЦБ в старой панели. Снимается вместе с мостом.
--
-- ОТКАТ — блок «-- rollback» в конце файла.

-- ── 1. Блок QR: auto → derived с якорем ───────────────────────────────────
update public.rate_blocks
set kind = 'derived',
    config = jsonb_build_object(
      'base_block_code', 'usdt',
      'anchor', jsonb_build_object('from', 'RUB', 'to', 'USDT')
    ),
    updated_at = now()
where code = 'qr';

-- Старые строки направления «валюта → рубли» больше не модель.
delete from public.rate_rows
where block_id = (select id from public.rate_blocks where code = 'qr');

-- Якорь: одна строка на весь блок, приходит из утреннего сообщения.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, value, band_pct, position)
select b.id, null, 'RUB', 'USDT', 'abs', null, 15, 1
from public.rate_blocks b where b.code = 'qr';

-- Подсчёт по городам: RUB → TRY / EUR / USD.
insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, value, band_pct, position)
select b.id, c.scope, 'RUB', v.ccy, 'derived', null, 15,
       10 + (row_number() over (order by c.scope, v.pos))::int
from public.rate_blocks b
cross join (values ('ANT'), ('IST')) as c(scope)
cross join (values ('TRY', 1), ('EUR', 2), ('USD', 3)) as v(ccy, pos)
where b.code = 'qr';

-- ── 2. SPB включается ─────────────────────────────────────────────────────
-- Обе строки стояли enabled=false, и утренние 87,03 / 88,72 не ложились.
update public.rate_rows r
set enabled = true
from public.rate_blocks b
where r.block_id = b.id and b.code = 'usdt' and r.scope = 'SPB';

comment on column public.rate_rows.value_mode is
  'pct — сырой процент (маржа на паре ~1:1); abs — читаемый курс > 1; source — цена провайдера + спред; derived — производная (от базового блока, от маршрута офисов или от ЯКОРЯ блока, если в config есть anchor).';

-- rollback:
-- update public.rate_blocks set kind='auto',
--   config='{"provider":"cbr","spread_pct":8,"spread_mode":"pct"}'::jsonb where code='qr';
-- delete from public.rate_rows where block_id=(select id from public.rate_blocks where code='qr');
-- insert into public.rate_rows (block_id, scope, from_ccy, to_ccy, value_mode, position)
-- select b.id, null, v.f, 'RUB', 'source', v.pos from public.rate_blocks b
-- cross join (values ('USDT',1),('USD',2),('EUR',3),('TRY',4)) as v(f,pos) where b.code='qr';
-- update public.rate_rows r set enabled=false from public.rate_blocks b
--   where r.block_id=b.id and b.code='usdt' and r.scope='SPB';
