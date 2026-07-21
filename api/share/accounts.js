/**
 * Публичное read-only чтение раздела «Счета» по share-токену.
 * БЕЗ логина: валидируем токен в public.share_tokens (service-role, обход RLS),
 * проверяем что не отозван, и отдаём ЖИВОЙ снапшот счетов+балансов под scope.
 *
 * Это единственная точка доступа к данным по токену, и она реализует ТОЛЬКО GET
 * — никакого write-пути не существует в принципе (энфорсмент read-only на бэке,
 * а не «спрятали кнопки»). Любой не-GET → 405. Нет/отозван токен → 404.
 *
 * Scope-фильтр по типу счёта применяется СЕРВЕРНО: крипто-ссылка не отдаёт фиат
 * в payload (не только не рисует). Пустые офисы возвращаем — фронт покажет $0.
 *
 * ENV: SUPABASE_URL (или VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

  const token = String(req.query.token || '').trim()
  if (!token) return res.status(400).json({ error: 'token required' })

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !svcKey) return res.status(503).json({ error: 'share backend not configured' })

  const db = createClient(supaUrl, svcKey, { auth: { persistSession: false } })

  try {
    // 1. Валидация токена: существует, секция accounts, не отозван.
    const { data: tok, error: tokErr } = await db
      .from('share_tokens')
      .select('scope, section, revoked_at')
      .eq('token', token)
      .maybeSingle()
    if (tokErr) return res.status(500).json({ error: 'token lookup failed' })
    if (!tok || tok.section !== 'accounts' || tok.revoked_at) {
      return res.status(404).json({ error: 'link not found or revoked' })
    }
    const scope = ['all', 'fiat', 'crypto'].includes(tok.scope) ? tok.scope : 'all'

    // 2. Живые данные. Счета фильтруем по scope СЕРВЕРНО.
    let accQ = db
      .from('accounts')
      .select('id, office_id, currency_code, kind, name, address, network_id, aegis_wallet_id, aegis_capability, risk_level, risk_score, risk_updated_at, balance_usd_est, synced_at')
      .eq('active', true)
    if (scope !== 'all') accQ = accQ.eq('kind', scope)

    const [accRes, offRes, balRes, pairRes, setRes] = await Promise.all([
      accQ,
      db.from('offices').select('id, name').order('name'),
      db.from('v_account_balances').select('account_id, total, reserved'),
      db.from('pairs').select('from_currency, to_currency, rate').eq('is_default', true),
      db.from('system_settings').select('key, value'),
    ])
    for (const r of [accRes, offRes, balRes, pairRes, setRes]) {
      if (r.error) return res.status(500).json({ error: 'data read failed' })
    }

    const accounts = (accRes.data || []).map((r) => ({
      id: r.id,
      officeId: r.office_id,
      currency: r.currency_code,
      kind: r.kind || 'fiat',
      name: r.name,
      active: true,
      address: r.address || null,
      network: r.network_id || null,
      // AEGIS-мониторинг (кэш) — бейдж риска + он-чейн баланс в share-view.
      aegisWalletId: r.aegis_wallet_id || null,
      aegisCapability: r.aegis_capability || null,
      riskLevel: r.risk_level || null,
      riskScore: r.risk_score ?? null,
      riskUpdatedAt: r.risk_updated_at || null,
      balanceUsdEst: r.balance_usd_est != null ? String(r.balance_usd_est) : null,
      syncedAt: r.synced_at || null,
    }))
    const offices = (offRes.data || []).map((r) => ({ id: r.id, name: r.name }))

    // Балансы только по возвращённым счетам (не льём чужой scope).
    const keep = new Set(accounts.map((a) => a.id))
    const balances = {}
    for (const r of balRes.data || []) {
      if (keep.has(r.account_id)) {
        balances[r.account_id] = { total: Number(r.total) || 0, reserved: Number(r.reserved) || 0 }
      }
    }

    // Плоская карта дефолтных пар {FROM_TO: rate} + синтез обратной ноги
    // (как buildRatesLookup) — фронт достроит USDT-пивот и base-конверсию.
    const rates = {}
    for (const p of pairRes.data || []) {
      if (p.from_currency && p.to_currency && Number(p.rate) > 0) {
        rates[`${p.from_currency}_${p.to_currency}`] = Number(p.rate)
      }
    }
    for (const p of pairRes.data || []) {
      const rk = `${p.to_currency}_${p.from_currency}`
      if (rates[rk] === undefined && Number(p.rate) > 0) rates[rk] = 1 / Number(p.rate)
    }

    const settings = {}
    for (const r of setRes.data || []) settings[r.key] = r.value
    const baseCurrency = typeof settings.base_currency === 'string' ? settings.base_currency : 'USD'
    const fxRates =
      settings.fx_rates && typeof settings.fx_rates === 'object' && !Array.isArray(settings.fx_rates)
        ? settings.fx_rates
        : {}

    // Не кэшировать — данные живые.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      section: 'accounts',
      scope,
      accounts,
      offices,
      balances,
      rates,
      baseCurrency,
      fxRates,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    return res.status(500).json({ error: `share read failed: ${e?.message || e}` })
  }
}
