/**
 * Ядро доставки опубликованного прайса в CoinPoint.
 *
 * Вынесено из api/rates/deliver.js, чтобы ОДНА логика обслуживала два входа:
 *   • кнопка кассира (deliver.js — проверяет сессию сотрудника);
 *   • крон-добивка (redeliver.js — проверяет CRON_SECRET).
 *
 * ПОЧЕМУ ДОБИВКА ВООБЩЕ НУЖНА. Доставку запускал только фронт сразу после
 * публикации. Если вкладку закрыли, сеть моргнула или публикация пришла не из
 * UI — версия оставалась в `pending`, и на витринах стояли вчерашние цены,
 * пока человек не заметит и не нажмёт «Переотправить». Так и случилось с
 * v. 29: опубликована, в каналы не ушла. Цены для клиента не должны зависеть
 * от того, не закрыл ли кассир вкладку.
 *
 * ИДЕМПОТЕНТНОСТЬ. Ключ — номер версии: принимающая сторона сравнивает его с
 * уже принятым и на повтор отвечает applied:false. Поэтому добивка повторяет
 * ту же версию тем же ключом — дубля цен от неё не появится.
 */

/** Паузы между попытками. 4xx не ретраится — это ошибка контракта. */
const BACKOFF_MS = [1000, 5000, 30000]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function rpc(supaUrl, key, fn, args) {
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

/** Публикация по номеру версии (прайс берём из базы, не из тела запроса). */
export async function loadPublication({ supaUrl, svc, version }) {
  const q = await fetch(
    `${supaUrl}/rest/v1/rate_publications?version=eq.${version}&select=version,published_at,prices,source_meta,delivery_state`,
    { headers: { apikey: svc, authorization: `Bearer ${svc}` } }
  )
  if (!q.ok) throw new Error(`read publication: ${q.status}`)
  const [pub] = await q.json()
  return pub || null
}

/**
 * Последняя публикация, которая НЕ доехала. Берём именно последнюю: доставлять
 * старую, когда поверх неё уже опубликована новая, значит вернуть витринам
 * устаревшие цены.
 */
export async function latestUndelivered({ supaUrl, svc }) {
  const q = await fetch(
    `${supaUrl}/rest/v1/rate_publications?select=version,delivery_state,delivery_attempts&order=version.desc&limit=1`,
    { headers: { apikey: svc, authorization: `Bearer ${svc}` } }
  )
  if (!q.ok) throw new Error(`read publications: ${q.status}`)
  const [row] = await q.json()
  if (!row) return null
  const state = row.delivery_state || 'pending'
  return state === 'pending' || state === 'failed' ? row : null
}

/**
 * Отправка версии в каналы + отметка результата в rate_publications.
 * Возвращает то же, что раньше отдавал deliver.js.
 */
export async function deliverVersion({ supaUrl, svc, base, secret, pub, sentBy = null, force = false }) {
  const payload = {
    version: pub.version,
    published_at: pub.published_at,
    prices: pub.prices,
    source_meta: pub.source_meta,
    sent_by: sentBy,
    force,
  }

  // ── Рубильник: считаем и показываем, наружу молчим ──────────────────────
  if (process.env.RATES_BRIDGE_ENABLED !== 'true') {
    await rpc(supaUrl, svc, 'mark_rate_delivery', {
      p_version: pub.version, p_state: 'skipped',
      p_error: 'мост выключен (RATES_BRIDGE_ENABLED)',
      p_meta: { prices: pub.prices?.length ?? 0, dry_run: true },
    }).catch(() => {})
    return {
      status: 200,
      body: {
        ok: true, delivered: false, dryRun: true, version: pub.version,
        prices: pub.prices?.length ?? 0,
        note: 'мост выключен — прайс посчитан и показан, наружу не отправлен',
      },
    }
  }

  if (!base || !secret) return { status: 503, body: { error: 'bridge env not configured' } }

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
    p_version: pub.version, p_state: state,
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

  return {
    status: last.ok ? 200 : 502,
    body: {
      ok: last.ok, delivered: last.ok, version: pub.version,
      prices: pub.prices?.length ?? 0,
      applied, skipped,
      status: last.status,
      error: last.ok ? undefined : last.body,
    },
  }
}
