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

// Гейт «не постим неготовый скор»: держим алерт, пока анализ не дозреет (прогрев снапшота ~30-90с), но не
// дольше MAX_HOLD_MS (иначе движение не потеряем — шлём как есть). < REPLAY_CAP (20мин), иначе окно-кап дропнет.
const MAX_HOLD_MS = Number(process.env.ALERT_MAX_HOLD_MS || 6 * 60 * 1000)

/** Готов ли риск-анализ к показу: свой кошелёк И внешний контрагент имеют ПОЛНЫЙ (не preliminary) вердикт.
 *  Внутренний перевод (контрагент — свой) риска не требует. cachedRiskScore.assessment: 'full'|'preliminary'. */
export function isAlertRiskReady(txObj) {
  const full = (r) => !!(r && (r.assessment === 'full' || (r.verdict && r.verdict.preliminary !== true && Number(r.score) > 0)))
  if (!full(txObj.ownRisk)) return false // свой кошелёк ещё «нет данных»/preliminary → держим
  if (txObj.counterpartyOwn) return true // внутренний перевод — контрагент свой, риск не нужен
  return full(txObj.counterpartyRisk)
}

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
async function sweepWallet(db, w, cursors, key, ownByAddr) {
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
    const dec = m.txObj.amount.decimals ?? 6
    // 🔴 СНАЧАЛА риск, ПОТОМ решаем слать: не постим НЕГОТОВЫЙ скор (preliminary/«нет данных» вводит в
    // заблуждение — напр. контрагент показывал 🟢10, а по факту 🟠68). Дешёвый /v1/risk триггерит прогрев
    // снапшота на сервере → за 1-2 свипа дозреет. Контрагент: свой (по accounts) → имя без риска; внешний → риск.
    if (m.counterparty) {
      const ownAcc = ownByAddr && ownByAddr.get(m.counterparty)
      if (ownAcc) {
        m.txObj.counterpartyOwn = true
        m.txObj.counterpartyName = ownAcc.name
      } else {
        m.txObj.counterpartyRisk = await cachedRiskScore(aegis, w.network_id, m.counterparty)
      }
    }
    m.txObj.ownRisk = await cachedRiskScore(aegis, w.network_id, w.address)
    // ГЕЙТ: анализ не готов И движение свежее (< MAX_HOLD) → ДЕРЖИМ (по порядку: не пишем/не шлём/не двигаем
    // курсор, break → вернёмся следующим свипом, прогрев дозреет). Старше MAX_HOLD → шлём как есть (fallback,
    // движение не теряем; редкий кейс не-индексируемого контрагента).
    if (!isAlertRiskReady(m.txObj) && Date.now() - m.bt < MAX_HOLD_MS) break
    // Дедуп (tx_hash,direction,counterparty,amount_minor) + display-поля для ленты «Поступления».
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

  // Карта наш-адрес→счёт: свой контрагент показываем именем (внутренний перевод), без риска.
  const ownByAddr = new Map(wallets.filter((x) => x.address).map((x) => [x.address, x]))

  const start = Date.now()
  let totalSent = 0
  let sweeps = 0
  while (Date.now() - start < RUN_BUDGET_MS) {
    const t0 = Date.now()
    await runPool(wallets, async (w) => { try { totalSent += await sweepWallet(db, w, cursors, key, ownByAddr) } catch { /* один кош не валит */ } })
    sweeps++
    const rest = SWEEP_INTERVAL_MS - (Date.now() - t0)
    if (Date.now() - start + Math.max(0, rest) >= RUN_BUDGET_MS) break
    if (rest > 0) await sleep(rest)
  }
  return res.status(200).json({ ok: true, wallets: wallets.length, sweeps, alertsSent: totalSent, keyed: !!key })
}
