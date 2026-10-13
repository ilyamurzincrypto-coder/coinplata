import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Шифрование секретов at-rest: AES-256-GCM с версионированным мастер-ключом.
 * Формат хранения — самоописывающийся, в той же text-колонке (миграции схемы нет):
 *
 *   enc:<keyVersion>:<base64( iv(12) || authTag(16) || ciphertext )>
 *
 * Префикс `enc:` отличает шифртекст от легаси-плейнтекста → основа dual-read.
 * keyVersion выбирает мастер-ключ при расшифровке (задел на ротацию).
 * AAD (имя колонки) привязывает шифртекст к его месту — нельзя переставить
 * значение между колонками/сущностями.
 *
 * Node-only (node:crypto). Экспортируется подпутём @coincash/core/secret-cipher,
 * НЕ через баррель — чтобы node:crypto не попал в edge/клиентские бандлы.
 */

const PREFIX = 'enc:';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32; // AES-256

export interface Keyring {
  active: number;
  keys: Map<number, Buffer>;
}

/** Разбор кольца ключей из строк env: keysCsv="1:<b64>,2:<b64>", active="2". */
export function parseKeyring(keysCsv: string, activeStr: string): Keyring {
  const keys = new Map<number, Buffer>();
  for (const pair of keysCsv.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = pair.indexOf(':');
    if (i === -1) throw new Error('secret-cipher: неверная запись ключа (ожидалось "<version>:<base64>")');
    const version = Number(pair.slice(0, i));
    const key = Buffer.from(pair.slice(i + 1), 'base64');
    if (!Number.isInteger(version) || version < 1) throw new Error('secret-cipher: версия ключа должна быть целым ≥1');
    if (key.length !== KEY_LEN) throw new Error(`secret-cipher: ключ версии ${version} не 32 байта`);
    keys.set(version, key);
  }
  const active = Number(activeStr);
  if (!keys.has(active)) throw new Error('secret-cipher: активного ключа нет в кольце');
  return { active, keys };
}

/** Уже шифртекст в нашем формате? (иначе — легаси-плейнтекст). */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Зашифровать активным ключом. aad привязывает значение к контексту (имя колонки). */
export function sealSecret(plain: string, keyring: Keyring, aad: string): string {
  const key = keyring.keys.get(keyring.active);
  if (!key) throw new Error('secret-cipher: активный ключ недоступен');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${keyring.active}:${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

/**
 * Расшифровать. Легаси-плейнтекст (без префикса) возвращается как есть (dual-read),
 * КРОМЕ строгого режима (opts.strict) — тогда встреченный плейнтекст бросает: гарантия,
 * что после backfill плейнтекста не осталось и регрессии (новый плейнтекст) не пройдут.
 * Битый тег/неверный ключ/несовпадение AAD → бросает (GCM-аутентификация).
 */
export function openSecret(stored: string, keyring: Keyring, aad: string, opts?: { strict?: boolean }): string {
  if (!isEncrypted(stored)) {
    if (opts?.strict) throw new Error('secret-cipher: strict-режим — обнаружен незашифрованный секрет');
    return stored; // dual-read
  }
  const rest = stored.slice(PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx === -1) throw new Error('secret-cipher: битый формат шифртекста');
  const version = Number(rest.slice(0, idx));
  const key = keyring.keys.get(version);
  if (!key) throw new Error(`secret-cipher: ключ версии ${version} недоступен для расшифровки`);
  const buf = Buffer.from(rest.slice(idx + 1), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('secret-cipher: шифртекст короче минимума');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Кэшируем ТОЛЬКО кольцо ключей (KEK, и так в env-памяти). Расшифрованные секреты
// не кэшируем никогда — читаем per-use и сбрасываем.
let cached: Keyring | null = null;

/** Кольцо ключей из env (SECRET_ENC_KEYS + SECRET_ENC_ACTIVE), мемоизировано. */
export function keyringFromEnv(): Keyring {
  if (cached) return cached;
  const keysCsv = process.env.SECRET_ENC_KEYS;
  const active = process.env.SECRET_ENC_ACTIVE;
  if (!keysCsv || !active) throw new Error('secret-cipher: SECRET_ENC_KEYS/SECRET_ENC_ACTIVE не заданы');
  cached = parseKeyring(keysCsv, active);
  return cached;
}

/** Только для тестов — сброс мемоизации. */
export function __resetKeyringCache(): void {
  cached = null;
}
