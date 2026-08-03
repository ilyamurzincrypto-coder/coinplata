import { describe, it, expect } from 'vitest'
import { formatMoveAlert } from './_common.js'

const acc = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', aegis_wallet_id: 'w1' }
const ext = (over) => formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TExtxxxxxxxxxxxxxxxxxxxxxxxxx', ...over }).text

describe('formatMoveAlert · базовое', () => {
  it('P2P без риск-данных (assessed=false) → строка «не проверен»', () => {
    const tx = { direction: 'in', amount: { amount: '5000000000', decimals: 6 }, counterparty: 'TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS', counterpartyType: 'p2p_merchant', txHash: 'h1' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/💰 <b>Поступление \+\$5,000\.00<\/b>/)
    expect(a.text).toMatch(/👤 Контрагент · P2P/)
    expect(a.text).toMatch(/<code>TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS<\/code>/)
    expect(a.text).toMatch(/❔ Риск контрагента: не проверен/)
    expect(a.text).toMatch(/<a href="https:\/\/tronscan\.org\/#\/transaction\/h1">Проверить перевод<\/a>/)
    expect(a.meta.explorer_url).toBe('https://tronscan.org/#/transaction/h1')
  })

  it('санкционный контрагент → цитата «санкции» 🔴', () => {
    const tx = { direction: 'out', amount: { amount: '3000000000', decimals: 6 }, counterparty: 'TMixerAddrxxxxxxxxxxxxxxxxxxxxx', counterpartyEntity: { category: 'mixer', sanctioned: true } }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/📤 <b>Списание −\$3,000\.00<\/b>/)
    expect(a.text).toMatch(/<blockquote expandable>🔴 Риск контрагента: санкции/)
    expect(a.text).toMatch(/• Санкции — 100%/)
    expect(a.text).toMatch(/• Миксер — 0%/)
    expect(a.meta.counterparty_sanctioned).toBe(true)
  })

  it('без контрагента — только сумма', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: null })
    expect(a.text).toMatch(/💰 <b>Поступление \+\$1\.00<\/b>/)
    expect(a.text).not.toMatch(/Риск контрагента/)
  })
})

describe('formatMoveAlert · риск = цитата с чек-листом по AML-категориям', () => {
  it('baseline 10% (ok) → 🟢 скор + все категории «чисто» + доп-фактор AEGIS', () => {
    const t = ext({ counterpartyRisk: { score: 10, level: 'ok', assessed: true, breakdown: [{ label: 'контрагент не верифицирован', pct: 10 }] } })
    expect(t).toMatch(/<blockquote expandable>🟢 Риск контрагента: 10%/)
    expect(t).toMatch(/• Санкции — 0%/)
    expect(t).toMatch(/• Гемблинг — 0%/)
    expect(t).toMatch(/• контрагент не верифицирован — 10%<\/blockquote>/)
  })
  it('critical 100% → 🔴 + Санкции/Чёрный список по %, прочие чисто', () => {
    const t = ext({ counterpartyRisk: { score: 100, level: 'critical', breakdown: [{ label: 'санкции', pct: 100 }, { label: 'чёрный список эмитента', pct: 100 }] } })
    expect(t).toMatch(/<blockquote expandable>🔴 Риск контрагента: 100%/)
    expect(t).toMatch(/• Санкции — 100%/)
    expect(t).toMatch(/• Чёрный список — 100%/)
    expect(t).toMatch(/• Миксер — 0%/)
  })
  it('warning gambling → 🟡, Гемблинг по %', () => {
    const t = ext({ counterpartyRisk: { score: 20, level: 'warning', breakdown: [{ label: 'гемблинг (по поведению)', pct: 20 }] } })
    expect(t).toMatch(/<blockquote expandable>🟡 Риск контрагента: 20%/)
    expect(t).toMatch(/• Гемблинг — 20%/)
    expect(t).toMatch(/• Санкции — 0%/)
  })
  it('матч по стабильному b.category (не только по метке)', () => {
    const t = ext({ counterpartyRisk: { score: 50, level: 'warning', breakdown: [{ label: 'tumbler service', pct: 50, category: 'mixer' }] } })
    expect(t).toMatch(/• Миксер — 50%/)
  })
  it('level=ok при score 30 → 🟢 (level главнее порога)', () => {
    expect(ext({ counterpartyRisk: { score: 30, level: 'ok', breakdown: [] } })).toMatch(/🟢 Риск контрагента: 30%/)
  })
  it('assessed=false → строка «❔ не проверен» (не цитата)', () => {
    const t = ext({ counterpartyRisk: { score: 0, level: 'ok', assessed: false } })
    expect(t).toMatch(/❔ Риск контрагента: не проверен/)
    expect(t).not.toMatch(/<blockquote/)
  })
  it('нет объекта риска → тоже «❔ не проверен»', () => {
    expect(ext({})).toMatch(/❔ Риск контрагента: не проверен/)
  })
  it('🔎 ссылка при PUBLIC_APP_URL', () => {
    const prev = process.env.PUBLIC_APP_URL; process.env.PUBLIC_APP_URL = 'https://app.test'
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TabcDEF' })
    expect(a.text).toMatch(/🔎 <a href="https:\/\/app\.test\/api\/risk\/detail\?net=TRC20&addr=TabcDEF">Риск контрагента<\/a>/)
    process.env.PUBLIC_APP_URL = prev
  })
})

describe('formatMoveAlert · свой кошелёк + шапка', () => {
  it('риск НАШЕГО кошелька в шапке (эмодзи по level)', () => {
    const dirty = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', risk_score: 55, risk_level: 'warning' }
    const a = formatMoveAlert(dirty, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx' })
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20 · 🟡 риск 55%/)
  })
  it('полный адрес контрагента в <code>', () => {
    const a = formatMoveAlert(acc, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb' })
    expect(a.text).toMatch(/<code>TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb<\/code>/)
    expect(a.text).not.toMatch(/…/)
  })
  it('свой контрагент (own) → имя офиса, БЕЗ риск-блока', () => {
    const a = formatMoveAlert(acc, { direction: 'out', amount: { amount: '1000000', decimals: 6 }, counterparty: 'TOwnxxxxxxxxxxxxxxxxxxxxxxxxx', counterpartyOwn: true, counterpartyName: 'WW-135 (kit out)' })
    expect(a.text).toMatch(/👤 Контрагент · WW-135 \(kit out\) \(свой\)/)
    expect(a.text).not.toMatch(/Риск контрагента/)
  })
})

describe('formatMoveAlert · риск НАШЕГО кошелька — такой же чек-лист', () => {
  it('tx.ownRisk → отдельная цитата «Риск кошелька» с категориями', () => {
    const a = formatMoveAlert(acc, {
      direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx',
      ownRisk: { score: 10, level: 'ok', assessed: true, breakdown: [{ label: 'наш кошелёк не верифицирован', pct: 10 }] },
    })
    expect(a.text).toMatch(/<blockquote expandable>🟢 Риск кошелька: 10%/)
    expect(a.text).toMatch(/• Санкции — 0%/)
    expect(a.text).toMatch(/• наш кошелёк не верифицирован — 10%<\/blockquote>/)
  })
  it('без ownRisk → фолбэк инлайн-скор в шапке (из accounts кэша)', () => {
    const dirty = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', risk_score: 55, risk_level: 'warning' }
    const a = formatMoveAlert(dirty, { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: 'Txxx' })
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>W88 Mark<\/b> · TRC20 · 🟡 риск 55%/)
    expect(a.text).not.toMatch(/Риск кошелька/)
  })
})
