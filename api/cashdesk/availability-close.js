/**
 * Касса → CoinPoint: админ обменника разово закрывает день офиса (гибрид-календарь).
 * Фронт зовёт со своим Supabase-JWT; форвардим в coinpoint POST /availability/close.
 *
 * Body: { office: 'ANT', date: 'YYYY-MM-DD', reason? }
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!base || !secret || !supaUrl || !anon) return res.status(503).json({ error: 'bridge env not configured' })

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'auth required' })
  const supa = createClient(supaUrl, anon, { auth: { persistSession: false } })
  const who = await supa.auth.getUser(token)
  if (who.error || !who.data?.user) return res.status(401).json({ error: 'invalid session' })

  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
  const r = await fetch(`${base}/api/internal/cashdesk/availability/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
    body: JSON.stringify({ office: body.office, date: body.date, reason: body.reason }),
  })
  const text = await r.text()
  res.status(r.status)
  try { return res.json(JSON.parse(text)) } catch { return res.send(text) }
}
