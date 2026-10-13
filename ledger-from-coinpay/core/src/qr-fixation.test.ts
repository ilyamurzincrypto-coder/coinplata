import { describe, expect, it } from 'vitest';
import {
  QR_EXPIRY_CASHIER, QR_EXPIRY_TIMEOUT, QR_LATE_CONFIRM_QUESTION, QR_NO_RECEIPT_CONFIRM_QUESTION,
  QR_PENDING_TTL_MINUTES, qrExpiryCutoff, qrFixationVerdict, qrReceiptVerdict,
} from './qr-fixation';

const qr = (status: string, expiryReason: string | null = null) => ({ provider: 'qr_static', status, expiryReason });

describe('QR: можно ли фиксировать оплату', () => {
  it('живую оплату фиксируем без вопросов', () => {
    expect(qrFixationVerdict(qr('pending'))).toEqual({ ok: true, late: false });
  });

  it('🔴 истёкшую по времени — только после прямого вопроса кассиру', () => {
    const asked = qrFixationVerdict(qr('expired', QR_EXPIRY_TIMEOUT));
    expect(asked).toEqual({ ok: false, code: 'confirm_late', error: QR_LATE_CONFIRM_QUESTION });
    // Подтвердил — фиксируем и помечаем опоздание: QR статический, деньги реально могли прийти позже.
    expect(qrFixationVerdict(qr('expired', QR_EXPIRY_TIMEOUT), { confirmLate: true })).toEqual({ ok: true, late: true });
  });

  it('🔴 снятую кассиром не спасает никакое подтверждение', () => {
    for (const reason of [QR_EXPIRY_CASHIER, null, 'что-то ещё']) {
      const v = qrFixationVerdict(qr('expired', reason), { confirmLate: true });
      expect(v).toMatchObject({ ok: false, code: 'refused' });
      if (!v.ok) expect(v.error).toContain('отменена кассиром');
    }
  });

  it('зафиксированную или отклонённую второй раз не проводим', () => {
    for (const status of ['paid', 'declined', 'refunded']) {
      expect(qrFixationVerdict(qr(status), { confirmLate: true })).toMatchObject({ ok: false, code: 'refused' });
    }
  });

  it('чужой провайдер — не наша оплата', () => {
    expect(qrFixationVerdict({ provider: '4pmts', status: 'pending' })).toEqual({ ok: false, code: 'refused', error: 'Оплата не найдена' });
  });
});

describe('QR: фиксация без квитанции', () => {
  it('фото есть — вопросов нет и отметки нет', () => {
    expect(qrReceiptVerdict(1)).toEqual({ ok: true, withoutReceipt: false });
    expect(qrReceiptVerdict(3)).toEqual({ ok: true, withoutReceipt: false });
  });

  it('🔴 фото нет — сначала прямой вопрос, и только подтверждение открывает фиксацию', () => {
    expect(qrReceiptVerdict(0)).toEqual({ ok: false, code: 'confirm_no_receipt', error: QR_NO_RECEIPT_CONFIRM_QUESTION });
    expect(qrReceiptVerdict(0, { confirmNoReceipt: true })).toEqual({ ok: true, withoutReceipt: true });
  });

  it('🔴 подтверждение при уже приложенном фото не помечает оплату: отметка — про факт, а не про кнопку', () => {
    expect(qrReceiptVerdict(1, { confirmNoReceipt: true })).toEqual({ ok: true, withoutReceipt: false });
  });
});

describe('QR: порог автоистечения', () => {
  it('30 минут по умолчанию, шаг считается от переданного «сейчас»', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    expect(QR_PENDING_TTL_MINUTES).toBe(30);
    expect(qrExpiryCutoff(now).toISOString()).toBe('2026-09-16T11:30:00.000Z');
    expect(qrExpiryCutoff(now, 5).toISOString()).toBe('2026-09-16T11:55:00.000Z');
  });

  it('нулевой или отрицательный срок — ошибка, а не «истекло всё»', () => {
    expect(() => qrExpiryCutoff(new Date(), 0)).toThrow();
    expect(() => qrExpiryCutoff(new Date(), -5)).toThrow();
  });
});
