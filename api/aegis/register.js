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
    // §4b C1: ответ регистрации ПЛОСКИЙ {wallet_id,…,created} — риска/баланса в нём НЕТ.
    const { created, walletId } = await aegis.registerWallet({
      address: acc.address,
      network: acc.network_id, // клиент маппит TRC20→TRON
      label: acc.name || null,
    })
    if (!walletId) return res.status(502).json({ error: 'register: no wallet_id in response' })

    // Первичный кэш риск/баланса — ОТДЕЛЬНЫМ getWallet (register его не отдаёт).
    // Сбой getWallet не критичен: wallet_id всё равно сохраняем, риск подтянет refresh/поллинг.
    let wallet = null
    try {
      wallet = await aegis.getWallet(walletId)
    } catch (e2) {
      if (!(e2 instanceof AegisError)) throw e2
    }

    if (wallet) {
      const err = await applyWalletCache(db, accountId, wallet, { setWalletId: true })
      if (err) return res.status(500).json({ error: 'cache write failed' })
    } else {
      const { error: widErr } = await db.from('accounts').update({ aegis_wallet_id: walletId }).eq('id', accountId)
      if (widErr) return res.status(500).json({ error: 'wallet_id write failed' })
    }

    return res.status(200).json({
      ok: true,
      created,
      aegisWalletId: walletId,
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
