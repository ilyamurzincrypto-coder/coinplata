// api/aegis/risk-alerts.test.js — HOP2-фильтр, дедуп по alert_id, матч офиса, алерт на новом.
import { describe, it, expect, vi } from 'vitest'
import { handleRiskAlerts } from './risk-alerts.js'
import { normalizeAlert } from '../../src/lib/aegisClient.js'

// Два реальных тест-алерта (BLACKLIST + SANCTION) + один не-HOP2 (должен игнорироваться).
const RAW_ALERTS = [
  {
    alert_id: 'al-blacklist-1', type: 'HOP2_RISK', network: 'TRON',
    risk_address: 'TDirtyBlacklistAddrxxxxxxxxxxxxxxx', category: 'BLACKLIST',
    via_counterparty: 'TQ2z8D91j4t1i69pR4X4e8Y2p2UR1h3YRg', office_wallet_id: 'cmrunl88k01tis6x51c9nqneo',
    office_label: 'WW-131 Центр', note: 'Грязь в 2 хопах: …EDD на контрагента', status: 'PENDING', created_at: '2026-08-01T10:00:00Z',
  },
  {
    alert_id: 'al-sanction-1', type: 'HOP2_RISK', network: 'TRON',
    risk_address: 'TSanctionedAddrxxxxxxxxxxxxxxxxxxx', category: 'SANCTION:OPENSANCTIONS',
    via_counterparty: 'TYsGhwVJr3p86ZGY', office_wallet_id: 'cmruimkr200jit7x5539mbepw',
    office_label: null, note: 'Грязь в 2 хопах', status: 'PENDING', created_at: '2026-08-01T10:05:00Z',
  },
  { alert_id: 'al-other-1', type: 'SOMETHING_ELSE', network: 'TRON', office_wallet_id: 'cmrunl88k01tis6x51c9nqneo' },
]

function mkDeps(overrides = {}) {
  return {
    fetchAlerts: vi.fn(async () => ({ alerts: RAW_ALERTS.map(normalizeAlert) })),
    findOffice: vi.fn(async () => ({ id: 'office-mark', name: 'Mark Antalya' })),
    resolveCounterparty: vi.fn(async () => null),
    recordFinding: vi.fn(async () => 'new'),
    notify: vi.fn(async () => true),
    markNotified: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('normalizeAlert', () => {
  it('маппит snake_case → внутреннюю форму', () => {
    const a = normalizeAlert(RAW_ALERTS[0])
    expect(a).toMatchObject({ alertId: 'al-blacklist-1', type: 'HOP2_RISK', category: 'BLACKLIST', officeWalletId: 'cmrunl88k01tis6x51c9nqneo' })
  })
  it('null → null', () => expect(normalizeAlert(null)).toBe(null))
})

describe('handleRiskAlerts', () => {
  it('фильтрует только HOP2_RISK (не-HOP2 игнор)', async () => {
    const deps = mkDeps()
    const r = await handleRiskAlerts({ deps })
    expect(r.total).toBe(3)
    expect(r.hop2).toBe(2)
    expect(deps.recordFinding).toHaveBeenCalledTimes(2)
  })

  it('матчит офис по office_wallet_id и пишет строку с office_id', async () => {
    const deps = mkDeps()
    await handleRiskAlerts({ deps })
    expect(deps.findOffice).toHaveBeenCalledWith('cmrunl88k01tis6x51c9nqneo')
    expect(deps.recordFinding).toHaveBeenCalledWith(expect.objectContaining({
      alert_id: 'al-blacklist-1', category: 'BLACKLIST', office_id: 'office-mark',
      via_counterparty: 'TQ2z8D91j4t1i69pR4X4e8Y2p2UR1h3YRg', office_wallet_id: 'cmrunl88k01tis6x51c9nqneo',
    }))
  })

  it('новая находка → алерт + markNotified', async () => {
    const deps = mkDeps()
    const r = await handleRiskAlerts({ deps })
    expect(r.inserted).toBe(2)
    expect(deps.notify).toHaveBeenCalledTimes(2)
    expect(deps.markNotified).toHaveBeenCalledWith('al-blacklist-1')
    expect(r.notified).toBe(2)
  })

  it('дубль alert_id → без повторного алерта', async () => {
    const deps = mkDeps({ recordFinding: vi.fn(async () => 'duplicate') })
    const r = await handleRiskAlerts({ deps })
    expect(r.inserted).toBe(0)
    expect(r.dup).toBe(2)
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('нераспознанный офис (findOffice→null) → строка сохранена с office_id=null, всё равно алерт', async () => {
    const deps = mkDeps({ findOffice: vi.fn(async () => null) })
    const r = await handleRiskAlerts({ deps })
    expect(deps.recordFinding).toHaveBeenCalledWith(expect.objectContaining({ office_id: null }))
    expect(r.inserted).toBe(2)
    expect(deps.notify).toHaveBeenCalledTimes(2)
  })

  it('подтягивает имя контрагента, если найдено', async () => {
    const deps = mkDeps({ resolveCounterparty: vi.fn(async () => 'ООО Ромашка') })
    await handleRiskAlerts({ deps })
    expect(deps.recordFinding).toHaveBeenCalledWith(expect.objectContaining({ via_counterparty_name: 'ООО Ромашка' }))
  })

  it('сбой notify не роняет прогон и не мешает записи', async () => {
    const deps = mkDeps({ notify: vi.fn(async () => { throw new Error('bridge down') }) })
    const r = await handleRiskAlerts({ deps })
    expect(r.inserted).toBe(2) // записаны
    expect(r.notified).toBe(0) // но не доставлены
  })
})

// Батч-путь — тот, по которому реально идёт прод. Раньше цикл делал 5 round-trip
// на КАЖДУЮ находку и при limit=100 упирался в maxDuration=60 → 504.
function mkBatchDeps(overrides = {}) {
  return {
    fetchAlerts: vi.fn(async () => ({ alerts: RAW_ALERTS.map(normalizeAlert) })),
    loadOffices: vi.fn(async (ids) => new Map(ids.filter(Boolean).map((id) => [id, { id: 'office-mark', name: 'Mark Antalya' }]))),
    loadCounterparties: vi.fn(async () => new Map()),
    existingAlertIds: vi.fn(async () => new Set()),
    insertFindings: vi.fn(async () => {}),
    notify: vi.fn(async () => true),
    markNotified: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('handleRiskAlerts — батч-путь', () => {
  it('резолвит офисы и дедуп ОДНИМ вызовом на прогон, а не по находке', async () => {
    const deps = mkBatchDeps()
    const r = await handleRiskAlerts({ deps })
    expect(deps.loadOffices).toHaveBeenCalledTimes(1)
    expect(deps.loadCounterparties).toHaveBeenCalledTimes(1)
    expect(deps.existingAlertIds).toHaveBeenCalledTimes(1)
    expect(deps.insertFindings).toHaveBeenCalledTimes(1)
    expect(r.inserted).toBe(2)
  })

  it('вставляет все новые находки одной пачкой', async () => {
    const deps = mkBatchDeps()
    await handleRiskAlerts({ deps })
    const rows = deps.insertFindings.mock.calls[0][0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ alert_id: 'al-blacklist-1', category: 'BLACKLIST', office_id: 'office-mark' })
  })

  it('известные alert_id → duplicate, без вставки и без алерта', async () => {
    const deps = mkBatchDeps({ existingAlertIds: vi.fn(async () => new Set(['al-blacklist-1', 'al-sanction-1'])) })
    const r = await handleRiskAlerts({ deps })
    expect(r.inserted).toBe(0)
    expect(r.dup).toBe(2)
    expect(deps.insertFindings).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('дубль ВНУТРИ одной пачки не вставляется дважды', async () => {
    const twice = [RAW_ALERTS[0], RAW_ALERTS[0]].map(normalizeAlert)
    const deps = mkBatchDeps({ fetchAlerts: vi.fn(async () => ({ alerts: twice })) })
    const r = await handleRiskAlerts({ deps })
    expect(r.inserted).toBe(1)
    expect(r.dup).toBe(1)
    expect(deps.insertFindings.mock.calls[0][0]).toHaveLength(1)
  })

  it('нераспознанный кошелёк → office_id=null, находка всё равно пишется', async () => {
    const deps = mkBatchDeps({ loadOffices: vi.fn(async () => new Map()) })
    const r = await handleRiskAlerts({ deps })
    expect(r.inserted).toBe(2)
    expect(deps.insertFindings.mock.calls[0][0][0]).toMatchObject({ office_id: null })
  })

  it('имя контрагента подтягивается из батч-мапы', async () => {
    const deps = mkBatchDeps({
      loadCounterparties: vi.fn(async () => new Map([['TQ2z8D91j4t1i69pR4X4e8Y2p2UR1h3YRg', 'ООО Ромашка']])),
    })
    await handleRiskAlerts({ deps })
    const rows = deps.insertFindings.mock.calls[0][0]
    expect(rows.find((r) => r.alert_id === 'al-blacklist-1').via_counterparty_name).toBe('ООО Ромашка')
    expect(rows.find((r) => r.alert_id === 'al-sanction-1').via_counterparty_name).toBe(null)
  })

  it('алертит ПОСЛЕ записи — не уведомляем о том, что не легло', async () => {
    const order = []
    const deps = mkBatchDeps({
      insertFindings: vi.fn(async () => { order.push('insert') }),
      notify: vi.fn(async () => { order.push('notify'); return true }),
    })
    const r = await handleRiskAlerts({ deps })
    expect(order[0]).toBe('insert')
    expect(order.slice(1)).toEqual(['notify', 'notify'])
    expect(r.notified).toBe(2)
  })

  it('падение вставки роняет прогон — молча терять находки нельзя', async () => {
    const deps = mkBatchDeps({ insertFindings: vi.fn(async () => { throw new Error('db down') }) })
    await expect(handleRiskAlerts({ deps })).rejects.toThrow('db down')
    expect(deps.notify).not.toHaveBeenCalled()
  })
})
