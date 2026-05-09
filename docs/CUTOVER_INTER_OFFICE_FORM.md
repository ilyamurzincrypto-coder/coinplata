# Inter-office balances — форма для Owner

Шаблон сбора данных по interoffice долгам. Owner заполняет за 1-2 дня
до cutover, передаёт финальную версию утром cutover-day.

## 6 пар офисов

Все возможные пары между 4 офисами (`istanbul`, `mark`, `moscow`, `terra` —
short_codes по lex-order):

1. **istanbul ↔ mark**
2. **istanbul ↔ moscow**
3. **istanbul ↔ terra**
4. **mark ↔ moscow**
5. **mark ↔ terra**
6. **moscow ↔ terra**

## По каждой паре — таблица

Для каждой валюты (USD, EUR, TRY, RUB, GBP, CHF, USDT) указать **сумму** и
**направление**. Если по паре×валюте долга нет — пропустить строку
(не сеять zero entries).

### Пример заполнения

| pair | currency | amount | direction |
|---|---|---|---|
| mark_terra | USD | 3000 | mark_owes_terra |
| istanbul_mark | TRY | 50000 | mark_owes_istanbul |
| moscow_terra | RUB | 100000 | terra_owes_moscow |

Правила:
- `pair` — `<left>_<right>` где left/right в lex-порядке (см. список выше)
- `amount` всегда **положительное**, направление кодируется в `direction`
- `direction` — одно из двух валидных значений: `<left>_owes_<right>` или
  `<right>_owes_<left>`. Любая другая строка → RPC падает с 22000.

## Финальный JSON для RPC

```json
[
  {"office_pair": "mark_terra",     "currency": "USD",  "amount": 3000,   "direction": "mark_owes_terra"},
  {"office_pair": "istanbul_mark",  "currency": "TRY",  "amount": 50000,  "direction": "mark_owes_istanbul"},
  {"office_pair": "moscow_terra",   "currency": "RUB",  "amount": 100000, "direction": "terra_owes_moscow"}
]
```

## Что НЕ включать

- **Партнёрские балансы** (Шериф, Мехмет) — partners в новом ledger
  как обычные клиенты. Их балансы пишутся через Customer Liab в
  `office_cash` секции, не через inter_office.
- **Долги клиентам** — это Customer Liab (account_code 21XX) в
  `office_cash` секции с `client_id`.
- **Bank accounts / exchange / retained earnings** — out of scope для
  19.05 cutover. Q3 expansion.

## Sanity check

Перед отправкой пройдись:

- [ ] Все pairs в lex-order (`mark_terra`, не `terra_mark`)
- [ ] Все amounts положительные
- [ ] Все directions содержат `_owes_`
- [ ] Currency code uppercase (USD, не usd)
- [ ] Нет дубликатов (один pair × currency = одна строка)

## Сроки

- T-2 (17 мая, суббота) — предварительный набор для dry-run
- T-0 (19 мая утром) — финальный, перед запуском opening transaction
