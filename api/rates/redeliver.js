/**
 * Крон-добивка недоставленных курсов (касса → CoinPoint).
 *
 * ЗАЧЕМ. Доставку запускал только фронт сразу после публикации. Любой сбой
 * между «опубликовано» и «ушло в каналы» — закрытая вкладка, моргнувшая сеть,
 * публикация не из UI — оставлял версию в `pending`, и на сайте, в боте и в
 * мини-аппе стояли вчерашние цены, пока человек не заметит и не нажмёт
 * «Переотправить». Клиент видит это раньше нас: «usd-eur с 1 октября не
 * менялся». Цены не должны зависеть от того, не закрыл ли кассир вкладку.
 *
 * ЧТО ДЕЛАЕТ. Каждые 5 минут смотрит ПОСЛЕДНЮЮ публикацию. Если она в
 * `pending` или `failed` — отправляет её ещё раз тем же ключом (номер версии),
 * поэтому повтор безвреден: принимающая сторона на уже принятую версию
 * отвечает applied:false. Доставленную (`sent`) и намеренно пропущенную при
 * выключенном рубильнике (`skipped`) не трогает.
 *
 * Берём именно ПОСЛЕДНЮЮ версию, а не все застрявшие: доставить старую, когда
 * поверх неё уже опубликована новая, значит вернуть витринам устаревшие цены.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COINPOINT_API_URL,
 *      CASHDESK_API_SECRET, RATES_BRIDGE_ENABLED, (опц.) CRON_SECRET.
 */
import { deliverVersion, latestUndelivered, loadPublication } from './_deliver.js'

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !svc) return res.status(503).json({ error: 'supabase env not configured' })

  let pending
  try {
    pending = await latestUndelivered({ supaUrl, svc })
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
  if (!pending) return res.status(200).json({ ok: true, delivered: false, note: 'нечего добивать' })

  const pub = await loadPublication({ supaUrl, svc, version: pending.version })
  if (!pub) return res.status(404).json({ error: `версии ${pending.version} нет` })

  // force не ставим: добивка повторяет штатную отправку, а не принудительную.
  const { status, body } = await deliverVersion({ supaUrl, svc, base, secret, pub })
  return res.status(status).json({ ...body, retriedState: pending.delivery_state || 'pending' })
}
