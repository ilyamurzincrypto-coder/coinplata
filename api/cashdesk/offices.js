/**
 * Касса → CoinPoint: читаем ЖИВОЙ список офисов сайта (offices.code + расписание),
 * чтобы привязать кассовый офис к офису сайта (дропдаун) и видеть новые (напр. liman).
 * Read-only: любой активный сотрудник. Форвардим в coinpoint GET /internal/cashdesk/offices.
 *
 * Также возвращаем syncEnabled — включена ли ЗАПИСЬ на сайт (рубильник), чтобы
 * UI показывал «предпросмотр» пока хозяин не подтвердил.
 *
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY,
 *      CASHDESK_SYNC_TO_SITE ('on' = живая запись; иначе dry-run).
 */
import { requireStaff } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !secret || !supaUrl || !anon) return res.status(503).json({ error: 'bridge env not configured' })

  try {
    await requireStaff(req, { supaUrl, anon, svcKey: process.env.SUPABASE_SERVICE_ROLE_KEY })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const syncEnabled = process.env.CASHDESK_SYNC_TO_SITE === 'on'
  try {
    const r = await fetch(`${base}/api/internal/cashdesk/offices`, {
      headers: { 'x-cashdesk-secret': secret },
    })
    const text = await r.text()
    let payload
    try { payload = JSON.parse(text) } catch { payload = { raw: text } }
    return res.status(r.status).json({ ...payload, syncEnabled })
  } catch (e) {
    return res.status(502).json({ error: `site unreachable: ${e?.message || e}`, syncEnabled })
  }
}
