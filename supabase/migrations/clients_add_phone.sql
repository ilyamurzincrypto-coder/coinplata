-- Телефон контрагента (часто WhatsApp). Применено через apply_migration.
alter table public.clients add column if not exists phone text;
comment on column public.clients.phone is 'Телефон контрагента (часто WhatsApp).';
