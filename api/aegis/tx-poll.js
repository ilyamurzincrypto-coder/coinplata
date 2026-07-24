/**
 * Лёгкий tx-поллинг (Vercel Cron, каждую минуту) — для МОМЕНТАЛЬНЫХ алертов
 * движений. Только getTransactions (без getWallet/getStats) → быстро → можно раз
 * в минуту. Детект новых транзакций (новее accounts.last_alert_tx_ts) → алерт в
 * менеджер-бот с контрагентом. Дедуп с full-poll и вебхуком по той же метке.
 *
 * Полный poll (каждые 10 мин) остаётся для риск/баланс/кэш/exposure.
 * Гейт CRON_SECRET. ENV: AEGIS_API_URL/KEY, SUPABASE_*, CRON_SECRET, (+ алерт-каналы).
 */
import { aegis } from '../../src/lib/aegisClient.js'
import { svcClient, alertNewTransactions } from './_common.js'

export const config = { maxDuration: 60 }

function withTimeout(p, ms, fb) {
  return Promise.race([Promise.resolve(p).catch(() => fb), new Promise((r) => setTimeout(() => r(fb), ms))])
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })
  if (!aegis.configured()) return res.status(200).json({ ok: true, skipped: 'aegis not configured' })

  const { data: accts, error } = await db
    .from('accounts')
    .select('id, name, network_id, aegis_wallet_id, last_alert_tx_ts')
    .not('aegis_wallet_id', 'is', null)
    .eq('active', true)
  if (error) return res.status(500).json({ error: 'account list failed' })

  const list = accts || []
  const CONCURRENCY = 10
  let alertsSent = 0
  let idx = 0
  async function worker() {
    while (idx < list.length) {
      const a = list[idx++]
      try {
        const tx = await withTimeout(aegis.getTransactions(a.aegis_wallet_id, {}), 15000, { available: false, items: [] })
        if (tx && tx.available) alertsSent += await alertNewTransactions(db, a, tx.items)
      } catch {
        /* один кошелёк не валит крон */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))

  return res.status(200).json({ ok: true, wallets: list.length, alertsSent })
}
