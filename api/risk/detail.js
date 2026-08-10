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

  // 1. Заголовок — уровень + score.
  const head = `<h1 style="color:${color}">📈 Уровень риска: ${esc(levelWord(d.level))} (${esc(d.score ?? '—')}%)</h1>` +
    `<div class="addr">${esc(net)} · ${esc(addr)}</div>`

  // 4. Hard-факты (direct:true) — вверху красным, отдельно от долевой композиции.
  const hard = bd.filter((b) => b.direct)
  const hardBlock = hard.length
    ? `<div class="card" style="border-color:#fca5a5;background:#fef2f2">` +
      `<div class="sec" style="color:#991b1b">⛔ Прямые метки на адресе</div>` +
      hard.map((b) => `<div class="row" style="color:#991b1b;font-weight:600"><span>• ${esc(b.label || b.category)}</span></div>`).join('') +
      `</div>`
    : ''

  // 2. Композиция «Связи адреса» — share_pct != null (кроме direct), по убыв. < 0.1% в группу.
  const comp = bd.filter((b) => b.sharePct != null && !b.direct).sort((a, b) => Number(b.sharePct) - Number(a.sharePct))
  const major = comp.filter((b) => Number(b.sharePct) >= 0.1)
  const minor = comp.filter((b) => Number(b.sharePct) < 0.1)
  const compBlock = comp.length
    ? `<div class="card"><div class="sec">Связи адреса</div>` +
      major.map((b) => `<div class="row"><span>${catIcon(b)} ${esc(b.label || b.category)}</span><b>${esc(b.sharePct)}%</b></div>`).join('') +
      (minor.length ? `<div class="row muted" style="display:block"><b>Менее 0.1%:</b> ${minor.map((b) => esc(b.label || b.category)).join(' · ')}</div>` : '') +
      `</div>`
    : ''

  // 3. «Почему такой балл» — драйверы (kind:signal) и контекст (kind:context), отдельно от композиции.
  const drivers = bd.filter((b) => b.kind === 'signal')
  const contexts = bd.filter((b) => b.kind === 'context')
  const whyBlock = drivers.length || contexts.length
    ? `<div class="card"><div class="sec">Почему такой балл</div>` +
      drivers.map((b) => `<div class="row"><span>🔸 ${esc(b.label)}</span>${b.pct != null ? `<span class="muted">${esc(b.pct)}%</span>` : ''}</div>`).join('') +
      contexts.map((b) => `<div class="row muted" style="display:block">◽ ${esc(b.label)}</div>`).join('') +
      `</div>`
    : ''

  const bodyFull = hardBlock || compBlock || whyBlock ? head + hardBlock + compBlock + whyBlock : head + '<div class="card muted">Разбор недоступен.</div>'
  return res.status(200).send(page(`Риск ${d.score ?? ''}% · ${addr.slice(0, 8)}…`, bodyFull))
}
