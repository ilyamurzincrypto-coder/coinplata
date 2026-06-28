-- ФИЗИЧЕСКОЕ удаление НЕпроведённой сделки (без сторно). Применено через apply_migration.
-- Удаляет сделку + recognition/settle + проводки + idempotency, пересчитывает балансы.
-- je_balance_check временно отключается (транзакционно, ACCESS EXCLUSIVE лок).
-- Только если deal НЕ подтверждён бухгалтером и НЕ сторнирован. Иначе — reverse_transaction.
-- Полный текст функции — см. миграцию ledger_void_deal_v2 в истории. Public-обёртка:
create or replace function public.void_deal(p_tx_id uuid)
returns void language sql security definer set search_path to 'ledger','public'
as $$ select ledger.void_deal(p_tx_id); $$;
grant execute on function public.void_deal(uuid) to authenticated;
