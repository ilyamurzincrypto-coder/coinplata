/**
 * Сальдовая ведомость ОН-ЧЕЙН за период по выбранным крипто-счетам.
 * POST { accountIds:[], from:"YYYY-MM-DD", to:"YYYY-MM-DD" } — requireStaff.
 *
 * Источник — AEGIS (у него TronGrid/индексеры с ключами, без публичных лимитов).
 * P1 полнота закрыта → getStats консистентен с getTransactions и балансом.
 *
 * Модель (классическая оборотка):
 *   Обороты          = getStats(from..to).in / .out
 *   Чистый с from    = getStats(from..сегодня).net  (для сальдо начального)
 *   Сальдо нач(from) = баланс − чистый_с_from
 *   Сальдо кон(to)   = Сальдо нач + вход − выход
 * Скорость: для отчёта «по сегодня» getStats(from..to) == getStats(from..сегодня)
 * → ОДИН запрос на кошелёк. Для прошлого периода — два. Широкий диапазон не тянем.
 * Сверка: сальдо не отрицательное (getStats-лаг на активных кошельках даёт минус
 * → ловится). Не сошлось/degraded → строка помечается, цифры не выдаются за правду.
 *
 * ENV: SUPABASE_*, AEGIS_API_URL/KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis } from '../../src/lib/aegisClient.js'

export const config = { maxDuration: 60 }

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
const netOf = (s) => (s && s.available ? (Number(s.in?.sumUsd) || 0) - (Number(s.out?.sumUsd) || 0) : null)
// Мягкий таймаут на getStats, чтобы один холодный кошелёк не тянул весь отчёт.
function withTimeout(p, ms) {
  return Promise.race([Promise.resolve(p).catch(() => ({ available: false })), new Promise((r) => setTimeout(() => r({ available: false }), ms))])
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
  const today = isoToday()
  const toIsToday = to >= today

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
        // sPeriod — обороты за [from,to]. sSince — чистый поток с from по сегодня (для
        // сальдо начального). Если to==сегодня, это ОДИН и тот же запрос → не дублируем.
        const sPeriod = await withTimeout(aegis.getStats(wid, from, to), 15000)
        const sSince = toIsToday ? sPeriod : await withTimeout(aegis.getStats(wid, from, today), 15000)
        if (!sPeriod.available || !sSince.available) {
          return { ...base, opening: null, turnoverIn: null, turnoverOut: null, closing: bal, count: null, reconciled: false, note: 'обороты недоступны (degraded/таймаут) — обнови' }
        }
        const inP = Number(sPeriod.in?.sumUsd) || 0
        const outP = Number(sPeriod.out?.sumUsd) || 0
        const netSince = netOf(sSince) ?? 0
        const opening = bal - netSince // сальдо на начало периода (баланс − поток после from)
        const closing = opening + (inP - outP)
        // Сверка: сальдо не отрицательное. getStats-лаг на активном кошельке завышает
        // netSince → opening уходит в минус → ловим и помечаем, а не выдаём за правду.
        const reconciled = opening >= -1 && closing >= -1
        return {
          ...base,
          opening, turnoverIn: inP, turnoverOut: outP, closing,
          count: (sPeriod.in?.count || 0) + (sPeriod.out?.count || 0),
          reconciled,
          note: reconciled ? null : 'данные не сошлись с балансом (лаг индексации) — обнови',
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
