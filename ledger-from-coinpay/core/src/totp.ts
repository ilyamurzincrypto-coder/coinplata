import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

/**
 * TOTP по RFC 6238 (HMAC-SHA1, шаг 30с, 6 цифр) без внешних сервисов.
 * verifyTotp возвращает совпавший timestep — вызывающий хранит его для анти-replay
 * (верный код нельзя использовать дважды).
 */

const STEP_SEC = 30;
const DIGITS = 6;
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── base32 (RFC 4648, без паддинга) ──
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Секрет 20 байт → base32 (как в authenticator-приложениях). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secretB32: string, counter: number): string {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  // 64-битный счётчик BE (старшие 32 бита практически 0 для TOTP).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function currentStep(timeSec: number): number {
  return Math.floor(timeSec / STEP_SEC);
}

export function totpCode(secretB32: string, timeSec: number): string {
  return hotp(secretB32, currentStep(timeSec));
}

export interface VerifyResult {
  ok: boolean;
  step?: number;
}

/**
 * Проверка кода в окне ±window шагов. Возвращает совпавший step (для анти-replay).
 * Сравнение времени-постоянное по длине строки не делаем — коды 6 цифр, вектор
 * тайминга ничтожен; критичнее lockout по попыткам (на уровне приложения).
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { timeSec: number; window?: number },
): VerifyResult {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { ok: false };
  const window = opts.window ?? 1;
  const base = currentStep(opts.timeSec);
  for (let d = -window; d <= window; d++) {
    if (hotp(secretB32, base + d) === normalized) return { ok: true, step: base + d };
  }
  return { ok: false };
}

export function otpauthUri(secretB32: string, opts: { label: string; issuer: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.label}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery-коды ──
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function rcGroup(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += RC_ALPHABET[randomInt(RC_ALPHABET.length)];
  return s;
}

/** Нормализация recovery-кода для сравнения (регистр/дефисы не важны). */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const code = `${rcGroup()}-${rcGroup()}`;
    codes.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { codes, hashes };
}

export function isRecoveryFormat(code: string): boolean {
  return /^[a-z0-9]{5}-?[a-z0-9]{5}$/i.test(code.trim());
}
