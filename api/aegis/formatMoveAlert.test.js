import { describe, it, expect } from 'vitest'
import { formatMoveAlert } from './_common.js'

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
