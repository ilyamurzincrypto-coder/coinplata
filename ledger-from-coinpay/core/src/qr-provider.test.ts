import { describe, expect, it } from 'vitest';
import {
  allocateUsdt, buildQrDeclineEntries, buildQrExchangeEntries, buildQrHoldEntries, buildQrIntakeEntries,
  merchantUsdtRateE6, providerRateE6, qrProviderRateCostRubMinor, qrSpreadUsdtMinor, rubToUsdtMinor, usdtToRubMinor,
} from './qr-provider';

const sumBy = (es: { amountMinor: bigint; currency: string }[]) =>
  es.reduce<Record<string, bigint>>((acc, e) => ({ ...acc, [e.currency]: (acc[e.currency] ?? 0n) + e.amountMinor }), {});
const IN_ACC = { claim: 'claim', usdtWallet: 'wallet', posRub: 'posRub', posUsdt: 'posUsdt' };
/** Легаси-оплата: фиксация положила рубли на 445, зачисление обязано забрать их на расчётный. */
const IN_ACC_LEGACY = { ...IN_ACC, legacyHold: { merchantHold: 'hold445', merchantSettlement: 'mRub' } };
/** Счёта дохода в наборе НЕТ: наша маржа остаётся остатком позиции ₮, отдельного счёта у неё нет. */
const EX_ACC = { merchantRub: 'mRub', merchantUsdt: 'mUsdt', posRub: 'posRub', posUsdt: 'posUsdt' };
const CB = 84_336_300n;
const A = 885_500n;
const M = 999_393n;

describe('курсы QR-провайдера', () => {
  it('курс провайдера = ЦБ + 3 %', () => expect(providerRateE6(CB, 300)).toBe(86_866_389n));
  it('курс мерчанта = курс провайдера + тариф мерчанта', () => expect(merchantUsdtRateE6(86_866_389n, 200)).toBe(88_603_717n));
  it('₽ → USDT вниз, 4 знака', () => {
    expect(rubToUsdtMinor(A, 86_866_389n)).toBe(1_019_381n);
    expect(rubToUsdtMinor(A, 88_603_717n)).toBe(999_393n);
  });
  it('USDT → ₽ вверх для суммы клиенту', () => expect(usdtToRubMinor(1_007_050n, 88_603_717n, 'ceil')).toBe(892_284n));

  it('округление отрицательных: ceil к +∞, floor к −∞ (не local a+b-1 багу)', () => {
    // -150 × 1e6 / 1e8 = -1,5 ровно: ceil(-1,5) = -1, floor(-1,5) = -2.
    expect(usdtToRubMinor(-150n, 1_000_000n, 'ceil')).toBe(-1n);
    expect(usdtToRubMinor(-150n, 1_000_000n, 'floor')).toBe(-2n);
  });
});

describe('проводки QR', () => {
  /**
   * 🔴 Фиксация: требование к провайдеру В ТЕЗЕРЕ, долг мерчанту в рублях.
   *
   * Рубли клиента уходят провайдеру напрямую и до нас не доходят; должен он нам тезер по курсу,
   * зафиксированному в момент приёма. Прежняя фиксация писала две рублёвые ноги и делала вид, что
   * рубли пришли НАМ на банковский счёт. Теперь видно настоящую экспозицию: длинные в тезере,
   * короткие в рубле.
   */
  it('🔴 фиксация: требование ₮ против позиции ₮, долг мерчанту ₽ против позиции ₽, Σ=0 по каждой', () => {
    const Uexp = 1_019_381n;
    const es = buildQrHoldEntries({
      amountRubMinor: A, providerUsdtMinor: Uexp,
      accounts: { claim: 'claim', merchantSettlement: 'mRub', posRub: 'posRub', posUsdt: 'posUsdt' },
    });
    const by = (id: string) => es.find((e) => e.accountId === id)?.amountMinor;
    expect(by('claim'), 'провайдер должен нам тезер').toBe(-Uexp);
    expect(by('posUsdt'), 'длинная позиция в тезере').toBe(Uexp);
    expect(by('mRub'), 'мерчанту обещаны рубли').toBe(A);
    expect(by('posRub'), 'короткая позиция в рубле').toBe(-A);
    const s = sumBy(es);
    expect(s.RUB).toBe(0n);
    expect(s['USDT-TRC20']).toBe(0n);
  });

  it('🔴 расчёт: требование гасится на СВОЮ сумму, расхождение с договорённостью — отдельной ногой', () => {
    const Uexp = 1_019_381n;
    const U = 1_030_000n; // провайдер прислал больше, чем обещал курс дня приёма
    const r = buildQrIntakeEntries({ amountRubMinor: A, providerUsdtMinor: Uexp, usdtReceivedMinor: U, accounts: IN_ACC });
    const by = (id: string) => r.entries.find((e) => e.accountId === id)?.amountMinor;
    expect(by('wallet'), 'на кошелёк пришло фактическое').toBe(-U);
    expect(by('claim'), 'требование гасится ровно на обещанное').toBe(Uexp);
    expect(by('posUsdt'), 'переплата провайдера видна отдельной ногой').toBe(U - Uexp);
    // Рублёвых ног нет вовсе: рубли к нам не приходили — они ушли провайдеру напрямую.
    expect(r.entries.some((e) => e.currency === 'RUB')).toBe(false);
    expect(sumBy(r.entries)['USDT-TRC20']).toBe(0n);
  });

  it('пришло ровно по договорённости — лишней ноги расхождения не появляется', () => {
    const Uexp = 1_019_381n;
    const r = buildQrIntakeEntries({ amountRubMinor: A, providerUsdtMinor: Uexp, usdtReceivedMinor: Uexp, accounts: IN_ACC });
    expect(r.entries).toHaveLength(2);
    expect(r.entries.some((e) => e.amountMinor === 0n)).toBe(false);
    expect(sumBy(r.entries)['USDT-TRC20']).toBe(0n);
  });

  it('🔴 легаси-оплата с 445: зачисление забирает рубли оттуда на расчётный счёт, Σ=0', () => {
    const U = 1_019_381n;
    const r = buildQrIntakeEntries({ amountRubMinor: A, providerUsdtMinor: U, usdtReceivedMinor: U, accounts: IN_ACC_LEGACY });
    const by = (id: string) => r.entries.find((e) => e.accountId === id)?.amountMinor;
    expect(by('hold445')).toBe(-A); // счёт «В пути» гасится
    expect(by('mRub')).toBe(A); // рубли уходят туда, где мерчант их ищет
    expect(by('claim'), 'требование гасится тезером').toBe(U);
    const s = sumBy(r.entries);
    expect(s.RUB).toBe(0n);
    expect(s['USDT-TRC20']).toBe(0n);
  });

  it('🔴 обмен: ВСЯ рублёвая сумма уходит в позицию, мерчанту ровно M, счёта дохода НЕТ, Σ=0 обе валюты', () => {
    const U = 1_019_381n;
    const r = buildQrExchangeEntries({ amountRubMinor: A, usdtReceivedMinor: U, merchantUsdtMinor: M, accounts: EX_ACC });
    // Спред остаётся СПРАВОЧНЫМ числом — проводкой он не становится.
    expect(r.incomeUsdtMinor).toBe(qrSpreadUsdtMinor(U, M));
    const by = (id: string) => r.entries.find((e) => e.accountId === id)?.amountMinor;
    expect(by('mRub')).toBe(-A);
    // Рубли конвертируются целиком: из позиции ₽ доход больше не вычитается.
    expect(by('posRub')).toBe(A);
    // 🔴 Позиция ₮ отдаёт РОВНО долю мерчанта: спред остаётся лежать на ней самой.
    expect(by('posUsdt')).toBe(-M);
    expect(by('mUsdt')).toBe(M);
    // Ровно четыре ноги — пятой, доходной, в обмене больше не существует.
    expect(r.entries).toHaveLength(4);
    expect(r.entries.map((e) => e.accountId).sort()).toEqual(['mRub', 'mUsdt', 'posRub', 'posUsdt']);
    const s = sumBy(r.entries);
    expect(s.RUB).toBe(0n);
    expect(s['USDT-TRC20']).toBe(0n);
  });

  it('🔴 ноги «затрат банка/НСПК» нет НИ В ОДНОЙ из двух проводок — у «Филиала 2» нет ни банка, ни НСПК', () => {
    const U = 1_019_381n;
    const all = [
      ...buildQrIntakeEntries({ amountRubMinor: A, providerUsdtMinor: U, usdtReceivedMinor: U, accounts: IN_ACC }).entries,
      ...buildQrExchangeEntries({ amountRubMinor: A, usdtReceivedMinor: U, merchantUsdtMinor: M, accounts: EX_ACC }).entries,
    ];
    // Набор счетов закрыт: ничего, кроме перечисленных, в расчёте не участвует — ни 372, ни 445,
    // ни счёт дохода обмена: заработок лежит остатком на позиции ₮, своего счёта у него нет.
    expect([...new Set(all.map((e) => e.accountId))].sort()).toEqual(
      ['claim', 'mRub', 'mUsdt', 'posRub', 'posUsdt', 'wallet'].sort(),
    );
  });

  it('🔴 боевой пример 25.09 ЦЕЛИКОМ: фиксация → расчёт → обмен, ₽ в ноль, ₮ держит 7,4776', () => {
    const amountRubMinor = 1_959_183n;
    const cb = 84_509_300n;
    const provRateE6 = 87_044_579n;   // ЦБ + 3 %, зафиксирован при приёме 18.09
    const Uexp = rubToUsdtMinor(amountRubMinor, provRateE6); // 225,0781 ₮ — столько должен провайдер
    const U = 2_260_000n;             // 226,0000 ₮ — столько прислал фактически 25.09
    const merchantUsdtMinor = 2_185_224n;

    expect(Uexp, 'требование по курсу дня приёма').toBe(2_250_781n);

    const hold = buildQrHoldEntries({
      amountRubMinor, providerUsdtMinor: Uexp,
      accounts: { claim: 'claim', merchantSettlement: 'mRub', posRub: 'posRub', posUsdt: 'posUsdt' },
    });
    const intake = buildQrIntakeEntries({ amountRubMinor, providerUsdtMinor: Uexp, usdtReceivedMinor: U, accounts: IN_ACC });
    const exch = buildQrExchangeEntries({ amountRubMinor, usdtReceivedMinor: U, merchantUsdtMinor, accounts: EX_ACC });

    expect(exch.incomeUsdtMinor, 'заработок на обмене с мерчантом').toBe(74_776n);
    expect(qrProviderRateCostRubMinor(amountRubMinor, U, cb)).toBe(49_273n);
    expect(rubToUsdtMinor(amountRubMinor, 89_655_917n)).toBe(merchantUsdtMinor);

    const all = [...hold, ...intake.entries, ...exch.entries];
    const by = (id: string) => all.filter((e) => e.accountId === id).reduce((a, e) => a + e.amountMinor, 0n);

    // Требование открылось фиксацией на 225,0781 и полностью погашено расчётом.
    expect(by('claim')).toBe(0n);
    // Рубли мерчанта пришли фиксацией и ушли обменом целиком.
    expect(by('mRub')).toBe(0n);
    // 🔴 Рублёвая позиция обнуляется: короткая при приёме, закрыта обменом.
    expect(by('posRub')).toBe(0n);
    /**
     * 🔴 Тезерная позиция держит ровно наш заработок — и он складывается из ДВУХ источников,
     * которые теперь различимы: обмен с мерчантом даёт 6,5557 ₮, а переплата провайдера против
     * зафиксированного курса — ещё 0,9219 ₮. Прежде вторая величина растворялась без следа.
     */
    expect(by('posUsdt')).toBe(74_776n);
    expect(Uexp - merchantUsdtMinor, 'заработок по зафиксированным курсам').toBe(65_557n);
    expect(U - Uexp, 'переплата провайдера против договорённости').toBe(9_219n);
    expect((Uexp - merchantUsdtMinor) + (U - Uexp)).toBe(74_776n);

    // Счёта «В пути» и счёта дохода в цепочке нет ни одной ногой.
    expect(all.some((e) => e.accountId === 'hold445' || e.accountId === '374')).toBe(false);
    // Тезер разошёлся без остатка: 226,0000 = 218,5224 мерчанту + 7,4776 на позиции.
    expect(by('mUsdt') + by('posUsdt')).toBe(U);
    expect(by('wallet')).toBe(-U);
    for (const es of [hold, intake.entries, exch.entries]) {
      const sum = sumBy(es);
      expect(sum.RUB ?? 0n).toBe(0n);
      expect(sum['USDT-TRC20'] ?? 0n).toBe(0n);
    }
  });

  it('пришло меньше, чем обещано мерчанту (U < M) — спред отрицателен, убыток виден в ТЕЗЕРЕ, Σ=0', () => {
    const U = 989_393n;
    const r = buildQrExchangeEntries({ amountRubMinor: A, usdtReceivedMinor: U, merchantUsdtMinor: M, accounts: EX_ACC });
    expect(r.incomeUsdtMinor).toBeLessThan(0n);
    expect(r.incomeUsdtMinor).toBe(U - M);
    // Убыток — тезерный: позиция ₮ отдаёт мерчанту больше, чем получила от провайдера, и уходит
    // в минус на разницу. Позиция ₽ всё равно в ноль — рубли конвертируются целиком.
    const by = (id: string) => r.entries.find((e) => e.accountId === id)?.amountMinor;
    expect(by('posRub')).toBe(A);
    expect(by('posUsdt')).toBe(-M);
    expect(sumBy(r.entries).RUB).toBe(0n);
    expect(sumBy(r.entries)['USDT-TRC20']).toBe(0n);
  });

  it('пришло ровно по обещанию — спреда нет, на позиции ₮ не остаётся ничего, лишних ног не появляется', () => {
    const intake = buildQrIntakeEntries({ amountRubMinor: A, providerUsdtMinor: M, usdtReceivedMinor: M, accounts: IN_ACC });
    const r = buildQrExchangeEntries({ amountRubMinor: A, usdtReceivedMinor: M, merchantUsdtMinor: M, accounts: EX_ACC });
    expect(r.incomeUsdtMinor).toBe(0n);
    expect(r.entries).toHaveLength(4);
    expect(r.entries.some((e) => e.amountMinor === 0n)).toBe(false);
    /**
     * Заработка нет — значит позиция ₮ по ВСЕЙ цепочке гаснет в ноль. Фиксация обязана быть в
     * наборе: именно она теперь ставит тезер на позицию (требование к провайдеру).
     */
    const hold = buildQrHoldEntries({
      amountRubMinor: A, providerUsdtMinor: M,
      accounts: { claim: 'claim', merchantSettlement: 'mRub', posRub: 'posRub', posUsdt: 'posUsdt' },
    });
    const all = [...hold, ...intake.entries, ...r.entries];
    expect(all.filter((e) => e.accountId === 'posUsdt').reduce((a, e) => a + e.amountMinor, 0n)).toBe(0n);
    expect(all.filter((e) => e.accountId === 'posRub').reduce((a, e) => a + e.amountMinor, 0n)).toBe(0n);
  });

  it('суммы ≤ 0 — отказ, а не «примерно ноль»', () => {
    expect(() => buildQrIntakeEntries({ amountRubMinor: 0n, providerUsdtMinor: 0n, usdtReceivedMinor: 1n, accounts: IN_ACC })).toThrow();
    expect(() => buildQrIntakeEntries({ amountRubMinor: A, providerUsdtMinor: 1n, usdtReceivedMinor: 0n, accounts: IN_ACC })).toThrow();
    expect(() => buildQrExchangeEntries({ amountRubMinor: A, usdtReceivedMinor: 1n, merchantUsdtMinor: 0n, accounts: EX_ACC })).toThrow();
    expect(() => buildQrExchangeEntries({ amountRubMinor: 0n, usdtReceivedMinor: 1n, merchantUsdtMinor: M, accounts: EX_ACC })).toThrow();
  });

  it('🔴 инвариант пары: позиция ₽ в ноль, позиция ₮ держит ровно спред, курс ЦБ не участвует', () => {
    const combos: { amountRubMinor: bigint; usdtReceivedMinor: bigint; merchantUsdtMinor: bigint }[] = [
      { amountRubMinor: A, usdtReceivedMinor: 1_019_381n, merchantUsdtMinor: M },
      { amountRubMinor: A, usdtReceivedMinor: 1_009_381n, merchantUsdtMinor: M },
      { amountRubMinor: A, usdtReceivedMinor: 989_393n, merchantUsdtMinor: M },
      { amountRubMinor: 12_345_600n, usdtReceivedMinor: 140_000n, merchantUsdtMinor: 138_000n },
      { amountRubMinor: 50_000n, usdtReceivedMinor: 6_000n, merchantUsdtMinor: 5_800n },
      { amountRubMinor: 1_959_183n, usdtReceivedMinor: 2_260_000n, merchantUsdtMinor: 2_185_224n },
    ];
    for (const p of combos) {
      // Цепочка целиком: фиксация ставит требование и долг, расчёт гасит требование, обмен отдаёт
      // мерчанту его долю. Проверяется инвариант всей тройки, а не пары.
      const hold = buildQrHoldEntries({
        amountRubMinor: p.amountRubMinor, providerUsdtMinor: p.usdtReceivedMinor,
        accounts: { claim: 'claim', merchantSettlement: 'mRub', posRub: 'posRub', posUsdt: 'posUsdt' },
      });
      const intake = buildQrIntakeEntries({ amountRubMinor: p.amountRubMinor, providerUsdtMinor: p.usdtReceivedMinor, usdtReceivedMinor: p.usdtReceivedMinor, accounts: IN_ACC });
      const exch = buildQrExchangeEntries({ ...p, accounts: EX_ACC });
      const all = [...hold, ...intake.entries, ...exch.entries];
      const by = (id: string) => all.filter((e) => e.accountId === id).reduce((a, e) => a + e.amountMinor, 0n);
      // Рубли мерчанта пришли фиксацией и ушли обменом — по цепочке ноль.
      expect(by('mRub')).toBe(0n);
      expect(by('claim'), 'требование открыто и погашено').toBe(0n);
      // Счёт «В пути» в расчёте новой оплаты не участвует.
      expect(all.some((e) => e.accountId === 'hold445')).toBe(false);
      // Тезер мерчанта — ровно то, что обещала касса; наша доля осталась на позиции.
      expect(by('mUsdt')).toBe(p.merchantUsdtMinor);
      // 🔴 Набор счетов ЗАКРЫТ при любом раскладе сумм: ни счёта дохода, ни 372, ни 445.
      expect([...new Set(all.map((e) => e.accountId))].sort()).toEqual(
        ['claim', 'mRub', 'mUsdt', 'posRub', 'posUsdt', 'wallet'].sort(),
      );
      // 🔴 Рубли конвертированы целиком — без всякой оценки по ЦБ и её копейки округления.
      expect(by('posRub')).toBe(0n);
      // 🔴 Позиция ₮ держит РОВНО спред: пришло U, ушло мерчанту M, остаток наш.
      expect(by('posUsdt')).toBe(p.usdtReceivedMinor - p.merchantUsdtMinor);
      expect(by('posUsdt')).toBe(exch.incomeUsdtMinor);
      // Тезер-ностро отдал всё пришедшее: долг мерчанту + остаток позиции = U.
      expect(by('wallet')).toBe(-p.usdtReceivedMinor);
      expect(by('mUsdt') + by('posUsdt')).toBe(p.usdtReceivedMinor);
      // Σ=0 по каждой валюте на КАЖДОЙ проводке цепочки. У расчёта рублёвых ног нет вовсе —
      // рубли к нам не приходили, поэтому валюта в сумме может отсутствовать, а не быть нулём.
      for (const es of [hold, intake.entries, exch.entries]) {
        const sum = sumBy(es);
        expect(sum.RUB ?? 0n).toBe(0n);
        expect(sum['USDT-TRC20'] ?? 0n).toBe(0n);
      }
    }
  });

  it('отклонение — точное зеркало фиксации по всем четырём ногам', () => {
    const acc = { claim: 'claim', merchantSettlement: 'mRub', posRub: 'posRub', posUsdt: 'posUsdt' };
    const Uexp = 1_019_381n;
    const hold = buildQrHoldEntries({ amountRubMinor: A, providerUsdtMinor: Uexp, accounts: acc });
    const decline = buildQrDeclineEntries({ amountRubMinor: A, providerUsdtMinor: Uexp, accounts: acc });
    expect(decline).toEqual(hold.map((e) => ({ ...e, amountMinor: -e.amountMinor })));
    // Отклонение обязано обнулять фиксацию целиком: ни требования, ни долга, ни позиций.
    const all = [...hold, ...decline];
    for (const id of ['claim', 'mRub', 'posRub', 'posUsdt']) {
      expect(all.filter((e) => e.accountId === id).reduce((a, e) => a + e.amountMinor, 0n), id).toBe(0n);
    }
  });

  it('распределение USDT пропорционально рублям, остаток последнему, сумма сходится', () => {
    const parts = allocateUsdt(1_000_001n, [300_000n, 700_000n]);
    expect(parts).toEqual([300_000n, 700_001n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1_000_001n);
    expect(() => allocateUsdt(10n, [])).toThrow();
  });

  it('распределение USDT: любая сумма ≤ 0 среди оплат — ошибка', () => {
    expect(() => allocateUsdt(1_000n, [500n, -100n, 600n])).toThrow();
    expect(() => allocateUsdt(1_000n, [500n, 0n, 500n])).toThrow();
  });
});
