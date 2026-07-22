// src/lib/shareLinks.js
// Клиент кассы к управлению share-ссылками раздела «Счета» (/api/share/manage).
// Все вызовы — с JWT сотрудника (создание/список/отзыв только для персонала).
// Публичное чтение по токену идёт мимо — прямо на /api/share/accounts.
import { supabase } from "./supabase.js";

async function authHeaders(json = false) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const h = token ? { authorization: `Bearer ${token}` } : {};
  if (json) h["content-type"] = "application/json";
  return h;
}

// Публичный URL ссылки по токену (для копирования). Читается без логина.
export function shareUrl(token) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/accounts/${token}`;
}

/** Активные (не отозванные) ссылки раздела «Счета». */
export async function listShareLinks() {
  const r = await fetch("/api/share/manage", { headers: await authHeaders() });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `list ${r.status}`);
  return Array.isArray(body.tokens) ? body.tokens : [];
}

/** Создать ссылку под разрез scope ∈ all|fiat|crypto. allowDetails — открыть по
 *  ссылке drill-down в детали крипто-кошелька. Возвращает { id, token, scope, allowDetails }. */
export async function createShareLink(scope, allowDetails = false) {
  const r = await fetch("/api/share/manage", {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({ scope, allowDetails }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `create ${r.status}`);
  return body;
}

/** Публичные детали кошелька по share-токену (read-only, если у ссылки включены детали). */
export async function fetchShareWalletDetail(token, accountId) {
  const r = await fetch(`/api/share/wallet?token=${encodeURIComponent(token)}&accountId=${encodeURIComponent(accountId)}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error || `detail ${r.status}`), { status: r.status });
  return body;
}

/** Отозвать ссылку по id. После отзыва публичное чтение отдаёт 404. */
export async function revokeShareLink(id) {
  const r = await fetch(`/api/share/manage?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `revoke ${r.status}`);
  return body;
}
