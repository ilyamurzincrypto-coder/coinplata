/**
 * Страница риск-раскладки контрагента (открывается из 🔎 в уведомлении менеджера).
 * Server-rendered: читает GET /v1/risk/{net}/{addr} тем же AEGIS_API_KEY. Деньги не трогаем.
 * Рендерит ПОЛНУЮ AML-композицию (уведомление в чате остаётся компактным — его не меняем).
 * Сеть/таймаут — мягкое сообщение, не падаем.
 */
import { aegis } from '../../src/lib/aegisClient.js'

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function levelColor(level, score) {
  const s = Number(score)
  if (level === 'critical' || s >= 80) return '#dc2626'
  if (level === 'warning' || s >= 25) return '#d97706'
  return '#16a34a'
}
const levelWord = (level) => (level === 'critical' ? 'Высокий' : level === 'warning' ? 'Средний' : 'Низкий')
// Иконка связи по категории: риск-категории 🔴, нейтральные 🟢, неизвестное ⚪.
const RISK_CATS = ['gambling', 'mixer', 'darknet', 'sanctions', 'scam', 'blacklist', 'proximity']
const NEUTRAL_CATS = ['exchange', 'bridge', 'defi', 'merchant', 'personal', 'service', 'contract', 'p2p']
function catIcon(b) {
  const c = String(b.category || '').toLowerCase()
  if (RISK_CATS.includes(c)) return '🔴'
  if (NEUTRAL_CATS.includes(c)) return '🟢'
  return '⚪'
}
function page(title, bodyHtml) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111;background:#fafafa}` +
    `.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:12px}` +
    `.addr{font-family:ui-monospace,monospace;font-size:12px;color:#6b7280;word-break:break-all;margin-bottom:12px}` +
    `.sec{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:#6b7280;margin-bottom:8px}` +
    `.row{display:flex;justify-content:space-between;gap:10px;margin:6px 0;font-size:14px}` +
    `.muted{color:#6b7280;font-size:13px}h1{font-size:20px;margin:0 0 4px}</style></head>` +
    `<body>${bodyHtml}</body></html>`
}

export default async function handler(req, res) {
  const net = (req.query?.net || '').toString()
  const addr = (req.query?.addr || '').toString()
  res.setHeader('content-type', 'text/html; charset=utf-8')
  if (!addr) return res.status(400).send(page('Риск', '<div class="card">Не указан адрес.</div>'))
  if (!aegis.configured()) return res.status(200).send(page('Риск', '<div class="card">AEGIS не сконфигурирован.</div>'))

  let d = null
  try {
    d = await aegis.getRiskDetail(net, addr)
  } catch (e) {
    return res.status(200).send(page('Риск', `<div class="card">Не удалось получить оценку риска.<div class="muted">${esc(e?.message || e)}</div></div>`))
  }
  if (!d) return res.status(200).send(page('Риск', '<div class="card">Нет данных по адресу.</div>'))

  const bd = Array.isArray(d.breakdown) ? d.breakdown : []
  const color = levelColor(d.level, d.score)
  const preliminary = d.assessment === 'preliminary'

  // Бейдж покрытия: typed_pct<60 → «оценено N%» (unknown ≠ чисто).
  const cov = d.coverage || null
  const typedPct = cov && Number.isFinite(Number(cov.typedPct)) ? Number(cov.typedPct) : null
  const covBadge = typedPct != null && typedPct < 60
    ? ` <span style="font-size:13px;color:#d97706">· оценено ${Math.round(typedPct)}%</span>`
    : ''

  // 1. Заголовок — уровень + score (+ предв./покрытие).
  const scoreStr = preliminary && (d.score == null) ? 'предв.' : `${esc(d.score ?? '—')}%`
  const head = `<h1 style="color:${color}">📈 Уровень риска: ${esc(levelWord(d.level))} (${scoreStr})${preliminary ? ' <span style="font-size:13px;color:#d97706">· уточняется</span>' : ''}${covBadge}</h1>` +
    `<div class="addr">${esc(net)} · ${esc(addr)}</div>`

  // Вердикт (клиентский вид) — шапкой над сырым breakdown. Breakdown ниже = аудит.
  const v = d.verdict
  const verdictBlock = v
    ? `<div class="card" style="border-color:${color}">` +
      `<div class="row" style="font-weight:600;font-size:16px"><span>${esc(v.emoji || '')} ${esc(v.levelText || '')}</span><b>${v.score != null ? esc(v.score) + '/100' : '—'}</b></div>` +
      (v.action ? `<div class="row"><span>${esc(v.action)}</span></div>` : '') +
      (Array.isArray(v.reasons) && v.reasons.length ? `<div class="sec" style="margin-top:8px">Почему</div>` + v.reasons.map((r) => {
        const rt = typeof r === 'string' ? r : (r?.text || '') // терпим оба формата: строка ИЛИ {text,detail}
        const rd = typeof r === 'object' ? (r?.detail || '') : ''
        return `<div class="row muted" style="display:block">${esc(rt)}</div>` + (rd && rd !== rt ? `<div class="row muted" style="display:block;padding-left:14px;opacity:.75">└ ${esc(rd)}</div>` : '')
      }).join('') : '') +
      (Array.isArray(v.sources) && v.sources.length ? `<div class="sec" style="margin-top:8px">Источник средств</div>` + v.sources.map((s) => `<div class="row"><span>${esc(s.emoji || '')} ${esc(s.label || '')}</span><b>${esc(s.bar || '')} ${s.pct != null ? esc(s.pct) + '%' : ''}</b></div>`).join('') : '') +
      (v.cleanNote ? `<div class="row muted" style="display:block;margin-top:6px">${esc(v.cleanNote)}</div>` : '') +
      `</div>`
    : ''

  // Правило 1: прямая санкц/ЧС-метка или critical → ⛔ ОТКАЗ (баннер вверху).
  const refuse = d.sanctioned || d.blacklisted || d.level === 'critical'
  const refuseWhy = d.sanctioned ? 'санкционный адрес' : d.blacklisted ? 'адрес в чёрном списке' : 'критический уровень риска'
  const refuseBanner = refuse
    ? `<div class="card" style="border-color:#dc2626;background:#fef2f2"><div class="sec" style="color:#991b1b">⛔ Рекомендация: ОТКАЗ</div>` +
      `<div class="row" style="color:#991b1b;font-weight:600"><span>${esc(refuseWhy)} — сделка не проводится</span></div></div>`
    : ''

  // Правило 4: preliminary без hard-фактов → предупреждение «не выдавать за чисто».
  const prelimBanner = preliminary && !refuse
    ? `<div class="card" style="border-color:#fcd34d;background:#fffbeb"><div class="sec" style="color:#92400e">🟡 Оценка предварительная</div>` +
      `<div class="row muted" style="display:block">Exposure ещё считается${typedPct != null ? ` (типизировано ${Math.round(typedPct)}%)` : ''}. «Неизвестно» ≠ «чисто» — дождитесь полной оценки.</div></div>`
    : ''

  // Правило 2: вложенный сервис → блок + авто-EDD.
  const ns = d.nestedService
  const nsBlock = ns && (ns.name || ns.license || ns.source)
    ? `<div class="card" style="border-color:#c7d2fe;background:#eef2ff"><div class="sec" style="color:#3730a3">🏦 Вложенный сервис</div>` +
      `<div class="row"><span>Название</span><b>${esc(ns.name || '—')}</b></div>` +
      `<div class="row"><span>Лицензия</span><b>${esc(ns.license || 'нет')}</b></div>` +
      (ns.source ? `<div class="row"><span>Источник (заявлено)</span><b>${esc(ns.source)}</b></div>` : '') +
      `<div class="row muted" style="display:block">EDD: кто это · есть ли лицензия · источник средств.</div></div>`
    : ''

  // 4. Hard-факты (direct:true) — красным, отдельно от долевой композиции.
  const hard = bd.filter((b) => b.direct)
  const hardBlock = hard.length
    ? `<div class="card" style="border-color:#fca5a5;background:#fef2f2">` +
      `<div class="sec" style="color:#991b1b">⛔ Прямые метки на адресе</div>` +
      hard.map((b) => `<div class="row" style="color:#991b1b;font-weight:600"><span>• ${esc(b.label || b.category)}</span></div>`).join('') +
      `</div>`
    : ''

  // Правило 3: funds_flow{source[],destination[]} — источник/назначение потока.
  // Слайс с risk_pct>0 = «грязный» (красным). Если funds_flow есть — он заменяет
  // старую «Связи адреса» (та же суть, но со стороной потока и usdt).
  const ff = d.fundsFlow || null
  const sliceRow = (s) => {
    const dirty = Number(s.riskPct) > 0
    const icon = dirty ? '🔴' : '🟢'
    const cl = dirty ? ' style="color:#991b1b;font-weight:600"' : ''
    const amt = s.usdt != null ? ` <span class="muted">· ${esc(Number(s.usdt).toLocaleString('en-US', { maximumFractionDigits: 0 }))} USDT</span>` : ''
    return `<div class="row"${cl}><span>${icon} ${esc(s.label || s.category || '—')}${dirty ? ` <span style="font-size:12px">(риск ${esc(s.riskPct)}%)</span>` : ''}</span><b>${esc(s.sharePct ?? '—')}%${amt}</b></div>`
  }
  const flowSide = (title, arr) => {
    const list = (arr || []).slice().sort((a, b) => (Number(b.sharePct) || 0) - (Number(a.sharePct) || 0))
    if (!list.length) return ''
    const anyDirty = list.some((s) => Number(s.riskPct) > 0)
    return `<div class="card"${anyDirty ? ' style="border-color:#fca5a5"' : ''}><div class="sec"${anyDirty ? ' style="color:#991b1b"' : ''}>${title}</div>` +
      list.map(sliceRow).join('') + `</div>`
  }
  const flowBlock = ff && ((ff.source && ff.source.length) || (ff.destination && ff.destination.length))
    ? flowSide('Происхождение средств', ff.source) + flowSide('Назначение средств', ff.destination)
    : ''

  // 2. Композиция «Связи адреса» — только если НЕТ funds_flow (back-compat).
  const comp = bd.filter((b) => b.sharePct != null && !b.direct).sort((a, b) => Number(b.sharePct) - Number(a.sharePct))
  const major = comp.filter((b) => Number(b.sharePct) >= 0.1)
  const minor = comp.filter((b) => Number(b.sharePct) < 0.1)
  const compBlock = !flowBlock && comp.length
    ? `<div class="card"><div class="sec">Связи адреса</div>` +
      major.map((b) => `<div class="row"><span>${catIcon(b)} ${esc(b.label || b.category)}</span><b>${esc(b.sharePct)}%</b></div>`).join('') +
      (minor.length ? `<div class="row muted" style="display:block"><b>Менее 0.1%:</b> ${minor.map((b) => esc(b.label || b.category)).join(' · ')}</div>` : '') +
      `</div>`
    : ''

  // 3. «Почему такой балл» — драйверы (kind:signal) и контекст (kind:context).
  const drivers = bd.filter((b) => b.kind === 'signal')
  const contexts = bd.filter((b) => b.kind === 'context')
  const whyBlock = drivers.length || contexts.length
    ? `<div class="card"><div class="sec">Почему такой балл</div>` +
      drivers.map((b) => `<div class="row"><span>🔸 ${esc(b.label)}</span>${b.pct != null ? `<span class="muted">${esc(b.pct)}%</span>` : ''}</div>`).join('') +
      contexts.map((b) => `<div class="row muted" style="display:block">◽ ${esc(b.label)}</div>`).join('') +
      `</div>`
    : ''

  // risk_by_category — 2-колоночная таблица (первые 7 = левая, следующие 8 = правая),
  // ВСЕГДА все категории (0% честно). out_pct>0 → «⬆️ уходит N%».
  const rbc = Array.isArray(d.riskByCategory) ? d.riskByCategory : []
  const catCell = (c) => {
    const dirty = Number(c.pct) > 0
    const out = c.outPct != null && Number(c.outPct) > 0 ? ` <span style="color:#b45309">⬆️ ${esc(c.outPct)}%</span>` : ''
    return `<div class="row"><span>${esc(c.emoji || '')} ${esc(c.label || '')} <span style="font-family:ui-monospace,monospace;color:${dirty ? '#991b1b' : '#c9ccd8'}">${esc(c.bar || '')}</span></span><b>${esc(c.pct != null ? c.pct : 0)}%${out}</b></div>`
  }
  const catTableBlock = rbc.length
    ? `<div class="card"><div class="sec">Риск по категориям (${rbc.length})</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">` +
      `<div>${rbc.slice(0, 7).map(catCell).join('')}</div>` +
      `<div>${rbc.slice(7).map(catCell).join('')}</div>` +
      `</div></div>`
    : ''

  const blocks = verdictBlock + refuseBanner + prelimBanner + nsBlock + catTableBlock + hardBlock + flowBlock + compBlock + whyBlock
  const bodyFull = blocks ? head + blocks : head + '<div class="card muted">Разбор недоступен.</div>'
  return res.status(200).send(page(`Риск ${d.score ?? ''}% · ${addr.slice(0, 8)}…`, bodyFull))
}
