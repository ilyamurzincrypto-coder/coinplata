# ТЗ: алерт движения — чистый verdict-блок для НАШЕГО кошелька и контрагента

## ЦЕЛЬ (в одном предложении)
В алерте движения (`formatMoveAlert`) **и наш кошелёк, и контрагент** показывают чистый verdict-блок
(шапка `emoji/уровень/скор` + 15-строчная таблица «⚠️ Риск по категориям» с барами и `⬆️ уходит N%`),
а НЕ старый плоский `riskBlock` («❔ нет данных» / «• Категория — 0%» стеной).

## КОРЕНЬ (почему сейчас уёбищно)
`formatMoveAlert` рендерит `riskBlock(ownRisk, …, isOwn=true)` и `riskBlock(risk, …)`. `riskBlock` вызывает
новый `renderVerdict` **только если `risk.verdict` присутствует** (`_common.js:151`). В алерте `verdict`
отсутствовал, потому что источники риска отдавали его не всегда. **Сторона AEGIS уже исправлена:**
`POST /v1/risk` (та, что зовёт `aegisClient.screenRisk` → `cachedRiskScore`) **теперь ВСЕГДА возвращает
`verdict`** — и на `full`, и на `preliminary`, и для наших кошельков. Значит касса должна:
(1) брать риск с verdict через `cachedRiskScore`, (2) рендерить `verdict` и для `isOwn`.

## ФАЙЛЫ В СКОУПЕ
- `api/aegis/_common.js` — `renderVerdict` (показать таблицу и для `isOwn`), `formatMoveAlert`
  (обогатить own + контрагента verdict'ом через `cachedRiskScore`).
- `src/lib/aegisClient.js` — только если `normalizeVerdict` не мапит новое поле `preliminary` (добавить).
- Вызывающий `formatMoveAlert` (webhook / tx-watch) — если он кладёт `tx.ownRisk`/`tx.counterpartyRisk`
  без verdict, дать `formatMoveAlert` дозапросить через `cachedRiskScore`.

## ПРАВКИ

### 1. `renderVerdict` — таблица категорий и для НАШЕГО кошелька
Сейчас блок «⚠️ Риск по категориям» и `reasons` под `if (!isOwn)`. Вынести **таблицу** из-под этого гейта:
- `isOwn === true`  → шапка + **таблица risk_by_category** + `clean_note`. БЕЗ `action` и БЕЗ `reasons`
  (решение «отказ/принять» и причины — про контрагента, к своему кошельку не применяются).
- `isOwn === false` → как сейчас: шапка + `action` + `reasons` + таблица + `clean_note`.

```js
// внутри renderVerdict, detail-сборка:
if (!isOwn && Array.isArray(v.reasons) && v.reasons.length) {
  detail.push('Почему:'); for (const r of v.reasons) detail.push(escapeHtmlA(r));
}
// таблица — ВСЕГДА (и own, и контрагент), формат НЕ меняем:
const rbc = Array.isArray(riskByCategory) && riskByCategory.length ? riskByCategory : null;
if (rbc) {
  detail.push('⚠️ Риск по категориям:');
  for (const c of rbc) {
    const out = c.outPct != null && Number(c.outPct) > 0 ? `   ⬆️ уходит ${c.outPct}%` : '';
    detail.push(`  ${c.emoji || ''} ${escapeHtmlA(c.label || '')} ${c.bar || ''} ${c.pct != null ? c.pct : 0}%${out}`);
  }
}
```

### 2. Бейдж «предв.» при `verdict.preliminary`
`verdict.preliminary === true` (экспозиция ещё трассируется) → в шапку добавить `(предв.)`, `clean_note`
уже придёт честной строкой «⏳ Экспозиция ещё трассируется…». Таблица всё равно 15 строк (0%).

```js
const prelim = v.preliminary ? ' (предв.)' : '';
lines[0] = `${emoji} <b>${escapeHtmlA(title)}:</b> ${escapeHtmlA(v.levelText || '')} — ${score}${prelim}`;
```

### 3. `formatMoveAlert` — и own, и контрагент берут verdict-несущий риск
`/v1/risk` теперь всегда отдаёт verdict, а `cachedRiskScore` уже мапит `verdict`+`riskByCategory`
(`_common.js:238-239`, TTL 10 мин — дёшево на алерт). Обеспечить, чтобы в `riskBlock` попал риск с verdict:
- **наш кошелёк:** если `ownRisk?.verdict` отсутствует → `ownRisk = await cachedRiskScore(aegisClient, account.network_id, account.address)`.
- **контрагент:** если `risk?.verdict` отсутствует → `risk = await cachedRiskScore(aegisClient, account.network_id, cp)`.
- (`formatMoveAlert` станет async, либо обогащать в вызывающем перед вызовом — на усмотрение.)

### 4. Старый плоский `riskBlock` — только как фолбэк
Плоский чек-лист (`• Категория — %` / «❔ нет данных») оставить ТОЛЬКО когда verdict реально `null`
(сеть/таймаут AEGIS). При наличии verdict — всегда `renderVerdict`.

## ИСТОЧНИК ИСТИНЫ (контракт verdict, репо AEGIS `apps/api/src/v1/verdict.ts`)
```
verdict: {
  emoji, level_text, score, action, reasons: string[],
  sources: RiskSlice[],                       // безобидный пирог источника (типы)
  risk_by_category: RiskSlice[],              // ВСЕГДА 15, фикс. порядок severity↓
  checked_clean: string[],                    // полностью чистые (in=0,out=0)
  clean_note?: string,                        // «✅ Чисто по всем…» ИЛИ «⏳ ещё трассируется» (preliminary)
  preliminary?: boolean                       // true → бейдж «(предв.)»
}
RiskSlice: { emoji, label, pct, bar, out_pct?, out_bar? }   // pct/out_pct дробные — печатать как есть
```
Нормализаторы уже есть: `normalizeVerdict`, `normalizeRiskByCategory` (проверить, что мапят `preliminary`).

## НЕ ТРОГАТЬ
- Формат таблицы категорий (уже согласован байт-в-байт): заголовок `⚠️ Риск по категориям:`,
  отступ **2 пробела** на строку, **3 пробела** перед `⬆️ уходит N%`, `pct`/`out_pct` — как есть.
- Инварианты денег/курсов (CLAUDE.md). Логику определения own/counterparty.

## КРИТЕРИЙ ГОТОВО
1. `npm test` — зелёный (+ тест: own-вердикт рендерит таблицу без action/reasons; preliminary → бейдж «(предв.)»).
2. `npm run build` — проходит.
3. **Скрин алерта движения**, где И наш кошелёк, И контрагент показывают таблицу 15 категорий с барами
   (не «❔ нет данных» и не «• Категория — 0%»).
