import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  currencySymbol,
  displayDecimals,
  formatAmountText,
  formatMoneyText,
  isNegative,
  sumExact,
} from "./money.js";

/**
 * 🔴 Правила перенесены из CoinPay вместе с инцидентами, которыми они оплачены.
 * Каждый тест ниже — это ошибка, которая однажды уехала на боевой экран.
 */
describe("точность не теряется", () => {
  it("восемь знаков доживают до экрана", () => {
    // numeric(20,8) в базе точен; ломает его Number() на чтении. Форматтер работает строкой.
    expect(formatAmountText("0.12345678", "USDT")).toBe("0,12345678");
  });

  it("крупная сумма с дробью не рассыпается", () => {
    // Через float такие числа теряют последние разряды молча, без ошибки.
    expect(formatAmountText("12345678901.87654321", "USDT")).toBe("12 345 678 901,87654321".replace(/ /g, " "));
  });

  it("дробная часть НЕ округляется, а отбрасывается", () => {
    // Округление на витрине тихо меняет сумму, а человек сверяет показанное с базой.
    expect(formatAmountText("1.999", "RUB")).toBe("1,99");
  });
});

describe("неизвестное — прочерк, а не ноль", () => {
  it("null, пусто и мусор дают прочерк", () => {
    // В ledgerReaders стоит `Number(x) || 0` — это превращает «нет данных» в «на счёте пусто».
    for (const bad of [null, undefined, "", "   ", "abc", {}, NaN]) {
      expect(formatAmountText(bad, "RUB")).toBe(NO_VALUE);
    }
  });

  it("ноль остаётся нулём — это ДРУГОЕ", () => {
    expect(formatAmountText("0", "RUB")).toBe("0,00");
    expect(formatAmountText("0.00000000", "USDT")).toBe("0,00000000");
  });
});

describe("валюта не угадывается", () => {
  it("символ берётся из справочника, а не «доллар по умолчанию»", () => {
    // В CoinPay локальный форматтер знал лишь RUB/USD/EUR — евровый счёт читался долларами.
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("TRY")).toBe("₺");
    expect(currencySymbol("USDT-TRC20")).toBe("₮");
  });

  it("незнакомая валюта печатается своим кодом, а не чужим знаком", () => {
    expect(currencySymbol("XYZ")).toBe("XYZ");
    expect(formatMoneyText("10", "XYZ")).toContain("XYZ");
  });

  it("число знаков зависит от валюты, а не константа 2", () => {
    expect(displayDecimals("RUB")).toBe(2);
    expect(displayDecimals("USDT")).toBe(8);
  });
});

describe("знак", () => {
  it("минус показывается типографским, ноль минусом не считается", () => {
    expect(formatAmountText("-5.5", "RUB")).toBe("−5,50");
    expect(isNegative("-0.00")).toBe(false);
    expect(isNegative("-0.01")).toBe(true);
  });
});

describe("сложение без float", () => {
  it("складывает точно там, где float врёт", () => {
    // 0.1 + 0.2 !== 0.3 — в деньгах это недостача, а не курьёз.
    expect(sumExact(["0.1", "0.2"], 2)).toBe("0.30");
  });

  it("неизвестные слагаемые не считаются нулями", () => {
    expect(sumExact(["1.00", null, "2.00"], 2)).toBe("3.00");
    expect(sumExact([null, undefined], 2)).toBeNull();
  });

  it("отрицательные складываются верно", () => {
    expect(sumExact(["10.00", "-3.50"], 2)).toBe("6.50");
    expect(sumExact(["1.00", "-3.50"], 2)).toBe("-2.50");
  });
});
