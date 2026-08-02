/**
 * Общее для AEGIS-endpoints: service-role клиент Supabase и применение кэша
 * кошелька на счёт. balance_usd_est/risk — кэш мониторинга, НЕ деньги.
 */
import { createClient } from '@supabase/supabase-js'
import { walletToCacheRow } from '../../src/lib/aegisClient.js'

export function svcClient() {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !svcKey) return null
  return createClient(supaUrl, svcKey, { auth: { persistSession: false } })
}

export function authEnv() {
  return {
    supaUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    svcKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

// Записать кэш кошелька (+ опц. aegis_wallet_id) на счёт по id. Возвращает error|null.
export async function applyWalletCache(db, accountId, wallet, { setWalletId = false } = {}) {
  const row = walletToCacheRow(wallet)
  if (setWalletId && wallet?.id) row.aegis_wallet_id = wallet.id
  if (Object.keys(row).length === 0) return null
  const { error } = await db.from('accounts').update(row).eq('id', accountId)
  return error || null
}

// Записать кэш деталей кошелька (tx/stats/reasons) в wallet_aegis_cache (upsert).
// Всё опционально: пишем только пришедшие секции (не затираем валидное null-ом при
// таймауте AEGIS). cached_at обновляем всегда. Возвращает error|null.
export async function applyDetailCache(db, accountId, walletId, { transactions, stats, reasons } = {}) {
  const row = { account_id: accountId, wallet_id: walletId || null, cached_at: new Date().toISOString() };
  if (transactions && transactions.available) {
    row.tx_items = transactions.items || [];
    row.tx_cursor = transactions.cursor || null;
    row.tx_has_more = !!transactions.hasMore;
  }
  if (stats && stats.available) row.stats = stats;
  if (Array.isArray(reasons)) row.risk_reasons = reasons;
  const { error } = await db.from('wallet_aegis_cache').upsert(row, { onConflict: 'account_id' });
  return error || null;
}

// Найти счёт по aegis_wallet_id (для вебхука/поллинга). Может быть несколько
// (мнемоник = один wallet_id на 2 счёта) — вернём все.
export async function accountsByWalletId(db, walletId) {
  const { data, error } = await db
    .from('accounts')
    .select('id, name, currency_code, risk_level')
    .eq('aegis_wallet_id', walletId)
  if (error) throw error
  return data || []
}

// ── Алерты движений по кошельку (поступило/ушло) в менеджер-бот ──
const MOVE_CAT_LABEL = { exchange: 'биржа', cex: 'биржа', p2p: 'P2P', p2p_merchant: 'P2P', mixer: 'микшер', gambling: 'гэмблинг', darknet: 'даркнет', scam: 'скам', sanctioned: 'санкции', personal: 'приватный', private: 'приватный', internal: 'свой', bridge: 'мост', contract: 'контракт' }
// Ссылка на транзакцию в блок-эксплорере по сети — «проверить, что перевод реально прошёл».
const EXPLORER_TX = {
  TRC20: { name: 'Tronscan', url: (h) => `https://tronscan.org/#/transaction/${h}` },
  ERC20: { name: 'Etherscan', url: (h) => `https://etherscan.io/tx/${h}` },
  BEP20: { name: 'BscScan', url: (h) => `https://bscscan.com/tx/${h}` },
  BTC: { name: 'Blockstream', url: (h) => `https://blockstream.info/tx/${h}` },
}
function escapeHtmlA(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Кэш риска адрес→{score,level,hop2} TTL ~10 мин (in-memory, тёплая лямбда). Дёшево,
// можно на каждое уведомление. Сеть/таймаут → молча null (не показываем/не падаем).
const RISK_TTL_MS = 10 * 60 * 1000
const _riskCache = new Map()
export async function cachedRiskScore(aegisClient, network, address) {
  if (!address || !aegisClient?.configured?.()) return null
  const key = `${network}:${address}`
  const hit = _riskCache.get(key)
  if (hit && Date.now() - hit.at < RISK_TTL_MS) return hit.risk
  try {
    const [r] = await aegisClient.screenRisk({ network, addresses: [address] })
    const risk = r ? { score: r.score, level: r.level, hop2: r.hop2 } : null
    _riskCache.set(key, { risk, at: Date.now() })
    return risk
  } catch {
    return null
  }
}

// Одна нормализованная транзакция → payload алерта {kind, text(HTML), meta}.
export function formatMoveAlert(account, tx) {
  const inbound = tx.direction === 'in'
  const amt = tx.amount ? Number(tx.amount.amount) / 10 ** (tx.amount.decimals ?? 6) : null
  const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const cp = tx.counterparty || null
  const category = tx.counterpartyEntity?.category || (tx.counterpartyType && tx.counterpartyType !== 'unknown' ? tx.counterpartyType : null)
  const sanctioned = tx.counterpartyEntity?.sanctioned === true
  const label = tx.counterpartyEntity?.name || (category ? MOVE_CAT_LABEL[category] || category : '')
  // Риск-% контрагента (счёт кладёт вызывающий: webhook — из event.counterparty_risk;
  // tx-watch — из /v1/risk). Только для ВНЕШНИХ контрагентов (own → risk не проставляют).
  const risk = tx.counterpartyRisk
  let riskStr = ''
  if (risk && risk.score != null) {
    const emoji = risk.level === 'critical' ? '🔴' : risk.level === 'warning' ? '🟡' : '🟢'
    riskStr = ` · ${emoji} риск ${risk.score}%${risk.hop2 ? ' (в 1 шаге от санкций/ЧС)' : ''}`
  }
  let cpLine = ''
  if (cp) {
    const short = cp.length > 18 ? `${cp.slice(0, 10)}…${cp.slice(-6)}` : cp
    cpLine = `\n${inbound ? '← от' : '→ на'} <code>${escapeHtmlA(short)}</code>${label ? ` · ${escapeHtmlA(label)}` : ''}${riskStr}${sanctioned ? ' ⚠️ санкции' : ''}`
  }
  // Ссылка на транзакцию в эксплорере — открыть и убедиться, что перевод прошёл.
  const exp = EXPLORER_TX[account.network_id]
  const txLink = tx.txHash && exp ? `\n🔗 <a href="${exp.url(tx.txHash)}">Проверить на ${exp.name}</a>` : ''
  // 🔎 деталь риска контрагента (наша страница, читает /v1/risk/{net}/{addr}). Только при PUBLIC_APP_URL.
  const appUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
  const riskLink = cp && appUrl ? `\n🔎 <a href="${appUrl}/api/risk/detail?net=${encodeURIComponent(account.network_id || '')}&addr=${encodeURIComponent(cp)}">риск-раскладка</a>` : ''
  const text =
    `${inbound ? '💰' : '📤'} <b>${escapeHtmlA(account.name || account.aegis_wallet_id || 'кошелёк')}</b>${account.network_id ? ` · ${escapeHtmlA(account.network_id)}` : ''}\n` +
    `${inbound ? 'Поступило +' : 'Списано −'}${money(amt)}` + cpLine + txLink + riskLink
  return { kind: 'wallet_move', text, meta: { account_id: account.id, name: account.name, direction: inbound ? 'in' : 'out', amount: amt, counterparty: cp, counterparty_category: category, counterparty_sanctioned: sanctioned, counterparty_risk_score: risk?.score ?? null, counterparty_risk_level: risk?.level ?? null, counterparty_hop2: risk?.hop2 === true, tx_hash: tx.txHash || null, explorer_url: tx.txHash && exp ? exp.url(tx.txHash) : null, ts: tx.ts || null } }
}

// HOP2_RISK-находка → payload EDD-алерта {kind, text(HTML), meta}. Смысл: наш
// контрагент (via) в 1 шаге от грязного адреса → «проверь контрагента (EDD)».
// Это НЕ значит что офис коснулся санкций.
export function formatRiskFinding(alert, officeName, viaName) {
  const short = (a) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || '')
  const via = alert.viaCounterparty
    ? `${viaName ? `${escapeHtmlA(viaName)} · ` : ''}<code>${escapeHtmlA(short(alert.viaCounterparty))}</code>`
    : '—'
  const office = officeName ? escapeHtmlA(officeName) : alert.officeLabel ? escapeHtmlA(alert.officeLabel) : '—'
  const text =
    `⚠️ <b>EDD: проверьте контрагента</b>\n` +
    `Контрагент ${via} связан с <b>${escapeHtmlA(alert.category || 'риском')}</b> (в 1 шаге).\n` +
    `Офис: ${office}\n` +
    `Грязный адрес: <code>${escapeHtmlA(short(alert.riskAddress))}</code>\n` +
    `Рекомендуется усиленная проверка (EDD).`
  return {
    kind: 'risk_finding',
    text,
    meta: { alert_id: alert.alertId, category: alert.category, office: officeName || alert.officeLabel || null, via_counterparty: alert.viaCounterparty, risk_address: alert.riskAddress },
  }
}

// Алерт в менеджерский бот (тот же путь, что rapira/sync): coinpoint-мост
// (x-cashdesk-secret) с fallback на прямой Telegram. Возвращает bool «доставлено».
export async function notifyManagerBot({ kind, text, meta = {} }) {
  const base = process.env.COINPOINT_API_URL
  const secret = process.env.CASHDESK_API_SECRET
  if (base && secret) {
    try {
      const r = await fetch(`${base}/api/internal/cashdesk/alert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cashdesk-secret': secret },
        body: JSON.stringify({ kind, text, ...meta }),
      })
      if (r.ok) return true
    } catch {
      /* падаем на fallback */
    }
  }
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID
  if (!token || !chat) return false
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    return r.ok
  } catch {
    return false
  }
}
