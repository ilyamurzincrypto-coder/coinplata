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
import { svcClient, notifyManagerBot, formatMoveAlert, cachedRiskScore } from './_common.js'
import { aegis } from '../../src/lib/aegisClient.js'

export const config = { api: { bodyParser: false } }

// Сеть AEGIS → network_id кассы. EVM-адрес общий для ETH/BSC — сеть обязательна для матча.
const NET_MAP = { TRON: 'TRC20', TRC20: 'TRC20', ETHEREUM: 'ERC20', ETH: 'ERC20', ERC20: 'ERC20', BSC: 'BEP20', BNB: 'BEP20', BEP20: 'BEP20', 'BINANCE-SMART-CHAIN': 'BEP20' }
export function mapNetwork(n) {
  if (!n) return null
  return NET_MAP[String(n).toUpperCase()] || String(n).toUpperCase()
}

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
    const updated = await deps.updateBalance(walletId, {
      balance_usd_est: bal.usd_est != null ? String(bal.usd_est) : null,
      synced_at: event.occurred_at || new Date().toISOString(),
    })
    // Движения ловим отдельно (transfer.detected ниже) — по balance.changed не дублируем.
    return { status: 200, body: { ok: true, updated } }
  }

  // Входящие/исходящие платежи — ГЛАВНЫЙ источник ленты «Поступления» (все сети/офисы).
  // transaction.created — фолбэк: если transfer.detected по этому tx не пришёл, дедуп-ключ
  // (tx_hash,direction,counterparty,amount_minor) сам предотвратит дубль/второй алерт.
  if (event.event === 'transfer.detected' || event.event === 'transaction.created') {
    if (event.is_spam === true) return { status: 200, body: { ok: true, ignored: 'spam' } }
    const amount = event.amount || {}
    const netId = mapNetwork(event.network)
    // Матч по АДРЕСУ+сети (нормализованно), fallback по aegis_wallet_id. Нет счёта → account_id=null.
    const acc = await deps.findAccount({ address: event.address || null, network: netId, walletId })
    const direction = event.direction || 'in'
    const cp = event.counterparty || ''
    const amountMinor = amount.amount != null ? String(amount.amount) : ''
    const cpLabel = event.counterparty_entity?.name || event.counterparty_entity?.category || null
    const address = event.address || acc?.address || null
    const network = netId || acc?.network_id || null
    const ts = event.ts || event.block_ts || event.occurred_at || new Date().toISOString()
    const saved = await deps.recordPayment({
      account_id: acc?.id || null,
      address,
      network,
      tx_hash: event.tx_hash,
      direction,
      counterparty: cp,
      amount_minor: amountMinor,
      decimals: amount.decimals ?? null,
      usd_est: amount.usd_est != null ? Number(amount.usd_est) : null,
      counterparty_label: cpLabel,
      is_incoming: direction === 'in',
      ts,
      source: event.event,
    })
    // Контрагент: свой счёт → имя, без риска; внешний → риск (POST /v1/risk, кэш 10 мин —
    // точный assessed) с фолбэком на event.counterparty_risk. Строку риска для внешнего
    // formatMoveAlert рисует ВСЕГДА (три состояния), даже при score=0/нет данных.
    const cpAcc = cp ? await deps.findAccount({ address: cp, network: netId }) : null
    const cpIsOwn = !!cpAcc
    let counterpartyRisk = null
    if (cp && !cpIsOwn) {
      counterpartyRisk = deps.riskLookup ? await deps.riskLookup(netId, cp) : null
      if (!counterpartyRisk && event.counterparty_risk) {
        const cr = event.counterparty_risk
        counterpartyRisk = {
          score: cr.score ?? 0,
          level: cr.level ?? null,
          hop2: cr.hop2_proximity === true,
          assessed: Number(cr.score) > 0 || event.counterparty_entity != null,
          behavioralType: cr.behavioral_type ?? null,
        }
      }
    }
    // Риск НАШЕГО кошелька (acc — офисный счёт по event.address) — такой же чек-лист.
    const ownRisk = acc?.address && deps.riskLookup ? await deps.riskLookup(network, acc.address) : null
    let notified = false
    if (saved === 'new' && deps.notifyMove) {
      // Алерт — best-effort: сбой notify НЕ валит webhook (иначе 500 → ретрай дедупится
      // по delivery_id → алерт теряется навсегда). Платёж уже записан и виден в ленте.
      try {
        const r = await deps.notifyMove({
          account: { id: acc?.id || null, name: acc?.name || address || walletId, network_id: network, riskScore: acc?.risk_score ?? null, riskLevel: acc?.risk_level ?? null },
          tx: {
            direction,
            counterparty: cp,
            txHash: event.tx_hash,
            amount: { amount: amountMinor, decimals: amount.decimals ?? 6 },
            ts,
            counterpartyEntity: event.counterparty_entity || null,
            counterpartyRisk,
            counterpartyOwn: cpIsOwn,
            counterpartyName: cpAcc?.name || null,
            ownRisk,
          },
        })
        notified = r !== false // notifyManagerBot → bool «доставлено»
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[webhook] notifyMove failed:', e?.message || e)
      }
    }
    return { status: 200, body: { ok: true, saved, notified, account_id: acc?.id || null, recognized: !!acc } }
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
    notifyTelegram: (payload) => notifyManagerBot({ kind: 'wallet_risk', ...payload }),
    // Матч счёта/офиса по АДРЕСУ+сети (нормализованно, ilike), fallback по aegis_wallet_id.
    async findAccount({ address, network, walletId }) {
      if (address) {
        let q = db.from('accounts').select('id, name, address, network_id, office_id, risk_score, risk_level').ilike('address', address)
        if (network) q = q.eq('network_id', network)
        const { data } = await q.limit(1)
        if (data && data.length) return data[0]
      }
      if (walletId) {
        const { data } = await db.from('accounts').select('id, name, address, network_id, office_id, risk_score, risk_level').eq('aegis_wallet_id', walletId).limit(1)
        if (data && data.length) return data[0]
      }
      return null
    },
    // Дедуп-запись платежа в ленту (общий ключ с tx-watch). 23505 → duplicate (не двоим/не алертим).
    async recordPayment(row) {
      const { error } = await db.from('wallet_move_alerts').insert(row)
      if (error && error.code === '23505') return 'duplicate'
      if (error) throw new Error(error.message)
      return 'new'
    },
    notifyMove: ({ account, tx }) => notifyManagerBot(formatMoveAlert(account, tx)),
    // Точный риск внешнего контрагента (POST /v1/risk, кэш 10 мин) — assessed/behavioral_type.
    riskLookup: (net, addr) => cachedRiskScore(aegis, net, addr),
  }

  try {
    const result = await handleAegisEvent({ raw, signature, secret, deps })
    return res.status(result.status).json(result.body)
  } catch (e) {
    return res.status(500).json({ error: `webhook failed: ${e?.message || e}` })
  }
}
