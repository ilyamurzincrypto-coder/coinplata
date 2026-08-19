import { describe, it, expect } from 'vitest'
import { tronRowToMove, isAlertRiskReady } from './tx-watch.js'
import { formatMoveAlert } from './_common.js'

describe('isAlertRiskReady — гейт «не постим неготовый скор»', () => {
  const full = { assessment: 'full', score: 5, verdict: { emoji: '🟢' } }
  const prelim = { assessment: 'preliminary', score: 10, verdict: { emoji: '⏳', preliminary: true } }
  it('свой + внешний контрагент оба full → готов', () => {
    expect(isAlertRiskReady({ ownRisk: full, counterpartyRisk: full })).toBe(true)
  })
  it('свой кошелёк preliminary → НЕ готов (держим)', () => {
    expect(isAlertRiskReady({ ownRisk: prelim, counterpartyRisk: full })).toBe(false)
  })
  it('контрагент preliminary → НЕ готов (держим)', () => {
    expect(isAlertRiskReady({ ownRisk: full, counterpartyRisk: prelim })).toBe(false)
  })
  it('свой «нет данных» (null) → НЕ готов', () => {
    expect(isAlertRiskReady({ ownRisk: null, counterpartyRisk: full })).toBe(false)
  })
  it('внутренний перевод (контрагент свой) → риск контрагента не нужен, готов если свой full', () => {
    expect(isAlertRiskReady({ ownRisk: full, counterpartyOwn: true })).toBe(true)
  })
  it('preliminary с вердиктом но score 0 → НЕ готов', () => {
    expect(isAlertRiskReady({ ownRisk: { verdict: { preliminary: true }, score: 0 }, counterpartyRisk: full })).toBe(false)
  })
})

const wallet = { id: 'a1', name: 'WW-131 · C52', network_id: 'TRC20', address: 'TNruX1DAdvTxqm944yLYGuP6meMRBky9qq' }
const row = (over = {}) => ({
  transaction_id: 'hAbC', block_timestamp: 1753370931000,
  from: 'TFromAddr000000000000000000000000', to: 'TToAddr0000000000000000000000000',
  value: '142886830000', token_info: { symbol: 'USDT', decimals: 6 }, ...over,
})

describe('tronRowToMove', () => {
  it('поступление (to = наш адрес) → in, контрагент = from', () => {
    const m = tronRowToMove(wallet, row({ to: wallet.address }))
    expect(m.direction).toBe('in')
    expect(m.counterparty).toBe('TFromAddr000000000000000000000000')
    expect(m.value).toBe('142886830000')
    expect(m.bt).toBe(1753370931000)
    expect(m.txObj.ts).toBe(new Date(1753370931000).toISOString())
  })

  it('списание (from = наш адрес) → out, контрагент = to', () => {
    const m = tronRowToMove(wallet, row({ from: wallet.address, to: 'TDest111', value: '1500000' }))
    expect(m.direction).toBe('out')
    expect(m.counterparty).toBe('TDest111')
    expect(m.value).toBe('1500000')
  })

  it('txObj кормит formatMoveAlert → корректный HTML + ссылка + meta', () => {
    const m = tronRowToMove(wallet, row({ from: wallet.address, to: 'TDest222', value: '6000000000' }))
    const a = formatMoveAlert(wallet, m.txObj)
    expect(a.kind).toBe('wallet_move')
    expect(a.text).toMatch(/📤 <b>Списание −\$6,000\.00<\/b>/)
    expect(a.text).toMatch(/🏦 Наш кошелёк: <b>WW-131 · C52<\/b> · TRC20/)
    expect(a.text).toMatch(/👤 Контрагент/)
    expect(a.text).toMatch(/<code>TDest222<\/code>/)
    expect(a.text).toMatch(/<a href="https:\/\/tronscan\.org\/#\/transaction\/hAbC">Проверить перевод<\/a>/)
    expect(a.meta.tx_hash).toBe('hAbC')
    expect(a.meta.direction).toBe('out')
    expect(a.meta.amount).toBe(6000)
    expect(a.meta.explorer_url).toBe('https://tronscan.org/#/transaction/hAbC')
  })

  it('нестандартные decimals из token_info учитываются', () => {
    const m = tronRowToMove(wallet, row({ to: wallet.address, value: '5000', token_info: { symbol: 'X', decimals: 2 } }))
    expect(m.txObj.amount.decimals).toBe(2)
    expect(formatMoveAlert(wallet, m.txObj).meta.amount).toBe(50)
  })
})
