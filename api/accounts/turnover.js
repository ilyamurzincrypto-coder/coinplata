/**
 * Сальдовая ведомость ОН-ЧЕЙН за период по выбранным крипто-счетам.
 * POST { accountIds:[], from:"YYYY-MM-DD", to:"YYYY-MM-DD" } — requireStaff.
 *
 * Источник — AEGIS getTransactions (полный список; он консистентен с балансом,
 * в отличие от getStats-агрегата, который на активных кошельках отстаёт). AEGIS
 * с ключами → без публичных лимитов. Всё считаем из полного списка движений:
 *   Сальдо нач(from) = чистый поток ДО from  (fullNet − netSinceFrom)
 *   Обороты         = Σ движений в [from,to]
 *   Сальдо кон(to)  = Сальдо нач + вход − выход
 * Сверка: полный чистый поток (fullNet) должен = текущему балансу. Не сошлось /
 * усечено / degraded → строка помечается, цифры не выдаются за правду.
 *
 * ENV: SUPABASE_*, AEGIS_API_URL/KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis } from '../../src/lib/aegisClient.js'

export const config = { maxDuration: 60 }
const MAX_PAGES = 60 // до ~1500 движений; больше — помечаем «история длинная»

function dayMs(d, endOfDay = false) {
  return new Date(`${d}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`).getTime()
}

// Полный список движений кошелька через AEGIS getTransactions (пагинация по cursor).
// Считаем обороты периода, чистый поток с from и за всю историю.
async function walletTurnover(wid, fromMs, toMs) {
  let cursor = null, pages = 0, truncated = false, ok = true, degraded = false
  let inPeriod = 0, outPeriod = 0, cnt = 0, netSinceFrom = 0, fullNet = 0
  do {
    let r
    try {
      r = await aegis.getTransactions(wid, cursor ? { cursor } : {})
    } catch {
      ok = false
      break
    }
    if (!r || r.available === false) { degraded = true; break } // сеть/кошелёк без движений в фиде
    for (const t of r.items || []) {
      const amt = t.amount ? Number(t.amount.amount) / 10 ** (t.amount.decimals ?? 6) : 0
      if (!Number.isFinite(amt)) continue
      const ts = t.ts ? new Date(t.ts).getTime() : 0
      const signed = t.direction === 'in' ? amt : -amt
      fullNet += signed
      if (ts >= fromMs) netSinceFrom += signed
      if (ts >= fromMs && ts <= toMs) {
        if (t.direction === 'in') inPeriod += amt; else outPeriod += amt
        cnt += 1
      }
    }
    cursor = r.hasMore ? r.cursor : null
    pages += 1
    if (pages >= MAX_PAGES && cursor) { truncated = true; break }
  } while (cursor)
  return { inPeriod, outPeriod, cnt, netSinceFrom, fullNet, truncated, ok, degraded }
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
    .select('id, name, network_id, aegis_wallet_id, balance_usd_est')
    .in('id', ids)
    .eq('kind', 'crypto')
  if (error) return res.status(500).json({ error: 'accounts read failed' })

  const rows = await Promise.all(
    (accs || []).map(async (a) => {
      const base = { id: a.id, name: a.name, network: a.network_id }
      if (!a.aegis_wallet_id) {
        return { ...base, opening: null, turnoverIn: null, turnoverOut: null, closing: null, count: null, reconciled: false, note: 'нет мониторинга AEGIS' }
      }
      try {
        const bal = Number(a.balance_usd_est) || 0
        const t = await walletTurnover(a.aegis_wallet_id, fromMs, toMs)
        if (!t.ok || t.degraded) {
          return { ...base, opening: null, turnoverIn: null, turnoverOut: null, closing: bal, count: null, reconciled: false, note: t.degraded ? 'движения недоступны (сеть degraded)' : 'источник недоступен — обнови' }
        }
        // Всё из полного списка: сальдо нач = поток ДО from, сальдо кон = нач + обороты.
        const opening = t.fullNet - t.netSinceFrom
        const closing = opening + (t.inPeriod - t.outPeriod)
        // Сверка: полный поток списка должен = балансу (список полон и свеж).
        const reconciled = !t.truncated && Math.abs(t.fullNet - bal) < 1 && opening >= -1 && closing >= -1
        const note = t.truncated
          ? 'история длинная — не проверено полностью'
          : !reconciled
          ? 'данные не сошлись с балансом — обнови'
          : null
        return { ...base, opening, turnoverIn: t.inPeriod, turnoverOut: t.outPeriod, closing, count: t.cnt, reconciled, note }
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
