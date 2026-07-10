/**
 * Tolunaylar → касса. Vercel-функция (cron): тянет розничную страницу обмена
 * tolunaylar.com.tr (Antalya döviz), парсит карточки `boxC` (USD/EUR/RUB —
 * «Покупка»/«Продажа» в TL) и пишет СЫРОЙ ретейл-снимок в
 * public.external_rates(source='tolunay', pair='USD_TRY'|'EUR_TRY'|'RUB_TRY',
 * bid=Покупка, ask=Продажа, mid=(bid+ask)/2, raw).
 *
 * Это ЦЕНА для блока «Нал» панели курсов кассы (read-only авто). Маржу/спред
 * (копейки) касса накидывает сверху сама — здесь никакой маржи, только сырьё.
 * Логика парсинга — порт bot/src/rates/tolunaylar.ts из coinpoint.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (опц.) CRON_SECRET, TOLUNAY_URL.
 */
import { createClient } from '@supabase/supabase-js'

const TOLUNAY_URL =
  process.env.TOLUNAY_URL || 'https://tolunaylar.com.tr/ru/' + encodeURIComponent('обмен')

// Тянем к TRY. Страница отдаёт USD/EUR/GBP/CHF/RUB (проверено) — все нужны для нала.
const PAIRS = ['USD', 'EUR', 'GBP', 'CHF', 'RUB']
// Sanity-диапазоны розничного курса к TRY — защита от мусора при смене вёрстки.
const RANGES = { USD: [20, 80], EUR: [30, 90], GBP: [40, 100], CHF: [30, 80], RUB: [0.2, 1.5] }

// Турецкий формат «1.234,56» → 1234.56; «45,5000» → 45.5.
const parseTr = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'))

/** HTML → { USD:{buy,sell}, ... }. Первый <b>XXX</b> в карточке boxC — код, первые два «NN,NN TL» — Покупка/Продажа. */
function parseTolunaylar(html) {
  const out = {}
  const chunks = String(html).split(/class=["']boxC["']/).slice(1)
  for (const chunk of chunks) {
    const code = chunk.match(/<b>\s*([A-Z]{3})\s*<\/b>/)?.[1]
    if (!code) continue
    const nums = [...chunk.matchAll(/([\d.,]+)\s*TL/g)].map((m) => parseTr(m[1] ?? ''))
    const buy = nums[0]
    const sell = nums[1]
    if (buy == null || sell == null) continue
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0) continue
    out[code] = { buy, sell }
  }
  return out
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) return res.status(503).json({ error: 'supabase env not configured' })
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } })

  let html
  try {
    const r = await fetch(TOLUNAY_URL, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CoinplataCashier/1.0)' },
    })
    if (!r.ok) return res.status(502).json({ error: `tolunay ${r.status}` })
    html = await r.text()
  } catch (e) {
    return res.status(502).json({ error: 'tolunay fetch failed', detail: String(e?.message || e) })
  }

  const parsed = parseTolunaylar(html)
  const rows = []
  const skipped = []
  for (const code of PAIRS) {
    const r = parsed[code]
    if (!r) { skipped.push({ code, reason: 'not on page' }); continue }
    const [lo, hi] = RANGES[code] || [0, Infinity]
    if (r.buy < lo || r.buy > hi || r.sell < lo || r.sell > hi) {
      skipped.push({ code, reason: `out of range buy=${r.buy} sell=${r.sell}` })
      continue
    }
    rows.push({
      source: 'tolunay',
      pair: `${code}_TRY`,
      bid: r.buy,
      ask: r.sell,
      mid: (r.buy + r.sell) / 2,
      raw: r,
    })
  }
  if (!rows.length) return res.status(200).json({ ok: false, inserted: 0, skipped, note: 'nothing parsed' })

  const { error } = await supa.from('external_rates').insert(rows)
  if (error) return res.status(500).json({ error: 'insert failed', detail: error.message })

  return res.status(200).json({ ok: true, inserted: rows.length, pairs: rows.map((r) => r.pair), skipped })
}
