/**
 * Быстрый детект движений по TRC20-кошелькам — НАПРЯМУЮ из TronGrid, минуя
 * индексинг-лаг AEGIS (часы). Крон раз в минуту (Vercel-минимум) → внутри
 * свипаем все watched-кошельки каждые ~8 сек ~55 сек → латентность ≤~15 сек.
 *
 * Инварианты (спека владельца):
 *  1. Частый детект (свип ~8с), а не редкий батч.
 *  2. Курсор на новизну (block_timestamp), персистится в accounts.last_alert_tx_ts —
 *     при рестарте историю НЕ реплеим. + окно-кап 20 мин: даже если курсор старый,
 *     смотрим максимум на 20 мин назад (ночью не зальём менеджеров старыми проводками).
 *  3. Шлём СРАЗУ при обнаружении, не копим в батч.
 *  4. Анти-дубль: таблица wallet_move_alerts (tx_hash+direction+counterparty+amount на счёт).
 *
 * ENV: TRONGRID_API_KEY (можно ключ AEGIS — иначе публичные лимиты), SUPABASE_*,
 *      CRON_SECRET, COINPOINT_API_URL + CASHDESK_API_SECRET (или TELEGRAM_* fallback).
 * Гейт CRON_SECRET (Vercel шлёт Bearer при выставленном CRON_SECRET).
 */
import { svcClient, notifyManagerBot, formatMoveAlert, cachedRiskScore } from './_common.js'
import { aegis } from '../../src/lib/aegisClient.js'

export const config = { maxDuration: 60 }

const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const REPLAY_CAP_MS = 20 * 60 * 1000 // не смотреть глубже 20 мин назад (анти-флуд старьём)
const SWEEP_INTERVAL_MS = 8000
const RUN_BUDGET_MS = 55000
const POOL = 8

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// TronGrid trc20-строка + кошелёк → нормализованное движение (чистое, тестируемое).
// direction/counterparty от точки зрения нашего кошелька; txObj — вход для formatMoveAlert.
export function tronRowToMove(wallet, row) {
  const bt = Number(row.block_timestamp)
  const isIn = row.to === wallet.address
  const direction = isIn ? 'in' : 'out'
  const counterparty = (isIn ? row.from : row.to) || ''
  const value = String(row.value ?? '')
  const decimals = row.token_info?.decimals ?? 6
  return {
    bt, direction, counterparty, value,
    txObj: { direction, counterparty, txHash: row.transaction_id, amount: { amount: value, decimals }, ts: new Date(bt).toISOString() },
  }
}

async function tronGridTrc20(address, minTs, key) {
  const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20` +
    `?min_timestamp=${minTs}&limit=50&only_confirmed=true&contract_address=${USDT_TRC20}&order_by=block_timestamp,asc`
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(url, { headers: key ? { 'TRON-PRO-API-KEY': key } : {}, signal: ctrl.signal })
    if (!r.ok) return null
    const j = await r.json()
    return Array.isArray(j.data) ? j.data : []
  } catch {
    return null
  } finally {
    clearTimeout(to)
  }
}

// Один свип одного кошелька: найти новые переводы, отправить, продвинуть курсор.
// cursors — Map<accountId, block_timestamp(ms)>, обновляется на месте.
async function sweepWallet(db, w, cursors, key, ownAddrs) {
  const cursorMs = cursors.get(w.id)
  // окно-кап: не смотрим глубже 20 мин, чем бы ни был курсор
  const minTs = Math.max(cursorMs, Date.now() - REPLAY_CAP_MS)
  const rows = await tronGridTrc20(w.address, minTs, key)
  if (!rows || !rows.length) return 0
  const fresh = rows
    .filter((t) => Number(t.block_timestamp) > cursorMs)
    .sort((a, b) => Number(a.block_timestamp) - Number(b.block_timestamp))
  if (!fresh.length) return 0
  let sent = 0
  let newCursor = cursorMs
  for (const t of fresh) {
    const m = tronRowToMove(w, t)
    // Дедуп (tx_hash,direction,counterparty,amount_minor) — общий с webhook. Пишем и
    // display-поля, чтобы TRON-платежи попадали в ленту «Поступления» (USDT ≈ USD).
    const dec = m.txObj.amount.decimals ?? 6
    const { error: dupErr } = await db.from('wallet_move_alerts').insert({
      account_id: w.id,
      address: w.address,
      network: w.network_id,
      tx_hash: t.transaction_id,
      direction: m.direction,
      counterparty: m.counterparty,
      amount_minor: m.value,
      decimals: dec,
      usd_est: Number(m.value) / 10 ** dec,
      is_incoming: m.direction === 'in',
      ts: new Date(m.bt).toISOString(),
      source: 'tx-watch',
    })
    if (dupErr) {
      // 23505 = уже слали → просто двигаем курсор; прочее — пропускаем (перешлём позже)
      if (dupErr.code === '23505' && m.bt > newCursor) newCursor = m.bt
      continue
    }
    // Риск-% контрагента (у TronGrid скора нет — тянем /v1/risk, кэш 10 мин). Только внешний.
    if (m.counterparty && !(ownAddrs && ownAddrs.has(m.counterparty))) {
      m.txObj.counterpartyRisk = await cachedRiskScore(aegis, w.network_id, m.counterparty)
    }
    try { await notifyManagerBot(formatMoveAlert(w, m.txObj)); sent++ } catch { /* не валим свип */ }
    if (m.bt > newCursor) newCursor = m.bt
  }
  if (newCursor > cursorMs) {
    cursors.set(w.id, newCursor)
    await db.from('accounts').update({ last_alert_tx_ts: new Date(newCursor).toISOString() }).eq('id', w.id)
  }
  return sent
}

async function runPool(items, fn) {
  let i = 0
  const worker = async () => { while (i < items.length) { const n = i++; await fn(items[n]) } }
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, worker))
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })
  const key = process.env.TRONGRID_API_KEY || null

  const { data: accts, error } = await db
    .from('accounts')
    .select('id, name, network_id, address, last_alert_tx_ts, risk_score, risk_level')
    .eq('active', true)
    .eq('kind', 'crypto')
    .eq('network_id', 'TRC20')
    .not('address', 'is', null)
  if (error) return res.status(500).json({ error: 'account list failed' })
  const wallets = accts || []
  if (!wallets.length) return res.status(200).json({ ok: true, wallets: 0 })

  // курсоры в память; новый кошелёк (метка null) — baseline=сейчас БЕЗ реплея истории
  const cursors = new Map()
  const baselineNow = []
  for (const w of wallets) {
    if (w.last_alert_tx_ts) cursors.set(w.id, new Date(w.last_alert_tx_ts).getTime())
    else { cursors.set(w.id, Date.now()); baselineNow.push(w.id) }
  }
  if (baselineNow.length) {
    await db.from('accounts').update({ last_alert_tx_ts: new Date().toISOString() }).in('id', baselineNow)
  }

  // разовый пруним старого дедупа (не растим таблицу)
  // Лента поступлений — держим дольше (90д), а не 3д: это витрина, не только анти-дубль.
  try { await db.from('wallet_move_alerts').delete().lt('created_at', new Date(Date.now() - 90 * 864e5).toISOString()) } catch { /* некритично */ }

  // Множество наших TRON-адресов — чтобы не показывать риск-% для своих же переводов.
  const ownAddrs = new Set(wallets.map((x) => x.address).filter(Boolean))

  const start = Date.now()
  let totalSent = 0
  let sweeps = 0
  while (Date.now() - start < RUN_BUDGET_MS) {
    const t0 = Date.now()
    await runPool(wallets, async (w) => { try { totalSent += await sweepWallet(db, w, cursors, key, ownAddrs) } catch { /* один кош не валит */ } })
    sweeps++
    const rest = SWEEP_INTERVAL_MS - (Date.now() - t0)
    if (Date.now() - start + Math.max(0, rest) >= RUN_BUDGET_MS) break
    if (rest > 0) await sleep(rest)
  }
  return res.status(200).json({ ok: true, wallets: wallets.length, sweeps, alertsSent: totalSent, keyed: !!key })
}
