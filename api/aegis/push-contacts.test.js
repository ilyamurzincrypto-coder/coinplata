// api/aegis/push-contacts.test.js — дедуп (network,address), батчи, идемпотентность.
import { describe, it, expect, vi } from 'vitest'
import { handlePushContacts } from './push-contacts.js'

function mkDeps(overrides = {}) {
  return {
    loadContacts: vi.fn(async () => [
      { network: 'TRC20', address: 'Taaa', name: 'W88 Mark', type: 'own' },
      { network: 'ERC20', address: '0xbbb', name: 'Hot ERC20', type: 'own' },
      { network: 'TRC20', address: 'Taaa', name: 'W88 Mark (dup)', type: 'own' }, // дубль (network,address)
    ]),
    push: vi.fn(async (batch) => ({ upserted: batch.length, skipped: 0 })),
    ...overrides,
  }
}

describe('handlePushContacts', () => {
  it('дедупит по (network,address) перед заливкой', async () => {
    const deps = mkDeps()
    const r = await handlePushContacts({ deps })
    expect(r.total).toBe(2) // Taaa задедуплен
    expect(deps.push).toHaveBeenCalledTimes(1)
    expect(deps.push.mock.calls[0][0]).toHaveLength(2)
    expect(r.upserted).toBe(2)
  })

  it('одинаковый адрес на разных сетях — НЕ дубль', async () => {
    const deps = mkDeps({ loadContacts: vi.fn(async () => [
      { network: 'TRC20', address: 'X', name: 'a', type: 'own' },
      { network: 'ERC20', address: 'X', name: 'b', type: 'own' },
    ]) })
    const r = await handlePushContacts({ deps })
    expect(r.total).toBe(2)
  })

  it('батчит по batchSize', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ network: 'TRC20', address: `T${i}`, name: `w${i}`, type: 'own' }))
    const deps = mkDeps({ loadContacts: vi.fn(async () => many) })
    const r = await handlePushContacts({ deps, batchSize: 2 })
    expect(deps.push).toHaveBeenCalledTimes(3) // 2+2+1
    expect(r.total).toBe(5)
  })

  it('пропускает записи без адреса/сети', async () => {
    const deps = mkDeps({ loadContacts: vi.fn(async () => [
      { network: 'TRC20', address: 'Tok', name: 'ok', type: 'own' },
      { network: 'TRC20', address: null, name: 'no addr', type: 'own' },
      { network: null, address: 'Tx', name: 'no net', type: 'own' },
    ]) })
    const r = await handlePushContacts({ deps })
    expect(r.total).toBe(1)
  })

  it('пустой источник → ничего не шлём', async () => {
    const deps = mkDeps({ loadContacts: vi.fn(async () => []) })
    const r = await handlePushContacts({ deps })
    expect(r.total).toBe(0)
    expect(deps.push).not.toHaveBeenCalled()
  })
})
