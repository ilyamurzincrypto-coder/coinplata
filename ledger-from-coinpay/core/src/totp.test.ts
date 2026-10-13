import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryFormat,
  totpCode,
  verifyTotp,
} from './totp';
import { is2faRequired, shouldRemind2fa } from './two-factor-policy';

// RFC 6238 тест-секрет SHA1: ASCII "12345678901234567890" → base32.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  it('round-trip', () => {
    const buf = Buffer.from('hello world', 'utf8');
    expect(base32Decode(base32Encode(buf)).toString('utf8')).toBe('hello world');
  });
  it('RFC-секрет декодируется в исходный ASCII', () => {
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
  });
});

describe('TOTP по RFC 6238 (последние 6 цифр эталонных значений)', () => {
  // RFC 6238 (SHA1): T=59→94287082, T=1111111109→07081804, T=1234567890→89005924.
  it('T=59 → 287082', () => {
    expect(totpCode(RFC_SECRET, 59)).toBe('287082');
  });
  it('T=1111111109 → 081804', () => {
    expect(totpCode(RFC_SECRET, 1111111109)).toBe('081804');
  });
  it('T=1234567890 → 005924', () => {
    expect(totpCode(RFC_SECRET, 1234567890)).toBe('005924');
  });
});

describe('verifyTotp окно ±1', () => {
  it('верный код текущего шага проходит и возвращает step', () => {
    const t = 1234567890;
    const code = totpCode(RFC_SECRET, t);
    const r = verifyTotp(RFC_SECRET, code, { timeSec: t });
    expect(r.ok).toBe(true);
    expect(r.step).toBe(Math.floor(t / 30));
  });
  it('код соседнего шага проходит в окне ±1', () => {
    const t = 1234567890;
    const prev = totpCode(RFC_SECRET, t - 30);
    expect(verifyTotp(RFC_SECRET, prev, { timeSec: t, window: 1 }).ok).toBe(true);
  });
  it('код вне окна не проходит', () => {
    const t = 1234567890;
    const far = totpCode(RFC_SECRET, t - 300);
    expect(verifyTotp(RFC_SECRET, far, { timeSec: t, window: 1 }).ok).toBe(false);
  });
  it('мусор не проходит', () => {
    expect(verifyTotp(RFC_SECRET, 'abc', { timeSec: 59 }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, '000000', { timeSec: 59 }).ok).toBe(false);
  });
});

describe('recovery-коды', () => {
  it('10 кодов формата xxxxx-xxxxx, хэши совпадают', () => {
    const { codes, hashes } = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    for (let i = 0; i < codes.length; i++) {
      expect(isRecoveryFormat(codes[i]!)).toBe(true);
      expect(hashRecoveryCode(codes[i]!)).toBe(hashes[i]);
    }
    // нормализация: дефис/регистр не важны
    expect(hashRecoveryCode(codes[0]!.toUpperCase())).toBe(hashes[0]);
    expect(hashRecoveryCode(codes[0]!.replace('-', ''))).toBe(hashes[0]);
  });
});

describe('требуемость 2FA по ролям', () => {
  it('все employees — обязательна', () => {
    for (const r of ['admin', 'risk_officer', 'finance', 'support']) {
      expect(is2faRequired('employee', r)).toBe(true);
    }
  });
  it('🔴 мерчанту 2FA НЕ обязательна — ни владельцу, ни оператору', () => {
    // Решение владельца: барьер на первом входе останавливал мерчанта на пороге продукта.
    // Вместо барьера — напоминание внутри кабинета.
    expect(is2faRequired('merchant_user', 'owner')).toBe(false);
    expect(is2faRequired('merchant_user', 'operator')).toBe(false);
  });

  it('РЕГРЕСС: у сотрудников и владельца агента обязательность НЕ снята', () => {
    expect(is2faRequired('employee', 'admin')).toBe(true);
    expect(is2faRequired('employee', 'support')).toBe(true);
    expect(is2faRequired('agent_user', 'owner')).toBe(true);
    expect(is2faRequired('agent_user', 'staff')).toBe(false);
  });

  it('напоминание: владельцу мерчанта без 2FA — да; с 2FA и оператору — нет', () => {
    expect(shouldRemind2fa('merchant_user', 'owner', false)).toBe(true);
    expect(shouldRemind2fa('merchant_user', 'owner', true)).toBe(false);
    expect(shouldRemind2fa('merchant_user', 'operator', false)).toBe(false);
    expect(shouldRemind2fa('employee', 'admin', false)).toBe(false); // у сотрудника это не напоминание, а требование
  });
});
