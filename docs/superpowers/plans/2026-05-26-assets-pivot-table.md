# Активы → pivot-таблица Office × Currency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести вкладку Treasury → Активы из трёхуровневого дерева Офис → Валюта → Счёт в плоскую pivot-таблицу: строки — офисы, колонки — валюты (динамически), правая колонка — `≈ base`. Клик по заголовку колонки сортирует строки. Раскрытие строки-офиса показывает листы-счета. CSV — тот же pivot.

**Architecture:** Один новый чистый селектор `assetsPivotByOffice(ctx)` рядом с существующими в `v2selectors.js`. UI — перепись `AssetsTab.jsx` на `<table>` с `<thead sticky>` + `<tbody>` (row-офисы и листья-счета как одинаковые `<tr>`) + `<tfoot sticky>`. Сортировка/раскрытие — локальный `useState` в компоненте. DS-токены и шапка не меняются.

**Tech Stack:** React 18 + Vite 5 + Tailwind 3 + vitest + @testing-library/react.

**Деплои:** все коммиты пушим ОДНИМ финальным push в Task 7 (избегаем серии мелких деплоев Vercel — memory `feedback_vercel_deploy_limit`).

---

## Файлы

- **Modify:** `src/lib/treasury/v2selectors.js` — добавить `assetsPivotByOffice`, удалить `assetsByOfficeCurrency`.
- **Modify:** `src/lib/treasury/v2selectors.test.js` — добавить блок тестов `assetsPivotByOffice`.
- **Modify:** `src/pages/treasury_v2/tabs/AssetsTab.jsx` — переписать рендер + CSV.
- **Modify:** `src/pages/treasury_v2/tabs/AssetsTab.test.jsx` — переписать тесты под новый layout.
- **Modify:** `src/i18n/translations.jsx` — 3 ключа × 3 языка (en/ru/tr).
- **Modify:** `src/pages/info/content.js` — раздел `balance-sheet` (Активы) переписать под pivot-вид.

---

### Task 1: Селектор `assetsPivotByOffice` (TDD)

**Files:**
- Modify: `src/lib/treasury/v2selectors.test.js` — новый `describe("assetsPivotByOffice")` блок (добавить в конец файла)
- Modify: `src/lib/treasury/v2selectors.js` — экспорт `assetsPivotByOffice` (добавить ниже `assetsByOfficeCurrency`)

- [ ] **Step 1: Дописать failing-тесты в `v2selectors.test.js`**

Добавить в конец файла (используется существующий `makeLedgerCtx` из этого же файла). Соседние describe-блоки делают `import { ... } from "./v2selectors.js";` прямо над собой — следуем тому же паттерну:

```js
import { assetsPivotByOffice } from "./v2selectors.js";
describe("assetsPivotByOffice", () => {
  it("строит pivot из asset-счетов: офисы в строках, валюты в колонках", () => {
    const ctx = makeLedgerCtx();
    const pivot = assetsPivotByOffice(ctx);
    // Asset accounts: ac_cash_usd_mark (office-mark, USD 11000),
    //                 ac_hot_usdt_mark (office-mark, USDT 150),
    //                 ac_treasury_usdt (null office, USDT 1000)
    // Валюты в плане счетов: USD, USDT. Base = USD → USD первой.
    expect(pivot.currencies).toEqual(["USD", "USDT"]);
    // rows: office-mark (totalInBase 11150) первой, null-офис в конце (1000)
    expect(pivot.rows.map((r) => r.officeId)).toEqual(["office-mark", null]);
    expect(pivot.rows[0].totals).toEqual({ USD: 11000, USDT: 150 });
    expect(pivot.rows[0].totalInBase).toBe(11150);
    expect(pivot.rows[1].totals).toEqual({ USDT: 1000 });
    expect(pivot.rows[1].totalInBase).toBe(1000);
    expect(pivot.grandTotals).toEqual({ USD: 11000, USDT: 1150, inBase: 12150 });
  });

  it("включает в accounts[] все asset-счета офиса, отсортированные по |balanceInBase| desc", () => {
    const ctx = makeLedgerCtx();
    const pivot = assetsPivotByOffice(ctx);
    const mark = pivot.rows.find((r) => r.officeId === "office-mark");
    expect(mark.accounts.map((a) => a.accountId)).toEqual([
      "ac_cash_usd_mark", // 11000 base
      "ac_hot_usdt_mark", // 150 base
    ]);
    expect(mark.accounts[0]).toMatchObject({
      accountId: "ac_cash_usd_mark", code: "1110", currency: "USD", balance: 11000, balanceInBase: 11000,
    });
  });

  it("officeFilter=<uuid> оставляет только этот офис и исключает null-office", () => {
    const ctx = makeLedgerCtx({ officeFilter: "office-mark" });
    const pivot = assetsPivotByOffice(ctx);
    expect(pivot.rows).toHaveLength(1);
    expect(pivot.rows[0].officeId).toBe("office-mark");
    // USDT остаётся в колонках, т.к. у office-mark есть USDT-счёт
    expect(pivot.currencies).toEqual(["USD", "USDT"]);
  });

  it("включает в currencies валюту даже если у счёта нулевой баланс", () => {
    const ctx = makeLedgerCtx({
      accounts: [
        { id: "a1", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "o1" },
        { id: "a2", code: "1120", name: "Cash EUR", type: "asset", subtype: "cash", currency: "EUR", officeId: "o1" },
      ],
      balances: [
        { accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 100 },
        // a2 — без balance row → 0
      ],
      toBase: (amt, cur) => Number(amt) * ({ USD: 1, EUR: 1.1 }[cur] ?? 0),
      baseCurrency: "USD",
      officeFilter: "all",
    });
    const pivot = assetsPivotByOffice(ctx);
    // EUR колонка есть, хотя баланс 0
    expect(pivot.currencies).toContain("EUR");
    const o1 = pivot.rows[0];
    expect(o1.totals.EUR ?? 0).toBe(0);
  });

  it("baseCurrency всегда первая в currencies, остальные — по Σ|inBase| desc", () => {
    const ctx = makeLedgerCtx({
      accounts: [
        { id: "a1", code: "1", name: "TRY", type: "asset", subtype: "cash", currency: "TRY", officeId: "o1" },
        { id: "a2", code: "2", name: "EUR", type: "asset", subtype: "cash", currency: "EUR", officeId: "o1" },
        { id: "a3", code: "3", name: "USD", type: "asset", subtype: "cash", currency: "USD", officeId: "o1" },
      ],
      balances: [
        { accountId: "a1", currency: "TRY", clientId: null, partnerId: null, balance: 1000000 }, // base ~ 30000
        { accountId: "a2", currency: "EUR", clientId: null, partnerId: null, balance: 100 },     // base ~ 110
        { accountId: "a3", currency: "USD", clientId: null, partnerId: null, balance: 500 },     // base 500
      ],
      toBase: (amt, cur) => Number(amt) * ({ USD: 1, EUR: 1.1, TRY: 0.03 }[cur] ?? 0),
      baseCurrency: "USD",
      officeFilter: "all",
    });
    const pivot = assetsPivotByOffice(ctx);
    expect(pivot.currencies).toEqual(["USD", "TRY", "EUR"]); // USD first, then TRY (30000), then EUR (110)
  });

  it("null-office всегда последний даже если у него больше |totalInBase|", () => {
    const ctx = makeLedgerCtx({
      accounts: [
        { id: "a1", code: "1", name: "small office", type: "asset", subtype: "cash", currency: "USD", officeId: "o1" },
        { id: "a2", code: "2", name: "big null", type: "asset", subtype: "cash", currency: "USD", officeId: null },
      ],
      balances: [
        { accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 10 },
        { accountId: "a2", currency: "USD", clientId: null, partnerId: null, balance: 999999 },
      ],
      toBase: (amt) => Number(amt),
      baseCurrency: "USD",
      officeFilter: "all",
    });
    const pivot = assetsPivotByOffice(ctx);
    expect(pivot.rows.map((r) => r.officeId)).toEqual(["o1", null]);
  });
});
```

- [ ] **Step 2: Запустить — должны упасть с "assetsPivotByOffice is not a function"**

Run: `npm test -- v2selectors.test.js -t "assetsPivotByOffice"`
Expected: FAIL (6 тестов падают с `assetsPivotByOffice is not a function`).

- [ ] **Step 3: Реализовать `assetsPivotByOffice` в `v2selectors.js`**

Добавить **сразу после** `assetsByOfficeCurrency` (примерно строка 121, перед комментарием про `liabilitiesByCounterparty`):

```js
// Pivot-вид asset-счетов для вкладки Treasury → Активы: офисы в строках,
// валюты в колонках. Возвращает плоскую структуру для табличного UI (в отличие
// от иерархического assetsByOfficeCurrency). Колонки-валюты строятся из набора
// валют, встретившихся в asset-счетах (даже с нулевым балансом — если счёт в
// плане есть, колонка должна быть). Порядок колонок: ctx.baseCurrency первой,
// остальные по Σ|toBase(amount)| desc. Строки: null-office всегда последним,
// остальные по |totalInBase| desc.
//
// Returns: {
//   currencies: ["USD", "EUR", ...],
//   rows: [{
//     officeId: string|null,
//     totals: { [currency]: nativeAmount },
//     totalInBase,
//     accounts: [{ accountId, code, name, currency, balance, balanceInBase }]
//   }],
//   grandTotals: { [currency]: nativeAmount, inBase: number }
// }
export function assetsPivotByOffice(ctx) {
  const { accounts, balances, toBase, baseCurrency, officeFilter } = ctx;
  const balByAccount = new Map();
  for (const b of balances) {
    const arr = balByAccount.get(b.accountId) || [];
    arr.push(b);
    balByAccount.set(b.accountId, arr);
  }
  const byOffice = new Map();          // officeKey → row builder
  const ccyVolume = new Map();         // currency → Σ|inBase| across all visible rows
  const allCurrencies = new Set();     // все валюты asset-счетов (для колонок, даже с 0)
  for (const acc of accounts) {
    if (acc.type !== "asset") continue;
    if (!passesOfficeFilter(acc, officeFilter)) continue;
    const ccy = acc.currency || "?";
    allCurrencies.add(ccy);
    const rows = balByAccount.get(acc.id) || [];
    let balance = 0, balanceInBase = 0;
    for (const b of rows) {
      balance += Number(b.balance) || 0;
      balanceInBase += toBase(b.balance, b.currency) || 0;
    }
    const officeKey = acc.officeId || "__none__";
    const row = byOffice.get(officeKey) || {
      officeId: acc.officeId || null,
      totals: {},
      totalInBase: 0,
      accounts: [],
    };
    row.totals[ccy] = (row.totals[ccy] || 0) + balance;
    row.totalInBase += balanceInBase;
    row.accounts.push({
      accountId: acc.id, code: acc.code, name: acc.name,
      currency: acc.currency, balance, balanceInBase,
    });
    byOffice.set(officeKey, row);
    ccyVolume.set(ccy, (ccyVolume.get(ccy) || 0) + Math.abs(balanceInBase));
  }

  // Колонки: base первой, остальные по Σ|inBase| desc
  const currencies = [...allCurrencies].sort((a, b) => {
    if (a === baseCurrency && b !== baseCurrency) return -1;
    if (b === baseCurrency && a !== baseCurrency) return 1;
    return (ccyVolume.get(b) || 0) - (ccyVolume.get(a) || 0);
  });

  // Строки: листы по |balanceInBase| desc; null-office последним, остальные по |totalInBase| desc
  const rows = [...byOffice.values()]
    .map((r) => ({
      ...r,
      accounts: r.accounts.slice().sort((x, y) => Math.abs(y.balanceInBase) - Math.abs(x.balanceInBase)),
    }))
    .sort((a, b) => {
      if (a.officeId === null && b.officeId !== null) return 1;
      if (b.officeId === null && a.officeId !== null) return -1;
      return Math.abs(b.totalInBase) - Math.abs(a.totalInBase);
    });

  // grandTotals
  const grandTotals = { inBase: 0 };
  for (const ccy of currencies) grandTotals[ccy] = 0;
  for (const r of rows) {
    grandTotals.inBase += r.totalInBase;
    for (const ccy of currencies) {
      if (r.totals[ccy] != null) grandTotals[ccy] += r.totals[ccy];
    }
  }

  return { currencies, rows, grandTotals };
}
```

- [ ] **Step 4: Запустить — все 6 должны зеленеть**

Run: `npm test -- v2selectors.test.js -t "assetsPivotByOffice"`
Expected: PASS (6/6).

- [ ] **Step 5: Запустить весь test-файл — ничего не сломали соседям**

Run: `npm test -- v2selectors.test.js`
Expected: PASS — все блоки (`groupByClass`, `assetsByOfficeCurrency` если есть, `trialBalance`, etc.) проходят.

- [ ] **Step 6: Коммит**

```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "feat(treasury): assetsPivotByOffice — pivot-селектор Office×Currency для Активов

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
(не пушим — см. Task 9)

---

### Task 2: i18n ключи

**Files:**
- Modify: `src/i18n/translations.jsx` — 3 новых ключа × 3 языка

- [ ] **Step 1: Прочитать соседство существующих ключей**

Чтобы понять, куда вставлять, запусти:
```bash
grep -n "trv2_assets_no_office" src/i18n/translations.jsx
```
Должно вернуть 3 строки (en/ru/tr). Вставляем НОВЫЕ ключи СРАЗУ ПОСЛЕ каждой `trv2_assets_no_office: ...` в соответствующем словаре.

- [ ] **Step 2: Добавить ключи в en-словарь**

Найти строку `trv2_assets_no_office: "No office (shared)",` (~строка 695). Вставить **сразу под ней**:

```js
    trv2_assets_col_office: "Cashbox",
    trv2_assets_col_base: "≈",
    trv2_assets_grand_total: "TOTAL",
```

- [ ] **Step 3: Добавить ключи в ru-словарь**

Найти строку `trv2_assets_no_office: "Без офиса (общие)",` (~строка 2152). Вставить **сразу под ней**:

```js
    trv2_assets_col_office: "Касса",
    trv2_assets_col_base: "≈",
    trv2_assets_grand_total: "ИТОГО",
```

- [ ] **Step 4: Добавить ключи в tr-словарь**

Найти строку `trv2_assets_no_office: "Ofis yok (ortak)",` (~строка 3607). Вставить **сразу под ней**:

```js
    trv2_assets_col_office: "Kasa",
    trv2_assets_col_base: "≈",
    trv2_assets_grand_total: "TOPLAM",
```

- [ ] **Step 5: Sanity-check — все 3 ключа в 3 языках**

Run: `grep -c "trv2_assets_col_office\|trv2_assets_col_base\|trv2_assets_grand_total" src/i18n/translations.jsx`
Expected: `9` (3 ключа × 3 языка).

- [ ] **Step 6: Коммит**

```bash
git add src/i18n/translations.jsx
git commit -m "i18n(treasury): ключи для pivot-таблицы Активов (col_office/col_base/grand_total)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: AssetsTab — переписать тесты под новый layout (TDD red)

**Files:**
- Modify: `src/pages/treasury_v2/tabs/AssetsTab.test.jsx` — переписать целиком

- [ ] **Step 1: Заменить файл целиком**

Скопируй ниже текст В ТОЧНОСТИ в `src/pages/treasury_v2/tabs/AssetsTab.test.jsx` (полная замена):

```jsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { makeLedgerCtx } from "../../../lib/treasury/v2selectors.test.js";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));

let canAccountingEdit = true;
vi.mock("../../../store/permissions.jsx", () => ({
  useCan: () => (section, level = "view") => (section === "accounting" && level === "edit" ? canAccountingEdit : true),
}));

vi.mock("../../../store/offices.jsx", () => ({
  useOffices: () => ({
    findOffice: (id) => ({ "office-mark": { id: "office-mark", name: "Mark Antalya" } }[id] || null),
    activeOffices: [{ id: "office-mark", name: "Mark Antalya" }],
  }),
}));
vi.mock("../../../store/currencies.jsx", () => ({ useCurrencies: () => ({ codes: ["USD", "USDT", "TRY"] }) }));
vi.mock("../../../lib/supabaseWrite.js", () => ({
  rpcCreateLedgerAccount: vi.fn(async () => "1901"),
  withToast: vi.fn(async (fn) => { try { return { ok: true, result: await fn() }; } catch (e) { return { ok: false, error: String(e) }; } }),
}));
vi.mock("../parts/AccountInlineEntries.jsx", () => ({
  __esModule: true,
  default: ({ accountId }) => <div data-testid="inline-entries">{accountId}</div>,
}));
const exportCSVSpy = vi.fn();
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVSpy(...a) }));

import AssetsTab from "./AssetsTab.jsx";

const formatBase = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

function renderTab(ctx = makeLedgerCtx()) {
  return render(<AssetsTab ctx={ctx} officeFilter="all" formatBase={formatBase} baseCurrency="USD" onOpenTx={() => {}} />);
}

describe("AssetsTab — pivot Office × Currency", () => {
  beforeEach(() => { canAccountingEdit = true; exportCSVSpy.mockClear(); });

  it("рендерит таблицу с заголовком 'Касса' + колонками валют + правой ≈USD", () => {
    renderTab();
    // thead должен содержать USD, USDT и ≈ (base column)
    const thead = document.querySelector("thead");
    expect(thead).not.toBeNull();
    expect(within(thead).getByText("trv2_assets_col_office")).toBeInTheDocument();
    expect(within(thead).getByText("USD")).toBeInTheDocument();
    expect(within(thead).getByText("USDT")).toBeInTheDocument();
  });

  it("строки-офисы видны: 'Mark Antalya' и 'trv2_assets_no_office'", () => {
    renderTab();
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    // листья-счета скрыты до раскрытия
    expect(screen.queryByText("1110")).toBeNull();
  });

  it("клик по строке-офису раскрывает листы-счета", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("Cash · Mark Antalya · USD")).toBeInTheDocument();
    expect(screen.getByText("1316")).toBeInTheDocument();
  });

  it("клик по строке-листу разворачивает AccountInlineEntries", () => {
    renderTab();
    fireEvent.click(screen.getByText("Mark Antalya"));
    fireEvent.click(screen.getByText("Cash · Mark Antalya · USD"));
    expect(screen.getByTestId("inline-entries")).toHaveTextContent("ac_cash_usd_mark");
  });

  it("строка ИТОГО внизу с grand-total в base", () => {
    renderTab();
    const tfoot = document.querySelector("tfoot");
    expect(tfoot).not.toBeNull();
    expect(within(tfoot).getByText("trv2_assets_grand_total")).toBeInTheDocument();
    // grand-total в base: $12,150 (11000 USD + 150 USDT + 1000 USDT)
    expect(within(tfoot).getByText("$12,150")).toBeInTheDocument();
  });

  it("клик по заголовку колонки USD сортирует строки по этой колонке", () => {
    renderTab();
    // default: по ≈base desc → office-mark (11150) первый, null (1000) второй
    const tbody = document.querySelector("tbody");
    const rowsBefore = within(tbody).getAllByRole("row");
    expect(within(rowsBefore[0]).queryByText("Mark Antalya")).toBeTruthy();

    // клик по USD: office-mark имеет 11000 USD, null — 0 USD → mark всё ещё первый
    // (проверяем сам факт смены сортировки: клик второй раз → asc)
    fireEvent.click(within(document.querySelector("thead")).getByText("USD"));
    fireEvent.click(within(document.querySelector("thead")).getByText("USD")); // asc
    const rowsAsc = within(tbody).getAllByRole("row");
    // в asc-режиме null (0 USD) первый, mark (11000) второй
    expect(within(rowsAsc[0]).queryByText("trv2_assets_no_office")).toBeTruthy();
  });

  it("кнопка 'Ненулевые' скрывает офисы с нулём и валюты с Σ==0", () => {
    // ctx где null-офис имеет 0 в base
    const ctx = makeLedgerCtx({
      accounts: [
        { id: "a1", code: "1", name: "non-zero", type: "asset", subtype: "cash", currency: "USD", officeId: "office-mark" },
        { id: "a2", code: "2", name: "zero", type: "asset", subtype: "cash", currency: "USD", officeId: null },
      ],
      balances: [
        { accountId: "a1", currency: "USD", clientId: null, partnerId: null, balance: 100 },
        // a2 без баланса → 0
      ],
    });
    renderTab(ctx);
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.getByText("trv2_assets_no_office")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ненулевые"));
    expect(screen.getByText("Mark Antalya")).toBeInTheDocument();
    expect(screen.queryByText("trv2_assets_no_office")).toBeNull();
  });

  it("CSV-экспорт вызывается с pivot-колонками (office + currencies + base_<ccy>) и строкой ИТОГО", () => {
    renderTab();
    fireEvent.click(screen.getByText(/^CSV$/));
    expect(exportCSVSpy).toHaveBeenCalledTimes(1);
    const arg = exportCSVSpy.mock.calls[0][0];
    expect(arg.filename).toMatch(/^assets_\d{4}-\d{2}-\d{2}\.csv$/);
    // колонки: office, USD, USDT, base_usd
    const colKeys = arg.columns.map((c) => c.key);
    expect(colKeys[0]).toBe("office");
    expect(colKeys).toContain("USD");
    expect(colKeys).toContain("USDT");
    expect(colKeys[colKeys.length - 1]).toBe("base_usd");
    // последняя строка — ИТОГО
    const lastRow = arg.rows[arg.rows.length - 1];
    expect(lastRow.office).toBe("trv2_assets_grand_total");
    expect(lastRow.base_usd).toBe(12150);
  });

  it("кнопка '+ Счёт в план' видна только при accounting:edit", () => {
    const { unmount } = renderTab();
    expect(screen.getByText("trv2_chart_add_btn")).toBeInTheDocument();
    unmount();
    canAccountingEdit = false;
    renderTab();
    expect(screen.queryByText("trv2_chart_add_btn")).toBeNull();
  });

  it("empty-state когда нет asset-счетов", () => {
    const ctx = makeLedgerCtx({ accounts: [], balances: [] });
    renderTab(ctx);
    expect(screen.getByText("trv2_no_accounts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить — ВСЕ тесты должны упасть (старый компонент не имеет таблицы)**

Run: `npm test -- AssetsTab.test.jsx`
Expected: FAIL — большинство тестов падают (нет `<thead>`, нет ИТОГО, нет CSV-spy и т.д.). Это OK — переходим к реализации.

(Не коммитить пока — реализация в Task 4 делает их зелёными, коммитим тесты+импл одним коммитом.)

---

### Task 4: Переписать `AssetsTab.jsx` — pivot-рендер + sort + expand + CSV

**Files:**
- Modify: `src/pages/treasury_v2/tabs/AssetsTab.jsx` — полная перезапись

- [ ] **Step 1: Заменить файл целиком**

Скопируй ниже текст В ТОЧНОСТИ в `src/pages/treasury_v2/tabs/AssetsTab.jsx` (полная замена):

```jsx
// src/pages/treasury_v2/tabs/AssetsTab.jsx
// «Активы» — pivot-таблица Office × Currency. Строки — офисы (раскрываются
// в листья-счета), колонки — валюты (из набора asset-счетов; base первой,
// остальные по Σ|inBase| desc). Клик по заголовку колонки сортирует строки.
// Лист-счёт показывает native-баланс в своей колонке + InlineBalanceEditor;
// клик по нему разворачивает AccountInlineEntries.

import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Plus, Building2, Download, ArrowUp, ArrowDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { assetsPivotByOffice } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountInlineEntries from "../parts/AccountInlineEntries.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import InlineBalanceEditor from "../parts/InlineBalanceEditor.jsx";

const NONZERO_KEY = "coinplata:assets-nonzero";
const SORT_KEY_BASE = "__inBase";

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

export default function AssetsTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { findOffice } = useOffices();
  const pivot = useMemo(() => assetsPivotByOffice(ctx), [ctx]);

  const [expandedOffices, setExpandedOffices] = useState(() => new Set());
  const [expandedAccounts, setExpandedAccounts] = useState(() => new Set());
  const [sort, setSort] = useState({ key: SORT_KEY_BASE, dir: "desc" });
  const [addOpen, setAddOpen] = useState(false);
  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => {
    setNonZeroOnly(v);
    try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {}
  };

  // 1) filter по «Ненулевые»: скрываем row с totalInBase ≈ 0; внутри row — accounts с balanceInBase ≈ 0
  // 2) затем фильтруем колонки: если ненулевые включены, прячем колонки с grandTotals[ccy] ≈ 0
  const isNonZero = (n) => Math.abs(Number(n) || 0) > 0.005;
  const filtered = useMemo(() => {
    if (!nonZeroOnly) return pivot;
    const rows = pivot.rows
      .map((r) => ({ ...r, accounts: r.accounts.filter((a) => isNonZero(a.balanceInBase)) }))
      .filter((r) => isNonZero(r.totalInBase));
    const grandTotals = { inBase: 0 };
    const ccyTotals = new Map();
    for (const r of rows) {
      grandTotals.inBase += r.totalInBase;
      for (const ccy of pivot.currencies) {
        if (r.totals[ccy] != null) ccyTotals.set(ccy, (ccyTotals.get(ccy) || 0) + r.totals[ccy]);
      }
    }
    const currencies = pivot.currencies.filter((ccy) => isNonZero(ccyTotals.get(ccy)));
    for (const ccy of currencies) grandTotals[ccy] = ccyTotals.get(ccy);
    return { currencies, rows, grandTotals };
  }, [pivot, nonZeroOnly]);

  // 3) сортировка строк
  const sortedRows = useMemo(() => {
    const rows = filtered.rows.slice();
    const dirMul = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      // null-office всегда последний (не зависит от сорта)
      if (a.officeId === null && b.officeId !== null) return 1;
      if (b.officeId === null && a.officeId !== null) return -1;
      if (sort.key === SORT_KEY_BASE) {
        return (Math.abs(a.totalInBase) - Math.abs(b.totalInBase)) * dirMul;
      }
      if (sort.key === "__office") {
        const aName = a.officeId ? (findOffice(a.officeId)?.name || a.officeId) : t("trv2_assets_no_office");
        const bName = b.officeId ? (findOffice(b.officeId)?.name || b.officeId) : t("trv2_assets_no_office");
        return String(aName).localeCompare(String(bName)) * dirMul;
      }
      // sort по конкретной валюте
      const aV = a.totals[sort.key] || 0;
      const bV = b.totals[sort.key] || 0;
      return (Math.abs(aV) - Math.abs(bV)) * dirMul;
    });
    return rows;
  }, [filtered, sort, findOffice, t]);

  const toggleOffice = (key) => setExpandedOffices((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAccount = (key) => setExpandedAccounts((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Click по заголовку колонки → toggle desc → asc → reset
  const onSortClick = (key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return { key: SORT_KEY_BASE, dir: "desc" };
    });
  };

  const SortArrow = ({ active, dir }) => {
    if (!active) return null;
    return dir === "asc"
      ? <ArrowUp className="inline w-3 h-3 ml-1 text-ink" strokeWidth={2.5} />
      : <ArrowDown className="inline w-3 h-3 ml-1 text-ink" strokeWidth={2.5} />;
  };

  const colCount = 1 + filtered.currencies.length + 1; // office + ccy*N + base

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-h2 text-ink flex items-center gap-2">
          {t("trv2_tab_assets")}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
            {sortedRows.length}
          </span>
          <span className="text-caption text-muted font-normal ml-1 font-mono tabular">
            ≈ {formatBase(filtered.grandTotals.inBase, baseCurrency)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNonZeroPersist(!nonZeroOnly)}
            className={`h-9 px-3 rounded-button text-body-sm font-semibold transition-all whitespace-nowrap ${
              nonZeroOnly ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
            }`}
            title="Скрыть нулевые балансы"
          >
            Ненулевые
          </button>
          <button
            type="button"
            onClick={() => doExportAssets(filtered, baseCurrency, findOffice, t)}
            disabled={sortedRows.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-button bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-soft transition-colors disabled:opacity-40"
            title="Экспорт pivot-таблицы в CSV"
          >
            <Download className="w-3.5 h-3.5" strokeWidth={2.5} />
            CSV
          </button>
          {can("accounting", "edit") && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-button bg-ink text-white text-body-sm font-semibold hover:bg-black hover:-translate-y-px shadow-cta-glow transition-all"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              {t("trv2_chart_add_btn")}
            </button>
          )}
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <div className="bg-surface rounded-card p-card">
          <div className="py-10 text-center">
            <div className="inline-flex w-11 h-11 rounded-full bg-surface-sunk text-muted-soft items-center justify-center mb-3">
              <Building2 className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="text-body font-semibold text-ink mb-1">{t("trv2_no_accounts")}</div>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border-soft">
                <th
                  className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => onSortClick("__office")}
                >
                  {t("trv2_assets_col_office")}
                  <SortArrow active={sort.key === "__office"} dir={sort.dir} />
                </th>
                {filtered.currencies.map((ccy) => (
                  <th
                    key={ccy}
                    className="text-right text-caption font-semibold text-muted tracking-wider px-3 py-2.5 cursor-pointer select-none hover:text-ink transition-colors font-mono"
                    onClick={() => onSortClick(ccy)}
                  >
                    {ccy}
                    <SortArrow active={sort.key === ccy} dir={sort.dir} />
                  </th>
                ))}
                <th
                  className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2.5 cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => onSortClick(SORT_KEY_BASE)}
                >
                  {t("trv2_assets_col_base")} {baseCurrency}
                  <SortArrow active={sort.key === SORT_KEY_BASE} dir={sort.dir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const officeKey = `office:${row.officeId || "none"}`;
                const open = expandedOffices.has(officeKey);
                const officeName = row.officeId
                  ? (findOffice(row.officeId)?.name || row.officeId)
                  : t("trv2_assets_no_office");
                return (
                  <React.Fragment key={officeKey}>
                    <tr
                      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer bg-surface-soft/40 transition-colors"
                      onClick={() => toggleOffice(officeKey)}
                    >
                      <td className="px-card py-2.5">
                        <div className="flex items-center gap-2">
                          {open
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                          <span className="text-h3 text-ink font-semibold truncate">{officeName}</span>
                        </div>
                      </td>
                      {filtered.currencies.map((ccy) => (
                        <td key={ccy} className="text-right px-3 py-2.5 font-mono tabular text-body-sm text-ink-soft">
                          {row.totals[ccy] != null && Math.abs(row.totals[ccy]) > 0.005
                            ? nativeFmt(row.totals[ccy], ccy)
                            : <span className="text-muted-soft">—</span>}
                        </td>
                      ))}
                      <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink">
                        {formatBase(row.totalInBase, baseCurrency)}
                      </td>
                    </tr>

                    {open && row.accounts.map((a) => {
                      const accKey = `${officeKey}|acc:${a.accountId}`;
                      const accOpen = expandedAccounts.has(accKey);
                      return (
                        <React.Fragment key={accKey}>
                          <tr
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => toggleAccount(accKey)}
                          >
                            <td className="pl-9 pr-card py-1.5">
                              <div className="flex items-center gap-2">
                                {accOpen
                                  ? <ChevronDown className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                  : <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />}
                                <span className="font-mono text-tiny text-muted-soft">{a.code}</span>
                                <span className="text-body-sm text-ink truncate">{a.name}</span>
                              </div>
                            </td>
                            {filtered.currencies.map((ccy) => (
                              <td key={ccy} className="text-right px-3 py-1.5 font-mono tabular text-body-sm">
                                {ccy === a.currency ? (
                                  <span onClick={(e) => e.stopPropagation()}>
                                    <InlineBalanceEditor
                                      account={{ code: a.code, currency: a.currency, type: "asset", subtype: null, balance: a.balance }}
                                      displayMul={1}
                                      accounts={ctx?.accounts || []}
                                      suffix={a.currency}
                                    />
                                  </span>
                                ) : (
                                  <span className="text-muted-soft">—</span>
                                )}
                              </td>
                            ))}
                            <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft">
                              {formatBase(a.balanceInBase, baseCurrency)}
                            </td>
                          </tr>
                          {accOpen && (
                            <tr>
                              <td colSpan={colCount} className="p-0">
                                <AccountInlineEntries ctx={ctx} accountId={a.accountId} onOpenTx={onOpenTx} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-surface-sunk">
              <tr className="border-t border-border-soft">
                <td className="px-card py-2.5 text-body-sm font-bold text-ink uppercase tracking-wider">
                  {t("trv2_assets_grand_total")}
                </td>
                {filtered.currencies.map((ccy) => (
                  <td key={ccy} className="text-right px-3 py-2.5 font-mono tabular font-semibold text-body-sm text-ink">
                    {filtered.grandTotals[ccy] != null && Math.abs(filtered.grandTotals[ccy]) > 0.005
                      ? nativeFmt(filtered.grandTotals[ccy], ccy)
                      : <span className="text-muted-soft">—</span>}
                  </td>
                ))}
                <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink">
                  {formatBase(filtered.grandTotals.inBase, baseCurrency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {addOpen && (
        <ChartAccountModal
          open
          onClose={() => setAddOpen(false)}
          defaultOfficeId={officeFilter && officeFilter !== "all" ? officeFilter : null}
        />
      )}
    </div>
  );
}

// Pivot-CSV: колонки office + каждая видимая валюта + base_<ccy>;
// строки — офисы + одна строка ИТОГО внизу.
function doExportAssets(filtered, baseCurrency, findOffice, t) {
  const baseKey = `base_${baseCurrency.toLowerCase()}`;
  const columns = [
    { key: "office", label: "office" },
    ...filtered.currencies.map((ccy) => ({ key: ccy, label: ccy })),
    { key: baseKey, label: baseKey },
  ];
  const rows = filtered.rows.map((r) => {
    const officeName = r.officeId
      ? (findOffice(r.officeId)?.name || r.officeId)
      : t("trv2_assets_no_office");
    const out = { office: officeName, [baseKey]: r.totalInBase };
    for (const ccy of filtered.currencies) out[ccy] = r.totals[ccy] ?? "";
    return out;
  });
  // total row
  const totalRow = { office: t("trv2_assets_grand_total"), [baseKey]: filtered.grandTotals.inBase };
  for (const ccy of filtered.currencies) totalRow[ccy] = filtered.grandTotals[ccy] ?? "";
  rows.push(totalRow);

  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `assets_${stamp}.csv`, columns, rows });
}
```

- [ ] **Step 2: Запустить тесты — должны зеленеть**

Run: `npm test -- AssetsTab.test.jsx`
Expected: PASS (10/10).

- [ ] **Step 3: Запустить ВЕСЬ test-suite — ничего соседнего не сломали**

Run: `npm test`
Expected: PASS. Если что-то падает из-за удалённого `assetsByOfficeCurrency` — Task 5 уберёт его, но сначала зафиксируем, что НЕ assets-тесты упали из-за чего-то ещё. Если в этот момент весь suite зелёный — отлично.

- [ ] **Step 4: Коммит (импл + тесты + сравнение с Task 3)**

```bash
git add src/pages/treasury_v2/tabs/AssetsTab.jsx src/pages/treasury_v2/tabs/AssetsTab.test.jsx
git commit -m "feat(treasury): Активы — pivot-таблица Office × Currency + sort + CSV

Строки = офисы (раскрываются в листья-счета), колонки = валюты
(динамически из плана счетов, base первой). Клик по заголовку
колонки сортирует строки. CSV в том же pivot-формате.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Удалить старый `assetsByOfficeCurrency`

**Files:**
- Modify: `src/lib/treasury/v2selectors.js` — удалить функцию

- [ ] **Step 1: Убедиться, что больше нет ссылок**

Run: `grep -rn "assetsByOfficeCurrency" src/`
Expected: ноль результатов (мы переключили `AssetsTab.jsx` в Task 4 на `assetsPivotByOffice`).

- [ ] **Step 2: Удалить функцию из `v2selectors.js`**

Открыть `src/lib/treasury/v2selectors.js`, найти комментарий-шапку перед `export function assetsByOfficeCurrency(ctx) {` (она начинается с `// Hierarchical asset view for the Treasury «Активы» tab`, ~строка 72-78). Удалить целиком блок: шапочный комментарий + всё тело функции до закрывающей `}` (примерно строки 72-121). Между предшествующим экспортом (`groupByClass`) и следующим (`assetsPivotByOffice`) должна остаться пустая строка.

- [ ] **Step 3: Запустить весь test-suite — не должно ничего сломаться**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Сборка — убедиться что нет dangling import-ов**

Run: `npm run build`
Expected: PASS, бандл собирается, никаких `assetsByOfficeCurrency is not exported` errors.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/treasury/v2selectors.js
git commit -m "refactor(treasury): удалить assetsByOfficeCurrency (заменён на assetsPivotByOffice)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Обновить Справку (info/content.js)

**Files:**
- Modify: `src/pages/info/content.js` — раздел `id: "balance-sheet"` (~строка 313-336), пункт про Активы

- [ ] **Step 1: Прочитать текущий блок**

Открыть файл, найти `id: "balance-sheet"` (~строка 313). Внутри `how` массив — первый элемент описывает старое дерево Офис → Валюта → Счёт.

- [ ] **Step 2: Заменить первый элемент `how` массива**

Найти строку:
```js
          "Вкладка «Активы» — иерархическое дерево: Офис → Валюта → счета плана. Уровень 1 — офис (плюс отдельная группа «Без офиса (общие)» — клиринговые / транзитные счета без привязки), в шапке группы — сумма всех его активов в базовой валюте. Уровень 2 — валюта внутри офиса (нативная сумма + «≈ $X» в базовой). Уровень 3 — конкретные счета плана (название + код + нативный остаток); клик по счёту разворачивает его проводки за всё время.",
```

Заменить на:
```js
          "Вкладка «Активы» — pivot-таблица: строки = офисы (плюс «Без офиса (общие)» — клиринговые/транзитные счета без привязки), колонки = валюты (динамически из плана счетов, базовая первой), правая колонка ≈ {base} — итог офиса в базовой валюте. Клик по заголовку колонки сортирует строки (desc → asc → reset). Клик по строке-офису раскрывает листья — конкретные счета плана (код + название + native-остаток в своей колонке-валюте, прочерк в остальных). Клик по листу разворачивает его проводки за всё время. Внизу таблицы — строка ИТОГО (sticky) с суммами по каждой колонке.",
```

И также обновить пример внутри этого же раздела (`examples`), найти строку:
```js
              "«Активы» → разворот «Mark Antalya» → «USDT $100 000 (≈ $100 000)» → разворот → «W88 Mark · USDT TRC20 (1900) $40 000», «Hot · USDT TRC20 · Mark Antalya (1316) $60 000» → разворот листа → его проводки за всё время.",
```

Заменить на:
```js
              "«Активы» → клик по столбцу USDT сортирует строки по USDT desc → разворот строки «Mark Antalya» → видны листья: «1900 W88 Mark · USDT TRC20» (₮40 000 в колонке USDT, ≈ $40 000) и «1316 Hot · USDT TRC20 · Mark Antalya» (₮60 000, ≈ $60 000) → разворот листа → его проводки за всё время.",
```

- [ ] **Step 3: Sanity — файл синтаксически валиден**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add src/pages/info/content.js
git commit -m "docs(info): обновить Справку под pivot-вид вкладки Активы

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Финальный прогон + push

**Files:** none.

- [ ] **Step 1: Полный test-suite**

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: PASS. Никаких warnings про import.

- [ ] **Step 3: Проверить dev-сервер вручную в браузере**

Run: `npm run dev` (если ещё не запущен).
Открыть http://localhost:5173 → Казначейство → Активы. Проверить:
- Таблица отображается, в заголовке колонки валют (USD первой) + ≈USD справа.
- Строки — офисы, ИТОГО внизу.
- Клик по строке-офису раскрывает листья-счета, native-баланс в своей колонке-валюте.
- Клик по заголовку колонки сортирует строки (стрелочка ▼/▲ появляется).
- Кнопка «Ненулевые» скрывает офисы/колонки с 0.
- Кнопка CSV скачивает файл с pivot-форматом.
- Балансовое тождество внизу страницы — не сломалось.

Если что-то выглядит криво — починить и пересобрать ДО push'а.

- [ ] **Step 4: ОДИН финальный push (все 5 коммитов сразу)**

```bash
git push
```

Это запустит **один** Vercel-деплой вместо пяти.

---

## Self-review notes (для исполнителя)

- Спека покрывается полностью: селектор (Task 1), i18n (Task 2), UI + sort + expand + CSV (Task 3+4), удаление старого селектора (Task 5), info-страница (Task 6), верификация (Task 7).
- Если в Task 4 какой-то тест падает по неожиданной причине (например `getByText("$12,150")` не находит — формат отличается) — поправь тестовый ассерт по факту, а не реализацию. Формат `formatBase` в тесте мок-фейк (`Math.round(n).toLocaleString("en-US")`), реальный formatBase из `useBaseCurrency` форматирует иначе.
- `passesOfficeFilter` — уже существующая функция в v2selectors.js, не нужно её переопределять.
- Если `useCurrencies()` мок упадёт (отсутствует) — `ChartAccountModal` через него грузит коды; мок мы кладём `["USD", "USDT", "TRY"]`, должно хватить.
- `InlineBalanceEditor` сам обращается к контексту через `useLedger()` — в тестах его может потребоваться замокать. Если падает — добавь:
  ```js
  vi.mock("../parts/InlineBalanceEditor.jsx", () => ({
    __esModule: true,
    default: ({ account }) => <span data-testid="bal">{account.balance}</span>,
  }));
  ```
  Добавлять только если без мока тесты падают на этом импорте.
