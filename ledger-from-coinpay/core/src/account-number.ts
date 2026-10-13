/**
 * Человеко-читаемые номера счетов леджера по классификации эксперта (Волна 1).
 * Маска: `{КЛАСС+ТИП}-{ВЛАДЕЛЕЦ[.точка]}-{ВАЛЮТА}-{ФОРМА}`
 *   `140-C0001-643-02` = Лоро · клиент #1 · RUB · безнал
 *   `220-P0001-643-01` = Касса · платформа · RUB · нал
 *   `140-C0001.01-643-02` = субсчёт-точка №01 того же клиента
 *
 * • КЛАСС (ведущая цифра): 1 Лоро (обязательства перед контрагентами), 2 Ностро
 *   и кассы (денежные активы), 3 Капитал (позиция/переоценка/доход), 4 Эквайринг
 *   (мерчанты/агенты — скрытая вкладка). Две следующие цифры — узнаваемый тип.
 * • ФОРМА: 01 нал · 02 безнал · 00 без формы (капитальные). У эксперта один
 *   клиент держит нал- и безнал-счета одной валюты как РАЗНЫЕ счета — форма в
 *   номере их различает.
 *
 * Число собирается чистой функцией: одинаковый вход → один номер (тест).
 */

import { SEED_CURRENCY_NUM } from './currencies';

export type AccountKindCode =
  | 'settlement'
  | 'hold'
  | 'reserve'
  | 'fee_income'
  | 'payable'
  | 'nostro'
  | 'cash_desk'
  | 'position'
  | 'countervalue'
  | 'reval_pnl'
  | 'bank_fees'
  | 'network_fees'
  | 'exchange_income';

export type AccountOwnerType = 'platform' | 'agent' | 'merchant' | 'counterparty';

/** Форма счёта → суффикс номера. */
export type AccountForm = 'cash' | 'cashless' | null | undefined;

/** Тип-код (класс+тип) по паре (вид, владелец). */
function typeCode(kind: AccountKindCode, ownerType: AccountOwnerType): string | null {
  if (ownerType === 'counterparty') {
    if (kind === 'settlement') return '140'; // Лоро
    return null;
  }
  if (ownerType === 'platform') {
    switch (kind) {
      case 'cash_desk': return '220';
      case 'nostro': return '230';
      case 'position': return '352';
      case 'countervalue': return '353';
      case 'reval_pnl': return '371';
      case 'fee_income': return '370';
      case 'exchange_income': return '374'; // (Д2) доход от обмена — курсовая маржа, ОТДЕЛЬНО от эквайринг-370
      case 'bank_fees': return '372'; // затраты банка/НСПК (рядом с доходом 370)
      case 'network_fees': return '373'; // затраты газа блокчейн-сетей (рядом с bank_fees 372)
      case 'payable': return '447';
      default: return null;
    }
  }
  // merchant / agent — эквайринг (4xx).
  switch (kind) {
    case 'settlement': return '440';
    case 'hold': return '445';
    case 'reserve': return '446';
    case 'payable': return '447';
    case 'fee_income': return '470'; // комиссия агента
    default: return null;
  }
}

function formSuffix(form: AccountForm): string {
  if (form === 'cash') return '01';
  if (form === 'cashless') return '02';
  return '00';
}

const OWNER_CODE: Record<AccountOwnerType, string> = {
  platform: 'P',
  agent: 'A',
  merchant: 'M',
  counterparty: 'C',
};

export interface AccountNumberInput {
  kind: AccountKindCode;
  ownerType: AccountOwnerType;
  /** Ординал владельца в своём типе (платформа → 0). */
  ownerSerial: number;
  currency: string;
  /** Форма счёта (нал/безнал); капитальные — без формы. */
  form?: AccountForm;
  /** Числовой код валюты (из справочника currencies). Для сид-валют берётся из SEED_CURRENCY_NUM. */
  numCode?: string;
}

export function accountNumber(input: AccountNumberInput): string {
  const tc = typeCode(input.kind, input.ownerType);
  if (!tc) throw new Error(`accountNumber: нет тип-кода для ${input.ownerType}/${input.kind}`);
  const oc = OWNER_CODE[input.ownerType];
  if (!oc) throw new Error(`accountNumber: неизвестный тип владельца "${input.ownerType}"`);
  const ccRaw = input.numCode ?? SEED_CURRENCY_NUM[input.currency];
  if (!ccRaw) throw new Error(`accountNumber: неизвестная валюта "${input.currency}" (передайте numCode из справочника)`);
  // Единый 4-значный валютный сегмент (Волна №3): легаси 3-значные ISO → 0-паддинг.
  const cc = String(ccRaw).padStart(4, '0');
  if (input.ownerSerial < 0 || input.ownerSerial > 9999 || !Number.isInteger(input.ownerSerial)) {
    throw new Error(`accountNumber: ординал вне диапазона 0..9999 (${input.ownerSerial})`);
  }
  const serial = String(input.ownerSerial).padStart(4, '0');
  return `${tc}-${oc}${serial}-${cc}-${formSuffix(input.form)}`;
}

/**
 * Номер субсчёта-точки: номер родителя с суффиксом «.NN» в сегменте владельца.
 * Форма — СВОЯ у точки (касса в точке — нал), а не родителя:
 * `140-C0005-643-02` (клиент безнал) + точка 1 нал → `140-C0005.01-643-01`.
 */
export function pointNumber(parentNumber: string, ordinal: number, form?: AccountForm): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 99) {
    throw new Error(`pointNumber: ординал точки вне 1..99 (${ordinal})`);
  }
  // {TYPE}-{OWNER}-{CUR}-{FORM}: точка вставляется в сегмент владельца (2-й), форма — своя.
  const m = /^([^-]+)-([^-]+)-([^-]+)-([^-]+)$/.exec(parentNumber);
  if (!m) throw new Error(`pointNumber: не разобран номер родителя "${parentNumber}"`);
  const fs = form === undefined ? m[4] : formSuffix(form);
  return `${m[1]}-${m[2]}.${String(ordinal).padStart(2, '0')}-${m[3]}-${fs}`;
}
