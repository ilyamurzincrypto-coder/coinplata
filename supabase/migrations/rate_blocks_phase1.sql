-- rate_blocks_phase1.sql — Фаза 1 блочной модели курсов.
--
-- Три таблицы фундамента. UI и старый модуль НЕ трогаются: старые pairs /
-- office_rate_overrides / special_rates продолжают работать, новое включается
-- фича-флагом в фазе 2-3. Откат фазы 1 = drop этих трёх таблиц.
--
-- ИМЯ: публикации названы rate_publications, а НЕ rate_snapshots — последнее
-- уже занято (611 строк аудита confirm_rates + триггер auto_snapshot_on_pair_change
-- пишет туда на каждое изменение pairs). Переиспользование имени снесло бы
-- работающий аудит.
--
-- ИСТОЧНИКИ: отдельный rate_source_cache НЕ заводится — public.external_rates
-- уже держит 796k строк по 7 провайдерам (tolunay/cbr/rapira/binance/ecb/harem/tcmb)
-- и наполняется работающими кронами api/tolunay/sync.js и api/rapira/sync.js.
-- Свежесть источника при публикации проверяется по external_rates.fetched_at.

-- ── Блоки ────────────────────────────────────────────────────────────────
-- Новый блок добавляется ЗАПИСЬЮ, без кода: поэтому на code нет check-списка,
-- только уникальность. kind задаёт, откуда берётся цена.
create table if not exists public.rate_blocks (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  title       text not null,
  kind        text not null check (kind in ('auto', 'manual', 'derived')),
  -- auto:    {"provider":"tolunay","spread_pct":0}
  -- derived: {"base_block_code":"usdt","margin_pct":1.5}
  -- manual:  {}
  config      jsonb not null default '{}'::jsonb,
  scopes      text[] not null default '{}'::text[],  -- города: ANT/IST/MSK/SPB
  position    integer not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Строки блока ─────────────────────────────────────────────────────────
-- Одна строка = ОДНО направление пары (обратное — отдельная строка).
-- scope null = строка действует на все города своего блока.
create table if not exists public.rate_rows (
  id          uuid primary key default gen_random_uuid(),
  block_id    uuid not null references public.rate_blocks(id) on delete cascade,
  scope       text,
  from_ccy    text not null,
  to_ccy      text not null,
  value_mode  text not null check (value_mode in ('pct', 'abs', 'source', 'derived')),
  -- value заполняется ТОЛЬКО у manual-строк (pct/abs); auto/derived считаются.
  value       numeric,
  -- Граница допустимого отклонения от последней публикации, %.
  band_pct    numeric not null default 5 check (band_pct >= 0),
  position    integer not null,
  enabled     boolean not null default true,
  constraint rate_rows_value_only_manual check (
    (value_mode in ('pct', 'abs')) or value is null
  ),
  constraint rate_rows_no_self_pair check (from_ccy <> to_ccy)
);

-- Одно направление на (блок, город) не должно дублироваться. scope null —
-- отдельный ключ, поэтому coalesce до пустой строки.
create unique index if not exists rate_rows_unique_dir_idx
  on public.rate_rows (block_id, coalesce(scope, ''), from_ccy, to_ccy);
create index if not exists rate_rows_block_idx on public.rate_rows (block_id, position);

-- ── Публикации (версии прайса) ───────────────────────────────────────────
-- Черновики НЕ хранятся: в таблице только опубликованные версии.
-- prices — плоский прайс, единственное, что уходит наружу:
--   [{"block":"usdt","scope":"ANT","from":"USDT","to":"TRY","rate":44.0025}, ...]
-- inputs — сырые введённые значения (для «Было» и воспроизводимости расчёта).
-- source_meta — какие котировки провайдеров взяты и когда получены.
create table if not exists public.rate_publications (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null unique,
  inputs        jsonb not null default '{}'::jsonb,
  prices        jsonb not null default '[]'::jsonb,
  source_meta   jsonb not null default '{}'::jsonb,
  created_by    uuid references public.users(id) on delete set null,
  published_at  timestamptz not null default now(),
  constraint rate_publications_version_positive check (version > 0)
);

create index if not exists rate_publications_published_idx
  on public.rate_publications (published_at desc);

-- ── RLS — та же модель, что у office_rate_overrides ───────────────────────
-- Чтение всем аутентифицированным, запись только owner/admin.
alter table public.rate_blocks enable row level security;
alter table public.rate_rows enable row level security;
alter table public.rate_publications enable row level security;

drop policy if exists rate_blocks_read on public.rate_blocks;
create policy rate_blocks_read on public.rate_blocks for select using (true);
drop policy if exists rate_blocks_write_admin on public.rate_blocks;
create policy rate_blocks_write_admin on public.rate_blocks for insert
  with check (f_role() = any (array['owner', 'admin']));
drop policy if exists rate_blocks_update_admin on public.rate_blocks;
create policy rate_blocks_update_admin on public.rate_blocks for update
  using (f_role() = any (array['owner', 'admin']))
  with check (f_role() = any (array['owner', 'admin']));
drop policy if exists rate_blocks_delete_admin on public.rate_blocks;
create policy rate_blocks_delete_admin on public.rate_blocks for delete
  using (f_role() = any (array['owner', 'admin']));

drop policy if exists rate_rows_read on public.rate_rows;
create policy rate_rows_read on public.rate_rows for select using (true);
drop policy if exists rate_rows_write_admin on public.rate_rows;
create policy rate_rows_write_admin on public.rate_rows for insert
  with check (f_role() = any (array['owner', 'admin']));
drop policy if exists rate_rows_update_admin on public.rate_rows;
create policy rate_rows_update_admin on public.rate_rows for update
  using (f_role() = any (array['owner', 'admin']))
  with check (f_role() = any (array['owner', 'admin']));
drop policy if exists rate_rows_delete_admin on public.rate_rows;
create policy rate_rows_delete_admin on public.rate_rows for delete
  using (f_role() = any (array['owner', 'admin']));

-- Публикации не редактируются и не удаляются: версия неизменна после insert.
drop policy if exists rate_publications_read on public.rate_publications;
create policy rate_publications_read on public.rate_publications for select using (true);
drop policy if exists rate_publications_write_admin on public.rate_publications;
create policy rate_publications_write_admin on public.rate_publications for insert
  with check (f_role() = any (array['owner', 'admin']));

comment on table public.rate_blocks is 'Блочная модель курсов: блок = группа строк с общим способом получения цены (auto/manual/derived).';
comment on table public.rate_rows is 'Строка блока = одно направление пары в одном городе. value только у manual.';
comment on table public.rate_publications is 'Опубликованные версии прайса. Монотонный version. Черновики не хранятся.';
