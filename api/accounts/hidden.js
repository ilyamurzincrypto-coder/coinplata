/**
 * Скрыть/показать счёт в витрине «Счета» (глазик). Общий флаг accounts.hidden.
 * POST { accountId, hidden:boolean } — requireStaff. Мониторинг не трогает,
 * счёт остаётся active — только убирается из основного списка.
 * ENV: SUPABASE_*.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '../cashdesk/_auth.js'

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
  const accountId = String(body.accountId || '').trim()
  const hidden = body.hidden === true
  if (!accountId) return res.status(400).json({ error: 'accountId required' })

  const db = createClient(supaUrl, svcKey, { auth: { persistSession: false } })
  const { error } = await db.from('accounts').update({ hidden }).eq('id', accountId)
  if (error) return res.status(500).json({ error: 'update failed' })
  return res.status(200).json({ ok: true, accountId, hidden })
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return {} }
}
