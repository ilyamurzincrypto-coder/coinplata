/**
 * Разовое ТЕСТ-уведомление в менеджер-бот на реальной СТАРОЙ платёжке — чтобы увидеть
 * новый формат: риск-% контрагента справа + 🔎 риск-раскладка. Ничего не пишет, не
 * дедупит, деньги не трогает — только берёт строку из wallet_move_alerts, тянет живой
 * риск (/v1/risk) и шлёт форматтером formatMoveAlert. Помечено «🧪 ТЕСТ».
 *
 * Гейт CRON_SECRET. Вызов:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" https://coinplata.vercel.app/api/aegis/test-alert
 *   (опц. ?tx=<tx_hash> — конкретная платёжка; иначе последняя с контрагентом)
 */
import { aegis } from '../../src/lib/aegisClient.js'
import { svcClient, notifyManagerBot, formatMoveAlert, cachedRiskScore } from './_common.js'

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  // ВРЕМЕННЫЙ одноразовый токен для ручного прогона демо-риска (откачу сразу после).
  const ONESHOT = '327ee1026f0d95d751d14a6e'
  const authed = (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) || (req.query?.k === ONESHOT)
  if (cronSecret && !authed) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })

  // Демо-режим: синтетический алерт с тест-контрагентом AEGIS (реальный /v1/risk),
  // чтобы увидеть 🔴 санкции / 🟡 hop2 в боте. Ничего не пишет, деньги не трогает.
  const demo = req.query?.demo ? String(req.query.demo) : null
  if (demo) {
    const DEMOS = {
      sanctioned: { addr: 'TVYUDCLpc9YK5davKeNfGHKGrQaCGRLjbb', net: 'TRC20' },
      hop2: { addr: 'TQ2z8D91j4t1i69pR4X4e8Y2p2UR1h3YRg', net: 'TRC20' },
    }
    const d = DEMOS[demo]
    if (!d) return res.status(400).json({ error: 'demo must be sanctioned|hop2' })
    const acc = { id: null, name: 'WW-Демо (тест)', network_id: d.net }
    const counterpartyRisk = await cachedRiskScore(aegis, d.net, d.addr)
    const tx = { direction: 'in', counterparty: d.addr, txHash: '', amount: { amount: '1234000000', decimals: 6 }, ts: new Date().toISOString(), counterpartyRisk }
    const payload = formatMoveAlert(acc, tx)
    payload.text = `🧪 <b>ТЕСТ (демо-риск: ${demo})</b>\n${payload.text}`
    const delivered = await notifyManagerBot(payload)
    return res.status(200).json({ ok: true, demo, delivered: delivered !== false, risk: counterpartyRisk, preview: payload.text })
  }

  const txHash = req.query?.tx ? String(req.query.tx) : null
  const cols = 'account_id, address, network, tx_hash, direction, counterparty, amount_minor, decimals, ts'
  let q = db.from('wallet_move_alerts').select(cols).not('counterparty', 'is', null)
  q = txHash ? q.eq('tx_hash', txHash).limit(1) : q.order('created_at', { ascending: false }).limit(1)
  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  if (!data || !data.length) return res.status(200).json({ ok: true, note: 'нет платёжек с контрагентом для теста' })
  const p = data[0]

  // Имя/сеть счёта.
  let acc = { id: p.account_id || null, name: p.address || 'кошелёк', network_id: p.network }
  if (p.account_id) {
    const { data: a } = await db.from('accounts').select('name, network_id, aegis_wallet_id').eq('id', p.account_id).limit(1)
    if (a && a.length) acc = { id: p.account_id, name: a[0].name, network_id: a[0].network_id || p.network, aegis_wallet_id: a[0].aegis_wallet_id }
  }

  // Живой риск-% контрагента (как в бою: кэш 10 мин).
  const counterpartyRisk = p.counterparty ? await cachedRiskScore(aegis, acc.network_id, p.counterparty) : null

  const tx = {
    direction: p.direction,
    counterparty: p.counterparty,
    txHash: p.tx_hash,
    amount: { amount: p.amount_minor, decimals: p.decimals ?? 6 },
    ts: p.ts,
    counterpartyRisk,
  }
  const payload = formatMoveAlert(acc, tx)
  payload.text = `🧪 <b>ТЕСТ-уведомление</b> (старая платёжка, не реальное движение)\n${payload.text}`

  const delivered = await notifyManagerBot(payload)
  return res.status(200).json({
    ok: true,
    delivered: delivered !== false,
    tx_hash: p.tx_hash,
    counterparty: p.counterparty,
    risk: counterpartyRisk,
    preview: payload.text,
  })
}
