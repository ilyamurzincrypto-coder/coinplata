/**
 * Rapira → касса. Vercel-функция (cron): тянет ПУБЛИЧНЫЕ рыночные тикеры Rapira
 * (api.rapira.net/open/market/rates, без авторизации) и пишет снимок в
 * public.external_rates(source='rapira', pair='USDT_RUB', bid/ask/mid, raw).
 * На этих котировках строится авто-курс: office_rate = rapira_mid ± spread.
 *
 * Заодно считает волатильность vs предыдущий снимок: если |Δmid| за окно
 * превышает порог — возвращает в alerts (следующий этап — пуш в менеджерский бот).
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (опц.) CRON_SECRET,
 *      (опц.) RAPIRA_URL, RAPIRA_VOL_PCT (дефолт 1.5), RAPIRA_FIATS.
 */
import { createClient } from '@supabase/supabase-js'

const RAPIRA_URL = process.env.RAPIRA_URL || 'https://api.rapira.net/open/market/rates'
// Какие фиаты против USDT нам интересны (Rapira RU-биржа → в основном RUB).
const FIATS = (process.env.RAPIRA_FIATS || 'RUB,USD,EUR,TRY,GBP,CHF').split(',').map((s) => s.trim())
const VOL_PCT = Number(process.env.RAPIRA_VOL_PCT || 1.5)

const numOr = (v, d = null) => (Number.isFinite(Number(v)) ? Number(v) : d)

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) return res.status(503).json({ error: 'supabase env not configured' })
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } })

  // 1. Тянем публичные тикеры Rapira.
  let tickers
  try {
    const r = await fetch(RAPIRA_URL, { headers: { accept: 'application/json' } })
    if (!r.ok) return res.status(502).json({ error: `rapira ${r.status}` })
    const j = await r.json()
    tickers = Array.isArray(j?.data) ? j.data : []
  } catch (e) {
    return res.status(502).json({ error: 'rapira fetch failed', detail: String(e?.message || e) })
  }

  // 2. Отбираем USDT↔фиат (quoteCurrency=USDT, baseCurrency ∈ FIATS). close = RUB за USDT.
  const rows = []
  for (const t of tickers) {
    if (String(t?.quoteCurrency).toUpperCase() !== 'USDT') continue
    const base = String(t?.baseCurrency || '').toUpperCase()
    if (!FIATS.includes(base)) continue
    const mid = numOr(t.close) ?? numOr(t.bidPrice)
    if (mid == null || mid <= 0) continue
    rows.push({
      source: 'rapira',
      pair: `USDT_${base}`, // USDT_RUB = RUB за 1 USDT (как binance USDT_TRY)
      bid: numOr(t.bidPrice, mid),
      ask: numOr(t.askPrice, mid),
      mid,
      raw: t,
    })
  }
  if (!rows.length) return res.status(200).json({ ok: true, inserted: 0, note: 'no matching pairs' })

  // 3. Волатильность: сравниваем с последним снимком по паре.
  const alerts = []
  for (const row of rows) {
    const prev = await supa
      .from('external_rates')
      .select('mid, fetched_at')
      .eq('source', 'rapira')
      .eq('pair', row.pair)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const prevMid = numOr(prev.data?.mid)
    if (prevMid && prevMid > 0) {
      const chgPct = ((row.mid - prevMid) / prevMid) * 100
      if (Math.abs(chgPct) >= VOL_PCT) {
        alerts.push({
          pair: row.pair,
          from: prevMid,
          to: row.mid,
          chgPct: Number(chgPct.toFixed(3)),
          since: prev.data?.fetched_at || null,
        })
      }
    }
  }

  // 4. Пишем снимок.
  const { error } = await supa.from('external_rates').insert(rows)
  if (error) return res.status(500).json({ error: 'insert failed', detail: error.message })

  // TODO(этап алертов): при alerts.length — POST в менеджерский бот
  // (нужны TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID) с текстом
  // «USDT/RUB {chgPct}% — проверь спред».
  return res.status(200).json({ ok: true, inserted: rows.length, pairs: rows.map((r) => r.pair), alerts })
}
