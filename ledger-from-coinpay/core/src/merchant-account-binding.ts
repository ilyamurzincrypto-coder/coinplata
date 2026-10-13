import type { PayoutMode } from './merchant-rules';

/**
 * Привязка ностро платформы к мерчанту: куда падает приём по каналу и с каких счетов ему платим.
 * Чистые функции: ни БД, ни времени.
 *
 * 🔴 Проверка набора — ОДНА. Её зовут окно правил (активация draft → active) и правка в карточке
 * мерчанта. «Одна денежная величина — одна функция»: два экземпляра правила разойдутся.
 */

export type IntakeChannel = '4pmts' | 'qr_static';
export const INTAKE_CHANNELS: readonly IntakeChannel[] = ['4pmts', 'qr_static'];
/** Подпись канала в сообщениях: «Для мерчанта не задан ностро приёма 4pmts». */
export const INTAKE_CHANNEL_LABEL: Record<IntakeChannel, string> = { '4pmts': '4pmts', qr_static: 'QR «Филиал 2»' };

export function isIntakeChannel(v: string): v is IntakeChannel {
  return (INTAKE_CHANNELS as readonly string[]).includes(v);
}

/** Факты о счёте, достаточные для проверки (читаются из ledger_accounts). */
export interface BindableAccount {
  id: string;
  number: string;
  ownerType: string;
  kind: string;
  currency: string;
  status: string;
}

export interface MerchantAccountsDraft {
  intake: { channel: IntakeChannel; account: BindableAccount }[];
  payout: BindableAccount[];
  /** Валюты выплаты мерчанта; «только рубли» — ['RUB']. */
  payoutCurrencies: string[];
  /**
   * Счета, которые уже стоят на приёме QR у ДРУГИХ мерчантов, и счета-требования провайдера
   * (claim-счета 4pmts): денег на них нет (долг провайдера до расчёта), платить с них нечем.
   */
  otherQrIntakeAccountIds: ReadonlySet<string>;
  /**
   * Счета, которые уже назначены источником выплаты ДРУГИМ мерчантам. Их нельзя поставить на
   * приём QR этому мерчанту: деньги другого мерчанта на приёмном счету смешаются с его выплатами.
   */
  otherPayoutAccountIds: ReadonlySet<string>;
  /**
   * Счета, которые стоят на приёме 4pmts у ДРУГИХ мерчантов. На приём QR их ставить нельзя: на счёте
   * QR лежит требование к провайдеру, на счёте 4pmts — живые деньги; смешивать их в одном ностро нельзя.
   */
  other4pmtsIntakeAccountIds: ReadonlySet<string>;
  /**
   * Счета, которые КОГДА-ЛИБО стояли на приёме QR (у любого мерчанта, в том числе снятые привязки и
   * расторгнутые мерчанты), и счета-требования провайдеров. На таком счёте может ещё лежать требование
   * к провайдеру, поэтому источником выплаты он не ставится никому и никогда.
   */
  qrHistoryAccountIds: ReadonlySet<string>;
  /**
   * Счета, на которые ставят приём QR, но на них уже есть ДЕНЬГИ: проводки не по QR (приём 4pmts,
   * переводы, выплаты, ручные операции…), а значит и остаток живых денег. Счёт приёма QR навсегда
   * исключается из выплат и переводов — поставь такой счёт на QR, и живые деньги выпадут из выплат.
   * Текущий приём QR этого же мерчанта сюда не попадает: запрет касается постановки, а не уже стоящего.
   */
  nonQrMoneyAccountIds: ReadonlySet<string>;
}

/**
 * Замечание «нет ни одного канала приёма». Отдельной константой: помощник тестовых фикстур
 * проверяет набор без правил полноты (канал приёма, источник в каждой валюте) и отбрасывает именно его.
 */
export const NO_INTAKE_CHANNEL_PROBLEM = 'Включите хотя бы один канал приёма и выберите для него ностро';

/**
 * Валюты, по которым мерчанту обязателен хотя бы один источник выплаты.
 *
 * Пустой список `currencies` даёт `[]` — «требований нет». Это безопасно только потому, что
 * `validateMerchantRules` (merchant-rules.ts) сам отвергает пустой `currencies` ещё на форме
 * правил: сюда пустой список долетать не должен, но функция не полагается на вызывающего.
 */
export function payoutCurrenciesOf(mode: PayoutMode): string[] {
  return mode.kind === 'rub_only' ? ['RUB'] : [...new Set(mode.currencies)];
}

/**
 * Валюты источников выплат в окне правил. Одна функция и для окна, и для предварительной проверки на
 * сервере — окно не может потребовать меньше или больше, чем проверка. Повторяет то, что после записи
 * посчитает `merchantPayoutCurrencies` внутри транзакции:
 *   • «только рубли» — каналов окно не заводит, значит останется всё, что у мерчанта уже есть
 *     (`existing.all`: каналы, иначе легаси-цель, иначе RUB), плюс RUB формы;
 *   • выбор валют — каналы появятся, и легаси-цель (`payout_currency`, `auto_convert_target`) перестанет
 *     считаться: к валютам формы добавляются только валюты уже заведённых каналов (`existing.fromChannels`).
 */
export function requiredPayoutCurrencies(
  mode: PayoutMode,
  existing: { all: readonly string[]; fromChannels: readonly string[] },
): string[] {
  const extra = mode.kind === 'currencies' ? existing.fromChannels : existing.all;
  return [...new Set([...payoutCurrenciesOf(mode), ...extra])];
}

/** Перечень того, что не так с набором счетов. Пустой — можно сохранять и активировать. */
export function validateMerchantAccounts(d: MerchantAccountsDraft): string[] {
  const out: string[] = [];
  const push = (s: string) => { if (!out.includes(s)) out.push(s); };

  if (d.intake.length === 0) push(NO_INTAKE_CHANNEL_PROBLEM);
  const seenChannels = new Set<IntakeChannel>();
  for (const { channel, account: a } of d.intake) {
    const label = INTAKE_CHANNEL_LABEL[channel];
    if (seenChannels.has(channel)) push(`Канал «${label}» указан дважды`);
    seenChannels.add(channel);
    if (a.ownerType !== 'platform' || a.kind !== 'nostro') push(`Ностро приёма «${label}»: счёт ${a.number} — не ностро платформы`);
    else if (a.currency !== 'RUB') push(`Ностро приёма «${label}»: счёт ${a.number} в ${a.currency}, нужен рублёвый`);
    if (a.status !== 'open') push(`Счёт ${a.number} закрыт`);
    if (channel === 'qr_static' && d.otherPayoutAccountIds.has(a.id)) {
      push(`Счёт ${a.number} — источник выплат другого мерчанта, на приём QR его поставить нельзя`);
    }
    if (channel === 'qr_static' && d.nonQrMoneyAccountIds.has(a.id)) {
      push(`Счёт ${a.number} уже используется для денег (есть остаток или проводки не по QR) — на приём QR его ставить нельзя`);
    }
    if (channel === 'qr_static' && d.other4pmtsIntakeAccountIds.has(a.id)) {
      push(`Счёт ${a.number} — ностро приёма 4pmts другого мерчанта, на приём QR его поставить нельзя`);
    }
    if (channel === '4pmts' && d.otherQrIntakeAccountIds.has(a.id)) {
      push(`Счёт ${a.number} стоит на приёме QR, на приём 4pmts его поставить нельзя`);
    } else if (channel === '4pmts' && d.qrHistoryAccountIds.has(a.id)
      // Свой текущий приём QR на том же счёте уже отбит замечанием «разные ностро» ниже — без дубля.
      && !d.intake.some((x) => x.channel === 'qr_static' && x.account.id === a.id)) {
      // Требование к провайдеру может ещё лежать на счёте: живые деньги 4pmts туда не кладём.
      push(`Счёт ${a.number} использовался для приёма QR — на приём 4pmts его ставить нельзя`);
    }
  }
  // QR держит требование к провайдеру, 4pmts — живые деньги: у одного мерчанта это разные ностро.
  const own4pmts = new Set(d.intake.filter((x) => x.channel === '4pmts').map((x) => x.account.id));
  if (d.intake.some((x) => x.channel === 'qr_static' && own4pmts.has(x.account.id))) {
    push('Приём QR и приём 4pmts должны идти на разные ностро');
  }

  const qr = new Set(d.otherQrIntakeAccountIds);
  for (const x of d.intake) if (x.channel === 'qr_static') qr.add(x.account.id);

  const seenPayout = new Set<string>();
  for (const a of d.payout) {
    if (seenPayout.has(a.id)) push(`Источник выплаты ${a.number} указан дважды`);
    seenPayout.add(a.id);
    if (a.ownerType !== 'platform' || (a.kind !== 'nostro' && a.kind !== 'cash_desk')) push(`Источник выплаты ${a.number} — не ностро и не касса платформы`);
    if (a.status !== 'open') push(`Счёт ${a.number} закрыт`);
    if (qr.has(a.id)) push(`Счёт ${a.number} стоит на приёме QR — источником выплаты быть не может`);
    else if (d.qrHistoryAccountIds.has(a.id)) push(`Счёт ${a.number} использовался для приёма QR — источником выплат его ставить нельзя`);
  }

  for (const c of new Set(d.payoutCurrencies)) {
    const usable = d.payout.some((a) => a.currency === c && a.status === 'open' && !qr.has(a.id) && !d.qrHistoryAccountIds.has(a.id)
      && a.ownerType === 'platform' && (a.kind === 'nostro' || a.kind === 'cash_desk'));
    if (!usable) push(`Для выплаты в ${c} не выбран ни один источник`);
  }
  return out;
}
