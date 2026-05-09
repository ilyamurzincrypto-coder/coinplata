# Manager cutover form — fiat-only office

**Кто заполняет:** менеджер офиса **Москва Вася** (единственный fiat-only офис
на 19.05.2026 cutover).
**Когда:** утром cutover-day (19 мая 2026, до 10:00 UTC).

---

## Office: Москва Вася  Manager: ____________________

### Cash inventory

| currency | amount       |
|----------|--------------|
| USD      |              |
| EUR      |              |
| TRY      |              |
| RUB      |              |

Если остаток 0 — оставь пустым. Не пиши "0".

### Crypto: НЕТ

У Москва Вася нет собственных USDT-wallet'ов. **Не заполняй** crypto секции.
Если ошибочно укажешь Москва Вася в crypto — RPC `create_opening_from_inventory`
упадёт с явной ошибкой *"Office Москва Вася has no crypto accounts"* (это
встроенная защита — не пугайся, просто убери crypto entry).

### Submitted at: __________ UTC
