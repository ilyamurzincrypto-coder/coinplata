/**
 * 🔴 ГРАНИЦА МЕЖДУ СЕТЬЮ И КНИГОЙ. Единственное место, где знаки сети встречаются с нашими.
 *
 * У USDT **шесть** знаков в TRON и Ethereum и **восемнадцать** в BNB Chain, а в нашей книге —
 * четыре. Это три разных числа, и спутать их — ошибка до 10^14. Тот же класс, что «×100 на
 * тезере», которым мы уже заплатили, только на десять порядков хуже; и Σ=0 его не ловит, потому
 * что обе ноги проводки окажутся неверны одинаково.
 *
 * Почему книга не хранит суммы по-сетевому, хотя это выглядело бы честнее: весь леджер на
 * `bigint`, то есть 9 223 372 036 854 775 807 минорных единиц — при восемнадцати знаках ровно
 * ДЕВЯТЬ монет. Перевести живые денежные колонки на `numeric` ради этого дороже и опаснее, чем
 * честно конвертировать на границе. Поэтому: в книге четыре знака, в сети — сколько у сети, а
 * между ними эти две функции и их тесты.
 */

/** Множитель между знаками сети и знаками книги. Бросает на бессмысленных значениях. */
function factor(chainDecimals: number, minorUnits: number): { mul: bigint; dir: 'chain_wider' | 'minor_wider' } {
  const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 36;
  if (!ok(chainDecimals) || !ok(minorUnits)) {
    throw new Error(`chain-amount: знаков должно быть 0..36, получено сеть=${chainDecimals} книга=${minorUnits}`);
  }
  const d = chainDecimals - minorUnits;
  return d >= 0
    ? { mul: 10n ** BigInt(d), dir: 'chain_wider' }
    : { mul: 10n ** BigInt(-d), dir: 'minor_wider' };
}

/**
 * Сумма ИЗ СЕТИ → минорные единицы книги. `null`, если точно не представима.
 *
 * 🔴 Округлять здесь нельзя. Пришло 1,234567 ₮ (шесть знаков), а книга держит четыре — тихо
 * записав 1,2346, мы бы сочинили мерчанту лишние доли и разошлись с тем, что реально в сети.
 * Поэтому не представимая сумма — это `null` и повод разобраться человеку, а не повод округлить.
 */
export function chainToMinorExact(chainAmount: bigint, chainDecimals: number, minorUnits: number): bigint | null {
  const f = factor(chainDecimals, minorUnits);
  if (f.dir === 'minor_wider') return chainAmount * f.mul; // у книги знаков больше — всегда точно
  if (chainAmount % f.mul !== 0n) return null;
  return chainAmount / f.mul;
}

/**
 * Минорные единицы книги → сумма ДЛЯ СЕТИ. Всегда точна: у сети знаков не меньше, а если меньше —
 * деление проверяется так же, как выше.
 *
 * 🔴 Результат НИКОГДА не кладётся в денежную колонку: при восемнадцати знаках одна монета это
 * 10^18, и уже десять монет не влезут в `bigint` Postgres. Это число живёт ровно столько, сколько
 * строится транзакция.
 */
export function minorToChain(minor: bigint, chainDecimals: number, minorUnits: number): bigint | null {
  const f = factor(chainDecimals, minorUnits);
  if (f.dir === 'chain_wider') return minor * f.mul;
  if (minor % f.mul !== 0n) return null;
  return minor / f.mul;
}

/**
 * Представима ли сумма книги в сети без остатка — то есть можем ли мы отправить ровно её.
 * Правило выплат: платим суммами, кратными нашей минорной единице, и тогда то, что ушло в сеть,
 * в точности равно тому, что записано в книге.
 */
export function payableExactly(minor: bigint, chainDecimals: number, minorUnits: number): boolean {
  return minorToChain(minor, chainDecimals, minorUnits) !== null;
}
