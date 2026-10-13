import { describe, expect, it } from 'vitest';
import { requiredPayoutCurrencies } from './merchant-account-binding';

/**
 * `all` — ответ `merchantPayoutCurrencies` (каналы, иначе легаси-цель, иначе RUB);
 * `fromChannels` — только валюты действующих каналов выплаты.
 */
describe('requiredPayoutCurrencies — валюты источников выплат в окне правил', () => {
  it('«только рубли», у мерчанта ничего нет — RUB', () => {
    expect(requiredPayoutCurrencies({ kind: 'rub_only' }, { all: ['RUB'], fromChannels: [] })).toEqual(['RUB']);
  });

  it('«только рубли», но у мерчанта уже есть валюта выплаты (канал или легаси) — RUB и она: так посчитает запись', () => {
    expect(requiredPayoutCurrencies({ kind: 'rub_only' }, { all: ['USD'], fromChannels: [] })).toEqual(['RUB', 'USD']);
    expect(requiredPayoutCurrencies({ kind: 'rub_only' }, { all: ['EUR'], fromChannels: ['EUR'] })).toEqual(['RUB', 'EUR']);
  });

  it('валюты формы: запасной RUB из «ничего нет» не требуется', () => {
    expect(requiredPayoutCurrencies({ kind: 'currencies', currencies: ['USD'], primary: 'USD' }, { all: ['RUB'], fromChannels: [] })).toEqual(['USD']);
  });

  it('🔴 валюты формы: легаси-цель мерчанта не требуется — после сохранения каналы её перекроют', () => {
    expect(requiredPayoutCurrencies({ kind: 'currencies', currencies: ['USD'], primary: 'USD' }, { all: ['EUR'], fromChannels: [] })).toEqual(['USD']);
  });

  it('валюты формы ∪ валюты уже заведённых каналов, без дублей', () => {
    expect(requiredPayoutCurrencies({ kind: 'currencies', currencies: ['USD', 'USD'], primary: 'USD' }, { all: ['EUR', 'USD'], fromChannels: ['EUR', 'USD'] }))
      .toEqual(['USD', 'EUR']);
  });

  it('в форме ещё ничего не выбрано — только каналы', () => {
    expect(requiredPayoutCurrencies({ kind: 'currencies', currencies: [], primary: '' }, { all: ['RUB'], fromChannels: [] })).toEqual([]);
    expect(requiredPayoutCurrencies({ kind: 'currencies', currencies: [], primary: '' }, { all: ['TRY'], fromChannels: ['TRY'] })).toEqual(['TRY']);
  });
});
