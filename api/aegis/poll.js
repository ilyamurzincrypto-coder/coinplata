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
import { svcClient, applyWalletCache, applyDetailCache, notifyManagerBot } from './_common.js'
import { alertPlan } from './webhook.js'

// cold getWallet+getStats+getTransactions × 22 кошелька — держим запас времени.
export const config = { maxDuration: 300 }

function daysAgoIso(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// Мягкий таймаут вокруг AEGIS-вызова: секция не готова → возвращаем fallback,
// один медленный кошелёк не вешает весь прогон крона.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

// Один кошелёк: риск/баланс (getWallet) + детали в кэш (getStats+getTransactions).
async function pollWallet(db, a) {
  const wid = a.aegis_wallet_id
  // getWallet — источник риск/скор/баланс/reasons (обязательный).
  const wallet = await aegis.getWallet(wid)
  await applyWalletCache(db, a.id, wallet)

  // Детали — best-effort, деградируют по таймауту, кэш не затирают null-ом.
  const [stats, transactions] = await Promise.all([
    withTimeout(aegis.getStats(wid, daysAgoIso(30), daysAgoIso(0)), 9000, { available: false }),
    withTimeout(aegis.getTransactions(wid, {}), 9000, { available: false, items: [], cursor: null, hasMore: false }),
  ])
  await applyDetailCache(db, a.id, wid, { stats, transactions, reasons: wallet?.riskReasons || [] })

  const plan = alertPlan(a.risk_level, wallet.riskLevel)
  if (plan.telegram) {
    await notifyManagerBot({
      kind: 'wallet_risk',
      text: `🚨 <b>Кошелёк ${escapeHtml(a.name || wid)}</b> — риск CRITICAL (poll)`,
      meta: { wallet_id: wid, level: wallet.riskLevel, prev_level: a.risk_level, source: 'poll' },
    })
    return { ok: true, alerted: a.id }
  }
  return { ok: true }
}

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

  // Пул параллелизма — чтобы 22 кошелька × 3 запроса не шли строго последовательно
  // (иначе крон рискует упереться в maxDuration), но и не заваливали AEGIS разом.
  const list = accts || []
  const CONCURRENCY = 5
  let ok = 0
  let failed = 0
  const alerts = []
  let idx = 0
  async function worker() {
    while (idx < list.length) {
      const a = list[idx++]
      try {
        const r = await pollWallet(db, a)
        ok += 1
        if (r.alerted) alerts.push(r.alerted)
      } catch (e) {
        failed += 1
        // eslint-disable-next-line no-console
        console.warn(`[aegis/poll] ${a.id} (${a.aegis_wallet_id}) failed:`, e?.message || e)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))

  return res.status(200).json({ ok: true, polled: list.length, updated: ok, failed, alerts })
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
