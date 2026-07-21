// src/lib/aegisMonitoring.js
// Клиент кассы к нашим AEGIS-endpoints (регистрация/обновление кошелька).
// AEGIS_API_KEY — секрет, живёт на сервере; браузер ходит сюда с JWT сотрудника.
import { supabase } from "./supabase.js";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

// «Подключить мониторинг»: регистрирует счёт в AEGIS, сохраняет aegis_wallet_id.
// Пробрасывает 409 (address_unavailable) и 503 (AEGIS ещё не поднят) как Error
// с полем code/status для явного показа в UI.
export async function connectMonitoring(accountId) {
  const r = await fetch("/api/aegis/register", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ accountId }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `register ${r.status}`), { status: r.status, code: body?.code });
  return body;
}

// Детали кошелька (Экран 3): getWallet+getStats+getTransactions через боевой
// эндпоинт (requireStaff). stats/transactions могут прийти available:false.
export async function fetchWalletDetail(accountId) {
  const r = await fetch(`/api/aegis/wallet?accountId=${encodeURIComponent(accountId)}`, { headers: await authHeaders() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `detail ${r.status}`), { status: r.status, code: body?.code });
  return body;
}

// Следующая страница движений («показать ещё»).
export async function fetchWalletTransactions(accountId, cursor) {
  const q = `accountId=${encodeURIComponent(accountId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const r = await fetch(`/api/aegis/wallet?${q}`, { headers: await authHeaders() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `tx ${r.status}`), { status: r.status });
  return body.transactions || { available: false, items: [], cursor: null, hasMore: false };
}

// «Обновить»: ручной пул сводки кошелька из AEGIS.
export async function refreshMonitoring(accountId) {
  const r = await fetch("/api/aegis/refresh", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ accountId }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `refresh ${r.status}`), { status: r.status, code: body?.code });
  return body;
}
