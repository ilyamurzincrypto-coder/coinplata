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
  // Строго по level (🟢 ok / 🟡 warning / 🔴 critical); фолбэк по score, если level нет.
  if (level === 'critical') return '🔴'
  if (level === 'warning') return '🟡'
  if (level === 'ok') return '🟢'
  if (Number(score) >= 80) return '🔴'
  if (Number(score) >= 25) return '🟡'
  return '🟢'
}
// Блок риска ВНЕШНЕГО контрагента (parse_mode=HTML). score>0/санкции → expandable-цитата
// «{emoji по level} Риск контрагента: N%» + breakdown-факторы AEGIS (baseline даёт ≥5 →
// цитата всегда «высокая» → Telegram сворачивает). Нет оценки (assessed=false) → «❔ не проверен».
// Baseline 10% приходит level=ok → 🟢 «риск 10%», фактор объяснит («контрагент не верифицирован»).
// AML-категории (аудитории) для раскрытой цитаты. Матч фактора breakdown → категория:
// сперва по стабильному b.category от AEGIS, затем фолбэк по kind/ключевым словам метки.
const AML_CATS = [
  ['sanctions', 'Санкции', /санкц|ofac|sanction/i, 'Санкции'],
  ['blacklist', 'Чёрный список', /чёрн|черн|blacklist|блэклист/i, 'Чёрный список'],
  ['mixer', 'Миксер', /миксер|mixer|тумблер|tumbler/i, 'Миксер'],
  ['darknet', 'Даркнет', /даркнет|darknet|наркоплатформ|market/i, 'Даркнет'],
  ['gambling', 'Гемблинг', /гемблинг|gambling|казино|casino|ставк|\bbet/i, 'Гемблинг'],
  ['scam', 'Скам/фрод', /скам|scam|фрод|fraud|phish|фишинг|обман/i, 'Скам'],
  ['proximity', 'Близость к санкц/ЧС', /1 шаг|проксимит|близост|proximity/i, 'Близость'],
]
function matchCat(b) {
  const c = (b?.category || '').toLowerCase()
  if (c && AML_CATS.some(([k]) => k === c)) return c
  if (b?.kind === 'proximity') return 'proximity'
  const lbl = b?.label || ''
  for (const [key, , re] of AML_CATS) if (re.test(lbl)) return key
  return null // не категория из списка → отдельной строкой (напр. верификация/сущность)
}
// Блок риска (наш кошелёк ИЛИ контрагент): score>0/санкции → expandable-цитата (заголовок=скор,
// тело=риск по ВСЕМ AML-категориям + доп-факторы AEGIS). assessed=false → «❔ не проверен».
// title — «Риск кошелька» / «Риск контрагента». parse_mode=HTML.
function riskBlock(risk, sanctioned, title = 'Риск контрагента') {
  const score = risk?.score ?? null
  const hasScore = score != null && score > 0
  if (!(hasScore || sanctioned)) return `❔ ${title}: не проверен`
  const bd = Array.isArray(risk?.breakdown) ? risk.breakdown : []
  const emoji = sanctioned ? '🔴' : riskEmoji(risk?.level, score)
  const head = `${emoji} ${title}: ${hasScore ? `${score}%` : 'санкции'}`
  const byCat = {}
  const extras = []
  for (const b of bd) {
    const cat = matchCat(b)
    const pct = b.pct != null ? Number(b.pct) : null
    if (cat) { if (byCat[cat] == null || (pct != null && pct > byCat[cat])) byCat[cat] = pct != null ? pct : (byCat[cat] ?? 0) }
    else extras.push(`• ${escapeHtmlA(b.label || 'фактор')}${pct != null && pct > 0 ? ` — ${pct}%` : ''}`)
  }
  // Сработавшие категории → «• Name — pct%»; без вклада → компактная строка галочек
  // «✓ Санкции · ✓ Чёрный список · …» (БЕЗ «— 0%»). verification/прочее — в extras отдельно.
  const active = []
  const clean = []
  for (const [key, name, , short] of AML_CATS) {
    const pct = byCat[key] != null ? byCat[key] : key === 'sanctions' && sanctioned ? 100 : 0
    if (pct > 0) active.push(`• ${name} — ${pct}%`)
    else clean.push(`✓ ${short}`)
  }
  // Скор без единого фактора (AEGIS прислал score, но пустой breakdown) — не оставляем
  // «N% и всё ✓» без объяснения: добавляем строку базовой оценки.
  if (hasScore && !active.length && !extras.length) extras.push(`• базовая оценка — ${score}%`)
  const bodyLines = [...active]
  if (clean.length) bodyLines.push(clean.join(' · '))
  bodyLines.push(...extras)
  return `<blockquote expandable>${[head, ...bodyLines].join('\n')}</blockquote>`
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
  // Риск НАШЕГО кошелька — чек-лист-цитата, ТОЛЬКО если /v1/risk вернул реальные данные
  // (score>0 или assessed). Пусто (score 0/assessed=false) → НЕ «не проверен» на своём
  // мониторимом кошельке, а фолбэк на инлайн-скор из кэша accounts.risk_*.
  const rawOwn = tx.ownRisk
  const ownRisk = rawOwn && (Number(rawOwn.score) > 0 || rawOwn.assessed === true) ? rawOwn : null
  const lines = [
    `${inbound ? '💰' : '📤'} <b>${inbound ? 'Поступление' : 'Списание'} ${inbound ? '+' : '−'}${money(amt)}</b>`,
    `🏦 Наш кошелёк: <b>${walletName}</b>${account.network_id ? ` · ${escapeHtmlA(account.network_id)}` : ''}${ownRisk ? '' : ownRiskStr}`,
  ]
  if (ownRisk) lines.push(riskBlock(ownRisk, false, 'Риск кошелька'))
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
      lines.push(riskBlock(risk, sanctioned, 'Риск контрагента'))
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
