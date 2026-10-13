/**
 * Статический QR СБП — ссылка https://qr.nspk.ru/<id>. НСПК принимает у неё сумму параметрами
 * `sum` (копейки) и `cur`. «Динамический» QR кассы = та же ссылка точки + сумма. Сумма — только
 * предзаполнение: в банке её можно поменять, поэтому кассир сверяет сумму на чеке клиента.
 */
export const NSPK_QR_HOST = 'qr.nspk.ru';

export function isStaticNspkLink(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.hostname === NSPK_QR_HOST && /^\/[A-Za-z0-9]{16,64}$/.test(u.pathname);
}

export function staticQrWithAmount(baseUrl: string, rubMinor: bigint): string {
  if (!isStaticNspkLink(baseUrl)) throw new Error('staticQrWithAmount: ожидается ссылка https://qr.nspk.ru/<id>');
  if (rubMinor <= 0n) throw new Error('staticQrWithAmount: сумма должна быть больше нуля');
  const u = new URL(baseUrl);
  u.searchParams.set('sum', rubMinor.toString());
  u.searchParams.set('cur', 'RUB');
  return u.toString();
}
