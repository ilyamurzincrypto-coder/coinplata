/**
 * (Правка 3б) Модель газовой проводки — чистая, БЕЗ БД (тест Σ=0). Закладка под Фазу 6:
 * исходящий перевод/выдача токена в газовой сети → к основным ногам (в валюте токена)
 * добавляется ПАРА газа в НАТИВНОЙ валюте сети: «кредит позиции нативной валюты (TRX ушли)
 * · дебет network_fees (расход газа)». Σ = 0 по КАЖДОЙ валюте: газовая пара в TRX, основная
 * в валюте токена — не смешиваются. Знак amount_minor: >0 кредит, <0 дебет.
 */
export interface Leg {
  accountId: string;
  amountMinor: bigint;
  currency: string;
}

export interface GasSpec {
  gasCurrency: string; // нативная валюта сети (TRX)
  gasMinor: bigint; // фактический газ (minor нативной валюты; дефолт из networks.default_gas_fee)
  gasPositionAccountId: string; // позиция/кошелёк нативной валюты
  networkFeesAccountId: string; // счёт расходов сети (kind network_fees, в нативной валюте)
}

/** Пара газа: кредит нативной позиции (TRX ушли), дебет network_fees (расход). Σ нативной = 0. */
export function buildGasLegs(gas: GasSpec): Leg[] {
  return [
    { accountId: gas.gasPositionAccountId, amountMinor: gas.gasMinor, currency: gas.gasCurrency }, // кредит: TRX ушли
    { accountId: gas.networkFeesAccountId, amountMinor: -gas.gasMinor, currency: gas.gasCurrency }, // дебет: расход газа
  ];
}

/** Исходящий перевод токена + газ = 4 ноги. Основная пара — в валюте токена (Σ=0),
 *  газовая пара — в нативной (Σ=0). */
export function buildTokenTransferWithGas(p: {
  tokenCurrency: string;
  tokenMinor: bigint;
  fromTokenAccountId: string;
  toTokenAccountId: string;
  gas: GasSpec;
}): Leg[] {
  return [
    { accountId: p.fromTokenAccountId, amountMinor: p.tokenMinor, currency: p.tokenCurrency }, // источник (кредит — токен ушёл)
    { accountId: p.toTokenAccountId, amountMinor: -p.tokenMinor, currency: p.tokenCurrency }, // получатель (дебет)
    ...buildGasLegs(p.gas),
  ];
}

/**
 * (Волна 4 №1) Детерминированный резолв нативной монеты сети для газа. Нативная монета
 * могла быть заведена как «TRX» или ошибочно «TRX-TRC20» — сопоставляем по приоритету:
 * 1) привязка network_id, 2) точный код == gas_currency, 3) база кода == gas_currency;
 * среди равных — enabled раньше disabled (после санации дубля чистый TRX выигрывает).
 * Чистая (без БД) — тестируется.
 */
export interface NativeCoinCand {
  code: string;
  networkId: string | null;
  enabled: boolean;
}
export function resolveNativeCoin<T extends NativeCoinCand>(coins: T[], net: { id: string; gasCurrency: string | null }): T | undefined {
  const gas = net.gasCurrency;
  if (!gas) return undefined;
  const base = (code: string) => (code.includes('-') ? code.split('-')[0]! : code);
  const s = (x: T) => (x.networkId === net.id ? 3 : x.code === gas ? 2 : base(x.code) === gas ? 1 : 0);
  return coins.filter((x) => s(x) > 0).sort((a, b) => s(b) - s(a) || Number(b.enabled) - Number(a.enabled))[0];
}

/**
 * (Волна 4 ж) Гейт реквизитов кошелька. Фиат → банк (не кошелёк, ok). Крипта → кошелёк:
 * нужен custody И у валюты должна быть сеть (network_id) — сеть кошелька берётся из валюты
 * (совпадение гарантировано, рассинхрон невозможен). Чистая — тестируется.
 */
export function walletGate(currency: { kind: string; networkId: string | null }, custody: string | null | undefined): { ok: true } | { ok: false; error: string } {
  if (currency.kind !== 'crypto') return { ok: true };
  if (!custody) return { ok: false, error: 'Укажите тип хранения кошелька (биржа / горячий / холодный)' };
  if (!currency.networkId) return { ok: false, error: 'У валюты не задана сеть — кошелёк без сети непроводим' };
  return { ok: true };
}

/** Σ amount_minor по каждой валюте — для проверки инварианта двойной записи per-currency. */
export function sumByCurrency(legs: Leg[]): Record<string, bigint> {
  const acc: Record<string, bigint> = {};
  for (const l of legs) acc[l.currency] = (acc[l.currency] ?? 0n) + l.amountMinor;
  return acc;
}
