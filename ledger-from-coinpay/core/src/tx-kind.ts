/**
 * (Волна Д2) ЕДИНЫЙ человеческий язык типов проводок (tx.kind) — один канон на журнал, карточку
 * операции, выписку. До этого journal.ts и tx-detail.ts давали РАЗНЫЕ слова одному kind
 * («Оплата QR» vs «Оплата (эквайринг)»). Экспертский back-office читает одинаково везде.
 */
const TX_KIND_RU: Record<string, string> = {
  // Эквайринг (QR/СБП)
  capture: 'Оплата по QR',
  fx_topup: 'Пополнение по QR',
  // Счёта «В пути» в тракте QR нет — подпись не должна обещать состояние, которого не бывает.
  qr_hold: 'Оплата по QR',
  qr_settlement: 'Обмен с провайдером',
  fee: 'Комиссия',
  agent_fee: 'Комиссия агента',
  refund: 'Возврат',
  payout: 'Выплата',
  reserve_hold: 'Удержание резерва',
  reserve_release: 'Освобождение резерва',
  adjustment: 'Корректировка',
  // Обменно-кассовый контур (ручные операции)
  deposit: 'Внесение',
  withdrawal: 'Выдача',
  transfer: 'Перевод',
  exchange: 'Обмен',
  storno: 'Сторно',
  revaluation: 'Переоценка',
  incassation: 'Инкассация',
  reinforcement: 'Подкрепление',
};

/** Человеческое название типа проводки; неизвестный kind — как есть (сигнал разработчику). */
export function txKindLabel(kind: string): string {
  return TX_KIND_RU[kind] ?? kind;
}
