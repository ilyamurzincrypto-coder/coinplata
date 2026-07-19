/**
 * Фолбэк-поллинг AEGIS (Vercel Cron, каждые 10 мин). Для всех счетов с
 * aegis_wallet_id тянет getWallet и обновляет кэш риск/баланс. Если вебхук
 * пропущен — poll подхватит; переход В critical здесь тоже шлёт Telegram
 * (естественно дедуплится против вебхука: если вебхук уже обновил risk_level,
 * poll не видит перехода). Ошибки сети логируются, не валят весь прогон.
 *
 * Гейт CRON_SECRET (как rapira/tolunay). ENV: AEGIS_API_URL/KEY, SUPABASE_*,
 * CRON_SECRET, (+ алерт-каналы).
 */
import { aegis } from '../../src/lib/aegisClient.js'
import { svcClient, applyWalletCache, notifyManagerBot } from './_common.js'
import { alertPlan } from './webhook.js'

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })
  if (!aegis.configured()) return res.status(200).json({ ok: true, skipped: 'aegis not configured', polled: 0 })

  const { data: accts, error } = await db
    .from('accounts')
    .select('id, name, aegis_wallet_id, risk_level')
    .not('aegis_wallet_id', 'is', null)
    .eq('active', true)
  if (error) return res.status(500).json({ error: 'account list failed' })

  let ok = 0
  let failed = 0
  const alerts = []
  for (const a of accts || []) {
    try {
      const wallet = await aegis.getWallet(a.aegis_wallet_id)
      await applyWalletCache(db, a.id, wallet)
      const plan = alertPlan(a.risk_level, wallet.riskLevel)
      if (plan.telegram) {
        await notifyManagerBot({
          kind: 'wallet_risk',
          text: `🚨 <b>Кошелёк ${escapeHtml(a.name || a.aegis_wallet_id)}</b> — риск CRITICAL (poll)`,
          meta: { wallet_id: a.aegis_wallet_id, level: wallet.riskLevel, prev_level: a.risk_level, source: 'poll' },
        })
        alerts.push(a.id)
      }
      ok += 1
    } catch (e) {
      failed += 1
      // eslint-disable-next-line no-console
      console.warn(`[aegis/poll] ${a.id} (${a.aegis_wallet_id}) failed:`, e?.message || e)
    }
  }

  return res.status(200).json({ ok: true, polled: (accts || []).length, updated: ok, failed, alerts })
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
