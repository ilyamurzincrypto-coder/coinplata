import { describe, it, expect } from 'vitest'
import { formatMoveAlert } from './_common.js'

const acc = { id: 'a1', name: 'W88 Mark', network_id: 'TRC20', aegis_wallet_id: 'w1' }

describe('formatMoveAlert', () => {
  it('поступление с контрагентом-P2P', () => {
    const tx = { direction: 'in', amount: { amount: '5000000000', decimals: 6 }, counterparty: 'TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS', counterpartyType: 'p2p_merchant', ts: '2026-07-24T10:00:00Z', txHash: 'h1' }
    const a = formatMoveAlert(acc, tx)
    expect(a.kind).toBe('wallet_move')
    expect(a.text).toMatch(/💰 <b>W88 Mark<\/b> · TRC20/)
    expect(a.text).toMatch(/Поступило \+\$5,000\.00/)
    expect(a.text).toMatch(/← от <code>TTqKSJbsbx…WV84kS<\/code> · P2P/)
    expect(a.text).toMatch(/<a href="https:\/\/tronscan\.org\/#\/transaction\/h1">Проверить на Tronscan<\/a>/)
    expect(a.meta.direction).toBe('in')
    expect(a.meta.counterparty).toBe('TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS')
    expect(a.meta.explorer_url).toBe('https://tronscan.org/#/transaction/h1')
  })

  it('списание с санкционным контрагентом', () => {
    const tx = { direction: 'out', amount: { amount: '3000000000', decimals: 6 }, counterparty: 'TMixerAddrxxxxxxxxxxxxxxxxxxxxx', counterpartyEntity: { category: 'mixer', sanctioned: true }, ts: '2026-07-24T11:00:00Z' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/📤/)
    expect(a.text).toMatch(/Списано −\$3,000\.00/)
    expect(a.text).toMatch(/→ на .* · микшер ⚠️ санкции/)
    expect(a.meta.counterparty_sanctioned).toBe(true)
  })

  it('без контрагента — только сумма', () => {
    const tx = { direction: 'in', amount: { amount: '1000000', decimals: 6 }, counterparty: null, ts: '2026-07-24T12:00:00Z' }
    const a = formatMoveAlert(acc, tx)
    expect(a.text).toMatch(/Поступило \+\$1\.00/)
    expect(a.text).not.toMatch(/← от/)
  })
})
