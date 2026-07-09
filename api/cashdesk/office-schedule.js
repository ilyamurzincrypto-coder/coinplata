/**
 * Касса → CoinPoint: пуш постоянного недельного расписания офиса сайта.
 * Body: { code, working_hours: { sun..sat: {open,close}|null }, is_active? }.
 *
 * РУБИЛЬНИК: пока CASHDESK_SYNC_TO_SITE !== 'on' — dry-run (сайт не трогаем).
 * Только owner/admin. ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_*.
 */
import { requireStaff } from './_auth.js'

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
  if (!code) return res.status(400).json({ error: 'code required' })
  if (!body.working_hours || typeof body.working_hours !== 'object') {
    return res.status(400).json({ error: 'working_hours required' })
  }

  const forward = { code, working_hours: body.working_hours }
  if (typeof body.is_active === 'boolean') forward.is_active = body.is_active

  const syncEnabled = process.env.CASHDESK_SYNC_TO_SITE === 'on'
  if (!syncEnabled) {
    return res.status(200).json({ dryRun: true, syncEnabled: false, would: forward })
  }

  try {
    const r = await fetch(`${base}/api/internal/cashdesk/office-schedule`, {
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
