/**
 * Общий guard для bridge-эндпоинтов кассы. Проверяет Supabase-JWT вызывающего
 * И что он — активный сотрудник кассы с нужной ролью. Без этой проверки любой
 * залогиненный пользователь мог бы форвардить действия в coinpoint с привил.
 * секретом (IDOR: чужие заявки / закрытие дня любого офиса).
 *
 * Роль/офис читаем service-ключом (обход RLS, надёжно); если его нет — по токену
 * (тогда нужна RLS-политика «читать свой users-row»).
 */
import { createClient } from '@supabase/supabase-js'

export const STAFF_ROLES = ['owner', 'admin', 'accountant', 'manager']

export async function requireStaff(req, { supaUrl, anon, svcKey }, { roles = STAFF_ROLES } = {}) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) throw { status: 401, error: 'auth required' }

  const supa = createClient(supaUrl, anon, { auth: { persistSession: false } })
  const who = await supa.auth.getUser(token)
  if (who.error || !who.data?.user) throw { status: 401, error: 'invalid session' }
  const userId = who.data.user.id

  const reader = svcKey ? createClient(supaUrl, svcKey, { auth: { persistSession: false } }) : supa
  const { data: staff, error } = await reader
    .from('users')
    .select('role, office_id, status')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw { status: 500, error: 'role lookup failed' }
  if (!staff || (staff.status && staff.status !== 'active') || !roles.includes(staff.role)) {
    throw { status: 403, error: 'forbidden' }
  }
  return { userId, role: staff.role, officeId: staff.office_id }
}
