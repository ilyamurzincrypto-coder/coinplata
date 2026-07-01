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

  // 3. Пишем снимок.
  const { error } = await supa.from('external_rates').insert(rows)
  if (error) return res.status(500).json({ error: 'insert failed', detail: error.message })

  // 4. Волатильность от РЕФЕРЕНСА (rapira_alert_state). |Δ| ≥ порога → алерт и
  //    перезадаём reference текущим (антиспам без таймера: следующий алерт —
  //    только после нового движения на порог от новой точки).
  const nowIso = new Date().toISOString()
  const alerts = []
  for (const row of rows) {
    const st = await supa.from('rapira_alert_state').select('ref_mid, ref_at').eq('pair', row.pair).maybeSingle()
    const ref = numOr(st.data?.ref_mid)
    if (!ref || ref <= 0) {
      await supa.from('rapira_alert_state').upsert({ pair: row.pair, ref_mid: row.mid, ref_at: nowIso, updated_at: nowIso })
      continue
    }
    const chgPct = ((row.mid - ref) / ref) * 100
    if (Math.abs(chgPct) >= VOL_PCT) {
      alerts.push({ pair: row.pair, from: ref, to: row.mid, chgPct: Number(chgPct.toFixed(2)), since: st.data?.ref_at || null })
      await supa.from('rapira_alert_state').upsert({ pair: row.pair, ref_mid: row.mid, ref_at: nowIso, updated_at: nowIso })
    }
  }

  // 5. Пуш алертов в менеджерский бот (@coinpoint_manager_bot).
  let notified = 0
  for (const a of alerts) {
    if (await notifyBot(a)) notified++
  }

  return res.status(200).json({ ok: true, inserted: rows.length, alerts, notified })
}

// Алерт в менеджерский бот. Приоритет — через coinpoint-мост (бот живёт там,
// токен НЕ в кассе): POST /api/internal/cashdesk/alert с x-cashdesk-secret.
// Fallback — прямой Telegram, если задан TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID.
async function notifyBot(a) {
  const arrow = a.chgPct >= 0 ? '▲' : '▼'
  const sign = a.chgPct > 0 ? '+' : ''
  const disp = a.pair.replace('_', '/')
  const text =
    `⚠️ <b>${disp}</b> ${arrow} ${sign}${a.chgPct}%\n` +
    `Рынок Rapira: ${a.from} → ${a.to}\n` +
    `Возможно нужно расширить спред.`

  // 1) через coinpoint (там бот)
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  if (base && secret) {
    try {
      const r = await fetch(`${base}/api/internal/cashdesk/alert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
        body: JSON.stringify({ kind: 'rate_volatility', text, pair: a.pair, chg_pct: a.chgPct, from: a.from, to: a.to }),
      })
      if (r.ok) return true
    } catch {
      /* падаем на fallback */
    }
  }

  // 2) fallback — прямой Telegram
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID
  if (!token || !chat) return false
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    return r.ok
  } catch {
    return false
  }
}
