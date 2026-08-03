import { describe, it, expect } from 'vitest'
import { formatMoveAlert } from './_common.js'

const acc = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', aegis_wallet_id: 'w1' }
const ext = (over) => formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TExtxxxxxxxxxxxxxxxxxxxxxxxxx', ...over }).text

describe('formatMoveAlert · базовое', () => {
  it('поступление с контрагентом-P2P (нет риск-данных → «не проверен»)', () => {
    const tx = { direction: 'in', amount: { amount: '5000000000', decimals: 6 }, counterparty: 'TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS', counterpartyType: 'p2p_merchant', ts: '2026-07-24T10:00:00Z', txHash: 'h1' }
    const a = formatMoveAlert(acc, tx)
    expect(a.kind).toBe('wallet_move')
    expect(a.text).toMatch(/💰 <b>Поступление \+\$5,000\.00<\/b>/)
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20/)
    expect(a.text).toMatch(/👤 Контрагент · P2P/)
    expect(a.text).toMatch(/<code>TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS<\/code>/)
    expect(a.text).toMatch(/❔ Риск контрагента: не проверен/)
    expect(a.text).toMatch(/<a href="https:\/\/tronscan\.org\/#\/transaction\/h1">Проверить перевод<\/a>/)
    expect(a.meta.direction).toBe('in')
    expect(a.meta.explorer_url).toBe('https://tronscan.org/#/transaction/h1')
  })

  it('списание с санкционным контрагентом → цитата «санкции»', () => {
    const tx = { direction: 'out', amount: { amount: '3000000000', decimals: 6 }, counterparty: 'TMixerAddrxxxxxxxxxxxxxxxxxxxxx', counterpartyEntity: { category: 'mixer', sanctioned: true }, ts: '2026-07-24T11:00:00Z' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/📤 <b>Списание −\$3,000\.00<\/b>/)
    expect(a.text).toMatch(/👤 Контрагент · микшер/)
    expect(a.text).toMatch(/<blockquote expandable>🔴 Риск контрагента: санкции/)
    expect(a.text).toMatch(/• санкции/)
    expect(a.meta.counterparty_sanctioned).toBe(true)
  })

  it('без контрагента — только сумма', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: null })
    expect(a.text).toMatch(/💰 <b>Поступление \+\$1\.00<\/b>/)
    expect(a.text).not.toMatch(/👤 Контрагент/)
    expect(a.text).not.toMatch(/Риск контрагента/)
  })
})

describe('formatMoveAlert · риск контрагента = expandable-цитата (три состояния, ВСЕГДА)', () => {
  it('① score>0 → цитата: скор + факторы breakdown по %', () => {
    const t = ext({ counterpartyRisk: { score: 100, level: 'critical', breakdown: [{ label: 'санкции', pct: 100 }, { label: 'чёрный список эмитента', pct: 100 }] } })
    expect(t).toMatch(/<blockquote expandable>🔴 Риск контрагента: 100%/)
    expect(t).toMatch(/• санкции — 100%/)
    expect(t).toMatch(/• чёрный список эмитента — 100%<\/blockquote>/)
  })
  it('① warning + gambling breakdown', () => {
    const t = ext({ counterpartyRisk: { score: 20, level: 'warning', breakdown: [{ label: 'гемблинг (по поведению)', pct: 20 }] } })
    expect(t).toMatch(/<blockquote expandable>🟡 Риск контрагента: 20%/)
    expect(t).toMatch(/• гемблинг \(по поведению\) — 20%/)
  })
  it('① hop2-фактор из breakdown', () => {
    const t = ext({ counterpartyRisk: { score: 25, level: 'warning', hop2: true, breakdown: [{ label: 'в 1 шаге от санкций/ЧС', pct: 25 }] } })
    expect(t).toMatch(/• в 1 шаге от санкций\/ЧС — 25%/)
  })
  it('② assessed && score=0 → цитата «0% — чисто»', () => {
    const t = ext({ counterpartyRisk: { score: 0, level: 'ok', assessed: true, breakdown: [] } })
    expect(t).toMatch(/<blockquote expandable>🟢 Риск контрагента: 0% — чисто/)
    expect(t).toMatch(/• проверен, факторов риска не найдено<\/blockquote>/)
  })
  it('③ assessed=false → цитата «не проверен» (единый вид, никогда не пусто)', () => {
    const t = ext({ counterpartyRisk: { score: 0, level: 'ok', assessed: false } })
    expect(t).toMatch(/<blockquote expandable>❔ Риск контрагента: не проверен/)
  })
  it('нет объекта риска вообще → тоже цитата «не проверен»', () => {
    const t = ext({})
    expect(t).toMatch(/<blockquote expandable>❔ Риск контрагента: не проверен/)
  })
  it('🔎 ссылка при PUBLIC_APP_URL', () => {
    const prev = process.env.PUBLIC_APP_URL; process.env.PUBLIC_APP_URL = 'https://app.test'
    const t = ext({ counterparty: 'TabcDEF' })
    // ext всегда шлёт TExt…; проверим ссылку отдельным вызовом на TabcDEF
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TabcDEF' })
    expect(a.text).toMatch(/🔎 <a href="https:\/\/app\.test\/api\/risk\/detail\?net=TRC20&addr=TabcDEF">Риск контрагента<\/a>/)
    process.env.PUBLIC_APP_URL = prev
  })
})

describe('formatMoveAlert · свой кошелёк + шапка', () => {
  it('риск НАШЕГО кошелька в шапке (snake_case из accounts)', () => {
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
  it('свой контрагент (own) → имя офиса, БЕЗ риск-блока', () => {
    const a = formatMoveAlert(acc, { direction: 'out', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TOwnxxxxxxxxxxxxxxxxxxxxxxxxx', counterpartyOwn: true, counterpartyName: 'WW-135 (kit out)' })
    expect(a.text).toMatch(/👤 Контрагент · WW-135 \(kit out\) \(свой\)/)
    expect(a.text).not.toMatch(/Риск контрагента/)
    expect(a.text).not.toMatch(/<blockquote/)
  })
})
