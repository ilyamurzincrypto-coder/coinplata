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
// Ссылка на АДРЕС в эксплорере (для адреса-пруфа грязного узла в причинах вердикта).
const EXPLORER_ADDR = {
  TRC20: (a) => `https://tronscan.org/#/address/${a}`,
  ERC20: (a) => `https://etherscan.io/address/${a}`,
  BEP20: (a) => `https://bscscan.com/address/${a}`,
  BTC: (a) => `https://blockstream.info/address/${a}`,
}
// Короткий адрес для показа: TXxx…yyyy
const shortAddr = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '')
// Валидация адреса (allowlist): только буквы/цифры 10..80 — иначе НЕ строим ссылку (защита от XSS через href).
const isPlainAddr = (a) => typeof a === 'string' && /^[A-Za-z0-9]{10,80}$/.test(a)
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
// Метка категории для checked_clean (ключ → рус-название). Берём из AML_CATS/MOVE_CAT_LABEL.
const CAT_LABEL = Object.fromEntries(AML_CATS.map(([k, name]) => [k, name]))
const cleanLabel = (c) => CAT_LABEL[String(c).toLowerCase()] || MOVE_CAT_LABEL[String(c).toLowerCase()] || String(c)

// Рендер ГОТОВОГО вердикта AEGIS (как BitOK/AMLBot): шапка (emoji/уровень/скор) +
// action → «Почему:» reasons → «Источник средств:» sources (bar+pct) → clean_note.
// Для НАШЕГО кошелька (isOwn) — только шапка + clean_note (action/reasons/источник =
// решение по КОНТРАГЕНТУ, к своему кошельку не применимо).
function renderVerdict(v, title, isOwn, riskByCategory, network) {
  const score = v.score != null ? `${v.score}/100` : '—'
  const emoji = v.emoji || riskEmoji(null, v.score)
  const prelim = v.preliminary ? ' (предв.)' : '' // экспозиция ещё трассируется — не «ложный зелёный»
  const lines = [`${emoji} <b>${escapeHtmlA(title)}:</b> ${escapeHtmlA(v.levelText || '')} — ${score}${prelim}`]
  if (!isOwn && v.action) lines.push(escapeHtmlA(v.action))
  const detail = []
  // action/reasons — решение и причины ПО КОНТРАГЕНТУ; к своему кошельку не применяются.
  // 🔴 ФОРМАТ ПРИБИТ (владелец 2026-08-19): плоское «Почему:» + причины с пояснением «└». Скор — только по
  // фактам (эвристики не надувают цифру, это на стороне AEGIS). НЕ менять структуру без явной просьбы.
  if (!isOwn && Array.isArray(v.reasons) && v.reasons.length) {
    detail.push('Почему:')
    v.reasons.forEach((r, i) => {
      const rt = typeof r === 'string' ? r : (r?.text || '')
      const rd = typeof r === 'object' ? (r?.detail || '') : ''
      const ra = typeof r === 'object' ? (r?.address || '') : ''
      const rtx = typeof r === 'object' ? (r?.tx || '') : ''
      if (i > 0) detail.push('') // пустая строка между причинами — не полотно текста
      detail.push(escapeHtmlA(rt))
      if (rd && rd !== rt) detail.push(`   └ ${escapeHtmlA(rd)}`)
      // Адрес/tx-пруф → кликабельные ссылки (allowlist + экранирование href).
      if (ra) {
        const mk = EXPLORER_ADDR[network]
        detail.push(mk && isPlainAddr(ra) ? `   └ адрес: <a href="${escapeHtmlA(mk(ra))}">${escapeHtmlA(shortAddr(ra))}</a>` : `   └ адрес: <code>${escapeHtmlA(ra)}</code>`)
      }
      if (rtx) {
        const tk = EXPLORER_TX[network]
        detail.push(tk && isPlainAddr(rtx) ? `   └ tx: <a href="${escapeHtmlA(tk.url(rtx))}">${escapeHtmlA(shortAddr(rtx))}</a>` : `   └ tx: <code>${escapeHtmlA(rtx)}</code>`)
      }
    })
  }
  // risk_by_category — ВСЕГДА 15 строк (0% честно), и для НАШЕГО кошелька, и для контрагента (владелец
  // хочет видеть % и по своему кошельку). Формат по контракту: заголовок «⚠️ Риск по категориям:»,
  // отступ 2 пробела на строку, 3 пробела перед «⬆️ уходит N%», pct/out_pct как есть.
  // dirt_flow — НАПРАВЛЕНИЕ грязи (приходит/уходит/оба), заголовок над таблицей категорий. Для обоих (own/контрагент):
  // владелец хочет видеть, куда/откуда течёт грязь и по своему кошельку тоже.
  if (v.dirtFlow && v.dirtFlow.label) {
    detail.push(escapeHtmlA(v.dirtFlow.label))
    const fmt = (arr) => (Array.isArray(arr) ? arr : []).map((x) => `${x.emoji || ''} ${x.label || ''} ${x.pct != null ? x.pct + '%' : ''}`.trim()).filter(Boolean).join(', ')
    const ti = fmt(v.dirtFlow.topIn)
    const to = fmt(v.dirtFlow.topOut)
    if (ti) detail.push(`   ⬇️ приходит: ${escapeHtmlA(ti)}`)
    if (to) detail.push(`   ⬆️ уходит: ${escapeHtmlA(to)}`)
  }
  // 🔴 ТАБЛИЦА ПРИБИТА (владелец 2026-08-19): ВСЕГДА все 15 категорий (0% честно) + пометка ✅/«нет фида» по
  // каждой + легенда. И для своего кошелька, и для контрагента. НЕ схлопывать, НЕ прятать без явной просьбы.
  const rbc = Array.isArray(riskByCategory) && riskByCategory.length ? riskByCategory : null
  if (rbc) {
    detail.push('⚠️ Риск по категориям:')
    // РОВНОСТЬ: моноширинный <code> на строку + добивка метки пробелами до общей ширины → бары и % в колонку.
    const wLabel = Math.max(...rbc.map((c) => (c.label || '').length))
    for (const c of rbc) {
      const hasPct = (Number(c.pct) || 0) > 0 || (c.outPct != null && Number(c.outPct) > 0)
      const out = c.outPct != null && Number(c.outPct) > 0 ? ` ⬆️ уходит ${c.outPct}%` : ''
      const pctStr = `${c.pct != null ? c.pct : 0}%`.padStart(4)
      const row = `${c.emoji || ''} ${(c.label || '').padEnd(wLabel)} ${c.bar || ''} ${pctStr}`
      // 0% + есть источник детекции → «✅» (проверено); 0% + нет источника по TRON → «нет фида». С % — сам % говорит.
      const mark = hasPct ? out : (c.covered ? ' ✅' : ' <i>нет фида</i>')
      detail.push(`<code>${escapeHtmlA(row)}</code>${mark}`)
    }
    detail.push('<i>✅ — проверяем (метка/поведение); «нет фида» — по TRON нет источника, не путать с «чисто»</i>')
  } else if (!isOwn && Array.isArray(v.sources) && v.sources.length) {
    // Фолбэк на sources-пирог (только контрагент), если таблицы категорий нет.
    detail.push('Источник средств:')
    for (const s of v.sources) {
      detail.push([s.emoji, escapeHtmlA(s.label || ''), escapeHtmlA(s.bar || ''), s.pct != null ? `${s.pct}%` : '']
        .filter(Boolean).join(' '))
    }
  }
  if (v.cleanNote) detail.push(escapeHtmlA(v.cleanNote))
  if (detail.length) lines.push(`<blockquote expandable>${detail.join('\n')}</blockquote>`)
  return lines.join('\n')
}

function riskBlock(risk, sanctioned, title = 'Риск контрагента', isOwn = false, network) {
  // Если AEGIS прислал готовый вердикт — рендерим ЕГО (клиентский вид), не чек-лист.
  if (risk?.verdict) return renderVerdict(risk.verdict, title, isOwn, risk.riskByCategory, network)
  const score = risk?.score ?? null
  const hasScore = score != null && score > 0
  const blacklisted = risk?.blacklisted === true
  // preliminary = exposure ещё не оценён → НЕ низкий score как «чисто».
  const preliminary = risk?.assessment === 'preliminary'
  const assessed = (risk && risk.assessed === true) || sanctioned || blacklisted || hasScore
  const bd = Array.isArray(risk?.breakdown) ? risk.breakdown : []
  const checkedClean = Array.isArray(risk?.checkedClean) ? risk.checkedClean : []
  // coverage.typed_pct < 60 → бейдж «оценено N%» (unknown ≠ чисто).
  const cov = risk?.coverage || null
  const typedPct = cov && Number.isFinite(Number(cov.typedPct)) ? Number(cov.typedPct) : null
  const covBadge = typedPct != null && typedPct < 60 ? ` · оценено ${Math.round(typedPct)}%` : ''

  // Заголовок. preliminary → «предв., уточняется» (даже при 0%). Санкции/скор — как раньше.
  let head
  if (preliminary && !hasScore && !sanctioned && !blacklisted) head = `🟡 ${title}: предв., уточняется${covBadge}`
  else if (hasScore || sanctioned || blacklisted) head = `${sanctioned || blacklisted ? '🔴' : riskEmoji(risk?.level, score)} ${title}: ${hasScore ? `${score}%` : sanctioned ? 'санкции' : 'чёрный список'}${preliminary ? ' (предв.)' : ''}${covBadge}`
  else if (assessed) head = `${riskEmoji(risk?.level, score)} ${title}: ${score ?? 0}%${covBadge}`
  else head = `❔ ${title}: нет данных`

  const byCat = {}
  const extras = []
  for (const b of bd) {
    const cat = matchCat(b)
    const pct = b.pct != null ? Number(b.pct) : null
    if (cat) { if (byCat[cat] == null || (pct != null && pct > byCat[cat])) byCat[cat] = pct != null ? pct : (byCat[cat] ?? 0) }
    else extras.push(`• ${escapeHtmlA(b.label || 'фактор')}${pct != null ? ` — ${pct}%` : ''}`)
  }

  // Тело категорий:
  //  - checked_clean присутствует → сработавшие категории по %, затем ОДНА строка
  //    «✅ Проверено: … — чисто» вместо стены «— 0%» (по контракту AEGIS);
  //  - иначе (сервер не прислал checked_clean) → прежний ПОЛНЫЙ список с 0% (back-compat).
  let catLines
  if (checkedClean.length) {
    const hit = AML_CATS.filter(([key]) => (byCat[key] ?? 0) > 0 || (key === 'sanctions' && sanctioned) || (key === 'blacklist' && blacklisted))
    catLines = hit.map(([key, name]) => `• ${name} — ${byCat[key] != null ? byCat[key] : 100}%`)
    catLines.push(`✅ Проверено: ${checkedClean.map((c) => escapeHtmlA(cleanLabel(c))).join(', ')} — чисто`)
  } else {
    catLines = AML_CATS.map(([key, name]) => {
      const pct = byCat[key] != null ? byCat[key] : (key === 'sanctions' && sanctioned) || (key === 'blacklist' && blacklisted) ? 100 : 0
      return `• ${name} — ${pct}%`
    })
  }

  // funds_flow.source с risk_pct>0 → «Происхождение: X% mixer/scam» (если прогрет).
  const srcDirty = (risk?.fundsFlow?.source || [])
    .filter((s) => Number(s.riskPct) > 0)
    .sort((a, b) => (Number(b.sharePct) || 0) - (Number(a.sharePct) || 0))
    .slice(0, 3)
    .map((s) => `⚠️ Происхождение: ${Math.round(Number(s.sharePct) || 0)}% ${escapeHtmlA(s.label || s.category || 'риск')}`)

  // Объясняющая строка. preliminary → явно «ещё считается». Иначе как раньше.
  if (!extras.length) {
    if (preliminary) extras.push('• экспозиция ещё считается — оценка предварительная')
    else if (hasScore && !checkedClean.length) extras.push(`• базовая оценка — ${score}%`)
    else if (!assessed && !checkedClean.length) extras.push('• адрес не проверен (нет данных в AEGIS)')
  }
  return `<blockquote expandable>${[head, ...catLines, ...srcDirty, ...extras].join('\n')}</blockquote>`
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
    const risk = r
      ? {
          score: r.score,
          level: r.level,
          hop2: r.hop2,
          assessed: r.assessed === true,
          assessment: r.assessment ?? null,
          blacklisted: r.blacklisted === true,
          categories: Array.isArray(r.categories) ? r.categories : [],
          behavioralType: r.behavioralType ?? null,
          nestedService: r.nestedService ?? null,
          checkedClean: Array.isArray(r.checkedClean) ? r.checkedClean : [],
          fundsFlow: r.fundsFlow ?? null,
          coverage: r.coverage ?? null,
          verdict: r.verdict ?? null,
          riskByCategory: Array.isArray(r.riskByCategory) ? r.riskByCategory : [],
          breakdown: Array.isArray(r.breakdown) ? r.breakdown : [],
        }
      : null
    // 🔴 НЕ кэшируем null/пустой результат: под burst-нагрузкой один пустой ответ залипал на 10 мин →
    // «нет данных» даже когда данные уже есть. Кэшируем ТОЛЬКО успешный риск; пусто → следующий поллинг ретраит.
    if (risk) _riskCache.set(key, { risk, at: Date.now() })
    return risk
  } catch {
    return null // сетевая ошибка/таймаут — тоже НЕ кэшируем (ретрай на след. поллинге)
  }
}

// Одна нормализованная транзакция → payload алерта {kind, text(HTML), meta}.
export function formatMoveAlert(account, tx) {
  const inbound = tx.direction === 'in'
  const amt = tx.amount ? Number(tx.amount.amount) / 10 ** (tx.amount.decimals ?? 6) : null
  const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const cp = tx.counterparty || null
  // Поведенческий ТИП контрагента (что это за адрес по on-chain-паттерну) — показываем в шапке, когда нет
  // имени/метки. Так «👤 Контрагент» не голый: «биржа/P2P/мерчант/транзит по поведению».
  const BEHAVIORAL_TYPE_LABEL = {
    PERSONAL: 'приватный · по поведению', MERCHANT: 'мерчант · по поведению', P2P_SERVICE: 'P2P-сервис · по поведению',
    EXCHANGE: 'биржа · по поведению', SERVICE: 'сервис · по поведению', CONTRACT: 'контракт',
    GAMBLING: 'гэмблинг · по поведению', MIXER: 'микшер · по поведению', DARKNET: 'даркнет · по поведению', SCAM: 'скам · по поведению',
  }
  const behType = tx.counterpartyRisk?.behavioralType
  const behLabel = behType && behType !== 'UNKNOWN' ? (BEHAVIORAL_TYPE_LABEL[behType] || null) : null
  const category = tx.counterpartyEntity?.category || (tx.counterpartyType && tx.counterpartyType !== 'unknown' ? tx.counterpartyType : null)
  const sanctioned = tx.counterpartyEntity?.sanctioned === true
  const label = tx.counterpartyEntity?.name || (category ? MOVE_CAT_LABEL[category] || category : '') || behLabel || ''
  // Риск-% контрагента (счёт кладёт вызывающий: webhook — из event.counterparty_risk;
  // tx-watch — из /v1/risk). Только для ВНЕШНИХ контрагентов (own → risk не проставляют).
  // Риск контрагента — рендерим ВСЕГДА для ВНЕШНЕГО (отдельным блоком, см. cpRiskBlock).
  const risk = tx.counterpartyRisk
  // «Грязнота» НАШЕГО кошелька — показываем каждый раз (из кэша accounts.risk_*, без запроса).
  // Читаем оба нейминга: tx-watch шлёт сырую строку (risk_score), webhook — объект (riskScore).
  const ownScore = account.riskScore ?? account.risk_score ?? null
  const ownLevel = account.riskLevel ?? account.risk_level ?? null
  // Эксплорер + 🔎 деталь риска контрагента — в футер.
  const exp = EXPLORER_TX[account.network_id]
  const txLink = tx.txHash && exp ? `🔗 <a href="${exp.url(tx.txHash)}">Проверить перевод</a>` : ''
  const appUrl = (process.env.PUBLIC_APP_URL || 'https://coinplata.vercel.app').replace(/\/$/, '')
  const riskLink = cp && appUrl && !tx.counterpartyOwn ? `🔎 <a href="${appUrl}/api/risk/detail?net=${encodeURIComponent(account.network_id || '')}&addr=${encodeURIComponent(cp)}">Риск контрагента</a>` : ''

  // Вёрстка: заголовок (сумма) · наш кошелёк+его риск · контрагент+его риск+адрес · футер.
  const walletName = escapeHtmlA(account.name || account.aegis_wallet_id || 'кошелёк')
  // Риск НАШЕГО кошелька — ВСЕГДА чек-лист: данные /v1/risk (tx.ownRisk), иначе синтез из
  // кэша accounts.risk_* (чтобы на мониторимом кошельке не пропадал чек-лист на EVM без данных).
  const rawOwn = tx.ownRisk
  let ownRisk = rawOwn && (rawOwn.verdict || Number(rawOwn.score) > 0 || rawOwn.assessed === true) ? rawOwn : null
  if (!ownRisk && ownScore != null) ownRisk = { score: ownScore, level: ownLevel, breakdown: [] }
  const lines = [
    `${inbound ? '💰' : '📤'} <b>${inbound ? 'Поступление' : 'Списание'} ${inbound ? '+' : '−'}${money(amt)}</b>`,
    `🏦 Наш кошелёк: <b>${walletName}</b>${account.network_id ? ` · ${escapeHtmlA(account.network_id)}` : ''}`,
  ]
  // ВСЕГДА рисуем блок нашего кошелька (симметрично контрагенту): ownRisk=null →
  // riskBlock даёт «❔ нет данных» + полный чек-лист. Иначе анализ пропадал на
  // EVM/пустом /v1/risk без кэша (регресс «куда делся анализ нашего кошелька»).
  lines.push(riskBlock(ownRisk, false, 'Риск кошелька', true, account.network_id))
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
      // Если есть готовый вердикт — он самодостаточен (action/reasons покрывают
      // отказ и вложенный сервис); отдельные ⛔/EDD-строки не дублируем.
      if (!risk?.verdict) {
        // Правило 1: прямая санкц/ЧС-метка или critical → ⛔ ОТКАЗ (видимой строкой, не в цитате).
        const cats = (risk?.categories || []).map((c) => String(c).toLowerCase())
        const refuse = sanctioned || risk?.blacklisted === true || cats.includes('blacklist') || cats.includes('sanctions') || risk?.level === 'critical'
        if (refuse) {
          const why = sanctioned ? 'санкции' : risk?.blacklisted === true || cats.includes('blacklist') ? 'чёрный список' : cats.includes('sanctions') ? 'санкции' : 'критический риск'
          lines.push(`⛔ <b>ОТКАЗ</b> — ${why}`)
        }
        // Правило 2: вложенный сервис (незарег. OTC/сервис за адресом) → строка + авто-EDD.
        const ns = risk?.nestedService
        if (ns && (ns.name || ns.license || ns.source)) {
          lines.push(`🏦 <b>Вложенный сервис:</b> ${escapeHtmlA(ns.name || '—')}${ns.license ? ` · лиц.: ${escapeHtmlA(ns.license)}` : ' · лиц.: нет'}`)
          lines.push(`❓ EDD: кто это · есть ли лицензия · источник средств${ns.source ? ` (заявлено: ${escapeHtmlA(ns.source)})` : ''}`)
        }
      }
      lines.push(riskBlock(risk, sanctioned, 'Риск контрагента', false, account.network_id))
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

// RISK_UPGRADE-находка (/v1/alerts) → payload коррекции. Смысл: exposure адреса
// прогрелся, оценка поднялась (напр. предв./10% → 46% warning). Не деньги — уточнение.
export function formatRiskUpgrade(alert, viaName) {
  const prev = alert.prevScore
  const prevStr = prev == null ? 'предв.' : `${prev}%`
  const nowStr = alert.newScore != null ? `${alert.newScore}%` : '—'
  const lvl = alert.level ? ` (${escapeHtmlA(alert.level)})` : ''
  const who = alert.address ? `<code>${escapeHtmlA(alert.address)}</code>` : alert.riskAddress ? `<code>${escapeHtmlA(alert.riskAddress)}</code>` : '—'
  const via = viaName ? `${escapeHtmlA(viaName)} · ` : ''
  const text =
    `⚠️ <b>Уточнение риска</b>: ${prevStr} → <b>${nowStr}</b>${lvl}\n` +
    `Адрес: ${via}${who}\n` +
    (alert.category ? `Причина: <b>${escapeHtmlA(alert.category)}</b>\n` : '') +
    `Оценка поднята после прогрева exposure — пересмотрите контрагента (EDD).`
  return {
    kind: 'risk_upgrade',
    text,
    meta: { alert_id: alert.alertId, address: alert.address || alert.riskAddress || null, prev_score: prev ?? null, new_score: alert.newScore ?? null, level: alert.level || null, category: alert.category || null },
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
