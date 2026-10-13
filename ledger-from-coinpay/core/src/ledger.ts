/**
 * Леджер: двойная запись.
 * Конвенция знака: amountMinor > 0 — кредит, < 0 — дебет.
 * Инвариант: сумма всех проводок транзакции строго равна 0n.
 */

import type { Minor } from './money';
import { applyRateBp, computeFee } from './money';

export interface EntryDraft {
  accountId: string;
  amountMinor: Minor;
  /**
   * Валюта проводки (F2a). Инвариант баланса проверяется ПО КАЖДОЙ валюте
   * отдельно. Не задана → одна группа (одновалютная tx, весь F1) — поведение
   * идентично прежнему.
   */
  currency?: string;
}

export type LedgerTxKind =
  | 'capture'
  | 'fee'
  | 'agent_fee'
  | 'refund'
  | 'payout'
  | 'reserve_hold'
  | 'reserve_release'
  | 'adjustment'
  | 'fx_topup'
  | 'qr_hold'
  | 'qr_settlement'
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'exchange'
  | 'incassation'
  | 'reinforcement'
  | 'storno'
  | 'revaluation';

export interface TxDraft {
  kind: LedgerTxKind;
  entries: EntryDraft[];
  idempotencyKey?: string;
}

/**
 * Бросает Error, если проводки пусты или не балансируются в 0n
 * ПО КАЖДОЙ валюте отдельно (F2a). Одновалютная tx (без currency или одна
 * валюта) — одна группа, поведение как раньше. Обмен: нога RUB и нога USD
 * балансируются в ноль независимо.
 */
export function assertBalanced(entries: EntryDraft[]): void {
  if (entries.length === 0) {
    throw new Error('Леджер: транзакция без проводок');
  }
  const byCurrency = new Map<string, Minor>();
  for (const e of entries) {
    const cur = e.currency ?? '';
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0n) + e.amountMinor);
  }
  for (const [cur, sum] of byCurrency) {
    if (sum !== 0n) {
      throw new Error(
        `Леджер: сумма проводок не равна нулю${cur ? ` по валюте ${cur}` : ''} (${sum})`,
      );
    }
  }
}

export interface FeeSplit {
  /** Полная комиссия, удерживаемая с мерчанта. */
  total: Minor;
  /** Доля платформы (базовая ставка). */
  platform: Minor;
  /** Доля агента (надбавка сверх базовой ставки). */
  agent: Minor;
}

/**
 * Делит комиссию мерчанта между платформой и агентом.
 * total = computeFee(amount, merchantRateBp, minFeeMinor);
 * platform = applyRateBp(amount, platformBaseRateBp);
 * agent = total - platform. Отрицательный agent — нарушение инварианта
 * (ставка мерчанта ниже базовой платформы) → Error.
 */
export function splitFee(
  amount: Minor,
  merchantRateBp: number,
  platformBaseRateBp: number,
  minFeeMinor: Minor,
): FeeSplit {
  const total = computeFee(amount, merchantRateBp, minFeeMinor);
  const platform = applyRateBp(amount, platformBaseRateBp);
  const agent = total - platform;
  if (agent < 0n) {
    throw new Error(
      `splitFee: ставка мерчанта (${merchantRateBp} bp) ниже базовой ставки платформы (${platformBaseRateBp} bp) — доля агента отрицательна`,
    );
  }
  return { total, platform, agent };
}

export interface CaptureAccounts {
  merchantSettlement: string;
  /**
   * Ностро платформы, куда физически зачисляются СБП-деньги эквайринга и с которого списываются
   * затраты банка. Выбирает вызывающий: при capture — ностро приёма 4pmts из привязки мерчанта
   * (у разных мерчантов — разные ностро), при возврате — ностро исходной проводки capture счёта.
   * 447-payable в capture не используется (оплаты до 25.07 проведены по старой схеме, без ноги
   * ностро); поле `platformPayable` оставлено опциональным для обратной совместимости.
   */
  platformNostro: string;
  platformPayable?: string;
  platformFeeIncome: string;
  agentFeeIncome?: string;
  /** Волна 2-3: счёт затрат банка/НСПК (bank_fees, капитал платформы). */
  bankFees?: string;
}

export interface BuildCaptureTxParams {
  amount: Minor;
  merchantRateBp: number;
  platformBaseRateBp: number;
  minFeeMinor: Minor;
  accounts: CaptureAccounts;
  /** Затраты банка/НСПК в копейках = amount×(nspk+bank)bp. Списываются с интейка 447 в bank_fees. */
  bankFeeMinor?: Minor;
  idempotencyKey?: string;
}

/**
 * Оплата счёта (одна транзакция kind:'capture'):
 *  • дебет platformNostro «Интейк СБП» (−amount), кредит merchantSettlement (+amount);
 *  • дебет merchantSettlement (−total), кредит platformFeeIncome, кредит agentFeeIncome.
 * Без агента вся комиссия — платформе. Чистый settlement = amount − total.
 */
export function buildCaptureTx(p: BuildCaptureTxParams): TxDraft {
  if (p.amount <= 0n) {
    throw new Error(`buildCaptureTx: сумма должна быть положительной, получено ${p.amount}`);
  }
  const { accounts } = p;
  const entries: EntryDraft[] = [
    { accountId: accounts.platformNostro, amountMinor: -p.amount },
    { accountId: accounts.merchantSettlement, amountMinor: p.amount },
  ];

  if (accounts.agentFeeIncome !== undefined) {
    const { total, platform, agent } = splitFee(
      p.amount,
      p.merchantRateBp,
      p.platformBaseRateBp,
      p.minFeeMinor,
    );
    if (total > 0n) {
      entries.push({ accountId: accounts.merchantSettlement, amountMinor: -total });
      entries.push({ accountId: accounts.platformFeeIncome, amountMinor: platform });
      if (agent !== 0n) {
        entries.push({ accountId: accounts.agentFeeIncome, amountMinor: agent });
      }
    }
  } else {
    // Прямой мерчант без агента — вся комиссия платформе.
    const total = computeFee(p.amount, p.merchantRateBp, p.minFeeMinor);
    if (total > 0n) {
      entries.push({ accountId: accounts.merchantSettlement, amountMinor: -total });
      entries.push({ accountId: accounts.platformFeeIncome, amountMinor: total });
    }
  }

  // Волна 2-3: затраты банка/НСПК. Списываются с единого интейка (ностро «Интейк СБП»)
  // в счёт затрат bank_fees (расход капитала): на интейке остаётся A−B (что реально
  // получили после удержания банка), капитал = доход − затраты. Σ по валюте сохраняется.
  if (p.bankFeeMinor !== undefined && p.bankFeeMinor > 0n && accounts.bankFees) {
    entries.push({ accountId: accounts.bankFees, amountMinor: -p.bankFeeMinor });
    entries.push({ accountId: accounts.platformNostro, amountMinor: p.bankFeeMinor });
  }

  assertBalanced(entries);
  const tx: TxDraft = { kind: 'capture', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}

export interface BuildRefundTxParams {
  amount: Minor;
  feeTotal: Minor;
  feePlatform: Minor;
  feeAgent: Minor;
  accounts: CaptureAccounts;
  idempotencyKey?: string;
}

/**
 * Возврат — зеркало capture: деньги возвращаются плательщику,
 * комиссия сторнируется. Все проводки инвертированы.
 *
 * TODO(A4+): политика «комиссия НЕ возвращается мерчанту» при возврате —
 * обсудить отдельно. Сейчас возврат полностью зеркальный (сторнирует и комиссию).
 * Если политику примут — feePlatform/feeAgent при возврате не сторнируем,
 * а оставляем на fee_income платформы/агента (мерчанту вернётся amount − fee).
 */
export function buildRefundTx(p: BuildRefundTxParams): TxDraft {
  if (p.amount <= 0n) {
    throw new Error(`buildRefundTx: сумма должна быть положительной, получено ${p.amount}`);
  }
  if (p.feeTotal < 0n || p.feePlatform < 0n || p.feeAgent < 0n) {
    throw new Error('buildRefundTx: компоненты комиссии не могут быть отрицательными');
  }
  if (p.feePlatform + p.feeAgent !== p.feeTotal) {
    throw new Error(
      `buildRefundTx: feePlatform + feeAgent (${p.feePlatform + p.feeAgent}) != feeTotal (${p.feeTotal})`,
    );
  }
  const { accounts } = p;
  if (p.feeAgent > 0n && accounts.agentFeeIncome === undefined) {
    throw new Error('buildRefundTx: feeAgent > 0, но счёт agentFeeIncome не задан');
  }

  const entries: EntryDraft[] = [
    // Зеркало capture: возвращаем деньги на интейк, снимаем долг мерчанту.
    { accountId: accounts.platformNostro, amountMinor: p.amount },
    { accountId: accounts.merchantSettlement, amountMinor: -p.amount },
  ];
  if (p.feeTotal > 0n) {
    // Сторно комиссии: возвращаем её мерчанту.
    entries.push({ accountId: accounts.merchantSettlement, amountMinor: p.feeTotal });
    if (p.feePlatform > 0n) {
      entries.push({ accountId: accounts.platformFeeIncome, amountMinor: -p.feePlatform });
    }
    if (p.feeAgent > 0n && accounts.agentFeeIncome !== undefined) {
      entries.push({ accountId: accounts.agentFeeIncome, amountMinor: -p.feeAgent });
    }
  }

  assertBalanced(entries);
  const tx: TxDraft = { kind: 'refund', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}

export interface BuildFxTopupTxParams {
  /** Сумма пополнения по СБП QR (RUB, копейки). */
  amount: Minor;
  accounts: {
    /** Платформенный ностро-RUB — точка входа средств из СБП. */
    platformNostro: string;
    /** Клиентский расчётный RUB-счёт контрагента. */
    clientSettlement: string;
  };
  idempotencyKey?: string;
}

/**
 * Пополнение клиентского счёта контрагента по СБП QR (F2a, вариант A).
 * Деньги пришли на платформенный ностро-RUB → зачисляются на клиентский счёт
 * полностью. Комиссии пополнения НЕТ (доход платформы — спред на обмене).
 * НЕ создаёт merchant-capture. Одна валюта.
 */
export function buildFxTopupTx(p: BuildFxTopupTxParams): TxDraft {
  if (p.amount <= 0n) {
    throw new Error(`buildFxTopupTx: сумма должна быть положительной, получено ${p.amount}`);
  }
  const { accounts } = p;
  const entries: EntryDraft[] = [
    { accountId: accounts.platformNostro, amountMinor: -p.amount },
    { accountId: accounts.clientSettlement, amountMinor: p.amount },
  ];
  assertBalanced(entries);
  const tx: TxDraft = { kind: 'fx_topup', entries };
  if (p.idempotencyKey !== undefined) tx.idempotencyKey = p.idempotencyKey;
  return tx;
}
