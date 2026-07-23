/**
 * Оборотно-сальдовая ведомость ОН-ЧЕЙН за период по выбранным крипто-счетам.
 * POST { accountIds:[], from:"YYYY-MM-DD", to:"YYYY-MM-DD" } — requireStaff.
 *
 * Источник (гибрид):
 *  - TRON (TRC20): напрямую из блокчейна (TronGrid) — полная и точная история.
 *  - EVM (ERC20/BEP20): AEGIS getStats(period) + getWallet balance (best-effort).
 *
 * Модель: Сальдо кон = Сальдо нач + Обороты_вход − Обороты_выход.
 *   Сальдо нач(from) = текущий_баланс − чистый_поток[from..now]
 *   Сальдо кон(to)   = Сальдо нач + (вход − выход)[from..to]
 * Возвращает по счёту: opening, turnoverIn, turnoverOut, closing, count, source, note.
 *
 * ENV: SUPABASE_*, AEGIS_API_URL/KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis } from '../../src/lib/aegisClient.js'

export const config = { maxDuration: 60 }

const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

function dayMs(d, endOfDay = false) {
  const t = new Date(`${d}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return t.getTime()
}

// TRON: тянем ПОЛНУЮ историю USDT (с 2019 — до неё USDT-TRON не было), считаем:
//  - inPeriod/outPeriod — обороты за [from,to];
//  - netSinceFrom — чистый поток с from по now (для сальдо начального);
//  - fullNet — чистый поток за всю историю (должен = текущему балансу → сверка).
// Полная история нужна именно для сверки: если Σнет ≠ баланс, данные не сошлись
// (лаг индексации TronGrid или усечение) — тогда сальдо ведомости недостоверно.
const USDT_HISTORY_START = Date.UTC(2019, 0, 1)
async function tronTurnover(address, fromMs, toMs) {
  const start = Math.min(fromMs, USDT_HISTORY_START)
  const mk = (fp) => `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?min_timestamp=${start}&limit=200&only_confirmed=true&contract_address=${USDT_TRC20}${fp ? `&fingerprint=${fp}` : ''}`
  let url = mk()
  let inPeriod = 0, outPeriod = 0, cnt = 0, netSinceFrom = 0, fullNet = 0, pages = 0, truncated = false
  while (url && pages < 25) {
    let j
    try {
      j = await fetch(url).then((r) => r.json())
    } catch {
      truncated = true
      break
    }
    const rows = j.data || []
    for (const t of rows) {
      const dec = (t.token_info && t.token_info.decimals) || 6
      const amt = Number(t.value) / 10 ** dec
      if (!Number.isFinite(amt)) continue
      const ts = Number(t.block_timestamp)
      const isIn = t.to === address
      const signed = isIn ? amt : -amt
      fullNet += signed
      if (ts >= fromMs) netSinceFrom += signed
      if (ts >= fromMs && ts <= toMs) {
        if (isIn) inPeriod += amt; else outPeriod += amt
        cnt += 1
      }
    }
    const fp = j.meta && j.meta.fingerprint
    url = fp && rows.length ? mk(fp) : null
    pages += 1
    if (pages >= 25 && url) truncated = true
  }
  return { inPeriod, outPeriod, cnt, netSinceFrom, fullNet, truncated }
}

// Текущий он-чейн баланс USDT из TronGrid.
async function tronBalance(address) {
  try {
    const j = await fetch(`https://api.trongrid.io/v1/accounts/${address}`).then((r) => r.json())
    const a = (j.data && j.data[0]) || {}
    const t = (a.trc20 || []).find((o) => o[USDT_TRC20] !== undefined)
    return t ? Number(t[USDT_TRC20]) / 1e6 : 0
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'backend not configured' })
  try {
    await requireStaff(req, { supaUrl, anon, svcKey })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {}
  const ids = Array.isArray(body.accountIds) ? body.accountIds.map(String) : []
  const from = String(body.from || '').slice(0, 10)
  const to = String(body.to || '').slice(0, 10)
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'accountIds, from, to required' })
  }
  const fromMs = dayMs(from), toMs = dayMs(to, true)

  const db = createClient(supaUrl, svcKey, { auth: { persistSession: false } })
  const { data: accs, error } = await db
    .from('accounts')
    .select('id, name, address, network_id, aegis_wallet_id, balance_usd_est')
    .in('id', ids)
    .eq('kind', 'crypto')
  if (error) return res.status(500).json({ error: 'accounts read failed' })

  const rows = []
  for (const a of accs || []) {
    const net = a.network_id
    try {
      if (net === 'TRC20' && a.address) {
        const [t, bal] = await Promise.all([tronTurnover(a.address, fromMs, toMs), tronBalance(a.address)])
        const cur = bal != null ? bal : Number(a.balance_usd_est) || 0
        const opening = cur - t.netSinceFrom
        const closing = opening + (t.inPeriod - t.outPeriod)
        // Сверка: полная история должна сойтись с балансом (Σнет = баланс). Не сошлось
        // (лаг индексации / усечение) ИЛИ отрицательное сальдо → данные недостоверны.
        const reconciled = !t.truncated && Math.abs(t.fullNet - cur) < 1 && opening >= -1
        rows.push({
          id: a.id, name: a.name, network: net,
          opening, turnoverIn: t.inPeriod, turnoverOut: t.outPeriod, closing, count: t.cnt,
          source: 'tron', reconciled,
          note: t.truncated ? 'история длинная — не проверено полностью' : (!reconciled ? 'данные не сошлись (лаг индексации) — обновите' : null),
        })
      } else if (a.aegis_wallet_id) {
        // EVM — best-effort через AEGIS getStats(period) + getStats(from..now) для сальдо нач.
        const [sp, sAll] = await Promise.all([
          aegis.getStats(a.aegis_wallet_id, from, to).catch(() => ({ available: false })),
          aegis.getStats(a.aegis_wallet_id, from, isoToday()).catch(() => ({ available: false })),
        ])
        const cur = Number(a.balance_usd_est) || 0
        if (!sp.available) {
          rows.push({ id: a.id, name: a.name, network: net, opening: null, turnoverIn: null, turnoverOut: null, closing: cur, count: null, source: 'aegis', note: 'EVM: обороты недоступны (degraded)' })
        } else {
          const inP = Number(sp.in?.sumUsd) || 0, outP = Number(sp.out?.sumUsd) || 0
          const netAll = sAll.available ? (Number(sAll.in?.sumUsd) || 0) - (Number(sAll.out?.sumUsd) || 0) : (inP - outP)
          const opening = cur - netAll
          rows.push({ id: a.id, name: a.name, network: net, opening, turnoverIn: inP, turnoverOut: outP, closing: opening + (inP - outP), count: (sp.in?.count || 0) + (sp.out?.count || 0), source: 'aegis', note: 'EVM: по данным AEGIS' })
        }
      } else {
        rows.push({ id: a.id, name: a.name, network: net, opening: null, turnoverIn: null, turnoverOut: null, closing: Number(a.balance_usd_est) || 0, count: null, source: 'none', note: 'нет источника' })
      }
    } catch (e) {
      rows.push({ id: a.id, name: a.name, network: net, opening: null, turnoverIn: null, turnoverOut: null, closing: null, count: null, source: 'error', note: String(e?.message || e).slice(0, 80) })
    }
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ from, to, generatedAt: new Date().toISOString(), rows })
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function safeJson(s) {
  try { return JSON.parse(s) } catch { return {} }
}
