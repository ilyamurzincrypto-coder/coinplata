// src/utils/password.js
// Mock-hashing. В проде — bcrypt/argon2 на backend. Здесь — детерминированный
// hash для клиент-демо. ВАЖНО: этого НЕ достаточно для реальной security, и
// бэкенд должен никогда не принимать client-side hash как источник правды.

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) return "";
  const salt = "coinplata-demo-v1";
  return `mock$${djb2(salt + plain)}$${plain.length}`;
}

export function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return hashPassword(plain) === hash;
}

export function generateInviteToken(len = 28) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
