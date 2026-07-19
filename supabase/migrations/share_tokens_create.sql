-- share_tokens_create.sql — применено в прод 2026-07-19.
-- Публичные read-only ссылки на разделы кассы (v1: «Счета»).
-- Токен крипто-стойкий (генерится на сервере), scope = разрез (Все/Фиат/Крипто).
-- Живёт вечно до отзыва (revoked_at). RLS ВКЛючён без политик → прямого доступа
-- ни у anon, ни у authenticated нет: всё идёт через service-role эндпоинты
-- (создание/список/отзыв за requireStaff; чтение — по токену). Это и есть
-- бэкенд-энфорсмент read-only: у публики нет ни одного write-пути к данным.
create table if not exists public.share_tokens (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  section     text not null default 'accounts',           -- что шарим (v1 только accounts)
  scope       text not null check (scope in ('all','fiat','crypto')),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- Быстрый lookup активного токена при открытии ссылки.
create index if not exists share_tokens_active_idx
  on public.share_tokens (token) where revoked_at is null;

alter table public.share_tokens enable row level security;
-- Намеренно БЕЗ политик: доступ только у service_role (обходит RLS).
