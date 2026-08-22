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
import { svcClient, applyWalletCache, applyDetailCache, notifyManagerBot, cachedRiskScore } from './_common.js'
import { alertPlan } from './webhook.js'

// cold getWallet+getStats+getTransactions × 22 кошелька — держим запас времени.
export const config = { maxDuration: 300 }

// Статистика/контрагенты — за ВСЁ время (не 30д): from раньше любой USDT-активности.
const ALL_TIME_FROM = '2018-01-01'
function todayIso() {
  return new Date().toISOString().slice(0, 10)
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
  let alerted = null

  // getWallet/детали — только для кошельков, заведённых AEGIS-монитором (wallet_id).
  if (wid) {
    // getWallet — источник риск/скор/баланс/reasons.
    const wallet = await aegis.getWallet(wid)
    await applyWalletCache(db, a.id, wallet)

    // Детали — best-effort, деградируют по таймауту, кэш не затирают null-ом.
    const [stats, transactions] = await Promise.all([
      withTimeout(aegis.getStats(wid, ALL_TIME_FROM, todayIso()), 22000, { available: false }), // exposure/top_entities тяжелее
      withTimeout(aegis.getTransactions(wid, {}), 15000, { available: false, items: [], cursor: null, hasMore: false }),
    ])
    await applyDetailCache(db, a.id, wid, { stats, transactions, reasons: wallet?.riskReasons || [] })

    // Алерты движений вынесены в tx-watch (прямой TronGrid, ≤15с) — poll их не шлёт.
    const plan = alertPlan(a.risk_level, wallet.riskLevel)
    if (plan.telegram) {
      await notifyManagerBot({
        kind: 'wallet_risk',
        text: `🚨 <b>Кошелёк ${escapeHtml(a.name || wid)}</b> — риск CRITICAL (poll)`,
        meta: { wallet_id: wid, level: wallet.riskLevel, prev_level: a.risk_level, source: 'poll' },
      })
      alerted = a.id
    }
  }

  // 🔴 АВТОРИТЕТНЫЙ risk_score НАШЕГО кошелька — через screenRisk ПО АДРЕСУ (тот же источник, что алерты
  // tx-watch), с щедрым таймаутом: у poll бюджет 300с и это НЕ hot-path, в отличие от tx-watch (60с/мин),
  // где тяжёлый экран TL9ih (4-12с, растёт под нагрузкой) таймаутит. Пишем в accounts.risk_* durable-кэш
  // ПОСЛЕ applyWalletCache (перекрывая скор getWallet альерт-совместимым). Раз poll записал full — свой
  // кошелёк больше НЕ падает в «нет данных»: tx-watch отдаёт этот скор, когда его live-запрос не дозрел.
  if (a.address && a.network_id) {
    const risk = await withTimeout(cachedRiskScore(aegis, a.network_id, a.address), 28000, null)
    if (risk && risk.assessment === 'full' && risk.score != null) {
      await db.from('accounts').update({ risk_score: risk.score, risk_level: risk.level ?? null, risk_updated_at: new Date().toISOString() }).eq('id', a.id)
    }
  }

  return alerted ? { ok: true, alerted } : { ok: true }
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })
  if (!aegis.configured()) return res.status(200).json({ ok: true, skipped: 'aegis not configured', polled: 0 })

  // Все активные крипто-счета (а не только заведённые wallet_id): свой кошелёк для durable risk_score
  // скринится ПО АДРЕСУ (см. pollWallet), поэтому нужен и адрес, и счета без aegis_wallet_id (иначе
  // TL9ih без wallet_id выпадал из poll → risk_score никогда не писался → алерт «нет данных»).
  const { data: accts, error } = await db
    .from('accounts')
    .select('id, name, network_id, address, aegis_wallet_id, risk_level')
    .eq('active', true)
    .eq('kind', 'crypto')
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
