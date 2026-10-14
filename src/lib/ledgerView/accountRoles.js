// src/lib/ledgerView/accountRoles.js
//
// Раскладка плана счетов на разделы и знак остатка — перенос канона CoinPay.
//
// 🔴 ПРАВИЛО ВЛАДЕЛЬЦА: Лоро, Ностро и кассы, Капитал обязаны выглядеть ИДЕНТИЧНО — один
// компонент, один набор колонок, те же ширины и порядок; различаются ТОЛЬКО данные строк.
// Поэтому раскладка живёт здесь, отдельно от разметки: экран не должен знать, какой он.
//
// 🔴 НЕИЗВЕСТНОЕ ПОКАЗЫВАЕМ, А НЕ ПРЯЧЕМ. Счёт, роль которого мы не распознали, попадает в
// отдельный раздел «Не разнесено», а не растворяется в ближайшем подходящем. Тихая раскладка
// неизвестного — это ложь витрины: в CoinPay зелёная галочка стояла над механизмом, который ни
// разу не отработал, и экран годами утверждал «сверка сходится».

/** Бухгалтерская роль счёта. От неё зависит ЗНАК показываемого остатка. */
export const ROLE = {
  ASSET: "asset",
  LIABILITY: "liability",
  CAPITAL: "capital",
  UNKNOWN: "unknown",
};

/** Разделы экрана «Счета» — порядок вкладок как в CoinPay. */
export const SECTION = {
  LORO: "loro",
  NOSTRO: "nostro",
  CAPITAL: "capital",
  UNSORTED: "unsorted",
};

export const SECTION_TITLE = {
  [SECTION.LORO]: "Лоро",
  [SECTION.NOSTRO]: "Ностро и кассы",
  [SECTION.CAPITAL]: "Капитал",
  [SECTION.UNSORTED]: "Не разнесено",
};

/**
 * Типы счетов → роль. Названия взяты из общепринятой двойной записи; если в базе встретится
 * что-то иное, счёт уедет в «Не разнесено» и будет виден — вместо того чтобы молча попасть не
 * в тот раздел и исказить итог.
 */
const TYPE_TO_ROLE = {
  asset: ROLE.ASSET,
  assets: ROLE.ASSET,
  cash: ROLE.ASSET,
  bank: ROLE.ASSET,
  crypto: ROLE.ASSET,
  liability: ROLE.LIABILITY,
  liabilities: ROLE.LIABILITY,
  payable: ROLE.LIABILITY,
  equity: ROLE.CAPITAL,
  capital: ROLE.CAPITAL,
  income: ROLE.CAPITAL,
  revenue: ROLE.CAPITAL,
  expense: ROLE.CAPITAL,
};

export function roleOf(account) {
  const t = String(account?.type || "").toLowerCase();
  return TYPE_TO_ROLE[t] || ROLE.UNKNOWN;
}

/**
 * В какой раздел попадает счёт.
 *
 * Лоро — обязательства ПЕРЕД КЛИЕНТАМИ: их отличает требование клиентского измерения
 * (`client_dim_required`), то есть остаток такого счёта всегда «чей-то». Обязательство без
 * клиента — не Лоро, а наше собственное обязательство, и ему место в Капитале.
 */
export function sectionOf(account) {
  const role = roleOf(account);
  if (role === ROLE.UNKNOWN) return SECTION.UNSORTED;
  if (role === ROLE.ASSET) return SECTION.NOSTRO;
  if (role === ROLE.LIABILITY) {
    return account?.clientDimRequired || account?.partnerDimRequired ? SECTION.LORO : SECTION.CAPITAL;
  }
  return SECTION.CAPITAL;
}

/**
 * 🔴 ЗНАК ПОКАЗЫВАЕМОГО ОСТАТКА.
 *
 * Канон CoinPay: `presented = asset ? −raw : raw`. Активные счета (кассы, ностро, позиции)
 * показывают ПОЛОЖИТЕЛЬНЫЙ остаток при нормальной стороне, пассив и капитал — как есть.
 * Благодаря этому выполняется тождество `Ностро − Лоро = Капитал` построчно по валюте.
 *
 * ⚠️ ВАЖНОЕ ОТЛИЧИЕ ОТ COINPAY. Там ноги проводки знаковые, и сторона бралась из знака. Здесь в
 * `journal_entries` есть ЯВНАЯ колонка `direction` ('dr'/'cr'), а `amount` всегда положителен.
 * Это другая, столь же законная модель — и переносить правило «сторона из знака» сюда БУКВАЛЬНО
 * нельзя, иначе получится бессмыслица. Эквивалент того же инварианта здесь:
 * `Σ(dr) = Σ(cr)` по каждой валюте в транзакции. Серверная проверка `tx_check_balance` его уже
 * выполняет — это их сильная сторона, и ломать её не нужно.
 */
export function presentSign(role) {
  return role === ROLE.ASSET ? -1 : 1;
}

/** Применить знак к сумме-строке, не трогая float. */
export function presentAmount(raw, role) {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (presentSign(role) === 1) return s;
  if (s.startsWith("-")) return s.slice(1);
  if (/^0+(?:[.,]0*)?$/.test(s)) return s; // ноль знака не меняет
  return "-" + s;
}

/**
 * Человеческое имя роли для колонки «Тип» — слово, а не код из базы.
 * Колонка «Тип» в CoinPay говорит человеку, что это за счёт, а не что лежит в поле `type`.
 */
export function roleLabel(account) {
  const role = roleOf(account);
  const sub = account?.subtype ? String(account.subtype) : "";
  const base = {
    [ROLE.ASSET]: "Актив",
    [ROLE.LIABILITY]: "Обязательство",
    [ROLE.CAPITAL]: "Капитал",
    [ROLE.UNKNOWN]: "Тип не распознан",
  }[role];
  return sub ? `${base} · ${sub}` : base;
}
