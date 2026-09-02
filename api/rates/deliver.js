/**
 * Доставка опубликованного прайса в CoinPoint (мост касса → каналы).
 *
 * Фронт зовёт эту функцию со своим Supabase-JWT сразу после публикации либо по
 * кнопке «Переотправить». Секрет CoinPoint живёт ТОЛЬКО здесь, на сервере —
 * ровно как в api/cashdesk/status.js, откуда взята схема.
 *
 * ИДЕМПОТЕНТНОСТЬ ДЕРЖИТСЯ НА НОМЕРЕ ВЕРСИИ. Повторная отправка v.N обязана
 * быть безвредной: принимающая сторона сравнивает версию с уже принятой и
 * отвечает applied:false, ничего не меняя. Поэтому и автоматический ретрай, и
 * ручная кнопка используют ОДИН ключ — новый прайс от повтора не появится.
 *
 * РУБИЛЬНИК RATES_BRIDGE_ENABLED. По умолчанию ВЫКЛЮЧЕН: функция считает
 * payload, отвечает и пишет статус skipped, но наружу ничего не отправляет.
 * Курсы — это цены для клиентов на шести витринах; включение живой записи —
 * решение владельца, а не побочный эффект деплоя. Тот же приём уже применён
 * в проекте для синхронизации офисов на сайт.
 *
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RATES_BRIDGE_ENABLED.
 */
import { requireStaff } from '../cashdesk/_auth.js'

/** Паузы между попытками. 4xx не ретраится — это ошибка контракта. */
const BACKOFF_MS = [1000, 5000, 30000]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpc(supaUrl, key, fn, args) {
  const r = await fetch(`${supaUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
  return r.json()
}

/**
 * Одна попытка отправки. Возвращает {ok, status, body} — решение о повторе
 * принимает вызывающий, чтобы политика ретраев была в одном месте.
 */
async function attempt(base, secret, payload) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(`${base}/api/internal/cashdesk/rates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    const text = await r.text()
    // Ответ принимающей стороны разбираем: в нём список НЕПРИНЯТЫХ строк с
    // причинами. Оставить его строкой значило бы прятать главное — какие
    // курсы не доехали до витрин и почему. Первая боевая доставка легла
    // на 12 строк из 42, и без этого списка причина искалась бы вручную.
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* не JSON — покажем как есть */ }
    return { ok: r.ok, status: r.status, body: text.slice(0, 500), parsed }
  } catch (e) {
    // Таймаут и сетевой сбой — кандидаты на повтор, в отличие от 4xx.
    return { ok: false, status: 0, body: String(e?.message || e) }
  } finally {
    clearTimeout(t)
  }
}

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
  const q = await fetch(
    `${supaUrl}/rest/v1/rate_publications?version=eq.${version}&select=version,published_at,prices,source_meta,delivery_state`,
    { headers: { apikey: svc, authorization: `Bearer ${svc}` } }
  )
  if (!q.ok) return res.status(502).json({ error: `read publication: ${q.status}` })
  const [pub] = await q.json()
  if (!pub) return res.status(404).json({ error: `версии ${version} нет` })

  // force приходит ТОЛЬКО от ручной кнопки «Переотправить»: она обязана
  // делать то, что написано на ней. Автоматический ретрай ниже его не ставит,
  // поэтому защита от двойной обработки при сбое сети остаётся на месте.
  const force = body.force === true
  const payload = {
    version: pub.version,
    published_at: pub.published_at,
    prices: pub.prices,
    source_meta: pub.source_meta,
    sent_by: caller.userId,
    force,
  }

  // ── Рубильник: считаем и показываем, наружу молчим ──────────────────────
  if (process.env.RATES_BRIDGE_ENABLED !== 'true') {
    await rpc(supaUrl, svc, 'mark_rate_delivery', {
      p_version: version, p_state: 'skipped',
      p_error: 'мост выключен (RATES_BRIDGE_ENABLED)',
      p_meta: { prices: pub.prices?.length ?? 0, dry_run: true },
    }).catch(() => {})
    return res.status(200).json({
      ok: true, delivered: false, dryRun: true, version,
      prices: pub.prices?.length ?? 0,
      note: 'мост выключен — прайс посчитан и показан, наружу не отправлен',
    })
  }

  if (!base || !secret) return res.status(503).json({ error: 'bridge env not configured' })

  let last = null
  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    last = await attempt(base, secret, payload)
    if (last.ok) break
    // 4xx — контракт разошёлся; повтор даст ту же ошибку и только затянет
    // время. Чинит человек.
    if (last.status >= 400 && last.status < 500) break
    if (i < BACKOFF_MS.length) await sleep(BACKOFF_MS[i])
  }

  const state = last.ok ? 'sent' : 'failed'
  const applied = last.parsed?.inserted ?? null
  const skipped = Array.isArray(last.parsed?.skipped) ? last.parsed.skipped : []

  await rpc(supaUrl, svc, 'mark_rate_delivery', {
    p_version: version, p_state: state,
    p_error: last.ok ? null : `${last.status || 'сеть'}: ${last.body}`,
    p_meta: {
      prices: pub.prices?.length ?? 0,
      http: last.status,
      applied,
      skipped_count: skipped.length,
      // Разделяем «строке нет места в модели сайта» (перестановки, НЕРЕЗ) и
      // «строка должна была лечь, но потерялась» (нет валюты/направления).
      // Без этого Экран 3 красит штатную доставку в тревожный цвет, а жёлтый,
      // который горит всегда, перестают замечать — вместе с настоящей потерей.
      skipped_structural: last.parsed?.skippedStructural
        ?? skipped.filter((s) => s?.kind === 'structural').length,
      skipped_fixable: last.parsed?.skippedFixable
        ?? skipped.filter((s) => s?.kind === 'fixable').length,
      // Причины храним сгруппированно: тридцать одинаковых строк «нет
      // направления» читаются хуже, чем «нет направления — 30».
      skipped_reasons: skipped.reduce((acc, s) => {
        const key = String(s?.reason || 'без причины')
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
    },
  }).catch(() => {})

  return res.status(last.ok ? 200 : 502).json({
    ok: last.ok, delivered: last.ok, version,
    prices: pub.prices?.length ?? 0,
    applied, skipped,
    status: last.status,
    error: last.ok ? undefined : last.body,
  })
}
