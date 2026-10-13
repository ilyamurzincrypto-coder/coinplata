/**
 * (Б2-3в) Подтверждение курса перед сделкой. Чистые правила, без БД.
 *
 * Зачем: у валюты на ручном источнике курс не обновляется сам. Если оператор ввёл его позавчера,
 * сделка пройдёт по позавчерашней цене и никто этого не заметит. Автоматические валюты (ЦБ)
 * подтверждения не требуют — их свежесть обеспечивает синк.
 *
 * Порог — «не сегодняшний день» (решение владельца): курс, введённый сегодня, считается
 * актуальным; любой более ранний требует явного «да» от оператора.
 *
 * 🔴 Подтверждается КОНКРЕТНЫЙ курс, а не факт нажатия. Иначе клиент, который всегда шлёт
 * «подтверждено», обошёл бы защиту целиком, а между показом диалога и отправкой курс мог бы
 * смениться. Поэтому оператор возвращает то, что видел (дату и значение), и сервер сверяет.
 */
export interface RateFacts {
  /** Валюта ведётся вручную. */
  manual: boolean;
  /** Дата курса, ГГГГ-ММ-ДД. */
  date: string;
  rateE6: bigint;
}

/** Что оператор увидел в диалоге и подтвердил. */
export interface RateConfirmation {
  date: string;
  rateE6: bigint;
}

export function needsRateConfirmation(rate: Pick<RateFacts, 'manual' | 'date'>, today: string): boolean {
  return rate.manual && rate.date !== today;
}

export type RateGateResult =
  | { ok: true }
  | { ok: false; kind: 'needs_confirmation' }
  | { ok: false; kind: 'stale_confirmation' };

/**
 * Пропускать ли сделку. `today` передаётся снаружи — время берёт вызывающий, чистая функция
 * его не выдумывает.
 */
export function checkRateGate(
  rate: RateFacts,
  confirmation: RateConfirmation | null,
  today: string,
): RateGateResult {
  if (!needsRateConfirmation(rate, today)) return { ok: true };
  if (!confirmation) return { ok: false, kind: 'needs_confirmation' };
  // Подтвердили не тот курс, что действует сейчас — значит показывали устаревшее окно.
  if (confirmation.date !== rate.date || confirmation.rateE6 !== rate.rateE6) {
    return { ok: false, kind: 'stale_confirmation' };
  }
  return { ok: true };
}
