/**
 * Управление share-ссылками раздела «Счета» — ТОЛЬКО для сотрудников кассы.
 * Guarded requireStaff (тот же, что bridge-эндпоинты): чужой/анон сюда не пройдёт.
 *   GET    → список активных ссылок (не отозванных)
 *   POST   {scope} → создать ссылку (токен генерится СЕРВЕРНО, крипто-стойкий)
 *   DELETE ?id= → отозвать (revoked_at = now)
 *
 * Токены живут вечно до отзыва (v1). Одна ссылка = один scope (Все/Фиат/Крипто).
 *
 * ENV: SUPABASE_URL (или VITE_SUPABASE_URL), SUPABASE_ANON_KEY (или VITE_*),
 *      SUPABASE_SERVICE_ROLE_KEY.
 */
import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '../cashdesk/_auth.js'

const SCOPES = ['all', 'fiat', 'crypto']

export default async function handler(req, res) {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'share backend not configured' })

  let staff
  try {
    staff = await requireStaff(req, { supaUrl, anon, svcKey })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const db = createClient(supaUrl, svcKey, { auth: { persistSession: false } })

  try {
    if (req.method === 'GET') {
      const { data, error } = await db
        .from('share_tokens')
        .select('id, token, scope, created_at, created_by')
        .eq('section', 'accounts')
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
      if (error) return res.status(500).json({ error: 'list failed' })
      return res.status(200).json({
        tokens: (data || []).map((r) => ({
          id: r.id,
          token: r.token,
          scope: r.scope,
          createdAt: r.created_at,
          createdBy: r.created_by,
        })),
      })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {}
      const scope = String(body.scope || '').trim()
      if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'bad scope' })
      // 192 бита энтропии (>128 требования), url-safe.
      const token = randomBytes(24).toString('base64url')
      const { data, error } = await db
        .from('share_tokens')
        .insert({ token, section: 'accounts', scope, created_by: staff.userId })
        .select('id, token, scope, created_at')
        .single()
      if (error) return res.status(500).json({ error: 'create failed' })
      return res.status(201).json({ id: data.id, token: data.token, scope: data.scope, createdAt: data.created_at })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '').trim()
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await db
        .from('share_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .is('revoked_at', null)
      if (error) return res.status(500).json({ error: 'revoke failed' })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: `manage failed: ${e?.message || e}` })
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
