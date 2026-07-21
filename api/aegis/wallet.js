/**
 * Детали кошелька для authed-кассы (Экран 3 + reasons в плашку списка).
 * GET /api/aegis/wallet?accountId=<uuid>[&cursor=<c>]  — requireStaff.
 * Чтение AEGIS через существующий aegisClient (getWallet+getStats+getTransactions);
 * схему/вебхук/поллинг не трогает. Share-токен сюда НЕ проходит (только staff-JWT)
 * — drill-down недоступен по share серверно.
 *
 * Без cursor: { account, wallet, stats(30д), transactions(1-я стр) }.
 * С cursor:   { transactions } — «показать ещё».
 *
 * ENV: AEGIS_API_URL/KEY, SUPABASE_*.
 */
import { requireStaff } from '../cashdesk/_auth.js'
import { aegis, AegisError } from '../../src/lib/aegisClient.js'
import { svcClient, authEnv } from './_common.js'

function daysAgoIso(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// AEGIS stats/transactions могут отвечать медленно/не быть готовыми — не даём
// эндпоинту висеть: по таймауту помечаем секцию недоступной (Экран 3 её скроет).
function withTimeout(promise, ms, onTimeout) {
  return Promise.race([
    promise.catch(() => onTimeout),
    new Promise((resolve) => setTimeout(() => resolve(onTimeout), ms)),
  ])
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

  const { supaUrl, anon, svcKey } = authEnv()
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'backend not configured' })

  try {
    await requireStaff(req, { supaUrl, anon, svcKey })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const accountId = String(req.query.accountId || '').trim()
  if (!accountId) return res.status(400).json({ error: 'accountId required' })
  const cursor = req.query.cursor ? String(req.query.cursor) : null

  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })

  const { data: acc, error: accErr } = await db
    .from('accounts')
    .select('id, name, address, network_id, aegis_wallet_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accErr) return res.status(500).json({ error: 'account lookup failed' })
  if (!acc) return res.status(404).json({ error: 'account not found' })
  if (!acc.aegis_wallet_id) return res.status(409).json({ error: 'monitoring not connected' })

  const wid = acc.aegis_wallet_id
  try {
    const TX_UNAVAIL = { available: false, items: [], cursor: null, hasMore: false }
    const STATS_UNAVAIL = { available: false, in: null, out: null, byDay: null }

    // «Показать ещё» — только следующая страница движений.
    if (cursor) {
      const transactions = await withTimeout(aegis.getTransactions(wid, { cursor }), 9000, TX_UNAVAIL)
      return res.status(200).json({ transactions })
    }

    // getWallet — ядро (риск/скор/reasons/баланс); с таймаутом, но обязателен.
    const wallet = await withTimeout(aegis.getWallet(wid), 9000, null)
    if (!wallet) return res.status(504).json({ error: 'aegis wallet timeout' })

    // stats/transactions — деградируют в «нет данных» по таймауту/ошибке.
    const [stats, transactions] = await Promise.all([
      withTimeout(aegis.getStats(wid, daysAgoIso(30), daysAgoIso(0)), 9000, STATS_UNAVAIL),
      withTimeout(aegis.getTransactions(wid, {}), 9000, TX_UNAVAIL),
    ])
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      account: { id: acc.id, name: acc.name, address: acc.address, network: acc.network_id },
      wallet,
      stats,
      transactions,
    })
  } catch (e) {
    if (e instanceof AegisError) return res.status(e.status || 502).json({ error: e.message, code: e.code })
    return res.status(500).json({ error: `wallet detail failed: ${e?.message || e}` })
  }
}
