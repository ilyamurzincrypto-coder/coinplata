import { describe, expect, it } from 'vitest';
import {
  acquiringHintBp, activationBlockers, belowCostBp, rulesComplete, validateMerchantRules,
  type MerchantRulesInput,
} from './merchant-rules';

const ok: MerchantRulesInput = {
  acquiringRateBp: 250,
  spreads: [{ currency: 'USD', priceBp: 500 }],
  payout: { kind: 'currencies', currencies: ['USD'], primary: 'USD' },
};

describe('validateMerchantRules', () => {
  it('полные правила — ни одной претензии', () => {
    expect(validateMerchantRules(ok)).toEqual([]);
  });

  it('🔴 «только рубли» — полноценный выбор, а не пустота', () => {
    // Разведка Б2-5: рубли это отсутствие каналов. Такой мерчант полон без валютного канала.
    expect(validateMerchantRules({ ...ok, payout: { kind: 'rub_only' } })).toEqual([]);
  });

  it('валюты выбраны «пусто» — это НЕ рублёвый выбор, а незаполненное поле', () => {
    const p = validateMerchantRules({ ...ok, payout: { kind: 'currencies', currencies: [], primary: '' } });
    expect(p).toContain('Выберите валюту выплаты или отметьте «только рубли»');
  });

  it('🔴 нулевой тариф допустим — но как введённое значение, а не как пустота', () => {
    // Ноль осознанный (дарим эквайринг) валиден; «поле не трогали» ловится формой, не здесь.
    expect(validateMerchantRules({ ...ok, acquiringRateBp: 0 })).toEqual([]);
  });

  it('без нашей наценки — отказ', () => {
    expect(validateMerchantRules({ ...ok, spreads: [] })).toContain('Задайте нашу наценку хотя бы по одной валюте');
  });

  it('отрицательные и запредельные значения названы поимённо', () => {
    const p = validateMerchantRules({ acquiringRateBp: -1, spreads: [{ currency: 'USD', priceBp: -5 }], payout: { kind: 'rub_only' } });
    expect(p.length).toBe(2); // перечень, а не первое попавшееся
    expect(validateMerchantRules({ ...ok, acquiringRateBp: 10_001 })).toContain('Тариф эквайринга не может превышать 100 %');
  });
});

describe('подсказка тарифа = расходы платформы', () => {
  it('НСПК + банк, считается динамически', () => {
    expect(acquiringHintBp(70, 70)).toBe(140);
    expect(acquiringHintBp(70, 110)).toBe(180); // банк поднял ставку — подсказка выросла
  });

  it('🔴 ставка ниже расходов → видно, сколько платформа теряет', () => {
    expect(belowCostBp(100, 140)).toBe(40); // 0,4 п.п. в минус
    expect(belowCostBp(0, 140)).toBe(140); // эквайринг подарен целиком
    expect(belowCostBp(250, 140)).toBe(0); // выше расходов — не теряем
  });
});

describe('полнота и активация', () => {
  it('🔴 полнота — только отметка, ничего не выводится косвенно', () => {
    expect(rulesComplete({ rulesSetAt: null })).toBe(false);
    expect(rulesComplete({ rulesSetAt: new Date() })).toBe(true);
  });

  it('кнопка активации объясняет, чего не хватает', () => {
    expect(activationBlockers({ status: 'draft', rulesSetAt: null })).toEqual(['правила не заданы']);
    expect(activationBlockers({ status: 'draft', rulesSetAt: new Date() })).toEqual([]);
  });

  it('активация неприменима к не-draft — и это сказано словами', () => {
    const b = activationBlockers({ status: 'active', rulesSetAt: new Date() });
    expect(b.length).toBe(1);
    expect(b[0]).toMatch(/применима только к draft/);
  });
});

describe('валюта выплаты обязана иметь нашу наценку', () => {
  const base = { acquiringRateBp: 250, spreads: [{ currency: 'USD', priceBp: 500 }] };

  it('🔴 канал в валюте без нашей наценки — правила не сохраняются', () => {
    // Ровно боевой случай: выплату в USDT включили, наценка осталась фиатной.
    const problems = validateMerchantRules({
      ...base,
      payout: { kind: 'currencies', currencies: ['USDT-TRC20'], primary: 'USDT-TRC20' },
    });
    expect(problems.some((p) => p.includes('USDT-TRC20') && p.includes('наценка'))).toBe(true);
  });

  it('валюта с нашей наценкой проходит', () => {
    const problems = validateMerchantRules({
      acquiringRateBp: 250,
      spreads: [{ currency: 'USDT-TRC20', priceBp: 400 }],
      payout: { kind: 'currencies', currencies: ['USDT-TRC20'], primary: 'USDT-TRC20' },
    });
    expect(problems).toEqual([]);
  });

  it('«только рубли» нашей наценки по валютам не требует', () => {
    expect(validateMerchantRules({ ...base, payout: { kind: 'rub_only' } })).toEqual([]);
  });
});

describe('основная валюта выплаты названа явно', () => {
  const base = {
    acquiringRateBp: 0,
    spreads: [{ currency: 'USD', priceBp: 500 }, { currency: 'EUR', priceBp: 500 }],
  };

  it('🔴 основная не указана → сохранение не проходит', () => {
    // Боевой случай: три канала, основным стал EUR просто потому, что оказался первым в массиве,
    // и счёт, выставленный в долларах, ушёл в евро. Порядок галочек не решает, куда идут деньги.
    const p = validateMerchantRules({ ...base, payout: { kind: 'currencies', currencies: ['USD', 'EUR'], primary: '' } });
    expect(p.some((x) => x.includes('основную валюту'))).toBe(true);
  });

  it('🔴 основная не из числа выбранных → тоже отказ, с называнием валюты', () => {
    const p = validateMerchantRules({ ...base, payout: { kind: 'currencies', currencies: ['USD', 'EUR'], primary: 'TRY' } });
    expect(p.some((x) => x.includes('TRY'))).toBe(true);
  });

  it('основная выбрана и входит в список → претензий нет', () => {
    expect(validateMerchantRules({ ...base, payout: { kind: 'currencies', currencies: ['USD', 'EUR'], primary: 'EUR' } })).toEqual([]);
  });

  it('только рубли — основная не спрашивается', () => {
    expect(validateMerchantRules({ ...base, payout: { kind: 'rub_only' } })).toEqual([]);
  });
});
