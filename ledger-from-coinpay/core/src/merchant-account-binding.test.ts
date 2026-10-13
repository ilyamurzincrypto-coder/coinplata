import { describe, expect, it } from 'vitest';
import { NO_INTAKE_CHANNEL_PROBLEM, payoutCurrenciesOf, validateMerchantAccounts, type BindableAccount } from './merchant-account-binding';

const acc = (id: string, over: Partial<BindableAccount> = {}): BindableAccount => ({
  id, number: `N-${id}`, ownerType: 'platform', kind: 'nostro', currency: 'RUB', status: 'open', ...over,
});
const NONE = new Set<string>();
/** Чужих привязок нет — поля «занятых» счетов пустые. */
const FREE = { otherQrIntakeAccountIds: NONE, otherPayoutAccountIds: NONE, other4pmtsIntakeAccountIds: NONE, qrHistoryAccountIds: NONE, nonQrMoneyAccountIds: NONE };

describe('validateMerchantAccounts', () => {
  it('полный набор: канал 4pmts + источник в каждой валюте выплаты — без замечаний', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('b', { currency: 'USD', kind: 'cash_desk' }), acc('c')],
      payoutCurrencies: ['USD', 'RUB'],
      ...FREE,
    })).toEqual([]);
  });

  it('ни одного канала — мерчант не активируется', () => {
    expect(validateMerchantAccounts({
      intake: [], payout: [acc('b')], payoutCurrencies: ['RUB'], ...FREE,
    })).toEqual([NO_INTAKE_CHANNEL_PROBLEM]);
    expect(NO_INTAKE_CHANNEL_PROBLEM).toBe('Включите хотя бы один канал приёма и выберите для него ностро');
  });

  it('ностро приёма: только открытый рублёвый ностро платформы, канал один раз', () => {
    const problems = validateMerchantAccounts({
      intake: [
        { channel: '4pmts', account: acc('usd', { currency: 'USD' }) },
        { channel: '4pmts', account: acc('kassa', { kind: 'cash_desk' }) },
        { channel: 'qr_static', account: acc('closed', { status: 'closed' }) },
      ],
      payout: [acc('p')],
      payoutCurrencies: ['RUB'],
      ...FREE,
    });
    expect(problems).toContain('Ностро приёма «4pmts»: счёт N-usd в USD, нужен рублёвый');
    expect(problems).toContain('Канал «4pmts» указан дважды');
    expect(problems).toContain('Ностро приёма «4pmts»: счёт N-kassa — не ностро платформы');
    expect(problems).toContain('Счёт N-closed закрыт');
  });

  it('нет источника в валюте выплаты — перечисляется каждая валюта', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('b', { currency: 'USD' })],
      payoutCurrencies: ['USD', 'USDT-TRC20'],
      ...FREE,
    })).toEqual(['Для выплаты в USDT-TRC20 не выбран ни один источник']);
  });

  it('«только рубли» требует рублёвый источник', () => {
    expect(payoutCurrenciesOf({ kind: 'rub_only' })).toEqual(['RUB']);
    expect(payoutCurrenciesOf({ kind: 'currencies', currencies: ['USD', 'USD', 'EUR'], primary: 'USD' })).toEqual(['USD', 'EUR']);
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [],
      payoutCurrencies: payoutCurrenciesOf({ kind: 'rub_only' }),
      ...FREE,
    })).toEqual(['Для выплаты в RUB не выбран ни один источник']);
  });

  it('счёт на приёме QR (свой или чужой) источником выплаты быть не может', () => {
    const own = validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }, { channel: 'qr_static', account: acc('qr') }],
      payout: [acc('qr')],
      payoutCurrencies: ['RUB'],
      ...FREE,
    });
    expect(own).toContain('Счёт N-qr стоит на приёме QR — источником выплаты быть не может');
    expect(own).toContain('Для выплаты в RUB не выбран ни один источник');
    const foreign = validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('x')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      otherQrIntakeAccountIds: new Set(['x']),
    });
    expect(foreign).toContain('Счёт N-x стоит на приёме QR — источником выплаты быть не может');
  });

  it('счёт с историей приёма QR (снятая привязка, расторгнутый мерчант) источником выплат не ставится', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('old'), acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      qrHistoryAccountIds: new Set(['old']),
    })).toEqual(['Счёт N-old использовался для приёма QR — источником выплат его ставить нельзя']);
    // Единственный рублёвый источник — с историей QR: валюта остаётся без источника.
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('old')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      qrHistoryAccountIds: new Set(['old']),
    })).toEqual([
      'Счёт N-old использовался для приёма QR — источником выплат его ставить нельзя',
      'Для выплаты в RUB не выбран ни один источник',
    ]);
    // Счёт сейчас на приёме QR — одно замечание «стоит на приёме», без дубля про историю.
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('b'), acc('x')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      otherQrIntakeAccountIds: new Set(['x']),
      qrHistoryAccountIds: new Set(['x']),
    })).toEqual(['Счёт N-x стоит на приёме QR — источником выплаты быть не может']);
  });

  it('источник: только ностро/касса платформы, открытый, без повторов', () => {
    const problems = validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('pos', { kind: 'position' }), acc('m', { ownerType: 'merchant', kind: 'settlement' }), acc('d'), acc('d')],
      payoutCurrencies: ['RUB'],
      ...FREE,
    });
    expect(problems).toContain('Источник выплаты N-pos — не ностро и не касса платформы');
    expect(problems).toContain('Источник выплаты N-m — не ностро и не касса платформы');
    expect(problems).toContain('Источник выплаты N-d указан дважды');
  });

  it('счёт приёма QR — источник выплат другого мерчанта: ставить нельзя', () => {
    const problems = validateMerchantAccounts({
      intake: [{ channel: 'qr_static', account: acc('qr') }],
      payout: [acc('p')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      otherPayoutAccountIds: new Set(['qr']),
    });
    expect(problems).toContain('Счёт N-qr — источник выплат другого мерчанта, на приём QR его поставить нельзя');
  });

  it('приём QR и приём 4pmts одного мерчанта на одном счёте — нельзя', () => {
    const problems = validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }, { channel: 'qr_static', account: acc('a') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
    });
    expect(problems).toEqual(['Приём QR и приём 4pmts должны идти на разные ностро']);
  });

  it('счёт приёма 4pmts другого мерчанта на приём QR не ставится', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }, { channel: 'qr_static', account: acc('x') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      other4pmtsIntakeAccountIds: new Set(['x']),
    })).toEqual(['Счёт N-x — ностро приёма 4pmts другого мерчанта, на приём QR его поставить нельзя']);
  });

  it('счёт приёма QR (другого мерчанта или провайдера) на приём 4pmts не ставится', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('x') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      otherQrIntakeAccountIds: new Set(['x']),
    })).toEqual(['Счёт N-x стоит на приёме QR, на приём 4pmts его поставить нельзя']);
  });

  it('счёт с историей приёма QR на приём 4pmts не ставится: требование и живые деньги на одном счёте недопустимы', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('old') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      qrHistoryAccountIds: new Set(['old']),
    })).toEqual(['Счёт N-old использовался для приёма QR — на приём 4pmts его ставить нельзя']);
    // Сейчас на чужом приёме QR — прежнее замечание, без дубля про историю.
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('x') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      otherQrIntakeAccountIds: new Set(['x']),
      qrHistoryAccountIds: new Set(['x']),
    })).toEqual(['Счёт N-x стоит на приёме QR, на приём 4pmts его поставить нельзя']);
    // Свой текущий приём QR на том же счёте — одно замечание «разные ностро».
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('q') }, { channel: 'qr_static', account: acc('q') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      qrHistoryAccountIds: new Set(['q']),
    })).toEqual(['Приём QR и приём 4pmts должны идти на разные ностро']);
    // История QR у счёта приёма QR самого мерчанта — не помеха (это его текущий приём QR).
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }, { channel: 'qr_static', account: acc('q') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      qrHistoryAccountIds: new Set(['q']),
    })).toEqual([]);
  });

  it('🔴 счёт с деньгами (остаток или проводки не по QR) на приём QR не ставится; на приём 4pmts и в выплаты — можно', () => {
    const money = acc('live');
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }, { channel: 'qr_static', account: money }],
      payout: [acc('p')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      nonQrMoneyAccountIds: new Set(['live']),
    })).toEqual(['Счёт N-live уже используется для денег (есть остаток или проводки не по QR) — на приём QR его ставить нельзя']);
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: money }],
      payout: [acc('live2')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      nonQrMoneyAccountIds: new Set(['live', 'live2']),
    })).toEqual([]);
  });

  it('один счёт приёма 4pmts у нескольких мерчантов — не конфликт', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('b')],
      payoutCurrencies: ['RUB'],
      ...FREE,
      other4pmtsIntakeAccountIds: new Set(['a']),
    })).toEqual([]);
  });

  it('счёт приёма 4pmts может быть также источником выплаты этого же мерчанта', () => {
    expect(validateMerchantAccounts({
      intake: [{ channel: '4pmts', account: acc('a') }],
      payout: [acc('a')],
      payoutCurrencies: ['RUB'],
      ...FREE,
    })).toEqual([]);
  });
});
