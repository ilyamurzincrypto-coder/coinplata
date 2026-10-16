/**
 * Доставка опубликованного прайса в CoinPoint (мост касса → каналы).
 *
 * Фронт зовёт эту функцию со своим Supabase-JWT сразу после публикации либо по
 * кнопке «Переотправить». Секрет CoinPoint живёт ТОЛЬКО на сервере — ровно как
 * в api/cashdesk/status.js, откуда взята схема.
 *
 * Сама отправка и разметка результата — в api/rates/_deliver.js: тот же код
 * обслуживает крон-добивку (api/rates/redeliver.js). Здесь остаётся только
 * «кто спрашивает и про какую версию».
 *
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RATES_BRIDGE_ENABLED.
 */
import { requireStaff } from '../cashdesk/_auth.js'
import { deliverVersion, loadPublication } from './_deliver.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !anon || !svc) return res.status(503).json({ error: 'supabase env not configured' })

  // Отправлять курсы наружу может только сотрудник кассы, а не кто угодно
  // с публичным ключом.
  let caller
  try {
    caller = await requireStaff(req, { supaUrl, anon, svcKey: svc })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
  const version = Number(body.version)
  if (!Number.isFinite(version) || version <= 0) {
    return res.status(400).json({ error: 'version required' })
  }

  // Прайс берём ИЗ БАЗЫ по номеру версии, а не из тела запроса: иначе клиент
  // мог бы отправить в каналы что угодно под видом опубликованного.
  let pub
  try {
    pub = await loadPublication({ supaUrl, svc, version })
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e) })
  }
  if (!pub) return res.status(404).json({ error: `версии ${version} нет` })

  // force приходит ТОЛЬКО от ручной кнопки «Переотправить»: она обязана
  // делать то, что написано на ней. Автоматический ретрай его не ставит,
  // поэтому защита от двойной обработки при сбое сети остаётся на месте.
  const force = body.force === true

  const { status, body: out } = await deliverVersion({
    supaUrl, svc, base, secret, pub, sentBy: caller.userId, force,
  })
  return res.status(status).json(out)
}
