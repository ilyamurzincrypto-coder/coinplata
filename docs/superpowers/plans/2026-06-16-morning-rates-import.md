# Импорт утреннего документа курсов + автокурсы кеш-кеш — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вставлять курсы из утреннего Telegram-документа («Paramon») текстом, применять USDT-якоря как office-overrides, а кросс-курсы кеш-кеш выводить на лету через USDT-пивот.

**Architecture:** Чистый парсер (`morningRatesParser.js`) превращает текст в `{anchors, special, skipped}`. Хелпер `buildMorningUpdates` маппит города на офисы и резолвит значения. Импорт пишет только USDT-якоря через существующий `rpcUpsertOfficeRate`/`applyOfficeOverrideLocal`. `getRate` получает уровень USDT-пивота (чистый хелпер `pivotRate`). UI — новая вкладка «Текст» в `RatesImportModal`.

**Tech Stack:** React 18, Vite, vitest, Tailwind. Курсы — Context-провайдер `src/store/rates.jsx`. Без бэкенда в demo-режиме; в DB-режиме — Supabase RPC.

**Спека:** `docs/superpowers/specs/2026-06-16-morning-rates-import-design.md`

---

## File Structure

| Файл | Ответственность |
|---|---|
| `src/utils/morningRatesParser.js` | новый — `parseMorningRates`, `resolveRateValue`, `buildMorningUpdates`, `pivotRate`, `CITY_OFFICE_MAP` |
| `src/utils/morningRatesParser.test.js` | новый — vitest для всего выше |
| `src/store/rates.jsx` | USDT-пивот в `getRate`; `specialRates` state + сеттер |
| `src/components/RatesImportModal.jsx` | вкладка «Текст»: textarea → превью → применение |
| `src/pages/RatesPage.jsx` | панель НЕРЕЗ/СБП (special) |
| `src/i18n/translations.jsx` | ключи en/ru/tr |
| `src/pages/info/content.js` | обновить Справку |

---

## Task 1: Парсер — числа, значения, маппинг городов

**Files:**
- Create: `src/utils/morningRatesParser.js`
- Test: `src/utils/morningRatesParser.test.js`

- [ ] **Step 1: Написать падающий тест**

```js
// src/utils/morningRatesParser.test.js
import { describe, it, expect } from "vitest";
import {
  parseNumber,
  resolveRateValue,
  CITY_OFFICE_MAP,
} from "./morningRatesParser.js";

describe("parseNumber", () => {
  it("запятая как десятичный разделитель", () => {
    expect(parseNumber("45,50")).toBe(45.5);
    expect(parseNumber("-0,80")).toBe(-0.8);
    expect(parseNumber("1.171")).toBe(1.171);
  });
  it("мусор → NaN", () => {
    expect(Number.isNaN(parseNumber("abc"))).toBe(true);
  });
});

describe("resolveRateValue", () => {
  it("процент → 1 + v/100", () => {
    expect(resolveRateValue({ value: -1, pct: true }, "crypto", "cash")).toBe(0.99);
    expect(resolveRateValue({ value: 0, pct: true }, "crypto", "cash")).toBe(1);
  });
  it("crypto→cash = абсолют", () => {
    expect(resolveRateValue({ value: 44.9, pct: false }, "crypto", "cash")).toBe(44.9);
  });
  it("cash→crypto = 1/v", () => {
    expect(resolveRateValue({ value: 45.7, pct: false }, "cash", "crypto")).toBeCloseTo(1 / 45.7, 10);
  });
  it("cash→crypto деление на ноль → null", () => {
    expect(resolveRateValue({ value: 0, pct: false }, "cash", "crypto")).toBe(null);
  });
});

describe("CITY_OFFICE_MAP", () => {
  it("ANT → оба офиса Антальи, MSK/SPB пусто", () => {
    expect(CITY_OFFICE_MAP.ANT).toEqual(["mark", "terra"]);
    expect(CITY_OFFICE_MAP.IST).toEqual(["ist"]);
    expect(CITY_OFFICE_MAP.MSK).toEqual([]);
    expect(CITY_OFFICE_MAP.SPB).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить — упадёт (модуль не существует)**

Run: `npm test -- morningRatesParser`
Expected: FAIL — "Failed to resolve import ./morningRatesParser.js"

- [ ] **Step 3: Минимальная реализация**

```js
// src/utils/morningRatesParser.js
// Парсер утреннего документа курсов («Paramon»). Чистый JS, без React/Supabase.
// Порт логики из coinpoint bot/src/util/rates-parser.ts, расширенный СБП/НЕРЕЗ.

export const KNOWN_CITIES = ["ANT", "IST", "MSK", "SPB"];

// city → список officeId. Пустой массив → строки города уходят в skipped.
export const CITY_OFFICE_MAP = {
  ANT: ["mark", "terra"],
  IST: ["ist"],
  MSK: [],
  SPB: [],
};

export function parseNumber(str) {
  if (typeof str !== "string") return NaN;
  return parseFloat(str.replace(",", "."));
}

// fromKind/toKind ∈ {"crypto","cash"} (из типа валюты: crypto | fiat→cash)
export function resolveRateValue({ value, pct }, fromKind, toKind) {
  if (!Number.isFinite(value)) return null;
  if (pct) return 1 + value / 100; // маржа на ~1:1 паре (USDT↔USD)
  const fromCash = fromKind !== "crypto";
  const toCash = toKind !== "crypto";
  if (!fromCash && toCash) return value; // crypto→cash: 1 USDT = N TRY
  if (fromCash && !toCash) return value === 0 ? null : 1 / value; // cash→crypto
  return value; // cash↔cash как есть
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npm test -- morningRatesParser`
Expected: PASS (3 describe-блока)

- [ ] **Step 5: Коммит**

```bash
git add src/utils/morningRatesParser.js src/utils/morningRatesParser.test.js
git commit -m "feat(rates): парсер утреннего документа — числа, resolveRateValue, маппинг городов"
```

---

## Task 2: `parseMorningRates` — якоря + city-заголовки + skipped

**Files:**
- Modify: `src/utils/morningRatesParser.js`
- Test: `src/utils/morningRatesParser.test.js`

- [ ] **Step 1: Добавить падающий тест**

```js
// добавить в morningRatesParser.test.js
import { parseMorningRates } from "./morningRatesParser.js";

const SAMPLE = `[15.06.2026 10:44] Paramon: ANT
USDT -> USD  -0,80%
USD -> USDT  0,00%
USDT -> TRY  45,50
TRY -> USDT  46,5
USDT -> EUR  1,171
EUR -> USDT  1,152

IST
USDT -> USD  -0,60%
USDT -> TRY  45,50`;

describe("parseMorningRates — якоря", () => {
  it("разбирает города и курсы", () => {
    const { anchors } = parseMorningRates(SAMPLE);
    const ant = anchors.filter((a) => a.city === "ANT");
    const ist = anchors.filter((a) => a.city === "IST");
    expect(ant).toHaveLength(6);
    expect(ist).toHaveLength(2);
    expect(ant[0]).toMatchObject({ city: "ANT", from: "USDT", to: "USD", value: -0.8, pct: true });
    expect(ant[2]).toMatchObject({ city: "ANT", from: "USDT", to: "TRY", value: 45.5, pct: false });
  });
  it("inline-city: «ANT USDT -> USD ...»", () => {
    const { anchors } = parseMorningRates("ANT USDT -> TRY 45,5");
    expect(anchors[0]).toMatchObject({ city: "ANT", from: "USDT", to: "TRY", value: 45.5 });
  });
  it("повторный префикс Paramon: срезается", () => {
    const { anchors } = parseMorningRates("[20.05 10:40] Paramon: Paramon:\nANT  USDT -> TRY  44,9");
    expect(anchors[0]).toMatchObject({ city: "ANT", from: "USDT", to: "TRY", value: 44.9 });
  });
  it("строка без города → skipped no-city", () => {
    const { anchors, skipped } = parseMorningRates("USDT -> TRY 45,5");
    expect(anchors).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/no-city/);
  });
  it("мусор → skipped unparseable", () => {
    const { skipped } = parseMorningRates("ANT\nкакая-то ерунда");
    expect(skipped.some((s) => /unparseable/.test(s.reason))).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test -- morningRatesParser`
Expected: FAIL — "parseMorningRates is not a function"

- [ ] **Step 3: Реализовать `parseMorningRates` (пока без special)**

Добавить в `src/utils/morningRatesParser.js`:

```js
// Регэкспы строк
const RATE_RE = /^([A-Za-z]{2,6})\s*(?:->|=>|→)\s*([A-Za-z]{2,6})\s+\(?([+-]?\d+(?:[.,]\d+)?)\s*(%?)\)?$/;
const INLINE_CITY_RE = /^(ANT|IST|MSK|SPB)\s+(.+)$/i;
const STANDALONE_CITY_RE = /^(ANT|IST|MSK|SPB)\s*:?\s*$/i;
const META_RE = /^\[\d{1,2}[.\d]*\s+[\d:]+\]\s*/; // [DD.MM(.YYYY) HH:MM]
const PARAMON_RE = /^(?:Paramon:\s*)+/i;

function stripMetadata(line) {
  let s = line.replace(META_RE, "");
  s = s.replace(PARAMON_RE, "");
  return s.trim();
}

export function parseMorningRates(text) {
  const anchors = [];
  const special = []; // заполнится в Task 3
  const skipped = [];
  let currentCity = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const original = rawLine.trim();
    if (!original) continue;
    if (original.startsWith("//") || original.startsWith("#")) continue;

    let line = stripMetadata(original);
    if (!line) continue;

    const stand = STANDALONE_CITY_RE.exec(line);
    if (stand) {
      currentCity = stand[1].toUpperCase();
      continue;
    }
    const inline = INLINE_CITY_RE.exec(line);
    if (inline) {
      currentCity = inline[1].toUpperCase();
      line = inline[2].trim();
    }

    const m = RATE_RE.exec(line);
    if (!m) {
      skipped.push({ line: original, reason: "unparseable" });
      continue;
    }
    if (!currentCity) {
      skipped.push({ line: original, reason: "no-city (нет city-заголовка перед строкой)" });
      continue;
    }
    const value = parseNumber(m[3]);
    if (!Number.isFinite(value)) {
      skipped.push({ line: original, reason: "invalid number" });
      continue;
    }
    anchors.push({
      city: currentCity,
      from: m[1].toUpperCase(),
      to: m[2].toUpperCase(),
      value,
      pct: m[4] === "%",
      raw: original,
    });
  }

  return { anchors, special, skipped };
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npm test -- morningRatesParser`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/utils/morningRatesParser.js src/utils/morningRatesParser.test.js
git commit -m "feat(rates): parseMorningRates — города, inline-city, якоря, skipped"
```

---

## Task 3: Спец-строки — СБП и блок НЕРЕЗ

**Files:**
- Modify: `src/utils/morningRatesParser.js`
- Test: `src/utils/morningRatesParser.test.js`

- [ ] **Step 1: Добавить падающий тест**

```js
// добавить в morningRatesParser.test.js
const SPECIAL = `RUB QR СБП>> USDT  75,50
USDT - RUB (НЕРЕЗ)

Sell
TOD-TOD  73,28
TOD-TOM  73,23
TOM-TOM  73,33

Buy
TOD-TOD  71,87
TOD-TOM  71,79
TOM-TOM  71,92`;

describe("parseMorningRates — special", () => {
  it("СБП-строка", () => {
    const { special } = parseMorningRates(SPECIAL);
    const sbp = special.filter((s) => s.kind === "sbp");
    expect(sbp).toHaveLength(1);
    expect(sbp[0]).toMatchObject({ kind: "sbp", from: "RUB", to: "USDT", value: 75.5 });
  });
  it("блок НЕРЕЗ: 3 settle × 2 side = 6", () => {
    const { special } = parseMorningRates(SPECIAL);
    const nerez = special.filter((s) => s.kind === "nerez");
    expect(nerez).toHaveLength(6);
    expect(nerez).toContainEqual(
      expect.objectContaining({ kind: "nerez", side: "sell", settle: "TOD-TOD", value: 73.28 })
    );
    expect(nerez).toContainEqual(
      expect.objectContaining({ kind: "nerez", side: "buy", settle: "TOM-TOM", value: 71.92 })
    );
  });
  it("спец-строки не попадают в anchors/skipped как мусор", () => {
    const { anchors, skipped } = parseMorningRates(SPECIAL);
    expect(anchors).toHaveLength(0);
    expect(skipped.some((s) => /СБП|TOD|НЕРЕЗ/.test(s.line))).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test -- morningRatesParser`
Expected: FAIL — special пуст / строки в skipped

- [ ] **Step 3: Реализовать распознавание special в `parseMorningRates`**

Добавить регэкспы рядом с остальными:

```js
const SBP_RE = /^([A-Za-z]{2,6})\s+QR\s+СБП\s*>>\s*([A-Za-z]{2,6})\s+([+-]?\d+(?:[.,]\d+)?)$/i;
const NEREZ_HEADER_RE = /\(\s*НЕРЕЗ\s*\)/i;
const NEREZ_SIDE_RE = /^(Sell|Buy)\s*:?\s*$/i;
const NEREZ_SETTLE_RE = /^(TOD-TOD|TOD-TOM|TOM-TOM)\s+([+-]?\d+(?:[.,]\d+)?)$/i;
```

Внутри цикла `parseMorningRates`, **до** проверки `RATE_RE`, вставить ветки.
Понадобится состояние режима НЕРЕЗ — объявить рядом с `currentCity`:

```js
  let nerezPair = null; // напр. "USDT/RUB" когда активен блок НЕРЕЗ
  let nerezSide = null; // "sell" | "buy"
```

Ветки (после `inline`-city и до `RATE_RE.exec`):

```js
    // СБП: «RUB QR СБП>> USDT 75,50»
    const sbp = SBP_RE.exec(line);
    if (sbp) {
      const v = parseNumber(sbp[3]);
      if (Number.isFinite(v)) {
        special.push({ kind: "sbp", from: sbp[1].toUpperCase(), to: sbp[2].toUpperCase(), value: v, raw: original });
      } else {
        skipped.push({ line: original, reason: "invalid number" });
      }
      continue;
    }
    // Заголовок блока НЕРЕЗ: «USDT - RUB (НЕРЕЗ)»
    if (NEREZ_HEADER_RE.test(line)) {
      const codes = (line.match(/[A-Za-z]{2,6}/g) || []).slice(0, 2);
      nerezPair = codes.length === 2 ? `${codes[0].toUpperCase()}/${codes[1].toUpperCase()}` : "USDT/RUB";
      nerezSide = null;
      continue;
    }
    if (nerezPair) {
      const side = NEREZ_SIDE_RE.exec(line);
      if (side) { nerezSide = side[1].toLowerCase(); continue; }
      const st = NEREZ_SETTLE_RE.exec(line);
      if (st) {
        const v = parseNumber(st[2]);
        if (Number.isFinite(v) && nerezSide) {
          special.push({ kind: "nerez", pair: nerezPair, side: nerezSide, settle: st[1].toUpperCase(), value: v, raw: original });
        } else {
          skipped.push({ line: original, reason: "nerez: нет side/число" });
        }
        continue;
      }
      // строка не относится к НЕРЕЗ — выходим из режима и обрабатываем обычно
      nerezPair = null;
      nerezSide = null;
    }
```

> Примечание: city-заголовок (`STANDALONE_CITY_RE`) уже стоит выше этих веток и
> сбросит `nerezPair` неявно? Нет — добавь сброс: в ветке `stand` перед `continue`
> поставь `nerezPair = null; nerezSide = null;`. Аналогично новый city не должен
> «прилипать» к НЕРЕЗ.

- [ ] **Step 4: Запустить — пройдёт**

Run: `npm test -- morningRatesParser`
Expected: PASS (включая прежние Task 1–2)

- [ ] **Step 5: Коммит**

```bash
git add src/utils/morningRatesParser.js src/utils/morningRatesParser.test.js
git commit -m "feat(rates): парсинг спец-строк СБП и блока НЕРЕЗ (Sell/Buy TOD/TOM)"
```

---

## Task 4: `buildMorningUpdates` — маппинг city→office + resolve

**Files:**
- Modify: `src/utils/morningRatesParser.js`
- Test: `src/utils/morningRatesParser.test.js`

- [ ] **Step 1: Добавить падающий тест**

```js
// добавить в morningRatesParser.test.js
import { buildMorningUpdates } from "./morningRatesParser.js";

const KIND = (code) => (code === "USDT" ? "crypto" : "cash");

describe("buildMorningUpdates", () => {
  it("ANT-якорь → две записи (mark, terra), MSK → skipped", () => {
    const parsed = parseMorningRates(`ANT
USDT -> TRY  45,50
MSK
USDT -> RUB  75,75`);
    const { updates, skipped } = buildMorningUpdates(parsed, KIND);
    const tryUpd = updates.filter((u) => u.to === "TRY");
    expect(tryUpd.map((u) => u.officeId).sort()).toEqual(["mark", "terra"]);
    expect(tryUpd[0]).toMatchObject({ from: "USDT", to: "TRY", rate: 45.5 });
    expect(skipped.some((s) => /MSK/.test(s.reason))).toBe(true);
  });
  it("пишем только якоря с USDT-стороной", () => {
    const parsed = parseMorningRates(`ANT
USD -> EUR  1,1`); // кросс без USDT — не якорь
    const { updates } = buildMorningUpdates(parsed, KIND);
    expect(updates).toHaveLength(0);
  });
  it("процент USDT->USD резолвится в rate", () => {
    const parsed = parseMorningRates(`ANT
USDT -> USD  -0,80%`);
    const { updates } = buildMorningUpdates(parsed, KIND);
    expect(updates[0].rate).toBeCloseTo(0.992, 6);
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test -- morningRatesParser`
Expected: FAIL — "buildMorningUpdates is not a function"

- [ ] **Step 3: Реализовать**

```js
// src/utils/morningRatesParser.js — добавить в конец
// kindOf(code) -> "crypto" | "cash"
export function buildMorningUpdates(parsed, kindOf) {
  const updates = [];
  const skipped = [...(parsed.skipped || [])];
  for (const a of parsed.anchors) {
    // только якоря: одна сторона USDT
    if (a.from !== "USDT" && a.to !== "USDT") continue;
    const offices = CITY_OFFICE_MAP[a.city] || [];
    if (offices.length === 0) {
      skipped.push({ line: a.raw, reason: `нет офиса для ${a.city}` });
      continue;
    }
    const rate = resolveRateValue(a, kindOf(a.from), kindOf(a.to));
    if (rate == null || !Number.isFinite(rate) || rate <= 0) {
      skipped.push({ line: a.raw, reason: "invalid rate" });
      continue;
    }
    for (const officeId of offices) {
      updates.push({ officeId, from: a.from, to: a.to, rate, city: a.city, raw: a.raw });
    }
  }
  return { updates, skipped };
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npm test -- morningRatesParser`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/utils/morningRatesParser.js src/utils/morningRatesParser.test.js
git commit -m "feat(rates): buildMorningUpdates — city→office, только USDT-якоря"
```

---

## Task 5: `pivotRate` — чистый хелпер USDT-пивота

**Files:**
- Modify: `src/utils/morningRatesParser.js`
- Test: `src/utils/morningRatesParser.test.js`

- [ ] **Step 1: Добавить падающий тест**

```js
// добавить в morningRatesParser.test.js
import { pivotRate } from "./morningRatesParser.js";

describe("pivotRate", () => {
  const direct = { USD_USDT: 1, USDT_TRY: 45.5, USDT_USD: 0.992 };
  const lookup = (a, b) => direct[`${a}_${b}`];
  it("USD→TRY через USDT", () => {
    // USD→USDT(1) × USDT→TRY(45.5)
    expect(pivotRate("USD", "TRY", lookup)).toBeCloseTo(45.5, 6);
  });
  it("одна сторона USDT → undefined (пивот не нужен)", () => {
    expect(pivotRate("USDT", "TRY", lookup)).toBeUndefined();
  });
  it("нет ноги → undefined", () => {
    expect(pivotRate("EUR", "TRY", lookup)).toBeUndefined();
  });
  it("from===to → 1", () => {
    expect(pivotRate("USD", "USD", lookup)).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test -- morningRatesParser`
Expected: FAIL — "pivotRate is not a function"

- [ ] **Step 3: Реализовать**

```js
// src/utils/morningRatesParser.js — добавить в конец
// lookup(a,b) -> number|undefined: ТОЛЬКО прямой курс (без пивота).
// Возвращает производный кросс через USDT или undefined.
export function pivotRate(from, to, lookup) {
  if (from === to) return 1;
  if (from === "USDT" || to === "USDT") return undefined;
  const leg1 = lookup(from, "USDT");
  const leg2 = lookup("USDT", to);
  if (Number.isFinite(leg1) && Number.isFinite(leg2)) return leg1 * leg2;
  return undefined;
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npm test -- morningRatesParser`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add src/utils/morningRatesParser.js src/utils/morningRatesParser.test.js
git commit -m "feat(rates): pivotRate — чистый USDT-пивот для кросс-курсов"
```

---

## Task 6: Встроить USDT-пивот в `getRate`

**Files:**
- Modify: `src/store/rates.jsx:293-306` (функция `getRate`)

- [ ] **Step 1: Импортировать `pivotRate`**

В шапке `src/store/rates.jsx` (рядом с прочими импортами) добавить:

```js
import { pivotRate } from "../utils/morningRatesParser.js";
```

- [ ] **Step 2: Заменить тело `getRate`**

Найти текущую функцию (строки ~293–306) и заменить на:

```js
  // getRate: office override → office USDT-пивот → global → global USDT-пивот.
  const getRate = useCallback(
    (from, to, officeId) => {
      if (from === to) return 1;
      const officeMap =
        officeId && officeOverrides instanceof Map ? officeOverrides.get(officeId) : null;

      // 1. Прямой office-override
      if (officeMap) {
        const ovr = officeMap.get(rateKey(from, to));
        if (ovr && Number.isFinite(ovr.rate)) return ovr.rate;
      }
      // 2. Office USDT-пивот (только офисные якоря-ноги)
      if (officeMap) {
        const officeLeg = (a, b) => {
          const o = officeMap.get(rateKey(a, b));
          return o && Number.isFinite(o.rate) ? o.rate : undefined;
        };
        const p = pivotRate(from, to, officeLeg);
        if (Number.isFinite(p)) return p;
      }
      // 3. Global default
      const direct = rates[rateKey(from, to)];
      if (Number.isFinite(direct)) return direct;
      // 4. Global USDT-пивот
      const globalLeg = (a, b) => rates[rateKey(a, b)];
      const gp = pivotRate(from, to, globalLeg);
      if (Number.isFinite(gp)) return gp;

      return undefined;
    },
    [rates, officeOverrides]
  );
```

- [ ] **Step 3: Сборка + ручная проверка**

Run: `npm run build`
Expected: build OK (нет ошибок импорта/синтаксиса).

Ручная проверка в `npm run dev`: на странице Курсов выбрать офис `mark`, выставить
office-override `USDT→TRY` и `USDT→USD`, убедиться что `USD→TRY` показывается как
произведение (если в UI есть такая пара) и меняется при правке якоря.

- [ ] **Step 4: Прогнать весь тест-сьют**

Run: `npm test`
Expected: PASS (существующие тесты не сломаны).

- [ ] **Step 5: Коммит**

```bash
git add src/store/rates.jsx
git commit -m "feat(rates): USDT-пивот в getRate — автокурсы кеш-кеш на лету"
```

---

## Task 7: `specialRates` state в RatesProvider

**Files:**
- Modify: `src/store/rates.jsx` (state + сеттер + экспорт в value)

- [ ] **Step 1: Добавить state**

Рядом с `const [officeOverrides, setOfficeOverrides] = useState(new Map());`:

```js
  // НЕРЕЗ/СБП-снимок последнего импорта (информационно, не в движке сделок).
  const [specialRates, setSpecialRates] = useState([]); // [{kind,...,importedAt}]
```

- [ ] **Step 2: Сеттер**

Рядом с другими `useCallback`:

```js
  const setSpecialRatesSnapshot = useCallback((entries) => {
    setSpecialRates(Array.isArray(entries) ? entries : []);
  }, []);
```

- [ ] **Step 3: Экспортировать в context value**

В объекте, который идёт в `useMemo`-value (там, где `getRate, ... officeOverrides`),
добавить `specialRates,` и `setSpecialRatesSnapshot,`. И добавить их в массив
зависимостей `useMemo` (там же, где перечислены `getRate`, `officeOverrides`).

- [ ] **Step 4: Сборка**

Run: `npm run build`
Expected: OK.

- [ ] **Step 5: Коммит**

```bash
git add src/store/rates.jsx
git commit -m "feat(rates): specialRates state для снимка НЕРЕЗ/СБП"
```

---

## Task 8: i18n-ключи для импорта-текста и special

**Files:**
- Modify: `src/i18n/translations.jsx`

- [ ] **Step 1: Добавить ключи в en/ru/tr**

Найти объект `DICT` и в каждую из секций `en`, `ru`, `tr` добавить (значения —
по языку; ниже ru, для en/tr перевести так же по смыслу):

```js
    rimport_tab_file: "Файл XLSX",
    rimport_tab_text: "Текст",
    rimport_text_hint: "Вставьте утренний документ с курсами (Paramon)",
    rimport_text_placeholder: "ANT\nUSDT -> TRY  45,50\n...",
    rimport_text_parse: "Разобрать",
    rimport_anchors_title: "Якоря к применению",
    rimport_derived_title: "Производные кросс-курсы (авто)",
    rimport_special_title: "Спец-курсы (СБП / НЕРЕЗ)",
    rimport_skipped_title: "Пропущено",
    special_sbp: "СБП",
    special_nerez: "НЕРЕЗ",
};
```

(en: "XLSX file" / "Text" / "Paste the morning rates document (Paramon)" / "Parse" /
"Anchors to apply" / "Derived cross-rates (auto)" / "Special rates (SBP / non-res)" /
"Skipped" / "SBP" / "Non-res". tr: "XLSX dosyası" / "Metin" / "Sabah kur belgesini
yapıştırın (Paramon)" / "Ayrıştır" / "Uygulanacak çapalar" / "Türetilen çapraz kurlar
(oto)" / "Özel kurlar (SBP / yerleşik değil)" / "Atlandı" / "SBP" / "Yerleşik değil".)

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: OK.

- [ ] **Step 3: Коммит**

```bash
git add src/i18n/translations.jsx
git commit -m "i18n(rates): ключи импорта текста и спец-курсов (en/ru/tr)"
```

---

## Task 9: UI — вкладка «Текст» в RatesImportModal

**Files:**
- Modify: `src/components/RatesImportModal.jsx`

- [ ] **Step 1: Импорты и хуки**

В шапке файла добавить:

```js
import { parseMorningRates, buildMorningUpdates } from "../utils/morningRatesParser.js";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
```

> Проверь точные пути/имена хуков (`useCurrencies`) — поправь под существующие
> экспорты, если отличаются. `rpcUpsertOfficeRate` импортируй из `../lib/supabaseWrite`.

Внутри компонента, рядом с прочими `useState`:

```js
  const { applyOfficeOverrideLocal, setSpecialRatesSnapshot, addChannel, addPair, channels } = useRates();
  const { dict: currencyDict } = useCurrencies();
  const [source, setSource] = useState("file"); // "file" | "text"
  const [bulkText, setBulkText] = useState("");
  const [textParsed, setTextParsed] = useState(null); // { updates, skipped, special, anchors }

  const kindOf = (code) => (currencyDict?.[code]?.type === "crypto" ? "crypto" : "cash");
```

- [ ] **Step 2: Парсинг текста**

Добавить обработчик рядом с `handleFileSelected`:

```js
  const handleParseText = () => {
    const parsed = parseMorningRates(bulkText);
    const { updates, skipped } = buildMorningUpdates(parsed, kindOf);
    setTextParsed({ updates, skipped, special: parsed.special, anchors: parsed.anchors });
    setStep(2);
  };
```

- [ ] **Step 3: Применение текста**

Добавить обработчик рядом с `handleApply`:

```js
  const handleApplyText = async () => {
    if (!textParsed || submitting) return;
    setSubmitting(true);
    try {
      // Якоря → office-overrides (demo: локально; DB: RPC при наличии)
      for (const u of textParsed.updates) {
        if (isSupabaseConfigured) {
          await rpcUpsertOfficeRate({ officeId: u.officeId, from: u.from, to: u.to, rate: u.rate });
        }
        applyOfficeOverrideLocal(u.officeId, u.from, u.to, { rate: u.rate });
      }
      // СБП → реальная альтернативная пара RUB(ch_rub_sbp)→USDT (работает в сделках).
      const specials = textParsed.special || [];
      for (const s of specials.filter((x) => x.kind === "sbp")) {
        await ensureSbpPair(s); // см. ниже
      }
      // НЕРЕЗ → снимок (информационно)
      const nerez = specials
        .filter((x) => x.kind === "nerez")
        .map((s) => ({ ...s, importedAt: new Date().toISOString() }));
      setSpecialRatesSnapshot(nerez);
      logAudit({
        action: "update",
        entity: "rates",
        entityId: "bulk",
        summary: `morning-import: ${textParsed.updates.length} якорей, ${specials.length} спец, ${textParsed.skipped.length} пропущено`,
      });
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  // Создать (один раз) канал ch_rub_sbp и альтернативную пару RUB(СБП)→USDT.
  // Альтернативная (не default) пара — не затирает дефолтный RUB→USDT, но видна
  // в pairs/allTradePairs и выбираема в сделке по каналу СБП.
  const ensureSbpPair = async (s) => {
    const SBP_CH = "ch_rub_sbp";
    const exists = (channels || []).some((c) => c.id === SBP_CH);
    if (!exists) {
      addChannel({ id: SBP_CH, currencyCode: "RUB", kind: "sbp", isDefaultForCurrency: false });
    }
    // USDT-канал по умолчанию — ch_usdt_trc20 (см. SEED_CHANNELS).
    // Направление/инверсию rate сверить с конвенцией существующей дефолтной пары
    // RUB→USDT (как там хранится rate: USDT за RUB или наоборот) и привести s.value
    // к той же конвенции перед передачей.
    await addPair({ fromChannelId: SBP_CH, toChannelId: "ch_usdt_trc20", rate: s.value, priority: 60 });
  };
```

> Сверь сигнатуру `applyOfficeOverrideLocal(officeId, from, to, value)` —
> `value` это объект `{ rate }` (см. `rates.jsx:323`); если там ожидается число,
> передай `u.rate` напрямую. `addChannel`/`addPair` — см. `rates.jsx:474,605`;
> `addPair` async, в demo пишет local state, в DB зовёт `rpcCreatePair`.

- [ ] **Step 4: Переключатель источника (Step 1 модалки)**

В рендере, в начале `step === 1` блока, добавить две кнопки-таба и условный рендер
textarea. Над существующим XLSX-блоком:

```jsx
      {step === 1 && (
        <div className="flex gap-2 mb-3">
          <button
            className={`px-3 py-1.5 rounded-lg text-sm ${source === "file" ? "bg-ink text-white" : "bg-surface-sunk"}`}
            onClick={() => setSource("file")}
          >{t("rimport_tab_file")}</button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm ${source === "text" ? "bg-ink text-white" : "bg-surface-sunk"}`}
            onClick={() => setSource("text")}
          >{t("rimport_tab_text")}</button>
        </div>
      )}
```

Существующий XLSX-контент step 1 обернуть в `{step === 1 && source === "file" && (...)}`,
и добавить рядом текстовый вариант:

```jsx
      {step === 1 && source === "text" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">{t("rimport_text_hint")}</p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={14}
            placeholder={t("rimport_text_placeholder")}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono"
          />
          <button
            disabled={!bulkText.trim()}
            onClick={handleParseText}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm disabled:opacity-50"
          >{t("rimport_text_parse")}</button>
        </div>
      )}
```

- [ ] **Step 5: Превью текста (Step 2) и кнопка применения (Step 3)**

Для `source === "text"` отрендерить превью вместо XLSX-диффа. В блоке `step === 2`
добавить ветку `source === "text" && textParsed`:

```jsx
      {step === 2 && source === "text" && textParsed && (
        <div className="space-y-4 text-sm">
          <section>
            <h4 className="font-semibold mb-1">{t("rimport_anchors_title")} ({textParsed.updates.length})</h4>
            <ul className="space-y-0.5 text-xs">
              {textParsed.updates.map((u, i) => (
                <li key={i}>{u.officeId} · {u.from}→{u.to}: {u.rate.toFixed(6)}</li>
              ))}
            </ul>
          </section>
          {textParsed.special?.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1">{t("rimport_special_title")} ({textParsed.special.length})</h4>
              <ul className="space-y-0.5 text-xs">
                {textParsed.special.map((s, i) => (
                  <li key={i}>{s.kind === "sbp" ? `СБП ${s.from}→${s.to}: ${s.value}` : `НЕРЕЗ ${s.side} ${s.settle}: ${s.value}`}</li>
                ))}
              </ul>
            </section>
          )}
          {textParsed.skipped?.length > 0 && (
            <section>
              <h4 className="font-semibold mb-1 text-status-error">{t("rimport_skipped_title")} ({textParsed.skipped.length})</h4>
              <ul className="space-y-0.5 text-xs text-ink-soft">
                {textParsed.skipped.map((s, i) => (<li key={i}>«{s.line}» — {s.reason}</li>))}
              </ul>
            </section>
          )}
          <button
            disabled={submitting || textParsed.updates.length === 0}
            onClick={handleApplyText}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm disabled:opacity-50"
          >{submitting ? "…" : t("rimport_text_parse")}</button>
        </div>
      )}
```

> Стиль-классы (`bg-ink`, `text-status-error`, `border-line`) — сверь с теми, что
> уже используются в этом файле/проекте; подставь существующие, если имена иные.

- [ ] **Step 6: Сборка + ручная проверка**

Run: `npm run build`
Expected: OK.

Ручная проверка `npm run dev`: открыть модалку импорта на странице Курсов →
вкладка «Текст» → вставить полный пример из спеки → «Разобрать» → проверить превью
(ANT даёт записи на mark+terra, MSK/SPB в skipped, СБП+6 НЕРЕЗ в special) →
«Применить» → курсы офиса обновились, в audit-логе запись `morning-import`.

- [ ] **Step 7: Коммит**

```bash
git add src/components/RatesImportModal.jsx
git commit -m "feat(rates): вкладка «Текст» в импорте — вставка утреннего документа"
```

---

## Task 10: Панель НЕРЕЗ/СБП на странице Курсов

**Files:**
- Modify: `src/pages/RatesPage.jsx`

- [ ] **Step 1: Прочитать `specialRates` из стора**

В компоненте `RatesPage` получить из `useRates()` поле `specialRates` (добавить к
существующей деструктуризации).

- [ ] **Step 2: Отрендерить панель**

Под основной таблицей курсов (в JSX, в подходящем месте `list`-вью) добавить:

```jsx
      {specialRates && specialRates.length > 0 && (
        <div className="mt-6 rounded-xl border border-line p-4">
          <h3 className="font-semibold mb-2">{t("rimport_special_title")}</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {specialRates.map((s, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-ink-soft">
                  {s.kind === "sbp" ? `СБП · ${s.from}→${s.to}` : `НЕРЕЗ · ${s.side} · ${s.settle}`}
                </span>
                <span className="font-mono">{s.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">Информационно. В сделках пока не участвует.</p>
        </div>
      )}
```

> Сверь `t`, `useRates`, классы и точку вставки с реальной структурой `RatesPage.jsx`.

- [ ] **Step 3: Сборка + ручная проверка**

Run: `npm run build`
Expected: OK. После импорта документа панель показывает СБП + 6 строк НЕРЕЗ.

- [ ] **Step 4: Коммит**

```bash
git add src/pages/RatesPage.jsx
git commit -m "feat(rates): панель спец-курсов НЕРЕЗ/СБП на странице Курсов"
```

---

## Task 11: Обновить Справку (Info)

**Files:**
- Modify: `src/pages/info/content.js`

- [ ] **Step 1: Добавить раздел про импорт текста**

Найти раздел о курсах в `content.js` и добавить пункт (по образцу существующих
записей в файле): как открыть импорт → вкладка «Текст» → вставить утренний документ
→ ANT применяется к обоим офисам Антальи, MSK/SPB пропускаются, кросс-курсы
кеш-кеш считаются автоматически через USDT, СБП/НЕРЕЗ показываются информационно.

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: OK.

- [ ] **Step 3: Коммит**

```bash
git add src/pages/info/content.js
git commit -m "docs(info): импорт утреннего документа курсов в Справке"
```

---

## Финал

- [ ] Прогнать полностью: `npm test && npm run build` — всё зелёное.
- [ ] Push (по рабочему правилу проекта — после серии коммитов одним пушем, чтобы
  не жечь лимит деплоев Vercel): `git push`.
