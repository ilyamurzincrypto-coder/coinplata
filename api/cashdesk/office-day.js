/**
 * Касса → CoinPoint: выходной / открыть КОНКРЕТНЫЙ офис сайта на дату (по offices.code).
 * Body: { code, date: 'YYYY-MM-DD', status: 'open'|'closed', reason? }.
 *
 * РУБИЛЬНИК: пока CASHDESK_SYNC_TO_SITE !== 'on' — dry-run: НЕ трогаем сайт,
 * возвращаем { dryRun:true, would:{...} }. Хозяин смотрит/проверяет, потом
 * включает синхронизацию (env → 'on' + redeploy).
 *
 * Только owner/admin. ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_*.
 */
import { requireStaff } from './_auth.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !secret || !supaUrl || !anon) return res.status(503).json({ error: 'bridge env not configured' })

  let caller
  try {
    caller = await requireStaff(req, { supaUrl, anon, svcKey: process.env.SUPABASE_SERVICE_ROLE_KEY }, { roles: ['owner', 'admin'] })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
  const code = String(body.code || '').trim()
  const date = String(body.date || '').trim()
  const status = String(body.status || '').trim().toLowerCase()
  if (!code) return res.status(400).json({ error: 'code required' })
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  if (status !== 'open' && status !== 'closed') return res.status(400).json({ error: "status must be 'open' or 'closed'" })

  const forward = { code, date, status, reason: body.reason }
  const syncEnabled = process.env.CASHDESK_SYNC_TO_SITE === 'on'
  if (!syncEnabled) {
    return res.status(200).json({ dryRun: true, syncEnabled: false, would: forward })
  }

  try {
    const r = await fetch(`${base}/api/internal/cashdesk/office-day`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
      body: JSON.stringify({ ...forward, changed_by: caller.userId }),
    })
    const text = await r.text()
    try { return res.status(r.status).json({ ...JSON.parse(text), syncEnabled: true }) }
    catch { return res.status(r.status).send(text) }
  } catch (e) {
    return res.status(502).json({ error: `site unreachable: ${e?.message || e}` })
  }
}
