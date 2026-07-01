/**
 * Касса → CoinPoint: кассир вернул жизнь заявки (пришёл/провести/отмена/no-show).
 * Фронт зовёт ЭТУ функцию со своим Supabase-JWT (секрет coinpoint тут, на сервере).
 * Проверяем, что вызывающий — аутентифицированный пользователь кассы, затем
 * форвардим в coinpoint POST /orders/:id/status с x-cashdesk-secret.
 *
 * Body: { order_id, status: 'arrived'|'completed'|'cancelled'|'no_show',
 *         arrived_at?, cashdesk_deal_id?, amount_fact?, rate_fact?, completed_by?, note? }
 * ENV: COINPOINT_API_URL, CASHDESK_API_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY.
 */
import { requireStaff } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !secret || !supaUrl || !anon) return res.status(503).json({ error: 'bridge env not configured' })

  // Аутентификация + авторизация: только активный сотрудник кассы (любая роль).
  let caller
  try {
    caller = await requireStaff(req, { supaUrl, anon, svcKey: process.env.SUPABASE_SERVICE_ROLE_KEY })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
  const orderId = Number(body.order_id)
  if (!Number.isFinite(orderId) || orderId <= 0) return res.status(400).json({ error: 'order_id required' })
  const { order_id, ...rest } = body // rest = { status, arrived_at, cashdesk_deal_id, ... }
  // Пробрасываем личность вызывающего — coinpoint enforce'ит office-scoping заявки.
  const payload = { ...rest, cashier_user_id: caller.userId, cashier_office_id: caller.officeId }

  const r = await fetch(`${base}/api/internal/cashdesk/orders/${orderId}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
    body: JSON.stringify(payload),
  })
  const text = await r.text()
  res.status(r.status)
  try { return res.json(JSON.parse(text)) } catch { return res.send(text) }
}
