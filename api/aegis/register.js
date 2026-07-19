/**
 * «Подключить мониторинг» для криптосчёта: регистрируем (address, network) в
 * AEGIS, сохраняем aegis_wallet_id + первичный кэш риск/баланс на счёт.
 * Идемпотентно: повтор → created:false (норма). 409 address_unavailable —
 * отдаём явно. Пока AEGIS /v1 не поднят → 503 not_configured (ожидаемо).
 *
 * POST { accountId }. requireStaff (owner/admin/accountant).
 * ENV: AEGIS_API_URL, AEGIS_API_KEY, SUPABASE_URL, SUPABASE_*_KEY.
 */
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis, AegisError } from '../../src/lib/aegisClient.js'
import { svcClient, authEnv, applyWalletCache } from './_common.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const { supaUrl, anon, svcKey } = authEnv()
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'backend not configured' })

  let staff
  try {
    staff = await requireStaff(req, { supaUrl, anon, svcKey }, { roles: ['owner', 'admin', 'accountant'] })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {}
  const accountId = String(body.accountId || '').trim()
  if (!accountId) return res.status(400).json({ error: 'accountId required' })

  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })

  const { data: acc, error: accErr } = await db
    .from('accounts')
    .select('id, name, address, network_id, kind, aegis_wallet_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accErr) return res.status(500).json({ error: 'account lookup failed' })
  if (!acc) return res.status(404).json({ error: 'account not found' })
  if (!acc.address || !acc.network_id) {
    return res.status(400).json({ error: 'account has no address/network' })
  }

  try {
    const { created, wallet } = await aegis.registerWallet({
      address: acc.address,
      network: acc.network_id, // клиент нормализует в lowercase
      label: acc.name || null,
    })
    const err = await applyWalletCache(db, accountId, wallet, { setWalletId: true })
    if (err) return res.status(500).json({ error: 'cache write failed' })
    return res.status(200).json({
      ok: true,
      created,
      aegisWalletId: wallet?.id || null,
      riskLevel: wallet?.riskLevel || null,
      capability: wallet?.capability || null,
      by: staff.userId,
    })
  } catch (e) {
    if (e instanceof AegisError) {
      return res.status(e.status || 502).json({ error: e.message, code: e.code })
    }
    return res.status(500).json({ error: `register failed: ${e?.message || e}` })
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
