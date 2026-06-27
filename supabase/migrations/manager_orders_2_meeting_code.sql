-- Код встречи/заявки (для сайтовых заявок — внешний код; для менеджерских —
-- опционально). Применено через apply_migration.
alter table public.manager_orders add column if not exists meeting_code text;
comment on column public.manager_orders.meeting_code is
  'Код встречи/заявки (для сайтовых заявок — внешний код; для менеджерских — опционально).';
