/**
 * Мост CoinPoint → касса. Vercel-функция (cron, ~1 мин): тянет открытые/дельту
 * онлайн-заявок из coinpoint и upsert'ит в public.manager_orders.
 *
 * Секрет coinpoint (x-cashdesk-secret) и service-role Supabase живут ТОЛЬКО тут,
 * на сервере — фронт кассы их не видит и читает manager_orders через realtime.
 *
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL,
 *      SUPABASE_SERVICE_ROLE_KEY, (опц.) CRON_SECRET, CASHDESK_OFFICES="ANT,IST,MSK".
 */
import { createClient } from '@supabase/supabase-js'

const OFFICES = (process.env.CASHDESK_OFFICES || 'ANT,IST,MSK').split(',').map((s) => s.trim()).filter(Boolean)

// coinpoint bot_orders.status → manager_orders.status (pending|done|cancelled).
function mapStatus(s) {
  if (s === 'completed') return 'done'
  if (s === 'cancelled' || s === 'expired') return 'cancelled'
  return 'pending' // new / awaiting_verification / verification_pending / verified / in_progress
}

export default async function handler(req, res) {
  // Vercel cron шлёт Authorization: Bearer <CRON_SECRET> (если env задан).
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !secret || !supaUrl || !supaKey) {
    return res.status(503).json({ error: 'bridge env not configured' })
  }
  const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } })

  const summary = {}
  for (const office of OFFICES) {
    try {
      // курсор дельты
      const st = await supa.from('cashdesk_sync_state').select('last_since').eq('office', office).maybeSingle()
      const since = st.data?.last_since || null

      const url = new URL(`${base}/api/internal/cashdesk/orders`)
      url.searchParams.set('office', office)
      if (since) url.searchParams.set('since', since)
      const r = await fetch(url, { headers: { 'x-cashdesk-secret': secret } })
      if (!r.ok) { summary[office] = { error: `coinpoint ${r.status}` }; continue }
      const { orders } = await r.json()

      let upserts = 0
      for (const o of orders) {
        const row = {
          source_order_id: o.id,
          office_id: o.office_uuid,
          kind: o.kind,
          contact: o.contact,
          from_currency: o.from_currency_cashdesk,
          from_amount: o.from_amount,
          rate: o.rate != null ? String(o.rate) : null,
          to_currency: o.to_currency_cashdesk,
          to_amount: o.to_amount,
          status: mapStatus(o.status),
          meeting_at: o.meeting_at,
        }
        const up = await supa.from('manager_orders').upsert(row, { onConflict: 'source_order_id' })
        if (!up.error) upserts++
        else console.warn(`[cashdesk-sync] upsert #${o.id} failed:`, up.error.message)
      }

      // сдвигаем курсор на максимальный updated_at подтянутых (или now при пустом)
      const maxUpdated = orders.reduce((m, o) => (o.updated_at && o.updated_at > m ? o.updated_at : m), since || '')
      const nextSince = maxUpdated || new Date().toISOString()
      await supa.from('cashdesk_sync_state').upsert(
        { office, last_since: nextSince, updated_at: new Date().toISOString() },
        { onConflict: 'office' },
      )
      summary[office] = { pulled: orders.length, upserts }
    } catch (e) {
      summary[office] = { error: String(e?.message || e) }
    }
  }
  return res.status(200).json({ ok: true, offices: summary })
}
