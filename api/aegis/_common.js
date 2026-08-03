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
// Эмодзи риска по level/score (один порог на весь алерт: свой кошелёк + контрагент).
function riskEmoji(level, score) {
  if (level === 'critical' || Number(score) >= 80) return '🔴'
  if (level === 'warning' || Number(score) >= 25) return '🟡'
  return '🟢'
}
// Блок риска ВНЕШНЕГО контрагента — ВСЕГДА одно из трёх (никогда не пусто). Требует parse_mode=HTML.
//  1) score>0/санкции → expandable-цитата: свёрнуто скор, развёрнуто факторы по %;
//  2) assessed && score=0 → expandable-цитата «чисто»; 3) нет данных → обычная строка «не проверен».
// Фактор breakdown → измерение чек-листа (по kind, затем по ключевым словам метки).
function classifyFactor(b) {
  const lbl = (b?.label || '').toLowerCase()
  if (b?.kind === 'proximity' || /1 шаг|проксимит|близост/.test(lbl)) return 'proximity'
  if (/чёрн|черн|blacklist/.test(lbl)) return 'blacklist'
  if (b?.kind === 'behavioral' || /поведени|гемблинг|gambling|mixer|микшер|казино|darknet|даркнет/.test(lbl)) return 'behavioral'
  if (/санкц|ofac|sanction/.test(lbl)) return 'sanctions'
  return 'other'
}
const RISK_DIMS = [['sanctions', 'Санкции'], ['blacklist', 'Чёрный список'], ['behavioral', 'Поведение'], ['proximity', 'Близость к санкц/ЧС']]
function cpRiskBlock(risk, sanctioned) {
  const score = risk?.score ?? null
  const hasScore = score != null && score > 0
  // score>0/санкции = адрес ОЦЕНЁН → непокрытые измерения «чисто» (а не «нет данных»).
  const assessed = (risk && risk.assessed === true) || sanctioned || hasScore
  // Нет данных → короткая спокойная цитата «оценивается» (без чек-листа «нет данных» ×4 = шум).
  if (!assessed) {
    return '<blockquote expandable>⏳ Риск контрагента: оценивается\n• адрес пока не классифицирован — данные появятся позже</blockquote>'
  }
  const bd = Array.isArray(risk?.breakdown) ? risk.breakdown : []
  // Заголовок (свёрнутый вид): скор / санкции / чисто.
  const head = hasScore || sanctioned
    ? `${riskEmoji(risk?.level, score != null ? score : 100)} Риск контрагента: ${hasScore ? `${score}%` : 'санкции'}`
    : '🟢 Риск контрагента: 0%'
  // Статусы измерений из breakdown (макс. pct на измерение) + прочие факторы отдельными строками.
  const byDim = {}
  const extras = []
  for (const b of bd) {
    const dim = classifyFactor(b)
    if (dim === 'other') { extras.push(`• ${escapeHtmlA(b.label || 'фактор')}${b.pct != null ? ` — ${b.pct}%` : ''}`); continue }
    const pct = b.pct != null ? Number(b.pct) : null
    if (byDim[dim] == null || (pct != null && pct > byDim[dim])) byDim[dim] = pct != null ? pct : byDim[dim] ?? 0
  }
  const dimLine = ([key, name]) => {
    if (byDim[key] != null) return `• ${name} — ${byDim[key]}%`
    if (key === 'sanctions' && sanctioned) return `• ${name} — есть`
    return `• ${name} — ${assessed ? 'чисто' : 'нет данных'}`
  }
  const lines = [head, ...RISK_DIMS.map(dimLine), ...extras]
  return `<blockquote expandable>${lines.join('\n')}</blockquote>`
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
    const risk = r ? { score: r.score, level: r.level, hop2: r.hop2, assessed: r.assessed === true, behavioralType: r.behavioralType ?? null, breakdown: Array.isArray(r.breakdown) ? r.breakdown : [] } : null
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
  // Риск контрагента — рендерим ВСЕГДА для ВНЕШНЕГО (отдельным блоком, см. cpRiskBlock).
  const risk = tx.counterpartyRisk
  // «Грязнота» НАШЕГО кошелька — показываем каждый раз (из кэша accounts.risk_*, без запроса).
  // Читаем оба нейминга: tx-watch шлёт сырую строку (risk_score), webhook — объект (riskScore).
  const ownScore = account.riskScore ?? account.risk_score ?? null
  const ownLevel = account.riskLevel ?? account.risk_level ?? null
  const ownRiskStr = ownScore != null ? ` · ${riskEmoji(ownLevel, ownScore)} риск ${ownScore}%` : ''
  // Эксплорер + 🔎 деталь риска контрагента — в футер.
  const exp = EXPLORER_TX[account.network_id]
  const txLink = tx.txHash && exp ? `🔗 <a href="${exp.url(tx.txHash)}">Проверить перевод</a>` : ''
  const appUrl = (process.env.PUBLIC_APP_URL || 'https://coinplata.vercel.app').replace(/\/$/, '')
  const riskLink = cp && appUrl && !tx.counterpartyOwn ? `🔎 <a href="${appUrl}/api/risk/detail?net=${encodeURIComponent(account.network_id || '')}&addr=${encodeURIComponent(cp)}">Риск контрагента</a>` : ''

  // Вёрстка: заголовок (сумма) · наш кошелёк+его риск · контрагент+его риск+адрес · футер.
  const walletName = escapeHtmlA(account.name || account.aegis_wallet_id || 'кошелёк')
  const lines = [
    `${inbound ? '💰' : '📤'} <b>${inbound ? 'Поступление' : 'Списание'} ${inbound ? '+' : '−'}${money(amt)}</b>`,
    `🏦 Наш кошелёк: <b>${walletName}</b>${account.network_id ? ` · ${escapeHtmlA(account.network_id)}` : ''}${ownRiskStr}`,
  ]
  if (cp) {
    if (tx.counterpartyOwn) {
      // Внутренний перевод (контрагент — НАШ кошелёк, по accounts): имя, риск НЕ показываем.
      const ownName = tx.counterpartyName || label || 'свой кошелёк'
      lines.push(`👤 Контрагент · ${escapeHtmlA(ownName)} (свой)`)
      // Полный адрес в <code> — Telegram копирует ТЕКСТ (усечение с «…» ломало копи).
      lines.push(`<code>${escapeHtmlA(cp)}</code>`)
    } else {
      // Внешний: идентификация + адрес + блок риска (ВСЕГДА, три состояния).
      lines.push(`👤 Контрагент${label ? ` · ${escapeHtmlA(label)}` : ''}`)
      lines.push(`<code>${escapeHtmlA(cp)}</code>`)
      lines.push(cpRiskBlock(risk, sanctioned))
    }
  }
  const footer = [txLink, riskLink].filter(Boolean).join(' · ')
  if (footer) lines.push('', footer)
  const text = lines.join('\n')
  return { kind: 'wallet_move', text, meta: { account_id: account.id, name: account.name, direction: inbound ? 'in' : 'out', amount: amt, counterparty: cp, counterparty_category: category, counterparty_sanctioned: sanctioned, counterparty_risk_score: risk?.score ?? null, counterparty_risk_level: risk?.level ?? null, counterparty_hop2: risk?.hop2 === true, tx_hash: tx.txHash || null, explorer_url: tx.txHash && exp ? exp.url(tx.txHash) : null, ts: tx.ts || null } }
}

// HOP2_RISK-находка → payload EDD-алерта {kind, text(HTML), meta}. Смысл: наш
// контрагент (via) в 1 шаге от грязного адреса → «проверь контрагента (EDD)».
// Это НЕ значит что офис коснулся санкций.
export function formatRiskFinding(alert, officeName, viaName) {
  // Полные адреса в <code> — тап-копирование Telegram копирует текст, усечение ломало копи.
  const via = alert.viaCounterparty
    ? `${viaName ? `${escapeHtmlA(viaName)} · ` : ''}<code>${escapeHtmlA(alert.viaCounterparty)}</code>`
    : '—'
  const office = officeName ? escapeHtmlA(officeName) : alert.officeLabel ? escapeHtmlA(alert.officeLabel) : '—'
  const text =
    `⚠️ <b>EDD: проверьте контрагента</b>\n` +
    `Контрагент ${via} связан с <b>${escapeHtmlA(alert.category || 'риском')}</b> (в 1 шаге).\n` +
    `Офис: ${office}\n` +
    `Грязный адрес: <code>${escapeHtmlA(alert.riskAddress || '')}</code>\n` +
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
