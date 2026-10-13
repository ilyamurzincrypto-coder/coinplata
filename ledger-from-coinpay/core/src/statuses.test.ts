import { describe, it, expect } from 'vitest';
import { mapPmtsStatus, sbpErrorText } from './statuses';

describe('mapPmtsStatus', () => {
  it('created/pending → pending', () => {
    expect(mapPmtsStatus('created')).toBe('pending');
    expect(mapPmtsStatus('pending')).toBe('pending');
  });

  it('approve → paid', () => {
    expect(mapPmtsStatus('approve')).toBe('paid');
  });

  it('approve с refunded → refunded', () => {
    expect(mapPmtsStatus('approve', { refunded: true })).toBe('refunded');
  });

  it('decline → declined', () => {
    expect(mapPmtsStatus('decline')).toBe('declined');
  });

  it('refund → refunded', () => {
    expect(mapPmtsStatus('refund')).toBe('refunded');
  });
});

describe('sbpErrorText', () => {
  it('обязательные коды', () => {
    expect(sbpErrorText(814)).toBe('Истёк срок действия QR-кода');
    expect(sbpErrorText(852)).toBe('Недостаточно средств');
    expect(sbpErrorText(853)).toBe('Превышен лимит операции СБП');
    expect(sbpErrorText(854)).toBe('Превышен суточный лимит СБП');
    expect(sbpErrorText(810)).toBe('Операция отклонена антифрод-системой');
  });

  it('прочие коды из диапазона 801–854 — осмысленная заглушка с кодом', () => {
    const text = sbpErrorText(823);
    expect(text).toContain('823');
    expect(text).not.toBe('Ошибка СБП (код 823)');
  });

  it('неизвестный код вне диапазона', () => {
    expect(sbpErrorText(999)).toBe('Ошибка СБП (код 999)');
    expect(sbpErrorText(0)).toBe('Ошибка СБП (код 0)');
  });
});
