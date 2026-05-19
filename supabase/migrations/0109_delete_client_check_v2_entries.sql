-- delete_client теперь блокирует hard-delete если у клиента есть
-- v2-проводки в ledger.journal_entries. Legacy public.deals проверка
-- остаётся (там тоже могут быть данные).

CREATE OR REPLACE FUNCTION public.delete_client(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal_count integer;
  v_entry_count integer;
BEGIN
  SELECT count(*) INTO v_deal_count
    FROM public.deals
   WHERE client_id = p_client_id AND status <> 'deleted';
  IF v_deal_count > 0 THEN
    RAISE EXCEPTION
      'Клиент имеет % активных сделок (legacy). Архивируй вместо удаления.',
      v_deal_count;
  END IF;

  SELECT count(*) INTO v_entry_count
    FROM ledger.journal_entries
   WHERE client_id = p_client_id;
  IF v_entry_count > 0 THEN
    RAISE EXCEPTION
      'Клиент имеет % проводок в ledger.journal_entries. Архивируй вместо удаления.',
      v_entry_count;
  END IF;

  DELETE FROM public.clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Клиент % не найден', p_client_id;
  END IF;
END;
$function$;
