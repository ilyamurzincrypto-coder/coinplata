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
function escapeHtmlA(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
  let cpLine = ''
  if (cp) {
    const short = cp.length > 18 ? `${cp.slice(0, 10)}…${cp.slice(-6)}` : cp
    cpLine = `\n${inbound ? '← от' : '→ на'} <code>${escapeHtmlA(short)}</code>${label ? ` · ${escapeHtmlA(label)}` : ''}${sanctioned ? ' ⚠️ санкции' : ''}`
  }
  const text =
    `${inbound ? '💰' : '📤'} <b>${escapeHtmlA(account.name || account.aegis_wallet_id || 'кошелёк')}</b>${account.network_id ? ` · ${escapeHtmlA(account.network_id)}` : ''}\n` +
    `${inbound ? 'Поступило +' : 'Списано −'}${money(amt)}` + cpLine
  return { kind: 'wallet_move', text, meta: { account_id: account.id, name: account.name, direction: inbound ? 'in' : 'out', amount: amt, counterparty: cp, counterparty_category: category, counterparty_sanctioned: sanctioned, tx_hash: tx.txHash || null, ts: tx.ts || null } }
}

// Алерты по НОВЫМ транзакциям кошелька (ts новее account.last_alert_tx_ts).
// Первый раз (метка null) — ставим baseline без алертов (не спамим историей).
// Обновляет last_alert_tx_ts. Возвращает число отправленных.
export async function alertNewTransactions(db, account, items) {
  const list = (items || []).filter((t) => t && t.ts)
  if (!list.length) return 0
  const baseline = account.last_alert_tx_ts ? new Date(account.last_alert_tx_ts).getTime() : null
  const newestTs = list.reduce((m, t) => (new Date(t.ts).getTime() > m ? new Date(t.ts).getTime() : m), 0)
  if (baseline == null) {
    await db.from('accounts').update({ last_alert_tx_ts: new Date(newestTs).toISOString() }).eq('id', account.id)
    return 0
  }
  const fresh = list
    .filter((t) => new Date(t.ts).getTime() > baseline)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()) // хронологически
    .slice(-10) // не заваливаем при пропущенном пуле
  if (!fresh.length) return 0
  for (const t of fresh) {
    try { await notifyManagerBot(formatMoveAlert(account, t)) } catch { /* не валим пул */ }
  }
  await db.from('accounts').update({ last_alert_tx_ts: new Date(newestTs).toISOString() }).eq('id', account.id)
  return fresh.length
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
