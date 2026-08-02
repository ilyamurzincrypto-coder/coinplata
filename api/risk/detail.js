/**
 * Страница риск-раскладки контрагента (открывается из 🔎 в уведомлении менеджера).
 * Server-rendered: читает GET /v1/risk/{net}/{addr} тем же AEGIS_API_KEY. Деньги не трогаем.
 * Сеть/таймаут — показываем мягкое сообщение, не падаем.
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
function bar(sev) {
  const w = Math.max(0, Math.min(100, Number(sev) || 0))
  const c = w >= 80 ? '#dc2626' : w >= 40 ? '#d97706' : '#16a34a'
  return `<div style="background:#e5e7eb;border-radius:6px;height:9px;overflow:hidden;margin-top:4px"><div style="width:${w}%;height:100%;background:${c}"></div></div>`
}
function page(title, bodyHtml) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111;background:#fafafa}` +
    `.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:12px}` +
    `.addr{font-family:ui-monospace,monospace;font-size:12px;color:#6b7280;word-break:break-all}` +
    `.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;margin-right:6px}` +
    `.row{margin:10px 0}.lbl{display:flex;justify-content:space-between;font-size:13px}.muted{color:#6b7280;font-size:12px}h1{font-size:20px;margin:0 0 4px}</style></head>` +
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

  const color = levelColor(d.level, d.score)
  const badges =
    (d.sanctioned ? `<span class="badge" style="background:#fee2e2;color:#991b1b">🚫 санкции</span>` : '') +
    (d.blacklisted ? `<span class="badge" style="background:#fee2e2;color:#991b1b">⛔ чёрный список</span>` : '')
  const breakdown = (d.breakdown || [])
    .slice()
    .sort((a, b) => (Number(b.severity) || 0) - (Number(a.severity) || 0))
    .map((b) => {
      const shareTxt = b.direct || b.sharePct == null ? 'прямая метка' : `${b.sharePct}% потока`
      return `<div class="row"><div class="lbl"><span>${esc(b.label || b.category)}</span><span><b>${esc(b.severity)}</b> <span class="muted">· ${esc(shareTxt)}</span></span></div>${bar(b.severity)}</div>`
    })
    .join('')
  const reasons = (d.reasons || []).length
    ? `<div class="card"><div class="muted" style="margin-bottom:6px">Причины</div>${d.reasons.map((r) => `<div class="row" style="margin:4px 0">• ${esc(typeof r === 'string' ? r : r?.message || JSON.stringify(r))}</div>`).join('')}</div>`
    : ''

  const html =
    `<h1 style="color:${color}">риск ${esc(d.score ?? '—')}%${d.level ? ` · ${esc(d.level)}` : ''}</h1>` +
    `<div class="addr">${esc(net)} · ${esc(addr)}</div>` +
    (d.headline ? `<div class="muted" style="margin:6px 0">${esc(d.headline)}</div>` : '') +
    `<div style="margin:10px 0">${badges}</div>` +
    (breakdown ? `<div class="card">${breakdown}</div>` : '<div class="card muted">Разбор недоступен.</div>') +
    reasons
  return res.status(200).send(page(`риск ${d.score ?? ''}% · ${addr.slice(0, 8)}…`, html))
}
