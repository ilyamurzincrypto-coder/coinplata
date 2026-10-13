import { describe, expect, it } from 'vitest';
import { amountInWordsRu, numberToWordsRu, pluralRu } from './amount-words';

/** Разрядный разделитель ru-RU — неразрывный пробел; сравниваем, не завися от его вида. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('pluralRu', () => {
  it('склонение по числу', () => {
    expect(pluralRu(1n, ['рубль', 'рубля', 'рублей'])).toBe('рубль');
    expect(pluralRu(2n, ['рубль', 'рубля', 'рублей'])).toBe('рубля');
    expect(pluralRu(5n, ['рубль', 'рубля', 'рублей'])).toBe('рублей');
    expect(pluralRu(11n, ['рубль', 'рубля', 'рублей'])).toBe('рублей');
    expect(pluralRu(21n, ['рубль', 'рубля', 'рублей'])).toBe('рубль');
    expect(pluralRu(111n, ['рубль', 'рубля', 'рублей'])).toBe('рублей');
    expect(pluralRu(0n, ['копейка', 'копейки', 'копеек'])).toBe('копеек');
  });
});

describe('numberToWordsRu', () => {
  it('базовые', () => {
    expect(numberToWordsRu(0n)).toBe('ноль');
    expect(numberToWordsRu(10000n)).toBe('десять тысяч');
    expect(numberToWordsRu(21n)).toBe('двадцать один');
    expect(numberToWordsRu(111n)).toBe('сто одиннадцать');
    expect(numberToWordsRu(1000n, 'f')).toBe('одна тысяча');
    expect(numberToWordsRu(2000n, 'f')).toBe('две тысячи');
    expect(numberToWordsRu(1234567n)).toBe('один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь');
  });
});

describe('amountInWordsRu — RUB', () => {
  it('целые и краевые', () => {
    expect(amountInWordsRu(1000000n, 'RUB')).toBe('десять тысяч рублей 00 копеек');
    expect(amountInWordsRu(100n, 'RUB')).toBe('один рубль 00 копеек');
    expect(amountInWordsRu(200n, 'RUB')).toBe('два рубля 00 копеек');
    expect(amountInWordsRu(2100n, 'RUB')).toBe('двадцать один рубль 00 копеек');
    expect(amountInWordsRu(11100n, 'RUB')).toBe('сто одиннадцать рублей 00 копеек');
  });
  it('дробные', () => {
    expect(amountInWordsRu(1050n, 'RUB')).toBe('десять рублей 50 копеек');
    expect(amountInWordsRu(2145n, 'RUB')).toBe('двадцать один рубль 45 копеек');
    expect(amountInWordsRu(1n, 'RUB')).toBe('ноль рублей 01 копейка');
  });
});

describe('amountInWordsRu — USD (выдача долларовая)', () => {
  it('доллары и центы', () => {
    expect(amountInWordsRu(1000000n, 'USD')).toBe('десять тысяч долларов США 00 центов');
    expect(amountInWordsRu(200n, 'USD')).toBe('два доллара США 00 центов');
    expect(amountInWordsRu(2100n, 'USD')).toBe('двадцать один доллар США 00 центов');
    expect(amountInWordsRu(12345n, 'USD')).toBe('сто двадцать три доллара США 45 центов');
    expect(amountInWordsRu(100n, 'USD')).toBe('один доллар США 00 центов');
  });
});

describe('(Хвост Б2-1) ордер печатается СВОЕЙ валютой, а не рублём', () => {
  it('🔴 евро: не склоняется — «евро» при любом числе', () => {
    expect(amountInWordsRu(100_00n, 'EUR')).toBe('сто евро 00 центов');
    expect(amountInWordsRu(1_00n, 'EUR')).toBe('один евро 00 центов');
    expect(amountInWordsRu(2_50n, 'EUR')).toBe('два евро 50 центов');
  });

  it('🔴 турецкая лира: склоняется вместе с определением', () => {
    expect(amountInWordsRu(1_00n, 'TRY')).toBe('одна лира турецкая 00 курушей');
    expect(amountInWordsRu(3_00n, 'TRY')).toBe('три лиры турецкие 00 курушей');
    expect(amountInWordsRu(100_00n, 'TRY')).toBe('сто лир турецких 00 курушей');
  });

  /**
   * 🔴 Регресс с боевого 25.09. «Сумма» на бланке печаталась компонентом, знающим про четыре
   * знака тезера, а «Сумма прописью» строкой ниже — делением на 100: 218,5224 ₮ и 21 852,24 в одной
   * рамке. Бумагу подписывает клиент, поэтому обе строки обязаны считаться от одного числа знаков.
   */
  it('🔴 крипта: цифрами, но со СВОИМ числом знаков и своим символом', () => {
    // Остаток мерчанта с боевого: 2 185 224 минорных единицы тезера — это 218,5224, а не 21 852,24.
    expect(plain(amountInWordsRu(2_185_224n, 'USDT-TRC20'))).toBe('218,5224 ₮');
    // Наш тезер-ностро с того же профиля.
    expect(plain(amountInWordsRu(2_260_000n, 'USDT-TRC20'))).toBe('226,0000 ₮');
    expect(plain(amountInWordsRu(50_0000n, 'TRX'))).toBe('50,0000 TRX');
  });

  it('число знаков из справочника побеждает запасной список', () => {
    // Справочник правится из админки и он — источник правды: сказано два знака, печатаем два.
    expect(plain(amountInWordsRu(2_185_224n, 'USDT-TRC20', 2))).toBe('21 852,24 ₮');
  });

  it('РЕГРЕСС: рубль и доллар звучат как прежде', () => {
    expect(amountInWordsRu(10_000_00n, 'RUB')).toBe('десять тысяч рублей 00 копеек');
    expect(amountInWordsRu(1_00n, 'RUB')).toBe('один рубль 00 копеек');
    expect(amountInWordsRu(10_000_00n, 'USD')).toBe('десять тысяч долларов США 00 центов');
  });
});
