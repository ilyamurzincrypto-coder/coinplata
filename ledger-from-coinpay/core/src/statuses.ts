/**
 * Маппинг статусов провайдера 4pmts в наши статусы счёта
 * и человеческие тексты ошибок СБП (коды 801–854).
 */

export type PmtsStatus = 'created' | 'pending' | 'approve' | 'decline' | 'refund';

export type InvoiceStatus = 'pending' | 'paid' | 'declined' | 'refunded' | 'expired';

export function mapPmtsStatus(s: PmtsStatus, opts?: { refunded?: boolean }): InvoiceStatus {
  switch (s) {
    case 'created':
    case 'pending':
      return 'pending';
    case 'approve':
      return opts?.refunded ? 'refunded' : 'paid';
    case 'decline':
      return 'declined';
    case 'refund':
      return 'refunded';
  }
}

/** Известные коды ошибок СБП с точными формулировками. */
const SBP_ERRORS: Readonly<Record<number, string>> = {
  801: 'Операция отклонена банком плательщика',
  810: 'Операция отклонена антифрод-системой',
  814: 'Истёк срок действия QR-кода',
  852: 'Недостаточно средств',
  853: 'Превышен лимит операции СБП',
  854: 'Превышен суточный лимит СБП',
};

/**
 * Человеческий русский текст по коду ошибки СБП.
 * Для известных кодов — точный текст, для прочих 801–854 — общая
 * формулировка отказа, для неизвестных — "Ошибка СБП (код N)".
 */
export function sbpErrorText(code: number): string {
  const known = SBP_ERRORS[code];
  if (known !== undefined) return known;
  if (code >= 801 && code <= 854) {
    return `Платёж отклонён системой СБП (код ${code}). Попробуйте другой способ оплаты или обратитесь в свой банк`;
  }
  return `Ошибка СБП (код ${code})`;
}
