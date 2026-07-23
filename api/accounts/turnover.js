/**
 * Сальдовая ведомость ОН-ЧЕЙН за период по выбранным крипто-счетам.
 * POST { accountIds:[], from:"YYYY-MM-DD", to:"YYYY-MM-DD" } — requireStaff.
 *
 * Источник — AEGIS (у него TronGrid/индексеры с ключами, без публичных лимитов).
 * P1 полнота закрыта → getStats консистентен с getTransactions и балансом.
 *
 * Модель (классическая оборотка):
 *   Сальдо нач(from)  = чистый поток ДО from (= баланс на начало периода)
 *   Обороты           = getStats(from..to).in / .out
 *   Сальдо кон(to)    = Сальдо нач + Обороты_вход − Обороты_выход
 * Сверка: полная история (Σвход−Σвыход за всё время) должна = текущему балансу.
 * Не сошлось (недоиндекс/degraded) → строка помечается, цифры не выдаются за правду.
 *
 * ENV: SUPABASE_*, AEGIS_API_URL/KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis } from '../../src/lib/aegisClient.js'

export const config = { maxDuration: 60 }

const HISTORY_START = '2019-01-01' // до этого USDT-TRON/массовой активности не было

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoMinusDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
const netOf = (s) => (s && s.available ? (Number(s.in?.sumUsd) || 0) - (Number(s.out?.sumUsd) || 0) : null)

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
  const today = isoToday()
  const beforeFrom = isoMinusDay(from)

  const db = createClient(supaUrl, svcKey, { auth: { persistSession: false } })
  const { data: accs, error } = await db
    .from('accounts')
    .select('id, name, address, network_id, aegis_wallet_id, balance_usd_est')
    .in('id', ids)
    .eq('kind', 'crypto')
  if (error) return res.status(500).json({ error: 'accounts read failed' })

  const rows = await Promise.all(
    (accs || []).map(async (a) => {
      const net = a.network_id
      const base = { id: a.id, name: a.name, network: net }
      if (!a.aegis_wallet_id) {
        return { ...base, opening: null, turnoverIn: null, turnoverOut: null, closing: null, count: null, reconciled: false, note: 'нет мониторинга AEGIS' }
      }
      try {
        const wid = a.aegis_wallet_id
        const bal = Number(a.balance_usd_est) || 0
        // Обороты периода, сальдо нач (всё ДО from), полная история (для сверки).
        const [sPeriod, sOpen, sAll] = await Promise.all([
          aegis.getStats(wid, from, to).catch(() => ({ available: false })),
          aegis.getStats(wid, HISTORY_START, beforeFrom).catch(() => ({ available: false })),
          aegis.getStats(wid, HISTORY_START, today).catch(() => ({ available: false })),
        ])
        if (!sPeriod.available || !sAll.available) {
          return { ...base, opening: null, turnoverIn: null, turnoverOut: null, closing: bal, count: null, reconciled: false, note: 'обороты недоступны (degraded)' }
        }
        const inP = Number(sPeriod.in?.sumUsd) || 0
        const outP = Number(sPeriod.out?.sumUsd) || 0
        const opening = netOf(sOpen) ?? 0 // сальдо на начало периода (баланс до from)
        const closing = opening + (inP - outP)
        const fullNet = netOf(sAll)
        // Сверка: полная история должна сойтись с балансом; сальдо не отрицательное.
        const reconciled = fullNet != null && Math.abs(fullNet - bal) < 1 && opening >= -1 && closing >= -1
        return {
          ...base,
          opening, turnoverIn: inP, turnoverOut: outP, closing,
          count: (sPeriod.in?.count || 0) + (sPeriod.out?.count || 0),
          reconciled,
          note: reconciled ? null : 'данные не сошлись с балансом (недоиндекс) — обнови',
        }
      } catch (e) {
        return { ...base, opening: null, turnoverIn: null, turnoverOut: null, closing: null, count: null, reconciled: false, note: String(e?.message || e).slice(0, 80) }
      }
    })
  )

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ from, to, generatedAt: new Date().toISOString(), rows })
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return {} }
}
