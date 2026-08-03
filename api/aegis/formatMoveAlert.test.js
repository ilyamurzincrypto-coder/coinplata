import { describe, it, expect } from 'vitest'
import { formatMoveAlert } from './_common.js'

const acc = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', aegis_wallet_id: 'w1' }

describe('formatMoveAlert', () => {
  it('поступление с контрагентом-P2P', () => {
    const tx = { direction: 'in', amount: { amount: '5000000000', decimals: 6 }, counterparty: 'TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS', counterpartyType: 'p2p_merchant', ts: '2026-07-24T10:00:00Z', txHash: 'h1' }
    const a = formatMoveAlert(acc, tx)
    expect(a.kind).toBe('wallet_move')
    expect(a.text).toMatch(/💰 <b>Поступление \+\$5,000\.00<\/b>/)
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20/)
    expect(a.text).toMatch(/👤 Контрагент · ❔ не проверен · P2P/)
    expect(a.text).toMatch(/<code>TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS<\/code>/)
    expect(a.text).toMatch(/<a href="https:\/\/tronscan\.org\/#\/transaction\/h1">Проверить перевод<\/a>/)
    expect(a.meta.direction).toBe('in')
    expect(a.meta.counterparty).toBe('TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS')
    expect(a.meta.explorer_url).toBe('https://tronscan.org/#/transaction/h1')
  })

  it('списание с санкционным контрагентом', () => {
    const tx = { direction: 'out', amount: { amount: '3000000000', decimals: 6 }, counterparty: 'TMixerAddrxxxxxxxxxxxxxxxxxxxxx', counterpartyEntity: { category: 'mixer', sanctioned: true }, ts: '2026-07-24T11:00:00Z' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/📤 <b>Списание −\$3,000\.00<\/b>/)
    expect(a.text).toMatch(/👤 Контрагент · 🔴 санкции · микшер/)
    expect(a.meta.counterparty_sanctioned).toBe(true)
  })

  it('без контрагента — только сумма', () => {
    const tx = { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: null, ts: '2026-07-24T12:00:00Z' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/💰 <b>Поступление \+\$1\.00<\/b>/)
    expect(a.text).not.toMatch(/👤 Контрагент/)
  })
})

describe('formatMoveAlert · риск-% контрагента', () => {
  it('критический риск + hop2', () => {
    const tx = { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TDirtyxxxxxxxxxxxxxxxxxxxxxx', counterpartyRisk: { score: 100, level: 'critical', hop2: true } }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/👤 Контрагент · 🔴 риск 100% \(в 1 шаге от санкций\/ЧС\)/)
    expect(a.meta.counterparty_risk_score).toBe(100)
    expect(a.meta.counterparty_hop2).toBe(true)
  })
  it('warning 🟡 без hop2', () => {
    const tx = { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx', counterpartyRisk: { score: 25, level: 'warning', hop2: false } }
    expect(formatMoveAlert(acc, tx).text).toMatch(/🟡 риск 25%/)
  })
  it('без риск-данных — инлайн-строки «риск N%» нет', () => {
    const tx = { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx' }
    expect(formatMoveAlert(acc, tx).text).not.toMatch(/риск \d+%/)
  })
  it('🔎 ссылка при PUBLIC_APP_URL', () => {
    const prev = process.env.PUBLIC_APP_URL; process.env.PUBLIC_APP_URL = 'https://app.test'
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TabcDEF' })
    expect(a.text).toMatch(/🔎 <a href="https:\/\/app\.test\/api\/risk\/detail\?net=TRC20&addr=TabcDEF">Риск контрагента<\/a>/)
    process.env.PUBLIC_APP_URL = prev
  })
})

describe('formatMoveAlert · риск НАШЕГО кошелька в шапке', () => {
  it('показывает риск-% нашего счёта (snake_case из accounts)', () => {
    const dirty = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', risk_score: 55, risk_level: 'warning' }
    const a = formatMoveAlert(dirty, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx' })
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20 · 🟡 риск 55%/)
  })
  it('нет кэша риска — шапка без риска', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx' })
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20\n/)
  })
  it('полный адрес контрагента в <code> (копируется целиком)', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb' })
    expect(a.text).toMatch(/<code>TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb<\/code>/)
    expect(a.text).not.toMatch(/…/)
  })
})

describe('formatMoveAlert · три состояния риска ВНЕШНЕГО контрагента (никогда не пусто)', () => {
  const mk = (over) => formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TExtxxxxxxxxxxxxxxxxxxxxxxxxx', ...over }).text
  it('score>0 → «риск N%» (+ поведенческий тип рус, + hop2)', () => {
    expect(mk({ counterpartyRisk: { score: 60, level: 'warning', assessed: true, behavioralType: 'gambling', hop2: true } }))
      .toMatch(/👤 Контрагент · 🟡 риск 60% \(гэмблинг\) \(в 1 шаге от санкций\/ЧС\)/)
  })
  it('assessed=true И score=0 → «🟢 проверен · чисто»', () => {
    expect(mk({ counterpartyRisk: { score: 0, level: 'ok', assessed: true } })).toMatch(/👤 Контрагент · 🟢 проверен · чисто/)
  })
  it('assessed=false → «❔ не проверен»', () => {
    expect(mk({ counterpartyRisk: { score: 0, level: 'ok', assessed: false } })).toMatch(/👤 Контрагент · ❔ не проверен/)
  })
  it('нет объекта риска вообще → тоже «❔ не проверен» (никогда не пусто)', () => {
    expect(mk({})).toMatch(/👤 Контрагент · ❔ не проверен/)
  })
  it('свой контрагент (own) → имя офиса, БЕЗ риска', () => {
    const a = formatMoveAlert(acc, { direction: 'out', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TOwnxxxxxxxxxxxxxxxxxxxxxxxxx', counterpartyOwn: true, counterpartyName: 'WW-135 (kit out)' })
    expect(a.text).toMatch(/👤 Контрагент · WW-135 \(kit out\) \(свой\)/)
    expect(a.text).not.toMatch(/риск/)
    expect(a.text).not.toMatch(/не проверен/)
  })
})
