// Слайс 1.c «предъявление»: отбой курса сделки — кассир видит человеческий текст
// (RPC message + hint) в error-тосте, НЕ SQLSTATE-код. Строки взяты 1-в-1 из живого
// прод-прогона create_deal_v2 (P0423 инверт, P0424 uncovered).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./toast.jsx', () => ({ emitToast: vi.fn() }))
import { emitToast } from './toast.jsx'
import { withToast } from './supabaseWrite.js'
import { formatLedgerError } from './newLedger.js'

// Форма ошибки, как её отдаёт supabase-js на RAISE из create_deal_v2 (живой прогон).
const P0423 = {
  code: 'P0423',
  message: 'Курс сделки отклоняется от рыночного на -99.78% (допуск ±5.00%) — проверьте ввод. Стоимость выдачи 2.16 USDT против прихода 1000.00 USDT.',
  hint: 'Возможно перевёрнут курс или ошибка в сумме — сверьте с рыночным.',
  details: null,
}
const P0424 = {
  code: 'P0424',
  message: 'Нет рыночного курса для BTC — заведите валютную пару. Сделка не проверяется и не проводится.',
  hint: 'Добавьте пару в справочник курсов для этой валюты.',
  details: null,
}

describe('отбой курса — кассир видит фразу, не код', () => {
  beforeEach(() => vi.clearAllMocks())

  it('formatLedgerError(P0423) = message · hint (не «P0423», не «P0001»)', () => {
    const s = formatLedgerError(P0423)
    expect(s).toContain('отклоняется от рыночного на -99.78%')
    expect(s).toContain('проверьте ввод')
    expect(s).toContain('Возможно перевёрнут курс')
    expect(s).not.toMatch(/^P0\d{3}$/)
    expect(s).not.toContain('P0001')
  })

  it('withToast(P0423) → error-тост с человеческим текстом (то, что видит кассир)', async () => {
    const r = await withToast(() => { throw new Error(formatLedgerError(P0423)) }, { errorPrefix: 'Create deal failed' })
    expect(r.ok).toBe(false)
    expect(emitToast).toHaveBeenCalledWith('error', expect.stringContaining('отклоняется от рыночного'))
    expect(emitToast).toHaveBeenCalledWith('error', expect.stringContaining('проверьте ввод'))
  })

  it('withToast(P0424 uncovered) → «Нет рыночного курса … заведите валютную пару»', async () => {
    await withToast(() => { throw new Error(formatLedgerError(P0424)) }, { errorPrefix: 'Create deal failed' })
    expect(emitToast).toHaveBeenCalledWith('error', expect.stringContaining('Нет рыночного курса для BTC'))
    expect(emitToast).toHaveBeenCalledWith('error', expect.stringContaining('заведите валютную пару'))
  })
})
