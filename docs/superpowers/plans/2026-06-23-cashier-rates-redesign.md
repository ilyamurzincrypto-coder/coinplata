# Переделка блока «Курсы» (Кассир) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить «портянку» курсов на главной Кассира на привычную менеджерам табличку: секция «Мастер» (USDT кеш-кеш, их 6 строк, % для USD / абсолют TRY/EUR, правка inline+паст) и секция «Авто» (производные кросс-курсы кеш-кеш, read-only).

**Architecture:** Чистые утилиты (`ratesFormat`, `ratesPasteParser`) под TDD; три новых презентационных компонента (`MasterRatesPanel`, `AutoRatesPanel`, `PasteRatesModal`); `RatesSidebar` становится оркестратором двух секций. Запись курсов — через существующий `setRate` из `useRates()`, без новой схемы. Автокурсы вычисляются на лету через `convert(1, from, to, getRate)`.

**Tech Stack:** React 18, Tailwind 3, Vite, Vitest. Стор `src/store/rates.jsx`. Утилита `src/utils/convert.js`.

---

## File Structure

- Create `src/utils/ratesFormat.js` — конвертация %↔rate, признак percent-валют, форматирование значения строки.
- Create `src/utils/ratesFormat.test.js` — unit.
- Create `src/utils/ratesPasteParser.js` — парс блока пасты их формата → updates.
- Create `src/utils/ratesPasteParser.test.js` — unit.
- Create `src/components/rates/MasterRatesPanel.jsx` — 6 направленных строк, % / абсолют, inline-правка.
- Create `src/components/rates/AutoRatesPanel.jsx` — read-only кросс-курсы.
- Create `src/components/rates/PasteRatesModal.jsx` — textarea + diff-превью + Применить.
- Modify `src/components/RatesSidebar.jsx` — собрать две секции + кнопку «Вставить курсы», офис-табы оставить.

---

## Task 1: ratesFormat — конвертация %↔rate и формат строки

**Files:**
- Create: `src/utils/ratesFormat.js`
- Test: `src/utils/ratesFormat.test.js`

- [ ] **Step 1: Написать падающий тест**

```js
// src/utils/ratesFormat.test.js
import { describe, it, expect } from "vitest";
import { isPercentPair, rateToPercent, percentToRate, formatRateValue } from "./ratesFormat.js";

describe("ratesFormat", () => {
  it("isPercentPair: USDT↔USD = percent, USDT↔TRY = absolute", () => {
    expect(isPercentPair("USDT", "USD")).toBe(true);
    expect(isPercentPair("USD", "USDT")).toBe(true);
    expect(isPercentPair("USDT", "TRY")).toBe(false);
    expect(isPercentPair("EUR", "USDT")).toBe(false);
  });

  it("rateToPercent / percentToRate round-trip", () => {
    expect(rateToPercent(0.99)).toBeCloseTo(-1, 9);
    expect(rateToPercent(1.002)).toBeCloseTo(0.2, 9);
    expect(percentToRate(-1)).toBeCloseTo(0.99, 9);
    expect(percentToRate(0.2)).toBeCloseTo(1.002, 9);
  });

  it("formatRateValue: percent pair → '−1,00 %', absolute → '45,10'", () => {
    expect(formatRateValue("USDT", "USD", 0.99)).toBe("−1,00 %");
    expect(formatRateValue("USD", "USDT", 1.002)).toBe("+0,20 %");
    expect(formatRateValue("USDT", "TRY", 45.1)).toBe("45,10");
    expect(formatRateValue("USDT", "EUR", 1.177)).toBe("1,177");
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npx vitest run src/utils/ratesFormat.test.js`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать**

```js
// src/utils/ratesFormat.js
// Конвертация курса ↔ процент для «парных» валют (USDT↔USD) и форматирование
// значения строки таблицы. Процент — ТОЛЬКО формат отображения/ввода; в сторе
// курс всегда абсолютный rate (для percent-пар rate = 1 + %/100).

// Валюты, которые против USDT показываем в процентах (около паритета).
export const PERCENT_CCYS = ["USD"];

export function isPercentPair(from, to) {
  const a = String(from).toUpperCase();
  const b = String(to).toUpperCase();
  const pair = new Set([a, b]);
  return pair.has("USDT") && PERCENT_CCYS.some((c) => pair.has(c));
}

export function rateToPercent(rate) {
  return (Number(rate) - 1) * 100;
}

export function percentToRate(pct) {
  return 1 + Number(pct) / 100;
}

// Десятичная запятая + минус-тире (−), как в их листе.
function ru(n, digits) {
  const fixed = Number(n).toFixed(digits);
  return fixed.replace("-", "−").replace(".", ",");
}

// Сколько знаков у абсолютного курса: ≥10 → 2, иначе 3.
function absDigits(rate) {
  return Math.abs(Number(rate)) >= 10 ? 2 : 3;
}

export function formatRateValue(from, to, rate) {
  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) return "—";
  if (isPercentPair(from, to)) {
    const pct = rateToPercent(rate);
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${ru(pct, 2)} %`.replace("+−", "−");
  }
  return ru(rate, absDigits(rate));
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npx vitest run src/utils/ratesFormat.test.js`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/utils/ratesFormat.js src/utils/ratesFormat.test.js
git commit -m "feat(rates): ratesFormat — %↔rate + формат значения строки"
```

---

## Task 2: ratesPasteParser — парс блока пасты

**Files:**
- Create: `src/utils/ratesPasteParser.js`
- Test: `src/utils/ratesPasteParser.test.js`

- [ ] **Step 1: Написать падающий тест**

```js
// src/utils/ratesPasteParser.test.js
import { describe, it, expect } from "vitest";
import { parseRatesPaste } from "./ratesPasteParser.js";

const KNOWN = new Set(["USDT", "USD", "TRY", "EUR", "RUB"]);
// currentRate(from,to): текущий rate для расчёта статуса.
const cur = (from, to) => {
  const m = { "USDT>TRY": 45.0, "USD>USDT": 1.002 };
  return m[`${from}>${to}`];
};

describe("parseRatesPaste", () => {
  it("парсит стрелки, запятую, % и абсолют", () => {
    const txt = [
      "USDT -> USD  -1,00%",
      "USD -> USDT  0,20%",
      "USDT → TRY 45,10",
      "TRY > USDT 46",
      "мусор без стрелки",
    ].join("\n");
    const rows = parseRatesPaste(txt, { known: KNOWN, currentRate: cur });

    expect(rows).toHaveLength(5);
    // USDT->USD percent → rate 0.99
    expect(rows[0]).toMatchObject({ from: "USDT", to: "USD", rate: 0.99, isPercent: true, status: "new" });
    // USD->USDT 0.20% → 1.002, текущий 1.002 → unchanged
    expect(rows[1]).toMatchObject({ from: "USD", to: "USDT", rate: 1.002, status: "unchanged" });
    // USDT->TRY 45.10, текущий 45.0 → updated
    expect(rows[2]).toMatchObject({ from: "USDT", to: "TRY", rate: 45.1, isPercent: false, status: "updated" });
    expect(rows[3]).toMatchObject({ from: "TRY", to: "USDT", rate: 46, status: "new" });
    expect(rows[4]).toMatchObject({ status: "error" });
  });

  it("неизвестная валюта → error", () => {
    const rows = parseRatesPaste("USDT -> XXX 1", { known: KNOWN, currentRate: cur });
    expect(rows[0].status).toBe("error");
  });
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npx vitest run src/utils/ratesPasteParser.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

```js
// src/utils/ratesPasteParser.js
// Парс блока пасты в формате менеджерской таблицы:
//   USDT -> USD  -1,00%
//   USDT → TRY 45,10
// Возвращает строки с rate (для percent-пар rate = 1 + %/100) и статусом
// относительно текущего курса. Не пишет в стор — только готовит превью.

import { isPercentPair, percentToRate } from "./ratesFormat.js";

const LINE_RE =
  /^\s*([A-Za-z]{2,6})\s*(?:->|→|>)\s*([A-Za-z]{2,6})\s*([-+]?\d[\d\s.,]*)\s*(%?)\s*$/;

function toNumber(raw) {
  const s = String(raw).replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function parseRatesPaste(text, { known, currentRate } = {}) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.map((line) => {
    const m = LINE_RE.exec(line);
    if (!m) return { raw: line, status: "error", error: "формат строки" };
    const from = m[1].toUpperCase();
    const to = m[2].toUpperCase();
    const value = toNumber(m[3]);
    const hasPct = m[4] === "%";
    if (known && (!known.has(from) || !known.has(to))) {
      return { raw: line, from, to, status: "error", error: "валюта неизвестна" };
    }
    if (!Number.isFinite(value)) {
      return { raw: line, from, to, status: "error", error: "число" };
    }
    const isPercent = hasPct || isPercentPair(from, to);
    const rate = isPercent ? percentToRate(value) : value;
    let status = "new";
    if (currentRate) {
      const prev = currentRate(from, to);
      if (Number.isFinite(prev)) {
        status = Math.abs(prev - rate) < 1e-9 ? "unchanged" : "updated";
      }
    }
    return { raw: line, from, to, rate, isPercent, status, prev: currentRate?.(from, to) };
  });
}
```

- [ ] **Step 4: Запустить — пройдёт**

Run: `npx vitest run src/utils/ratesPasteParser.test.js`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/utils/ratesPasteParser.js src/utils/ratesPasteParser.test.js
git commit -m "feat(rates): ratesPasteParser — парс блока пасты в updates+diff"
```

---

## Task 3: MasterRatesPanel — секция «Мастер» (6 строк, inline)

**Files:**
- Create: `src/components/rates/MasterRatesPanel.jsx`

**Контракт props:**
- `getRate(from, to)` — эффективный курс для выбранного офиса (из родителя).
- `onCommit(from, to, rate)` — записать абсолютный rate (родитель → `setRate`/rpc).
- `pairUpdatedAt(from, to)` — Date|null (есть в RatesSidebar).
- `hasOverride(from, to)` — bool (есть в RatesSidebar).

- [ ] **Step 1: Реализовать компонент**

```jsx
// src/components/rates/MasterRatesPanel.jsx
// Секция «Мастер» — USDT кеш-кеш, 6 направленных строк (их лист).
// USDT↔USD → проценты, TRY/EUR → абсолют. Клик по значению — inline-правка
// в том же формате; commit → onCommit(from,to,absoluteRate).

import React, { useState, useRef, useEffect } from "react";
import { isPercentPair, percentToRate, formatRateValue } from "../../utils/ratesFormat.js";

export const MASTER_ROWS = [
  ["USDT", "USD"],
  ["USD", "USDT"],
  ["USDT", "TRY"],
  ["TRY", "USDT"],
  ["USDT", "EUR"],
  ["EUR", "USDT"],
];

function ValueCell({ from, to, rate, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef(null);
  const pct = isPercentPair(from, to);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);

  const start = () => {
    // в режиме редактирования показываем «сырое» значение (% или абсолют)
    const shown = pct ? ((Number(rate) - 1) * 100).toFixed(2) : String(rate ?? "");
    setDraft(shown.replace(".", ","));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const raw = String(draft).trim().replace("−", "-").replace(",", ".").replace("%", "");
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next = pct ? percentToRate(n) : n;
    if (Math.abs(next - Number(rate)) < 1e-9) return;
    onCommit?.(from, to, next);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,\-−]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        }}
        className="w-[92px] bg-white border border-accent rounded-[6px] px-1.5 py-0.5 text-right text-body-sm font-mono tabular-nums outline-none"
      />
    );
  }
  const neg = pct && Number(rate) < 1;
  return (
    <button
      type="button"
      onClick={start}
      title="Клик — изменить"
      className={`w-[92px] text-right font-mono tabular-nums text-body-sm font-semibold cursor-text rounded-[4px] hover:bg-amber-50 px-1 ${
        pct ? (neg ? "text-danger" : "text-success") : "text-ink"
      }`}
    >
      {formatRateValue(from, to, rate)}
    </button>
  );
}

export default function MasterRatesPanel({ getRate, onCommit, pairUpdatedAt, hasOverride }) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">Мастер · USDT кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>
      <div className="space-y-0.5">
        {MASTER_ROWS.map(([from, to]) => {
          const rate = Number(getRate?.(from, to));
          const ovr = hasOverride?.(from, to);
          return (
            <div key={`${from}_${to}`} className="grid items-center gap-2 px-1.5 py-1 rounded-[6px] hover:bg-surface-soft"
                 style={{ gridTemplateColumns: "minmax(96px,1fr) 92px" }}>
              <span className="font-mono font-bold text-body-sm text-ink whitespace-nowrap">
                {from}<span className="text-muted-soft mx-0.5">→</span>{to}
                {ovr && <span className="ml-1 text-micro font-bold text-accent">OFC</span>}
              </span>
              <ValueCell from={from} to={to} rate={rate} onCommit={onCommit} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Сборка не падает**

Run: `npm run build`
Expected: успешная сборка (компонент пока не подключён — проверяем синтаксис).

- [ ] **Step 3: Коммит**

```bash
git add src/components/rates/MasterRatesPanel.jsx
git commit -m "feat(rates): MasterRatesPanel — 6 строк мастер-курсов, inline %/абсолют"
```

---

## Task 4: AutoRatesPanel — секция «Авто» (read-only кросс)

**Files:**
- Create: `src/components/rates/AutoRatesPanel.jsx`

**Контракт props:** `getRate(from, to)` (эффективный курс для офиса).

- [ ] **Step 1: Реализовать**

```jsx
// src/components/rates/AutoRatesPanel.jsx
// Секция «Авто» — производные кросс-курсы кеш-кеш между USD/EUR/TRY/RUB,
// выведенные из мастера через USDT-пивот (convert). Read-only.

import React from "react";
import { convert } from "../../utils/convert.js";
import { formatRateValue } from "../../utils/ratesFormat.js";

export const AUTO_CCYS = ["USD", "EUR", "TRY", "RUB"];

function autoPairs() {
  const out = [];
  for (const a of AUTO_CCYS) for (const b of AUTO_CCYS) if (a !== b) out.push([a, b]);
  return out;
}

export default function AutoRatesPanel({ getRate }) {
  const pairs = autoPairs();
  return (
    <div className="px-1 pt-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="text-micro font-bold uppercase tracking-wider text-muted-soft">Авто · кеш-кеш</span>
        <span className="flex-1 h-px bg-border-soft" />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {pairs.map(([a, b]) => {
          const rate = convert(1, a, b, getRate); // кросс-курс через USDT/USD
          return (
            <div key={`${a}_${b}`} className="flex items-center justify-between px-1.5 py-0.5 rounded-[5px] opacity-80">
              <span className="font-mono text-tiny text-muted whitespace-nowrap">
                {a}<span className="text-muted-soft mx-0.5">→</span>{b}
              </span>
              <span className="font-mono tabular-nums text-tiny text-muted">
                {Number.isFinite(rate) && rate > 0 ? formatRateValue(a, b, rate) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: успешно.

- [ ] **Step 3: Коммит**

```bash
git add src/components/rates/AutoRatesPanel.jsx
git commit -m "feat(rates): AutoRatesPanel — авто кросс-курсы кеш-кеш (read-only)"
```

---

## Task 5: PasteRatesModal — массовый ввод курсов

**Files:**
- Create: `src/components/rates/PasteRatesModal.jsx`

**Контракт props:** `open`, `onClose`, `getRate(from,to)`, `onApply(rows)` (rows со status updated|new), `known` (Set валют).

- [ ] **Step 1: Реализовать**

```jsx
// src/components/rates/PasteRatesModal.jsx
// Модалка «Вставить курсы»: textarea (их формат) → diff-превью → Применить.

import React, { useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import { parseRatesPaste } from "../../utils/ratesPasteParser.js";
import { formatRateValue } from "../../utils/ratesFormat.js";

const STATUS_STYLE = {
  new: "text-success",
  updated: "text-accent",
  unchanged: "text-muted-soft",
  error: "text-danger",
};

export default function PasteRatesModal({ open, onClose, getRate, onApply, known }) {
  const [text, setText] = useState("");
  const rows = useMemo(
    () => parseRatesPaste(text, { known, currentRate: (f, t) => Number(getRate?.(f, t)) }),
    [text, known, getRate]
  );
  const applicable = rows.filter((r) => r.status === "updated" || r.status === "new");

  if (!open) return null;
  return (
    <Modal onClose={onClose} title="Вставить курсы">
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"USDT -> USD  -1,00%\nUSDT -> TRY 45,10\nTRY -> USDT 46\nUSDT -> EUR 1,177"}
          className="w-full font-mono text-body-sm border border-border rounded-[8px] p-2 outline-none focus:border-accent"
        />
        {rows.length > 0 && (
          <div className="max-h-[240px] overflow-auto rounded-[8px] border border-border-soft divide-y divide-border-soft">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-1.5 text-body-sm">
                <span className="font-mono">{r.from ? `${r.from} → ${r.to}` : r.raw}</span>
                <span className={`font-mono ${STATUS_STYLE[r.status]}`}>
                  {r.status === "error"
                    ? `ошибка: ${r.error}`
                    : `${Number.isFinite(r.prev) ? formatRateValue(r.from, r.to, r.prev) + " → " : ""}${formatRateValue(r.from, r.to, r.rate)}`}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-caption text-muted">К применению: {applicable.length}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-[8px] text-muted hover:bg-surface-soft">Отмена</button>
            <button
              onClick={() => { onApply?.(applicable); onClose?.(); }}
              disabled={applicable.length === 0}
              className="px-3 py-1.5 rounded-[8px] bg-ink text-white disabled:opacity-40"
            >
              Применить {applicable.length}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: успешно (проверить, что `../ui/Modal.jsx` экспортит default — он используется в RatesImportModal).

- [ ] **Step 3: Коммит**

```bash
git add src/components/rates/PasteRatesModal.jsx
git commit -m "feat(rates): PasteRatesModal — паст + diff-превью + apply"
```

---

## Task 6: Встроить две секции + паст в RatesSidebar

**Files:**
- Modify: `src/components/RatesSidebar.jsx`

Заменяем тело виджета (список `tradePairs` через RatesTable) на: офис-табы (оставить как есть) → `MasterRatesPanel` → `AutoRatesPanel` → кнопка «Вставить курсы» (открывает `PasteRatesModal`). Поиск/expand/favorites/fitCount по мастеру не нужны (строк фиксировано 6) — соответствующий код по тради-парам удалить, но офис-табы и `getRateForTab/hasOverride/pairUpdatedAt` оставить.

- [ ] **Step 1: Импорты + состояние**

В шапке файла добавить:
```jsx
import MasterRatesPanel from "./rates/MasterRatesPanel.jsx";
import AutoRatesPanel from "./rates/AutoRatesPanel.jsx";
import PasteRatesModal from "./rates/PasteRatesModal.jsx";
```
В теле компонента (рядом с `const [query, setQuery] = useState("")`) добавить:
```jsx
const [pasteOpen, setPasteOpen] = useState(false);
const KNOWN_CCYS = React.useMemo(() => new Set(["USDT", "USD", "TRY", "EUR", "RUB"]), []);
const commitMaster = React.useCallback(
  (from, to, rate) => { setRate(from, to, rate); },
  [setRate]
);
const applyPaste = React.useCallback(
  (rows) => { rows.forEach((r) => setRate(r.from, r.to, r.rate)); },
  [setRate]
);
```
И в деструктуризации `useRates()` добавить `setRate`:
```jsx
const { getRate: getRateRaw, lastUpdated, getOfficeOverride, allTradePairs, pairs, channels, setRate } = useRates();
```

- [ ] **Step 2: Заменить тело рендера**

Заменить блок от `<div ref={pairsRef} ...>` со списком/RatesTable на:
```jsx
<div ref={pairsRef} className="flex-1 min-h-0 overflow-y-auto">
  <MasterRatesPanel
    getRate={getRateForTab}
    onCommit={commitMaster}
    pairUpdatedAt={pairUpdatedAt}
    hasOverride={hasOverride}
  />
  <AutoRatesPanel getRate={getRateForTab} />
</div>
```
В footer карточки заменить кнопку expand на кнопку паста:
```jsx
<button
  type="button"
  onClick={() => setPasteOpen(true)}
  className="w-full mt-1 px-2 py-1.5 rounded-[8px] text-caption font-semibold text-accent bg-accent-bg hover:bg-indigo-100"
>
  Вставить курсы
</button>
```
Перед закрывающим `</aside>` добавить модалку:
```jsx
<PasteRatesModal
  open={pasteOpen}
  onClose={() => setPasteOpen(false)}
  getRate={getRateForTab}
  onApply={applyPaste}
  known={KNOWN_CCYS}
/>
```

- [ ] **Step 3: Удалить мёртвый код**

Удалить неиспользуемое после замены: `tradePairs`, `favoritesList/othersList/totalCount` memo, `collapsedList`, `expandedPairs/expandedSeparators`, `fitCount`/ResizeObserver effect, `query`/search input, импорт `RatesTable` (если больше не нужен в этом файле). Офис-табы, `getRateForTab`, `hasOverride`, `pairUpdatedAt`, `selectedTab` — ОСТАВИТЬ.

- [ ] **Step 4: Сборка + линт-чек глазами**

Run: `npm run build`
Expected: успешно, без unused-import ошибок (Vite не падает на unused, но почистить).

- [ ] **Step 5: Коммит**

```bash
git add src/components/RatesSidebar.jsx
git commit -m "feat(rates): RatesSidebar — секции Мастер+Авто и паст вместо портянки"
```

---

## Task 7: Ручная проверка в dev (seed) + финальный прогон

- [ ] **Step 1: Тесты**

Run: `npm test`
Expected: все зелёные (включая новые ratesFormat/ratesPasteParser).

- [ ] **Step 2: Dev в seed-режиме**

```bash
mv .env.local /tmp/cp-env.bak 2>/dev/null; npm run dev
```
Открыть http://localhost:5173 → главная Кассира. Проверить:
- секция «Мастер»: 6 строк, USDT↔USD в %, TRY/EUR абсолютом;
- клик по значению → правка (в % для USD), Enter применяет, авто-секция пересчиталась;
- «Вставить курсы» → паст блока → diff-превью → Применить меняет мастер;
- переключение офис-табов меняет значения (override).
Вернуть env: `mv /tmp/cp-env.bak .env.local`.

- [ ] **Step 3: Скриншот для согласования стиля**

Снять скриншот блока (headless Chrome) и показать юзеру — итеративно поправить стиль/плотность.

- [ ] **Step 4: Финальный коммит (если были правки стиля)**

```bash
git add -A && git commit -m "polish(rates): стиль блока курсов по обратной связи"
```

---

## Self-Review

- **Покрытие спеки:** Секция 1 (Task 3+6), Секция 2 (Task 4+6), % формат (Task 1), паст (Task 2+5+6), inline (Task 3), офисы (Task 6 — табы оставлены), парсер-модуль (Task 2), стиль (Task 3-6 + Task 7 polish). Лайфцикл draft→confirmed: `setRate` уже дёргает `markModifiedIfConfirmed` — баннер не ломаем (проверить в Task 7). ✓
- **Плейсхолдеры:** нет — весь код приведён.
- **Согласованность типов:** `getRate(from,to)`, `onCommit(from,to,rate)`, `parseRatesPaste(text,{known,currentRate})`, `formatRateValue(from,to,rate)`, `isPercentPair/percentToRate` — имена совпадают между задачами. ✓
- **Замечание:** в проде `setRate` меняет локальный стейт `pairs`; персист в Supabase идёт по пути import-модалки (rpc). Для текущего scope (привычный вид + локальная правка/паст) достаточно `setRate`; если нужна немедленная запись в БД на проде — отдельной задачей подключить `rpcImportRates/rpcUpsertOfficeRate` в `commitMaster/applyPaste` (как делает существующая Edit-страница). Вынесено как явный follow-up, не плейсхолдер.
