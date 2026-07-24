/**
 * Приёмник вебхуков AEGIS. Read-only мониторинг: обновляет кэш риск/баланс на
 * счетах, шлёт алерты. Деньги/леджер не трогает.
 *
 * Безопасность:
 *  - raw body (bodyParser выключен) + HMAC-SHA256 подпись X-Aegis-Signature;
 *    невалидная → 401 (энфорсмент на бэке, а не «доверяем телу»).
 *  - дедуп по delivery_id (at-least-once → повторы): PK-конфликт → 200 без побочек.
 *
 * События:
 *  - risk.changed  → risk_level/risk_updated_at; переход в critical → Telegram
 *    (+ колокольчик через Realtime accounts); warning/→ok → только колокольчик.
 *  - balance.changed → balance_usd_est/synced_at.
 *
 * ENV: AEGIS_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      (+ COINPOINT_API_URL/CASHDESK_API_SECRET или TELEGRAM_* для алертов).
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { svcClient, notifyManagerBot } from './_common.js'

export const config = { api: { bodyParser: false } }

// --- HMAC (чистое, тестируемое) ---
export function verifyAegisSignature(raw, signature, secret) {
  if (!signature || !secret) return false
  const provided = String(signature).replace(/^sha256=/i, '').trim()
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  let a
  let b
  try {
    a = Buffer.from(provided, 'hex')
    b = Buffer.from(expected, 'hex')
  } catch {
    return false
  }
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

// --- план алерта по переходу prev→level (чистое, тестируемое) ---
// Telegram только при переходе В critical. Колокольчик — на любом переходе,
// но он рисуется клиентом из Realtime-UPDATE accounts (здесь не пушим).
export function alertPlan(prevLevel, level) {
  if (!level || level === prevLevel) return { transitioned: false, telegram: false, severity: null }
  if (level === 'critical') return { transitioned: true, telegram: prevLevel !== 'critical', severity: 'critical' }
  if (level === 'warning') return { transitioned: true, telegram: false, severity: 'warning' }
  if (level === 'ok') {
    const cleared = prevLevel === 'warning' || prevLevel === 'critical'
    return { transitioned: cleared, telegram: false, severity: cleared ? 'cleared' : null }
  }
  return { transitioned: true, telegram: false, severity: 'info' }
}

// --- ядро: инъекция deps (recordDelivery/updateRisk/updateBalance/notifyTelegram) ---
export async function handleAegisEvent({ raw, signature, secret, deps }) {
  if (!verifyAegisSignature(raw, signature, secret)) {
    return { status: 401, body: { error: 'bad signature' } }
  }
  let event
  try {
    event = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return { status: 400, body: { error: 'invalid json' } }
  }
  const deliveryId = event?.delivery_id
  if (!deliveryId) return { status: 400, body: { error: 'delivery_id required' } }

  // Дедуп: повтор доставки → 200 без побочек.
  const seen = await deps.recordDelivery(deliveryId, event.event)
  if (seen === 'duplicate') return { status: 200, body: { ok: true, duplicate: true } }

  const walletId = event.wallet_id
  if (!walletId) return { status: 200, body: { ok: true, ignored: 'no wallet_id' } }

  if (event.event === 'risk.changed') {
    // §4b: уровень/причины ВНУТРИ event.risk; время — event.occurred_at; prev_level сверху.
    const risk = event.risk || {}
    const level = risk.level
    const prev = event.prev_level
    const updated = await deps.updateRisk(walletId, {
      risk_level: level,
      risk_score: risk.score ?? null, // §4b: числовой скор внутри event.risk
      risk_updated_at: event.occurred_at || new Date().toISOString(),
    })
    const plan = alertPlan(prev, level)
    if (plan.telegram && deps.notifyTelegram) {
      const reasons = (risk.reasons || []).map((r) => r.message).filter(Boolean)
      await deps.notifyTelegram({
        text:
          `🚨 <b>Кошелёк ${escapeHtml(event.address || walletId)}</b> — риск CRITICAL\n` +
          (reasons.length ? reasons.map((m) => `• ${escapeHtml(m)}`).join('\n') : 'Проверьте кошелёк в AEGIS.'),
        meta: { wallet_id: walletId, address: event.address || null, level, prev_level: prev },
      })
    }
    return { status: 200, body: { ok: true, updated, severity: plan.severity } }
  }

  if (event.event === 'balance.changed') {
    // §4b: balance = {native, usdt, usd_est}; собственного времени нет → occurred_at.
    const bal = event.balance || {}
    const newUsd = bal.usd_est != null ? Number(bal.usd_est) : null
    // Старый баланс ДО апдейта — чтобы посчитать движение (дельту) и назвать кошелёк.
    const before = deps.getAccounts ? await deps.getAccounts(walletId) : []
    const updated = await deps.updateBalance(walletId, {
      balance_usd_est: bal.usd_est != null ? String(bal.usd_est) : null,
      synced_at: event.occurred_at || new Date().toISOString(),
    })
    // Алерт в менеджерский бот: поступило/ушло по нашему кошельку (порог от дуста).
    if (newUsd != null && before.length && deps.notifyMove) {
      const acc = before[0]
      const oldUsd = acc.balance_usd_est != null ? Number(acc.balance_usd_est) : null
      if (oldUsd != null && Number.isFinite(newUsd)) {
        const delta = newUsd - oldUsd
        const minUsd = Number(process.env.WALLET_MOVE_ALERT_MIN_USD || 50)
        if (Math.abs(delta) >= minUsd) {
          const inbound = delta > 0
          const money = (n) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          await deps.notifyMove({
            kind: 'wallet_move',
            text:
              `${inbound ? '💰' : '📤'} <b>${escapeHtml(acc.name || event.address || walletId)}</b>${acc.network ? ` · ${escapeHtml(acc.network)}` : ''}\n` +
              `${inbound ? 'Поступило +' : 'Списано −'}${money(delta)}\n` +
              `Баланс: ${money(newUsd)}`,
            meta: { wallet_id: walletId, account_id: acc.id, name: acc.name, direction: inbound ? 'in' : 'out', delta, balance: newUsd },
          })
        }
      }
    }
    return { status: 200, body: { ok: true, updated } }
  }

  return { status: 200, body: { ok: true, ignored: event.event } }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function readRaw(req) {
  const chunks = []
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const secret = process.env.AEGIS_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({ error: 'webhook secret not configured' })

  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })

  let raw
  try {
    raw = await readRaw(req)
  } catch {
    return res.status(400).json({ error: 'cannot read body' })
  }
  const signature = req.headers['x-aegis-signature']

  const deps = {
    async recordDelivery(deliveryId, eventType) {
      const { error } = await db.from('aegis_webhook_deliveries').insert({ delivery_id: deliveryId, event_type: eventType })
      if (error && error.code === '23505') return 'duplicate'
      if (error) throw new Error(error.message)
      return 'new'
    },
    async updateRisk(walletId, patch) {
      const { data, error } = await db.from('accounts').update(patch).eq('aegis_wallet_id', walletId).select('id')
      if (error) throw new Error(error.message)
      return (data || []).length
    },
    async updateBalance(walletId, patch) {
      const { data, error } = await db.from('accounts').update(patch).eq('aegis_wallet_id', walletId).select('id')
      if (error) throw new Error(error.message)
      return (data || []).length
    },
    // Старый баланс + имя/сеть счёта ДО апдейта (для алерта о движении).
    async getAccounts(walletId) {
      const { data } = await db.from('accounts').select('id, name, network_id, balance_usd_est').eq('aegis_wallet_id', walletId).eq('active', true)
      return (data || []).map((r) => ({ id: r.id, name: r.name, network: r.network_id, balance_usd_est: r.balance_usd_est }))
    },
    notifyTelegram: (payload) => notifyManagerBot({ kind: 'wallet_risk', ...payload }),
    notifyMove: (payload) => notifyManagerBot(payload),
  }

  try {
    const result = await handleAegisEvent({ raw, signature, secret, deps })
    return res.status(result.status).json(result.body)
  } catch (e) {
    return res.status(500).json({ error: `webhook failed: ${e?.message || e}` })
  }
}
