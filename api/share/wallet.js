/**
 * Публичные детали крипто-кошелька по share-токену (drill-down на share-странице).
 * БЕЗ логина. Доступно ТОЛЬКО если у токена allow_details=true (галочка при
 * генерации ссылки). Отдаёт read-only снапшот ИЗ КЭША (wallet_aegis_cache) —
 * живой AEGIS отсюда НЕ дёргаем.
 *
 * Гейты безопасности (все обязательны):
 *  1. token существует, section='accounts', не отозван, allow_details=true;
 *  2. accountId — активный крипто-счёт, попадающий в scope токена (crypto/all);
 *  3. отдаём только публичные поля (имя/адрес/сеть/риск/баланс + кэш движений),
 *     никаких staff-only данных, никаких live-запросов, без пагинации.
 *
 * Любой не-GET → 405. Нет доступа → 404 (не палим, что именно не так).
 * ENV: SUPABASE_URL (или VITE_*), SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

  const token = String(req.query.token || '').trim()
  const accountId = String(req.query.accountId || '').trim()
  if (!token || !accountId) return res.status(400).json({ error: 'token and accountId required' })

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !svcKey) return res.status(503).json({ error: 'share backend not configured' })

  const db = createClient(supaUrl, svcKey, { auth: { persistSession: false } })
  const DENY = () => res.status(404).json({ error: 'not available' })

  try {
    // 1. Токен: accounts-секция, не отозван, детали разрешены.
    const { data: tok } = await db
      .from('share_tokens')
      .select('scope, section, revoked_at, allow_details')
      .eq('token', token)
      .maybeSingle()
    if (!tok || tok.section !== 'accounts' || tok.revoked_at || tok.allow_details !== true) return DENY()
    const scope = ['all', 'fiat', 'crypto'].includes(tok.scope) ? tok.scope : 'all'
    if (scope === 'fiat') return DENY() // фиат-ссылка деталей крипты не даёт

    // 2. Счёт: активный, крипта, в scope токена.
    const { data: acc } = await db
      .from('accounts')
      .select('id, name, address, network_id, kind, active, aegis_capability, risk_level, risk_score, balance_usd_est')
      .eq('id', accountId)
      .maybeSingle()
    if (!acc || acc.active !== true || acc.kind !== 'crypto') return DENY()

    const TX_UNAVAIL = { available: false, items: [], cursor: null, hasMore: false }
    const STATS_UNAVAIL = { available: false, in: null, out: null, byDay: null }

    // 3. Детали — только из кэша (никакого live).
    const { data: cache } = await db
      .from('wallet_aegis_cache')
      .select('tx_items, tx_has_more, stats, risk_reasons, cached_at')
      .eq('account_id', accountId)
      .maybeSingle()

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      account: { id: acc.id, name: acc.name, address: acc.address, network: acc.network_id },
      wallet: {
        riskLevel: acc.risk_level ?? null,
        riskScore: acc.risk_score ?? null,
        balanceUsdEst: acc.balance_usd_est != null ? String(acc.balance_usd_est) : null,
        capability: acc.aegis_capability ?? null,
        riskReasons: (cache && cache.risk_reasons) || [],
      },
      stats: (cache && cache.stats) || STATS_UNAVAIL,
      transactions: cache && cache.tx_items != null
        ? { available: true, items: cache.tx_items, cursor: null, hasMore: false } // без live-пагинации на share
        : TX_UNAVAIL,
      cachedAt: cache ? cache.cached_at : null,
      source: 'share-cache',
      readOnly: true,
    })
  } catch (e) {
    return res.status(500).json({ error: `share wallet failed: ${e?.message || e}` })
  }
}
