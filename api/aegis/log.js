/**
 * Общая лента крипто-движений (Экран «Лог» в списке счетов · Крипто).
 * GET /api/aegis/log[?limit=150] — requireStaff.
 * Читает КЭШ wallet_aegis_cache (его наполняет poll-крон getTransactions),
 * разворачивает tx_items всех кошельков в один хронологический список с
 * привязкой к нашему кошельку (имя/адрес/сеть) — «откуда → куда».
 * Живьём AEGIS здесь НЕ дёргаем (мгновенно из БД).
 *
 * ENV: SUPABASE_*.
 */
import { requireStaff } from '../cashdesk/_auth.js'
import { svcClient, authEnv } from './_common.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

  const { supaUrl, anon, svcKey } = authEnv()
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'backend not configured' })

  try {
    await requireStaff(req, { supaUrl, anon, svcKey })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 150, 1), 500)

  // Кэш детали + счёт (имя/адрес/сеть/офис) одним запросом.
  const { data: rows, error } = await db
    .from('wallet_aegis_cache')
    .select('account_id, tx_items, accounts:account_id ( name, address, network_id, office_id )')
  if (error) return res.status(500).json({ error: 'log read failed' })

  const items = []
  for (const r of rows || []) {
    const acc = r.accounts || {}
    for (const t of r.tx_items || []) {
      items.push({
        ...t,
        accountId: r.account_id,
        walletName: acc.name || null,
        walletAddress: acc.address || null,
        network: acc.network_id || null,
        officeId: acc.office_id || null,
      })
    }
  }
  // Хронология: свежие сверху (ts ISO строка — лексикографически сортируется корректно).
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ items: items.slice(0, limit), total: items.length })
}
