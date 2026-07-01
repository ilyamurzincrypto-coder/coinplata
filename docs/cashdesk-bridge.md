# Мост CoinPoint ↔ касса (серверная часть)

Реализует сторону кассы для интеграции заявок/визитов. Контракт CoinPoint:
`docs/superpowers/specs/2026-06-30-cashdesk-orders-integration-design.md` в репо
coinpoint. Все секреты — на сервере (Vercel-функции), фронт кассы их не видит.

## Что делает

- **`api/cashdesk/sync.js`** — Vercel cron (раз в минуту, `vercel.json → crons`):
  тянет `GET coinpoint /api/internal/cashdesk/orders?office=…&since=…` по каждому
  офису (ANT/IST/MSK), upsert в `public.manager_orders` по `source_order_id`
  (= coinpoint `bot_orders.id`). Курсор дельты — в `public.cashdesk_sync_state`,
  так подтягиваются и закрытые (cancelled/done) заявки. Статус мапится
  coinpoint→касса: open→`pending`, completed→`done`, cancelled/expired→`cancelled`.
- **`api/cashdesk/status.js`** — фронт зовёт при действии кассира (пришёл/провести/
  отмена/no-show) со своим Supabase-JWT; функция проверяет юзера и форвардит в
  `POST coinpoint /orders/:id/status` с секретом.
- **`api/cashdesk/availability-close.js`** — разово закрыть день офиса (гибрид-
  календарь) → форвард в `POST coinpoint /availability/close`.

Фронт читает `manager_orders` через Supabase realtime (как `deals`) — секрет и
service-role в браузер не попадают.

## Что нужно, чтобы включить

1. **Миграция** `supabase/migrations/manager_orders_2_cashdesk_bridge.sql`
   (`source_order_id` + `cashdesk_sync_state`) — накатить.
2. **Env в Vercel** (см. `.env.local.example`, блок «мост»):
   `COINPOINT_API_URL=https://coinpointr.com`, `CASHDESK_API_SECRET` (тот же, что
   в coinpoint; лежит в `~/.coinpoint_cashdesk_secret`), `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (для upsert из cron), `SUPABASE_ANON_KEY` (проверка
   JWT), опц. `CRON_SECRET`.
3. **Deploy** (Vercel подхватит `api/` как functions + cron из `vercel.json`).
4. Проверка: `curl -H "Authorization: Bearer $CRON_SECRET" https://<касса>/api/cashdesk/sync`
   → `{ ok:true, offices:{ANT:{pulled,upserts},…} }`.

## Оставшаяся работа (фронт кассы, эта сессия/UI)

Серверный поток готов — онлайн-заявки уже льются в `manager_orders`. Осталось UI
(по `docs/orders-in-ledger-compat.md`, фазы 2-3):
- Рендер «живых» строк `manager_orders` (status='pending') сверху ленты «Сделки
  за день» (`DealsLedger.jsx`), realtime-подписка на `manager_orders`.
- Кнопка «клиент пришёл» → `POST /api/cashdesk/status {order_id, status:'arrived'}`.
- «Провести» → `createDeal(...)` в кассе + `POST /api/cashdesk/status
  {order_id, status:'completed', cashdesk_deal_id, amount_fact, rate_fact}` +
  проставить `manager_orders.deal_id` (антидубль).
- Визит → инлайн-строка с подставленным контактом.
- (Опц.) резолв контрагента: `GET coinpoint /counterparty?telegram=…` через
  прокси-функцию, привязка w110 → `POST /counterparty`.

Заголовок JWT в fetch со стороны фронта:
`Authorization: 'Bearer ' + (await supabase.auth.getSession()).data.session.access_token`.
