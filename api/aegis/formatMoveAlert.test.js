import { describe, it, expect } from 'vitest'
import { formatMoveAlert, formatRiskUpgrade } from './_common.js'

const acc = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', aegis_wallet_id: 'w1' }
const ext = (over) => formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TExtxxxxxxxxxxxxxxxxxxxxxxxxx', ...over }).text

describe('formatMoveAlert · базовое', () => {
  it('P2P без данных → чек-лист «нет данных» (не голое «не проверен»)', () => {
    const tx = { direction: 'in', amount: { amount: '5000000000', decimals: 6 }, counterparty: 'TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS', counterpartyType: 'p2p_merchant', txHash: 'h1' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/💰 <b>Поступление \+\$5,000\.00<\/b>/)
    expect(a.text).toMatch(/👤 Контрагент · P2P/)
    expect(a.text).toMatch(/<blockquote expandable>❔ Риск контрагента: нет данных/)
    expect(a.text).toMatch(/• Санкции — 0%/)
    expect(a.text).toMatch(/• адрес не проверен \(нет данных в AEGIS\)<\/blockquote>/)
    expect(a.meta.explorer_url).toBe('https://tronscan.org/#/transaction/h1')
  })

  it('санкционный контрагент → 🔴 санкции, Санкции 100%', () => {
    const tx = { direction: 'out', amount: { amount: '3000000000', decimals: 6 }, counterparty: 'TMixerAddrxxxxxxxxxxxxxxxxxxxxx', counterpartyEntity: { category: 'mixer', sanctioned: true } }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/<blockquote expandable>🔴 Риск контрагента: санкции/)
    expect(a.text).toMatch(/• Санкции — 100%/)
    expect(a.text).toMatch(/• Миксер — 0%/)
    expect(a.meta.counterparty_sanctioned).toBe(true)
  })

  it('без контрагента — только сумма', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: null })
    expect(a.text).not.toMatch(/Риск контрагента/)
  })
})

describe('formatMoveAlert · чек-лист (полный список категорий с %)', () => {
  it('baseline 10% → 🟢, все категории 0% + verification-фактор', () => {
    const t = ext({ counterpartyRisk: { score: 10, level: 'ok', assessed: true, breakdown: [{ label: 'контрагент не верифицирован', pct: 10, category: 'verification' }] } })
    expect(t).toMatch(/<blockquote expandable>🟢 Риск контрагента: 10%/)
    expect(t).toMatch(/• Санкции — 0%/)
    expect(t).toMatch(/• контрагент не верифицирован — 10%<\/blockquote>/)
  })
  it('critical 100% → 🔴, Санкции/Чёрный список по %, прочие 0%', () => {
    const t = ext({ counterpartyRisk: { score: 100, level: 'critical', breakdown: [{ label: 'санкции', pct: 100, category: 'sanctions' }, { label: 'чёрный список', pct: 100, category: 'blacklist' }] } })
    expect(t).toMatch(/🔴 Риск контрагента: 100%/)
    expect(t).toMatch(/• Санкции — 100%/)
    expect(t).toMatch(/• Чёрный список — 100%/)
    expect(t).toMatch(/• Миксер — 0%/)
  })
  it('warning gambling → 🟡, Гемблинг по %', () => {
    const t = ext({ counterpartyRisk: { score: 20, level: 'warning', breakdown: [{ label: 'гемблинг', pct: 20, category: 'gambling' }] } })
    expect(t).toMatch(/🟡 Риск контрагента: 20%/)
    expect(t).toMatch(/• Гемблинг — 20%/)
  })
  it('матч по b.category', () => {
    expect(ext({ counterpartyRisk: { score: 50, level: 'warning', breakdown: [{ label: 'tumbler', pct: 50, category: 'mixer' }] } })).toMatch(/• Миксер — 50%/)
  })
  it('score>0 без факторов → «• базовая оценка — N%»', () => {
    expect(ext({ counterpartyRisk: { score: 10, level: 'ok', breakdown: [] } })).toMatch(/• базовая оценка — 10%<\/blockquote>/)
  })
  it('нет данных (assessed=false) → «нет данных» + «адрес не проверен»', () => {
    const t = ext({ counterpartyRisk: { score: 0, assessed: false } })
    expect(t).toMatch(/❔ Риск контрагента: нет данных/)
    expect(t).toMatch(/• адрес не проверен \(нет данных в AEGIS\)/)
  })
  it('🔎 ссылка при PUBLIC_APP_URL', () => {
    const prev = process.env.PUBLIC_APP_URL; process.env.PUBLIC_APP_URL = 'https://app.test'
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TabcDEF' })
    expect(a.text).toMatch(/🔎 <a href="https:\/\/app\.test\/api\/risk\/detail\?net=TRC20&addr=TabcDEF">Риск контрагента<\/a>/)
    process.env.PUBLIC_APP_URL = prev
  })
})

describe('formatMoveAlert · наш кошелёк (всегда чек-лист)', () => {
  it('tx.ownRisk → цитата «Риск кошелька» с категориями', () => {
    const a = formatMoveAlert(acc, {
      direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx',
      ownRisk: { score: 5, level: 'ok', assessed: true, breakdown: [{ label: 'риск-флагов не найдено', pct: 5, category: 'verification' }] },
    })
    expect(a.text).toMatch(/<blockquote expandable>🟢 Риск кошелька: 5%/)
    expect(a.text).toMatch(/• риск-флагов не найдено — 5%<\/blockquote>/)
  })
  it('без ownRisk, но есть кэш risk_score → синтез чек-листа из кэша', () => {
    const dirty = { id: 'a1', name: 'WW-131', network_id: 'ERC20', risk_score: 5, risk_level: 'ok' }
    const a = formatMoveAlert(dirty, { direction: 'out', amount: { amount: '1000000', decimals: 6 }, counterparty: '0xabc', ownRisk: { score: 0, assessed: false } })
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>WW-131<\/b> · ERC20\n<blockquote expandable>🟢 Риск кошелька: 5%/)
    expect(a.text).toMatch(/• базовая оценка — 5%/)
  })
  it('без ownRisk И без кэша → блок кошелька всё равно есть («нет данных»)', () => {
    // Регресс «куда делся анализ нашего кошелька»: пустой /v1/risk на нашем адресе
    // + null-кэш не должен убирать блок — он симметричен контрагенту.
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx' })
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20\n<blockquote expandable>❔ Риск кошелька: нет данных/)
    expect(a.text).toMatch(/• Санкции — 0%/)
  })
  it('свой контрагент (own) → имя, БЕЗ риск-блока', () => {
    const a = formatMoveAlert(acc, { direction: 'out', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TOwn', counterpartyOwn: true, counterpartyName: 'WW-135 (kit out)' })
    expect(a.text).toMatch(/👤 Контрагент · WW-135 \(kit out\) \(свой\)/)
    expect(a.text).not.toMatch(/Риск контрагента/)
  })
  it('полный адрес контрагента в <code>', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb' })
    expect(a.text).toMatch(/<code>TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb<\/code>/)
  })
})

describe('formatMoveAlert · новые сигналы AEGIS (unknown ≠ чисто, hard-факты)', () => {
  it('checked_clean → «✅ Проверено: … — чисто» ВМЕСТО стены «— 0%»', () => {
    const t = ext({ counterpartyRisk: { score: 5, level: 'ok', checkedClean: ['sanctions', 'blacklist', 'mixer'], breakdown: [] } })
    // Изолируем блок контрагента (у нашего кошелька без данных — своя стена «— 0%»).
    const cp = t.slice(t.indexOf('👤 Контрагент'))
    expect(cp).toMatch(/✅ Проверено: Санкции, Чёрный список, Миксер — чисто/)
    expect(cp).not.toMatch(/— 0%/) // стена подавлена в блоке контрагента
  })
  it('assessment=preliminary → «предв., уточняется», НЕ «чисто»', () => {
    const t = ext({ counterpartyRisk: { score: 0, level: 'ok', assessment: 'preliminary', breakdown: [] } })
    expect(t).toMatch(/🟡 Риск контрагента: предв\., уточняется/)
    expect(t).toMatch(/• экспозиция ещё считается — оценка предварительная/)
  })
  it('coverage.typed_pct<60 → бейдж «· оценено N%»', () => {
    const t = ext({ counterpartyRisk: { score: 20, level: 'warning', coverage: { typedPct: 42 }, breakdown: [] } })
    expect(t).toMatch(/🟡 Риск контрагента: 20% · оценено 42%/)
  })
  it('nested_service → видимая строка + авто-EDD', () => {
    const t = ext({ counterpartyRisk: { score: 30, level: 'warning', nestedService: { name: 'OTC Desk X', license: null, source: 'salary' }, breakdown: [] } })
    expect(t).toMatch(/🏦 <b>Вложенный сервис:<\/b> OTC Desk X · лиц\.: нет/)
    expect(t).toMatch(/❓ EDD: кто это · есть ли лицензия · источник средств \(заявлено: salary\)/)
  })
  it('level=critical → видимый ⛔ ОТКАЗ', () => {
    const t = ext({ counterpartyRisk: { score: 90, level: 'critical', breakdown: [] } })
    expect(t).toMatch(/⛔ <b>ОТКАЗ<\/b> — критический риск/)
  })
  it('blacklisted → ⛔ ОТКАЗ (чёрный список)', () => {
    const t = ext({ counterpartyRisk: { score: 100, level: 'critical', blacklisted: true, breakdown: [] } })
    expect(t).toMatch(/⛔ <b>ОТКАЗ<\/b> — чёрный список/)
  })
  it('funds_flow.source с risk_pct>0 → «⚠️ Происхождение: X% cat»', () => {
    const t = ext({ counterpartyRisk: { score: 80, level: 'warning', fundsFlow: { source: [{ category: 'mixer', label: 'миксер', sharePct: 12, riskPct: 80 }], destination: [] }, breakdown: [] } })
    expect(t).toMatch(/⚠️ Происхождение: 12% миксер/)
  })
})

describe('formatMoveAlert · verdict (готовый клиентский вердикт AEGIS)', () => {
  const V = {
    emoji: '🔴', levelText: 'ВЫСОКИЙ РИСК', score: 71, action: '❌ Рекомендуем отказ',
    reasons: ['⚠️ прямые метки', '🔀 миксер в 1 хопе'],
    sources: [{ emoji: '❓', label: 'Неизвестно', pct: 76, bar: '▓▓▓▓▓▓▓▓░░' }],
    cleanNote: '✅ Прямых меток нет',
  }
  it('контрагент: рендерит вердикт (шапка+action+Почему+Источник+clean), НЕ чек-лист', () => {
    const t = ext({ counterpartyRisk: { verdict: V, breakdown: [] } })
    const cp = t.slice(t.indexOf('👤 Контрагент'))
    expect(cp).toMatch(/🔴 <b>Риск контрагента:<\/b> ВЫСОКИЙ РИСК — 71\/100/)
    expect(cp).toMatch(/❌ Рекомендуем отказ/)
    expect(cp).toMatch(/ФАКТЫ|СИГНАЛЫ/)
    expect(cp).toMatch(/⚠️ прямые метки/)
    expect(cp).toMatch(/Источник средств:/)
    expect(cp).toMatch(/❓ Неизвестно ▓▓▓▓▓▓▓▓░░ 76%/)
    expect(cp).toMatch(/✅ Прямых меток нет/)
    expect(cp).not.toMatch(/— 0%/) // старого чек-листа нет
    expect(cp).not.toMatch(/⛔ <b>ОТКАЗ<\/b>/) // отдельная ⛔-строка не дублируется
  })
  it('risk_by_category: показываем ТОЛЬКО ненулевые (нули схлопнуты, не 15 строк)', () => {
    const rbc = [
      { emoji: '⛔️', label: 'Санкции', pct: 0, bar: '░░░░░░░░░░' },
      { emoji: '🎰', label: 'Гемблинг', pct: 0, bar: '░░░░░░░░░░', outPct: 12, outBar: '▓░░░░░░░░░' },
      { emoji: '⚠️', label: 'Скам', pct: 4, bar: '▓░░░░░░░░░' },
    ]
    const t = ext({ counterpartyRisk: { verdict: V, riskByCategory: rbc, breakdown: [] } })
    const cp = t.slice(t.indexOf('👤 Контрагент'))
    expect(cp).toMatch(/⚠️ Риск по категориям:/)
    // только категории с реальным % (вход/выход)
    expect(cp).toMatch(/<code>🎰 Гемблинг\s+░░░░░░░░░░\s+0%<\/code> ⬆️ уходит 12%/)
    expect(cp).toMatch(/<code>⚠️ Скам\s+▓░░░░░░░░░\s+4%<\/code>/)
    expect(cp).not.toMatch(/⛔️ Санкции/) // нулевую категорию НЕ показываем (схлопнута)
    expect(cp).not.toMatch(/нет фида/) // per-row «нет фида»-шум убран
  })
  it('все категории 0% → компактная строка вместо 15 нулей', () => {
    const rbc = [
      { emoji: '⛔️', label: 'Санкции', pct: 0, bar: '░░░░░', covered: true },
      { emoji: '🎣', label: 'Фишинг', pct: 0, bar: '░░░░░', covered: false },
    ]
    const t = ext({ counterpartyRisk: { verdict: { ...V, cleanNote: '✅ Чисто по проверяемым …' }, riskByCategory: rbc, breakdown: [] } })
    const cp = t.slice(t.indexOf('👤 Контрагент'))
    expect(cp).toMatch(/Прямых категорий-меток нет/)
    expect(cp).not.toMatch(/⛔️ Санкции/) // не вываливаем 15 нулей
    expect(cp).not.toMatch(/нет фида/)
    expect(cp).not.toMatch(/Чисто по проверяемым/) // cleanNote не дублируем при компактной строке
  })
  it('наш кошелёк: только шапка+clean_note (action/Почему/источник скрыты)', () => {
    const own = { emoji: '🟢', levelText: 'НИЗКИЙ РИСК', score: 3, action: '✅ ок', reasons: ['x'], sources: [{ emoji: '❓', label: 'y', pct: 1, bar: '░' }], cleanNote: '✅ чисто' }
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Tx', ownRisk: { verdict: own } })
    const head = a.text.slice(0, a.text.indexOf('👤 Контрагент'))
    expect(head).toMatch(/🟢 <b>Риск кошелька:<\/b> НИЗКИЙ РИСК — 3\/100/)
    expect(head).toMatch(/✅ чисто/)
    expect(head).not.toMatch(/Рекомендуем|✅ ок/) // action скрыт для своего кошелька
    expect(head).not.toMatch(/Почему:/) // reasons скрыты
  })
})

describe('formatRiskUpgrade (/v1/alerts RISK_UPGRADE)', () => {
  it('prev→new + level + причина', () => {
    const { text } = formatRiskUpgrade({ alertId: 'u1', address: 'TXabc', prevScore: 10, newScore: 46, level: 'warning', category: 'mixer' })
    expect(text).toMatch(/⚠️ <b>Уточнение риска<\/b>: 10% → <b>46%<\/b> \(warning\)/)
    expect(text).toMatch(/<code>TXabc<\/code>/)
    expect(text).toMatch(/Причина: <b>mixer<\/b>/)
  })
  it('prev=null → «предв.»', () => {
    const { text } = formatRiskUpgrade({ alertId: 'u2', address: 'TXd', prevScore: null, newScore: 46, level: 'warning' })
    expect(text).toMatch(/предв\. → <b>46%<\/b>/)
  })
})

describe('formatMoveAlert · verdict-рендер (renderVerdict)', () => {
  const rbc = [
    { emoji: '🎰', label: 'Гемблинг', pct: 11, bar: '▓░░░░░░░░░', outPct: 0.4, outBar: '▓░░░░░░░░░' },
    { emoji: '🚫', label: 'Чёрный список', pct: 0, bar: '░░░░░░░░░░', outPct: 1.2, outBar: '▓░░░░░░░░░' },
  ]
  it('контрагент с verdict → шапка+action+таблица категорий (моноширинно), out_pct рендерится', () => {
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🔴', levelText: 'ВЫСОКИЙ РИСК', score: 81, action: '❌ Рекомендуем отказ', reasons: ['⚠️ близость к санкц/ЧС'], sources: [], cleanNote: null, preliminary: false }, riskByCategory: rbc } })
    expect(t).toMatch(/🔴 <b>Риск контрагента:<\/b> ВЫСОКИЙ РИСК — 81\/100/)
    expect(t).toMatch(/❌ Рекомендуем отказ/)
    expect(t).toMatch(/⚠️ Риск по категориям:/)
    // моноширинная строка: <code>emoji label(добито пробелами) bar pct</code>, out — после code
    expect(t).toMatch(/<code>🎰 Гемблинг\s+▓░░░░░░░░░\s+11%<\/code> ⬆️ уходит 0\.4%/)
    expect(t).toMatch(/<code>🚫 Чёрный список\s+░░░░░░░░░░\s+0%<\/code> ⬆️ уходит 1\.2%/)
  })
  it('все категории 0% → компактная строка, без 15 нулей и «нет фида»', () => {
    const rbc2 = [
      { emoji: '⛔️', label: 'Санкции', pct: 0, bar: '░░░░░', outPct: null, covered: true },
      { emoji: '🎣', label: 'Фишинг', pct: 0, bar: '░░░░░', outPct: null, covered: false },
    ]
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🟢', levelText: 'НИЗКИЙ РИСК', score: 5, action: '✅ Можно работать', reasons: [], sources: [], cleanNote: null }, riskByCategory: rbc2 } })
    expect(t).toMatch(/Прямых категорий-меток нет/)
    expect(t).not.toMatch(/⛔️ Санкции/)
    expect(t).not.toMatch(/нет фида/)
  })
  it('dirt_flow → заголовок направления грязи + «⬇️ приходит / ⬆️ уходит» над таблицей', () => {
    const dirtFlow = { direction: 'both', label: '⬆️⬇️ Грязь и ПРИХОДИТ, и УХОДИТ — деньги идут и с грязных адресов, и на грязные', inPct: 0.4, outPct: 98, topIn: [{ emoji: '🎰', label: 'Гемблинг', pct: 0.4 }], topOut: [{ emoji: '🎰', label: 'Гемблинг', pct: 98 }] }
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🟠', levelText: 'СРЕДНИЙ РИСК', score: 47, action: '🔍 Проверка', reasons: [], sources: [], dirtFlow, cleanNote: null }, riskByCategory: rbc } })
    expect(t).toMatch(/Грязь и ПРИХОДИТ, и УХОДИТ/)
    expect(t).toMatch(/⬇️ приходит: 🎰 Гемблинг 0\.4%/)
    expect(t).toMatch(/⬆️ уходит: 🎰 Гемблинг 98%/)
  })
  it('reasons с detail → заголовок + строка-доказательство «└ …»', () => {
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🔴', levelText: 'ВЫСОКИЙ РИСК', score: 72, action: '❌ Рекомендуем отказ', reasons: [{ text: '🔀 Кошелёк-прокладка: деньги проходят насквозь', detail: '95% входящего уходит за ≤ 30 мин (10 быстрых переводов, медиана 2 мин)' }], sources: [], cleanNote: null, preliminary: false }, riskByCategory: rbc } })
    expect(t).toMatch(/🔀 Кошелёк-прокладка: деньги проходят насквозь/)
    expect(t).toMatch(/└ 95% входящего уходит за ≤ 30 мин \(10 быстрых переводов, медиана 2 мин\)/)
  })
  it('reason с address → кликабельная ссылка на адрес в эксплорере', () => {
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🌀', levelText: 'ВЫСОКИЙ', score: 60, action: '❌', reasons: [{ text: '🌀 Миксер: получал средства напрямую', detail: 'Почему это миксер: перемешивает монеты', address: 'TXdirtyMixer12345678901234567890' }], sources: [], cleanNote: null }, riskByCategory: rbc } })
    expect(t).toMatch(/🌀 Миксер: получал средства напрямую/)
    expect(t).toMatch(/└ Почему это миксер: перемешивает монеты/)
    expect(t).toMatch(/└ адрес: <a href="https:\/\/tronscan\.org\/#\/address\/TXdirtyMixer12345678901234567890">TXdirt…7890<\/a>/)
  })
  it('reason с address+tx → две ссылки: адрес и транзакция', () => {
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🚫', levelText: 'ВЫСОКИЙ', score: 100, action: '❌', reasons: [{ text: '🚫 Чёрный список: получал средства напрямую', detail: 'Почему это адрес из чёрного списка: заморожен', address: 'TXblacklistTerminalAddr0001', tx: 'abcTxHash1234567890abcdef' }], sources: [], cleanNote: null }, riskByCategory: rbc } })
    expect(t).toMatch(/└ адрес: <a href="https:\/\/tronscan\.org\/#\/address\/TXblacklistTerminalAddr0001">/)
    expect(t).toMatch(/└ tx: <a href="https:\/\/tronscan\.org\/#\/transaction\/abcTxHash1234567890abcdef">/)
  })
  it('reasons как строки (back-compat) → рендерятся без └', () => {
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🔴', levelText: 'ВЫСОКИЙ', score: 72, action: '❌', reasons: ['⚠️ близость'], sources: [], cleanNote: null }, riskByCategory: rbc } })
    expect(t).toMatch(/⚠️ близость/)
    expect(t).not.toMatch(/└/)
  })
  it('НАШ кошелёк с verdict → таблица категорий ЕСТЬ, action/reasons НЕТ (решение — по контрагенту)', () => {
    const own = { verdict: { emoji: '🟢', levelText: 'НИЗКИЙ РИСК', score: 30, action: '✅ Можно работать', reasons: ['не показывать это'], sources: [], cleanNote: '✅ Чисто по всем', preliminary: false }, riskByCategory: rbc }
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: null, ownRisk: own })
    expect(a.text).toMatch(/🟢 <b>Риск кошелька:<\/b> НИЗКИЙ РИСК — 30\/100/)
    expect(a.text).toMatch(/⚠️ Риск по категориям:/)      // таблица показывается и для нашего
    expect(a.text).toMatch(/<code>🎰 Гемблинг\s+▓░░░░░░░░░\s+11%<\/code>/)
    expect(a.text).not.toMatch(/✅ Можно работать/)        // action к своему кошельку не применяется
    expect(a.text).not.toMatch(/не показывать это/)        // reasons — тоже нет
  })
  it('preliminary verdict → бейдж «(предв.)» + честная нота', () => {
    const t = ext({ counterpartyRisk: { verdict: { emoji: '🟡', levelText: 'НИЗКИЙ РИСК', score: 10, action: '⚠️ Повышенное внимание', reasons: [], sources: [], cleanNote: '⏳ Экспозиция ещё трассируется', preliminary: true }, riskByCategory: [{ emoji: '⛔️', label: 'Санкции', pct: 0, bar: '░░░░░░░░░░', outPct: null }] } })
    expect(t).toMatch(/— 10\/100 \(предв\.\)/)
    expect(t).toMatch(/⏳ Экспозиция ещё трассируется/)
  })
})
