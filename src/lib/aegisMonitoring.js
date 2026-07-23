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

// Session-кэш деталей в памяти: повторное открытие того же кошелька в рамках
// сессии — мгновенно, без сети (TTL 60с). Живой запрос (live) кэш игнорирует и
// перезаписывает. Сам эндпоинт по умолчанию отдаёт кэш из БД (poll), а ?live=1 —
// свежий пул из AEGIS (кнопка «Обновить»).
const _detailMem = new Map(); // accountId → { at, body }
const _MEM_TTL = 60000;

// Детали кошелька (Экран 3). live=false → БД-кэш (мгновенно), live=true → свежий.
export async function fetchWalletDetail(accountId, { live = false } = {}) {
  if (!live) {
    const hit = _detailMem.get(accountId);
    if (hit && Date.now() - hit.at < _MEM_TTL) return hit.body;
  }
  const q = `accountId=${encodeURIComponent(accountId)}${live ? "&live=1" : ""}`;
  const r = await fetch(`/api/aegis/wallet?${q}`, { headers: await authHeaders() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `detail ${r.status}`), { status: r.status, code: body?.code });
  _detailMem.set(accountId, { at: Date.now(), body });
  return body;
}

// Оборотно-сальдовая ведомость он-чейн за период по выбранным счетам.
export async function fetchTurnover(accountIds, from, to) {
  const r = await fetch("/api/accounts/turnover", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ accountIds, from, to }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `turnover ${r.status}`), { status: r.status });
  return body;
}

// Скрыть/показать счёт в витрине (глазик). Общий флаг, staff-only.
export async function setAccountHidden(accountId, hidden) {
  const r = await fetch("/api/accounts/hidden", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ accountId, hidden }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `hide ${r.status}`), { status: r.status });
  return body;
}

// Общая лента крипто-движений (вкладка «Лог») — из кэша, по всем кошелькам.
export async function fetchCryptoLog(limit = 150) {
  const r = await fetch(`/api/aegis/log?limit=${limit}`, { headers: await authHeaders() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `log ${r.status}`), { status: r.status });
  return { items: body.items || [], total: body.total || 0 };
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
