-- assert_deal_rate_sane_usdt_direction.sql
-- Применено в прод (касса ygtphuxzazxdtyouxxir) 2026-07-16.
--
-- Фикс ориентации в бэкстопе курса. Раньше ноги оценивались через
-- effective_rate(office, cur, 'USDT') — прямой оверрайд cur→USDT, который в
-- данных бывает ПЕРЕВЁРНУТ (напр. Istanbul TRY→USDT=46.80 вместо 0.0216). Из-за
-- этого приход 50000 TRY оценивался как 2.34М USDT, и бэкстоп ОТКЛОНЯЛ корректные
-- сделки (P0423). Теперь оцениваем через сторону USDT→cur (корректную):
--   USDT за 1 cur = 1 / effective_rate(office, 'USDT', cur).
-- Совпадает с фронтовым usdtPer = 1/getRate("USDT",cur) (см. lib/rates.js).
-- Инверсию по-прежнему ловит (перевёрнутая сделка → ratio далеко за ±25%).
CREATE OR REPLACE FUNCTION ledger.assert_deal_rate_sane(
  p_office_id uuid, p_in_legs jsonb, p_out_legs jsonb,
  p_deal_tx_id uuid, p_tolerance numeric DEFAULT 0.25
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'ledger','public'
AS $function$
DECLARE
  v_leg jsonb; v_cur text; v_ref numeric; v_rate numeric;
  v_usdt_in numeric := 0; v_usdt_out numeric := 0;
  v_uncovered text[] := ARRAY[]::text[];
BEGIN
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_in_legs) LOOP
    v_cur := upper(v_leg->>'currency');
    IF v_cur = 'USDT' THEN v_rate := 1;
    ELSE
      v_ref := public.effective_rate(p_office_id, 'USDT', v_cur);
      v_rate := CASE WHEN v_ref IS NOT NULL AND v_ref > 0 THEN 1.0 / v_ref ELSE NULL END;
    END IF;
    IF v_rate IS NULL OR v_rate <= 0 THEN v_uncovered := array_append(v_uncovered, v_cur);
    ELSE v_usdt_in := v_usdt_in + (v_leg->>'amount')::numeric * v_rate; END IF;
  END LOOP;
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_out_legs) LOOP
    v_cur := upper(v_leg->>'currency');
    IF v_cur = 'USDT' THEN v_rate := 1;
    ELSE
      v_ref := public.effective_rate(p_office_id, 'USDT', v_cur);
      v_rate := CASE WHEN v_ref IS NOT NULL AND v_ref > 0 THEN 1.0 / v_ref ELSE NULL END;
    END IF;
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
