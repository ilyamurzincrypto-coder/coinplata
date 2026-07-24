// api/aegis/webhook.test.js — HMAC, дедуп, алерты по переходам.
import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'crypto'
import { verifyAegisSignature, alertPlan, handleAegisEvent } from './webhook.js'
import { FIX_EVENT_RISK_CHANGED, FIX_EVENT_RISK_CRITICAL, FIX_EVENT_BALANCE_CHANGED } from '../../src/lib/aegisFixtures.js'

const SECRET = 'test_webhook_secret'
const sign = (raw) => createHmac('sha256', SECRET).update(raw).digest('hex')

function mkDeps(overrides = {}) {
  return {
    recordDelivery: vi.fn(async () => 'new'),
    updateRisk: vi.fn(async () => 1),
    updateBalance: vi.fn(async () => 1),
    notifyTelegram: vi.fn(async () => true),
    ...overrides,
  }
}

describe('verifyAegisSignature', () => {
  it('валидная подпись → true', () => {
    const raw = '{"a":1}'
    expect(verifyAegisSignature(raw, sign(raw), SECRET)).toBe(true)
  })
  it('поддерживает префикс sha256=', () => {
    const raw = '{"a":1}'
    expect(verifyAegisSignature(raw, `sha256=${sign(raw)}`, SECRET)).toBe(true)
  })
  it('подделанное тело → false', () => {
    const raw = '{"a":1}'
    expect(verifyAegisSignature('{"a":2}', sign(raw), SECRET)).toBe(false)
  })
  it('нет подписи/секрета → false', () => {
    expect(verifyAegisSignature('{}', '', SECRET)).toBe(false)
    expect(verifyAegisSignature('{}', 'abc', '')).toBe(false)
  })
})

describe('alertPlan', () => {
  it('ok→warning: переход, без telegram', () => {
    expect(alertPlan('ok', 'warning')).toMatchObject({ transitioned: true, telegram: false, severity: 'warning' })
  })
  it('warning→critical: telegram', () => {
    expect(alertPlan('warning', 'critical')).toMatchObject({ transitioned: true, telegram: true, severity: 'critical' })
  })
  it('critical→ok: снят, без telegram', () => {
    expect(alertPlan('critical', 'ok')).toMatchObject({ transitioned: true, telegram: false, severity: 'cleared' })
  })
  it('без изменения уровня — не переход', () => {
    expect(alertPlan('ok', 'ok').transitioned).toBe(false)
  })
  it('первичный ok (из null) — не алертим', () => {
    expect(alertPlan(null, 'ok')).toMatchObject({ transitioned: false, severity: null })
  })
})

describe('handleAegisEvent', () => {
  const wrap = (obj) => JSON.stringify(obj)

  it('невалидный HMAC → 401, без побочек', async () => {
    const deps = mkDeps()
    const raw = wrap(FIX_EVENT_RISK_CRITICAL)
    const r = await handleAegisEvent({ raw, signature: 'deadbeef', secret: SECRET, deps })
    expect(r.status).toBe(401)
    expect(deps.recordDelivery).not.toHaveBeenCalled()
    expect(deps.updateRisk).not.toHaveBeenCalled()
  })

  it('дубль delivery_id → 200 без побочек', async () => {
    const deps = mkDeps({ recordDelivery: vi.fn(async () => 'duplicate') })
    const raw = wrap(FIX_EVENT_RISK_CRITICAL)
    const r = await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(r.status).toBe(200)
    expect(r.body.duplicate).toBe(true)
    expect(deps.updateRisk).not.toHaveBeenCalled()
    expect(deps.notifyTelegram).not.toHaveBeenCalled()
  })

  it('risk.changed → critical: обновляет риск и шлёт telegram', async () => {
    const deps = mkDeps()
    const raw = wrap(FIX_EVENT_RISK_CRITICAL) // prev warning → critical
    const r = await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(r.status).toBe(200)
    expect(r.body.severity).toBe('critical')
    expect(deps.updateRisk).toHaveBeenCalledWith('aegis_w_trc20_003', expect.objectContaining({ risk_level: 'critical' }))
    expect(deps.notifyTelegram).toHaveBeenCalledTimes(1)
  })

  it('risk.changed → warning: без telegram (только колокольчик)', async () => {
    const deps = mkDeps()
    const raw = wrap(FIX_EVENT_RISK_CHANGED) // ok → warning
    const r = await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(r.status).toBe(200)
    expect(deps.updateRisk).toHaveBeenCalledTimes(1)
    expect(deps.notifyTelegram).not.toHaveBeenCalled()
  })

  it('balance.changed → обновляет баланс', async () => {
    const deps = mkDeps()
    const raw = wrap(FIX_EVENT_BALANCE_CHANGED)
    const r = await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(r.status).toBe(200)
    expect(deps.updateBalance).toHaveBeenCalledWith('aegis_w_trc20_001', expect.objectContaining({ balance_usd_est: '12777.10' }))
  })

  it('balance.changed → алерт «Поступило» при росте выше порога', async () => {
    // старый баланс 12000 → новый 12777.10 = поступило +777.10 (> $50)
    const deps = mkDeps({ getAccounts: vi.fn(async () => [{ id: 'a1', name: 'W88 Mark', network: 'TRC20', balance_usd_est: '12000.00' }]), notifyMove: vi.fn(async () => true) })
    const raw = wrap(FIX_EVENT_BALANCE_CHANGED)
    await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(deps.notifyMove).toHaveBeenCalledTimes(1)
    const payload = deps.notifyMove.mock.calls[0][0]
    expect(payload.meta.direction).toBe('in')
    expect(payload.text).toMatch(/Поступило \+\$777\.10/)
    expect(payload.text).toMatch(/W88 Mark/)
  })

  it('balance.changed → алерт с контрагентом (← от … · категория)', async () => {
    const deps = mkDeps({
      getAccounts: vi.fn(async () => [{ id: 'a1', name: 'W88 Mark', network: 'TRC20', balance_usd_est: '12000.00' }]),
      notifyMove: vi.fn(async () => true),
      fetchLastCounterparty: vi.fn(async () => ({ counterparty: 'TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS', category: 'p2p', entityName: null, sanctioned: false })),
    })
    const raw = wrap(FIX_EVENT_BALANCE_CHANGED)
    await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(deps.fetchLastCounterparty).toHaveBeenCalledWith('aegis_w_trc20_001', 'in')
    const payload = deps.notifyMove.mock.calls[0][0]
    expect(payload.text).toMatch(/← от <code>TTqKSJbsbx…WV84kS<\/code> · P2P/)
    expect(payload.meta.counterparty).toBe('TTqKSJbsbxTBpKzz1GDoTsDBpDMHWV84kS')
  })

  it('balance.changed → алерт «Списано» при падении', async () => {
    const deps = mkDeps({ getAccounts: vi.fn(async () => [{ id: 'a1', name: 'W88 Mark', network: 'TRC20', balance_usd_est: '20000.00' }]), notifyMove: vi.fn(async () => true) })
    const raw = wrap(FIX_EVENT_BALANCE_CHANGED) // новый 12777.10 < 20000 → списано
    await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    const payload = deps.notifyMove.mock.calls[0][0]
    expect(payload.meta.direction).toBe('out')
    expect(payload.text).toMatch(/Списано −\$7,222\.90/)
  })

  it('balance.changed → нет алерта при дельте ниже порога', async () => {
    const deps = mkDeps({ getAccounts: vi.fn(async () => [{ id: 'a1', name: 'W88', network: 'TRC20', balance_usd_est: '12770.00' }]), notifyMove: vi.fn(async () => true) })
    const raw = wrap(FIX_EVENT_BALANCE_CHANGED) // 12777.10 − 12770 = 7.10 < $50
    await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(deps.notifyMove).not.toHaveBeenCalled()
  })

  it('невалидный JSON → 400', async () => {
    const deps = mkDeps()
    const raw = 'not json'
    const r = await handleAegisEvent({ raw, signature: sign(raw), secret: SECRET, deps })
    expect(r.status).toBe(400)
  })
})
