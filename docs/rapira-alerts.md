# Rapira: авто-курс + алерты волатильности → @coinpoint_manager_bot

Касса тянет публичный market-data Rapira, строит авто-курс `Rapira mid ± спред` и
шлёт алерты волатильности в менеджерский бот **через coinpoint-мост** (токен бота
в кассе не хранится).

## Поток (сторона кассы — уже задеплоено)

- **Cron** `api/rapira/sync.js` (`vercel.json`, каждые 2 мин):
  1. `GET https://api.rapira.net/open/market/rates` (публично, без ключа).
  2. Пишет `USDT↔фиат` в `public.external_rates(source='rapira', pair='USDT_RUB', bid/ask/mid, raw)`.
  3. Волатильность от референса (`public.rapira_alert_state`): если `|Δmid|` от точки
     последнего алерта ≥ `RAPIRA_VOL_PCT` (дефолт 1.5%) → алерт + reset референса
     (антиспам без таймера).
  4. Алерт → `notifyBot()`.
- Защита cron: `CRON_SECRET` (Vercel шлёт `Authorization: Bearer <CRON_SECRET>`).
- Запись в БД: `SUPABASE_SERVICE_ROLE_KEY`.

## Контракт алерта: касса → coinpoint

`notifyBot()` делает (приоритетно):

```
POST ${COINPOINT_API_URL}/api/internal/cashdesk/alert
Headers: x-cashdesk-secret: <CASHDESK_API_SECRET>, content-type: application/json
Body: {
  "kind": "rate_volatility",
  "text": "⚠️ <b>USDT/RUB</b> ▲ +1.8%\nРынок Rapira: 81.04 → 82.5\nВозможно нужно расширить спред.",
  "pair": "USDT_RUB",
  "chg_pct": 1.8,
  "from": 81.04,
  "to": 82.5
}
```

**Что должен сделать coinpoint** (эндпоинт `/api/internal/cashdesk/alert`):
- Проверить `x-cashdesk-secret` (как остальные internal).
- Отправить готовый `text` (уже HTML) в чат менеджеров через `@coinpoint_manager_bot`
  (`sendMessage`, `parse_mode:'HTML'`). Chat_id менеджерской группы — на стороне coinpoint.
- Вернуть 2xx при успехе (иначе касса упадёт на fallback / посчитает не доставленным).

Fallback (если мост недоступен): прямой Telegram по `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_ALERT_CHAT_ID` (опционально; при переходе на coinpoint-бот не нужен).

## ENV кассы (Vercel Production)

| ENV | Зачем |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | cron пишет external_rates / читает alert_state |
| `COINPOINT_API_URL`, `CASHDESK_API_SECRET` | форвард алерта в coinpoint (уже есть для моста заявок) |
| `CRON_SECRET` | защита cron-эндпоинтов |
| `RAPIRA_VOL_PCT` (опц.) | порог алерта, дефолт `1.5` |
| `RAPIRA_URL`, `RAPIRA_FIATS` (опц.) | переопределить источник/список фиатов |

## Проверка пайпа

После деплоя coinpoint-эндпоинта и настройки env:

```
GET/POST https://coinplata.vercel.app/api/rapira/sync?test=1
Authorization: Bearer <CRON_SECRET>   # если CRON_SECRET задан
→ { "test": true, "notified": true }   # и сообщение в @coinpoint_manager_bot
```

`?test=1` шлёт фиктивный алерт (USDT/RUB +1.8%) без ожидания реальной волатильности.

## Спреды (дефолты, эмпирика Paramon)

`src/lib/rapiraSpreads.js`: MSK ±0.95% (итог 1.9%), SPB ±1.2% (итог 2.4%),
`_default` ±1.1%. Симметрично вокруг Rapira mid.
