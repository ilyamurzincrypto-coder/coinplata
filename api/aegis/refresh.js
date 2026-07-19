/**
 * «Обновить» — ручной пул сводки кошелька из AEGIS для одного счёта.
 * POST { accountId }. requireStaff (любой сотрудник). Обновляет кэш риск/баланс.
 * ENV: AEGIS_API_URL, AEGIS_API_KEY, SUPABASE_*.
 */
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis, AegisError } from '../../src/lib/aegisClient.js'
import { svcClient, authEnv, applyWalletCache } from './_common.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const { supaUrl, anon, svcKey } = authEnv()
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'backend not configured' })

  try {
    await requireStaff(req, { supaUrl, anon, svcKey })
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
    .select('id, aegis_wallet_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accErr) return res.status(500).json({ error: 'account lookup failed' })
  if (!acc) return res.status(404).json({ error: 'account not found' })
  if (!acc.aegis_wallet_id) return res.status(400).json({ error: 'monitoring not connected' })

  try {
    const wallet = await aegis.getWallet(acc.aegis_wallet_id)
    const err = await applyWalletCache(db, accountId, wallet)
    if (err) return res.status(500).json({ error: 'cache write failed' })
    return res.status(200).json({
      ok: true,
      riskLevel: wallet?.riskLevel || null,
      capability: wallet?.capability || null,
      balanceUsdEst: wallet?.balanceUsdEst ?? null,
      syncedAt: wallet?.syncedAt || null,
    })
  } catch (e) {
    if (e instanceof AegisError) {
      return res.status(e.status || 502).json({ error: e.message, code: e.code })
    }
    return res.status(500).json({ error: `refresh failed: ${e?.message || e}` })
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
