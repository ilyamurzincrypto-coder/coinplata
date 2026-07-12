-- create_deal_v2_rate_backstop.sql
-- Применено в прод (касса ygtphuxzazxdtyouxxir) 2026-07-12 через apply_migration.
--
-- S1/B2 бэкстоп. Разбор S1 (docs/db/rate-and-deal-functions.sql) показал: живой
-- create_deal_v2 книжит только leg.amount, курс сделки = amtOut/amtIn целиком с
-- фронта, серверной проверки курса нет. Значит фронт-баг ориентации (B2) уходит в
-- проводку как реальные деньги. Добавлен серверный бэкстоп:
--   • ledger.assert_deal_rate_sane — оценивает IN и OUT ноги в USDT (нумерарий,
--     покрывает все 7 валют через public.effective_rate(*, 'USDT')) и требует
--     |usd_out − usd_in| в коридоре ±25%. Инверсия даёт перекос ≥40% → RAISE P0423.
--   • Нет reference (валюта вне pairs) → пропуск + audit_alert 'warn' (не блокируем,
--     чтобы пробел в справочнике курсов не ронял прод).
--   • create_deal_v2 зовёт бэкстоп ОДНОЙ строкой PERFORM сразу после генерации
--     v_tx_id, ДО записи проводок → отказ атомарен (ноль journal_entries).
--
-- Коридор/поведение выбраны 2026-07-12: ±25%, пропуск+alert при NULL.
-- Тесты (rolled-back на живой БД): валидная GBP→USDT ratio 1.0 проходит;
-- инвертированная (742 вместо 1347) → P0423; валюта JPY вне pairs → пропуск+alert;
-- полный валидный create_deal_v2 в BEGIN/ROLLBACK проходит все проводки.

-- ── helper ──
CREATE OR REPLACE FUNCTION ledger.assert_deal_rate_sane(
  p_office_id uuid, p_in_legs jsonb, p_out_legs jsonb,
  p_deal_tx_id uuid, p_tolerance numeric DEFAULT 0.25
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'ledger','public'
AS $function$
DECLARE
  v_leg jsonb; v_cur text; v_rate numeric;
  v_usdt_in numeric := 0; v_usdt_out numeric := 0;
  v_uncovered text[] := ARRAY[]::text[];
BEGIN
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_in_legs) LOOP
    v_cur := upper(v_leg->>'currency');
    IF v_cur = 'USDT' THEN v_rate := 1; ELSE v_rate := public.effective_rate(p_office_id, v_cur, 'USDT'); END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN v_uncovered := array_append(v_uncovered, v_cur);
    ELSE v_usdt_in := v_usdt_in + (v_leg->>'amount')::numeric * v_rate; END IF;
  END LOOP;
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_out_legs) LOOP
    v_cur := upper(v_leg->>'currency');
    IF v_cur = 'USDT' THEN v_rate := 1; ELSE v_rate := public.effective_rate(p_office_id, v_cur, 'USDT'); END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN v_uncovered := array_append(v_uncovered, v_cur);
    ELSE v_usdt_out := v_usdt_out + (v_leg->>'amount')::numeric * v_rate; END IF;
  END LOOP;

  IF array_length(v_uncovered,1) IS NOT NULL THEN
    INSERT INTO ledger.audit_alerts(level, source, message, payload)
    VALUES('warn','rpc.create_deal_v2.rate_check',
      format('rate_check_skipped: нет USDT-reference для %s', array_to_string(v_uncovered,',')),
      jsonb_build_object('deal_tx_id',p_deal_tx_id,'uncovered',v_uncovered,'usdt_in',v_usdt_in,'usdt_out',v_usdt_out));
    RETURN;
  END IF;

  IF v_usdt_in <= 0 THEN RETURN; END IF;

  IF v_usdt_out < v_usdt_in*(1-p_tolerance) OR v_usdt_out > v_usdt_in*(1+p_tolerance) THEN
    RAISE EXCEPTION 'Курс сделки не прошёл проверку: выдача % USDT против прихода % USDT (ratio %, допуск %..%). Возможно перевёрнутый курс.',
      round(v_usdt_out,2), round(v_usdt_in,2), round(v_usdt_out/v_usdt_in,3),
      round(1-p_tolerance,2), round(1+p_tolerance,2)
      USING ERRCODE='P0423',
      HINT='Проверь ориентацию getRate — стоимость выдачи сильно расходится с приходом.';
  END IF;
END $function$;

-- ── create_deal_v2: добавлена ОДНА строка PERFORM ledger.assert_deal_rate_sane(...)
--    после `v_tx_id := gen_random_uuid();`. Остальное тело — байт-в-байт с прежним DDL.
--    Полный текст функции см. в живой БД (pg_get_functiondef) или в git-истории этой
--    миграции; здесь не дублируем 15 КБ ради читаемости diff. Точка вставки:
--
--      v_tx_id := gen_random_uuid();
--      PERFORM ledger.assert_deal_rate_sane(p_office_id, p_in_legs, p_out_legs, v_tx_id, 0.25);
--
-- ВАЖНО при пересборке: применять этот PERFORM вставкой в актуальное тело
-- create_deal_v2, а не откатывать функцию к снимку — тело могло измениться.
