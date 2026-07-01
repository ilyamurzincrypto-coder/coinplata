/**
 * Касса → CoinPoint: админ обменника разово закрывает день офиса (гибрид-календарь).
 * Фронт зовёт со своим Supabase-JWT; форвардим в coinpoint POST /availability/close.
 *
 * Body: { office: 'ANT', date: 'YYYY-MM-DD', reason? }
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY.
 */
import { requireStaff } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !secret || !supaUrl || !anon) return res.status(503).json({ error: 'bridge env not configured' })

  // Закрытие дня офиса — только admin/owner (не любой залогиненный).
  let caller
  try {
    caller = await requireStaff(req, { supaUrl, anon, svcKey: process.env.SUPABASE_SERVICE_ROLE_KEY }, { roles: ['owner', 'admin'] })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
  const r = await fetch(`${base}/api/internal/cashdesk/availability/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
    body: JSON.stringify({ office: body.office, date: body.date, reason: body.reason, closed_by: caller.userId }),
  })
  const text = await r.text()
  res.status(r.status)
  try { return res.json(JSON.parse(text)) } catch { return res.send(text) }
}
