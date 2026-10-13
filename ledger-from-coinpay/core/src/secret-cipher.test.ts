import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isEncrypted, openSecret, parseKeyring, sealSecret, type Keyring } from './secret-cipher';

const k = (v: number) => `${v}:${randomBytes(32).toString('base64')}`;
function ring(csv: string, active: string): Keyring {
  return parseKeyring(csv, active);
}
const AAD = 'two_factor.secret';

describe('secret-cipher — AES-256-GCM at-rest', () => {
  it('round-trip: seal → open = исходник, формат enc:<v>:', () => {
    const r = ring(k(1), '1');
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', r, AAD);
    expect(sealed.startsWith('enc:1:')).toBe(true);
    expect(isEncrypted(sealed)).toBe(true);
    expect(openSecret(sealed, r, AAD)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('dual-read: легаси-плейнтекст возвращается как есть', () => {
    const r = ring(k(1), '1');
    expect(isEncrypted('PLAINSECRET')).toBe(false);
    expect(openSecret('PLAINSECRET', r, AAD)).toBe('PLAINSECRET');
  });

  it('неверный ключ → ошибка аутентификации', () => {
    const r1 = ring(k(1), '1');
    const sealed = sealSecret('secret', r1, AAD);
    const r2 = ring(k(1), '1'); // другой случайный ключ версии 1
    expect(() => openSecret(sealed, r2, AAD)).toThrow();
  });

  it('подделанный шифртекст → ошибка (GCM-тег)', () => {
    const r = ring(k(1), '1');
    const sealed = sealSecret('secret', r, AAD);
    const parts = sealed.split(':'); // ["enc", "<version>", "<base64>"]
    const buf = Buffer.from(parts[2]!, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff; // портим последний байт ct
    const tampered = `enc:${parts[1]}:${buf.toString('base64')}`;
    expect(() => openSecret(tampered, r, AAD)).toThrow();
  });

  it('несовпадение AAD → ошибка (нельзя переставить между колонками)', () => {
    const r = ring(k(1), '1');
    const sealed = sealSecret('secret', r, 'two_factor.secret');
    expect(() => openSecret(sealed, r, 'shops.webhook_secret')).toThrow();
  });

  it('версия ключа: шифруем активной, расшифровываем правильной (ротация)', () => {
    const key1 = k(1);
    const key2 = k(2);
    const encRing = ring(`${key1},${key2}`, '2'); // active = 2
    const sealed = sealSecret('secret', encRing, AAD);
    expect(sealed.startsWith('enc:2:')).toBe(true);
    // кольцо с обоими ключами расшифрует; без ключа v2 — упадёт
    expect(openSecret(sealed, encRing, AAD)).toBe('secret');
    const onlyV1 = ring(key1, '1');
    expect(() => openSecret(sealed, onlyV1, AAD)).toThrow(/версии 2/);
  });

  it('strict-режим: плейнтекст бросает, шифртекст проходит', () => {
    const r = ring(k(1), '1');
    const sealed = sealSecret('secret', r, AAD);
    expect(openSecret(sealed, r, AAD, { strict: true })).toBe('secret'); // enc: — ок
    expect(() => openSecret('PLAINLEGACY', r, AAD, { strict: true })).toThrow(/strict/); // легаси — отказ
    expect(openSecret('PLAINLEGACY', r, AAD)).toBe('PLAINLEGACY'); // без strict — dual-read
  });

  it('parseKeyring: отвергает не-32-байтные ключи и отсутствующий active', () => {
    expect(() => parseKeyring(`1:${Buffer.from('short').toString('base64')}`, '1')).toThrow();
    expect(() => parseKeyring(k(1), '2')).toThrow(/активного ключа нет/);
  });
});
