import { describe, expect, it } from 'vitest';
import { describeTx, foldStatement, splitDebitCredit } from './statement';

describe('foldStatement', () => {
  it('обороты и исходящий остаток', () => {
    const r = foldStatement(1000n, [{ amountMinor: 500n }, { amountMinor: -200n }, { amountMinor: 300n }]);
    expect(r.creditTurnover).toBe(800n);
    expect(r.debitTurnover).toBe(200n);
    expect(r.closing).toBe(1600n); // 1000 + 800 − 200
  });

  it('инвариант вход+кредит−дебет=исход на случайных наборах', () => {
    let seed = 424242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let t = 0; t < 500; t++) {
      const opening = BigInt(rnd() - 0x40000000);
      const entries = Array.from({ length: rnd() % 12 }, () => ({
        amountMinor: BigInt((rnd() % 200000) - 100000),
      }));
      const r = foldStatement(opening, entries);
      expect(opening + r.creditTurnover - r.debitTurnover).toBe(r.closing);
      const net = entries.reduce((a, e) => a + e.amountMinor, 0n);
      expect(r.closing).toBe(opening + net);
    }
  });

  it('пустой период: обороты нулевые, исходящий = входящий', () => {
    const r = foldStatement(777n, []);
    expect(r).toEqual({ creditTurnover: 0n, debitTurnover: 0n, closing: 777n });
  });

  it('нулевые проводки не двигают обороты', () => {
    const r = foldStatement(0n, [{ amountMinor: 0n }, { amountMinor: 0n }]);
    expect(r).toEqual({ creditTurnover: 0n, debitTurnover: 0n, closing: 0n });
  });
});

describe('describeTx', () => {
  it('capture/refund с order_id', () => {
    expect(describeTx({ kind: 'capture', invoiceOrderId: 'FP-1001' })).toBe('Оплата счёта FP-1001');
    expect(describeTx({ kind: 'refund', invoiceOrderId: 'FP-1001' })).toBe('Возврат по счёту FP-1001');
  });
  it('capture без order_id', () => {
    expect(describeTx({ kind: 'capture' })).toBe('Оплата счёта');
  });
  it('прочие типы', () => {
    expect(describeTx({ kind: 'fee' })).toBe('Комиссия');
    expect(describeTx({ kind: 'agent_fee' })).toBe('Комиссия агента');
    expect(describeTx({ kind: 'payout' })).toBe('Выплата');
    expect(describeTx({ kind: 'reserve_hold' })).toBe('Удержание резерва');
    expect(describeTx({ kind: 'reserve_release' })).toBe('Освобождение резерва');
    expect(describeTx({ kind: 'adjustment' })).toBe('Корректировка');
  });
});

describe('splitDebitCredit', () => {
  it('кредит (>0)', () => {
    expect(splitDebitCredit(500n)).toEqual({ debit: 0n, credit: 500n });
  });
  it('дебет (<0) — модуль', () => {
    expect(splitDebitCredit(-500n)).toEqual({ debit: 500n, credit: 0n });
  });
  it('ноль', () => {
    expect(splitDebitCredit(0n)).toEqual({ debit: 0n, credit: 0n });
  });
});

describe('содержание обменной проводки несёт курс сделки', () => {
  it('🔴 курс виден прямо в строке выписки, а не только в карточке транзакции', () => {
    // Курс печатается КАК ЕСТЬ. Прежде выписка резала его до четырёх знаков (105,5238), а журнал
    // печатал шесть — одна сделка выглядела двумя разными курсами. Форматтер теперь один.
    expect(describeTx({ kind: 'exchange', exchangeRateE6: 105_523_845n, exchangeCurrency: 'EUR' }))
      .toBe('Обмен по курсу 105,523845 ₽ за 1 EUR');
  });

  it('курса нет (старые проводки) → прежнее короткое «Обмен», без выдумок', () => {
    expect(describeTx({ kind: 'exchange' })).toBe('Обмен');
    expect(describeTx({ kind: 'exchange', exchangeRateE6: 105_523_845n })).toBe('Обмен');
    expect(describeTx({ kind: 'exchange', exchangeCurrency: 'EUR' })).toBe('Обмен');
  });

  it('нулевой курс не печатается: 0 — это «неизвестно», а не курс', () => {
    expect(describeTx({ kind: 'exchange', exchangeRateE6: 0n, exchangeCurrency: 'EUR' })).toBe('Обмен');
  });

  it('прочие типы проводок не задеты', () => {
    expect(describeTx({ kind: 'capture', invoiceOrderId: 'MER-1' })).toBe('Оплата счёта MER-1');
    expect(describeTx({ kind: 'transfer' })).toBe('Перевод');
  });
});

/**
 * Порядок строк выписки внутри ОДНОЙ секунды: приход выше расхода.
 *
 * Расчёт с провайдером и обмен пишутся одной транзакцией базы — время у них одинаковое до
 * микросекунды. Ранг по ТИПУ операции здесь не работает: на тезерной позиции верен один порядок,
 * на рублёвой — обратный, а тип у проводок тот же самый. Поэтому правило про счёт: строка,
 * поднимающая остаток, идёт выше, и остаток не уходит в минус, которого не было.
 */
function orderRows<T extends { createdAt: string; amountMinor: bigint }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const dt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (dt !== 0) return dt;
    return a.amountMinor === b.amountMinor ? 0 : a.amountMinor > b.amountMinor ? -1 : 1;
  });
}

const T = '2026-09-25T17:47:00.343Z';

describe('порядок строк выписки в один момент', () => {
  it('рублёвая позиция: сначала пришли рубли мерчанта, потом ушли провайдеру', () => {
    // Как вернула база: расчёт (−) раньше обмена (+) — ровно тот случай с боевого.
    const rows = orderRows([
      { createdAt: T, amountMinor: -1_959_183n, tag: 'расчёт с провайдером' },
      { createdAt: T, amountMinor: 1_959_183n, tag: 'обмен с мерчантом' },
    ]);
    expect(rows.map((r) => r.tag)).toEqual(['обмен с мерчантом', 'расчёт с провайдером']);
    let running = 0n;
    const trail = rows.map((r) => (running += r.amountMinor));
    expect(trail, 'остаток ни на одной строке не ушёл в минус').toEqual([1_959_183n, 0n]);
  });

  it('тезерная позиция: сначала пришло 226,0000 от провайдера, потом ушло 218,5224 мерчанту', () => {
    const rows = orderRows([
      { createdAt: T, amountMinor: -2_185_224n, tag: 'обмен с мерчантом' },
      { createdAt: T, amountMinor: 2_260_000n, tag: 'расчёт с провайдером' },
    ]);
    expect(rows.map((r) => r.tag)).toEqual(['расчёт с провайдером', 'обмен с мерчантом']);
    let running = 0n;
    const trail = rows.map((r) => (running += r.amountMinor));
    // Наш заработок остаётся на позиции — и он виден последней строкой, а не выведен отдельно.
    expect(trail).toEqual([2_260_000n, 74_776n]);
  });

  it('разные дни не переставляются ради знака', () => {
    const rows = orderRows([
      { createdAt: '2026-09-25T17:47:00.343Z', amountMinor: 1_959_183n, tag: 'позже' },
      { createdAt: '2026-09-18T11:13:17.009Z', amountMinor: -1_959_183n, tag: 'раньше' },
    ]);
    expect(rows.map((r) => r.tag)).toEqual(['раньше', 'позже']);
  });
});

describe('содержание обменной строки', () => {
  /**
   * Строка описывает ДВИЖЕНИЕ ПО ОТКРЫТОМУ СЧЁТУ и его встречный счёт той же валюты, а сделку
   * оставляет контекстом. Прежде она называла сделку целиком — и на рублёвом счёте мерчанта это
   * было прямой неправдой: «Отдано 19 591,83 ₽ за 218,5224 ₮», хотя тезер на этот счёт не
   * приходил (он лёг на тезерный счёт мерчанта), а сюда пришла валютная позиция.
   */
  it('рублёвый счёт мерчанта: рубли ушли НА КАПИТАЛ, а не «за тезер»', () => {
    expect(
      describeTx({
        kind: 'exchange',
        exchangeRateE6: 89_655_917n,
        exchangeCurrency: 'USDT-TRC20',
        exchangeLeg: { inbound: false, ownText: '19 591,83 ₽', counterTitle: 'Валютная позиция · безнал · RUB', rateOwner: 'merchant' },
      }),
    ).toBe('Списано 19 591,83 ₽ на «Валютная позиция · безнал · RUB» · обмен по курсу мерчанта 89,655917');
  });

  it('тезерный счёт мерчанта: тезер пришёл С КАПИТАЛА', () => {
    expect(
      describeTx({
        kind: 'exchange',
        exchangeRateE6: 89_655_917n,
        exchangeCurrency: 'USDT-TRC20',
        exchangeLeg: { inbound: true, ownText: '218,5224 ₮', counterTitle: 'Валютная позиция · безнал · USDT-TRC20', rateOwner: 'merchant' },
      }),
    ).toBe('Зачислено 218,5224 ₮ с «Валютная позиция · безнал · USDT-TRC20» · обмен по курсу мерчанта 89,655917');
  });

  /**
   * 🔴 Расчёт с провайдером БОЛЬШЕ НЕ ОБМЕН, и подписи у трёх его ног разные.
   *
   * Прежние утверждения ждали «Зачислено 226,0000 ₮ … расчёт по курсу провайдера 86,689513».
   * Курс 86,689513 был ВЫВЕДЕННЫЙ — 19 591,83 ₽ ÷ 226,0000 ₮ из рублёвых ног расчёта. В новой
   * модели рублёвых ног в расчёте нет вовсе (клиент платит провайдеру напрямую), выводить курс
   * не из чего, и обмена в проводке тоже нет: она закрывает тезерный долг.
   */
  it('🔴 ностро: сколько провайдер прислал на самом деле', () => {
    expect(
      describeTx({
        kind: 'qr_settlement',
        exchangeLeg: { inbound: true, ownText: '226,0000 ₮', counterTitle: 'Требование к провайдеру', settlement: true, accountKind: 'nostro' },
      }),
    ).toBe('Провайдер прислал 226,0000 ₮');
  });

  it('🔴 требование: гасится тем, что был должен по курсу дня приёма', () => {
    expect(
      describeTx({
        kind: 'qr_settlement',
        exchangeLeg: { inbound: false, ownText: '225,0781 ₮', counterTitle: 'USDT-TRC20', settlement: true, accountKind: 'payable' },
      }),
    ).toBe('Требование к провайдеру погашено · 225,0781 ₮');
  });

  /**
   * 🔴 Ради ЭТОЙ строки делалась вся волна: отклонение провайдера от зафиксированного курса.
   * На боевой оплате 18.09 это +0,9219 ₮ — прежде величина растворялась в позиции без подписи.
   */
  it('🔴 позиция: переплата провайдера названа своим именем и со знаком', () => {
    expect(
      describeTx({
        kind: 'qr_settlement',
        exchangeLeg: { inbound: true, ownText: '0,9219 ₮', counterTitle: null, settlement: true, accountKind: 'position' },
      }),
    ).toBe('Провайдер прислал больше, чем был должен по курсу дня · +0,9219 ₮');
  });

  it('🔴 позиция: недоплата — то же правило зеркально', () => {
    expect(
      describeTx({
        kind: 'qr_settlement',
        exchangeLeg: { inbound: false, ownText: '0,9219 ₮', counterTitle: null, settlement: true, accountKind: 'position' },
      }),
    ).toBe('Провайдер прислал меньше, чем был должен по курсу дня · −0,9219 ₮');
  });

  it('легаси-фиксация на 445: расчёт переносит рубли, и это назван перенос', () => {
    expect(
      describeTx({
        kind: 'qr_settlement',
        exchangeLeg: { inbound: true, ownText: '19 591,83 ₽', counterTitle: 'Удержано (ожидает выплаты)', settlement: true, accountKind: 'settlement' },
      }),
    ).toBe('Зачислено 19 591,83 ₽ · расчёт провайдера');
  });

  it('ног не разобрали — расчёт не молчит прочерком', () => {
    expect(describeTx({ kind: 'qr_settlement' })).toBe('Расчёт провайдера');
  });

  it('встречных счетов несколько — строка их не называет, но движение остаётся названным', () => {
    expect(
      describeTx({ kind: 'exchange', exchangeRateE6: 89_655_917n, exchangeCurrency: 'USDT-TRC20', exchangeLeg: { inbound: false, ownText: '19 591,83 ₽', counterTitle: null } }),
    ).toBe('Списано 19 591,83 ₽ · обмен по курсу 89,655917');
  });

  it('ног не разобрали — прежняя форма «сделка + курс», а не пустая строка', () => {
    expect(
      describeTx({ kind: 'exchange', exchangeRateE6: 89_655_917n, exchangeCurrency: 'USDT-TRC20', exchangePair: '19 591,83 ₽ → 218,5224 ₮' }),
    ).toBe('Обмен 19 591,83 ₽ → 218,5224 ₮ по 89,655917');
  });

  it('фиксация оплаты по QR больше не обещает «в пути»', () => {
    expect(describeTx({ kind: 'qr_hold' })).toBe('Оплата по QR');
  });
});

/**
 * 🔴 В покупке валюты внутреннего отправителя НЕТ: расчёт с провайдером поднимает и наш кошелёк,
 * и валютную позицию — обе ноги приход. Подпись «Зачислено 226,0000 ₮ с …» стояла на обоих
 * счетах, и каждый ссылался на другой: два счёта получали друг от друга по кругу. Владелец: «на
 * ностро 226 и на капитале те же 226, при этом с ностро не дебетовались».
 */
describe('внутреннего источника нет — называем внешнюю сторону', () => {
  /**
   * Правило «нет внутреннего источника — называем внешнюю сторону» проверяется на ОБМЕНЕ:
   * расчёт с провайдером теперь описывается своими подписями и этой ветки не касается.
   */
  it('тезер пришёл ОТ ПРОВАЙДЕРА, а не «с валютной позиции»', () => {
    expect(
      describeTx({
        kind: 'exchange',
        exchangeRateE6: 86_689_513n,
        exchangeCurrency: 'USDT-TRC20',
        exchangeLeg: { inbound: true, ownText: '226,0000 ₮', counterTitle: null, externalSide: 'provider', rateOwner: 'provider' },
      }),
    ).toBe('Зачислено 226,0000 ₮ от провайдера · обмен по курсу провайдера 86,689513');
  });

  it('рубли ушли ПРОВАЙДЕРУ, а не «на валютную позицию»', () => {
    expect(
      describeTx({
        kind: 'exchange',
        exchangeRateE6: 86_689_513n,
        exchangeCurrency: 'USDT-TRC20',
        exchangeLeg: { inbound: false, ownText: '19 591,83 ₽', counterTitle: null, externalSide: 'provider', rateOwner: 'provider' },
      }),
    ).toBe('Списано 19 591,83 ₽ провайдеру · обмен по курсу провайдера 86,689513');
  });

  it('настоящий перевод между нашими счетами по-прежнему называет встречный счёт', () => {
    expect(
      describeTx({
        kind: 'exchange',
        exchangeRateE6: 89_655_917n,
        exchangeCurrency: 'USDT-TRC20',
        exchangeLeg: { inbound: false, ownText: '218,5224 ₮', counterTitle: 'К выплате USDT-TRC20', rateOwner: 'merchant' },
      }),
    ).toBe('Списано 218,5224 ₮ на «К выплате USDT-TRC20» · обмен по курсу мерчанта 89,655917');
  });
});
