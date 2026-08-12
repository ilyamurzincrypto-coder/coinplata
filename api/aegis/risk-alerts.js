/**
 * Пул HOP2_RISK-находок AEGIS (Vercel Cron). AEGIS теперь видит риск ГЛУБЖЕ прямого
 * контрагента: если наш контрагент сам в 1 шаге от блэклист/санкц-адреса (hop-2),
 * AEGIS это отдаёт через GET /v1/alerts. Мы тянем, дедупим по alert_id (идемпотентно),
 * матчим офис (office_wallet_id → accounts.aegis_wallet_id) и контрагента (best-effort),
 * и на НОВОЙ находке шлём EDD-алерт менеджеру. Деньги/леджер НЕ трогаем — только READ
 * из /v1/alerts + запись в public.aegis_risk_findings + уведомление.
 *
 * Гейт CRON_SECRET (как poll/rapira/tolunay). ENV: AEGIS_API_URL/KEY, SUPABASE_*,
 * CRON_SECRET, (+ COINPOINT_API_URL/CASHDESK_API_SECRET или TELEGRAM_* для алерта).
 */
import { aegis } from '../../src/lib/aegisClient.js'
import { svcClient, notifyManagerBot, formatRiskFinding, formatRiskUpgrade } from './_common.js'

export const config = { maxDuration: 60 }

// --- ядро: инъекция deps (fetchAlerts/findOffice/resolveCounterparty/recordFinding/notify) ---
// Чистое и тестируемое. Фильтрует HOP2_RISK, дедупит по alert_id, алертит только на новое.
export async function handleRiskAlerts({ deps, limit = 100 }) {
  const { alerts } = await deps.fetchAlerts(limit)
  // Обрабатываем HOP2_RISK (грязь в 2 хопах) и RISK_UPGRADE (оценка адреса поднялась
  // после прогрева exposure — коррекция). Прочие типы игнорируем.
  const relevant = (alerts || []).filter((a) => (a.type === 'HOP2_RISK' || a.type === 'RISK_UPGRADE') && a.alertId)
  let inserted = 0
  let dup = 0
  let notified = 0
  const results = []
  for (const a of relevant) {
    const isUpgrade = a.type === 'RISK_UPGRADE'
    const office = await deps.findOffice(a.officeWalletId) // {id,name} | null
    const viaName = a.viaCounterparty && deps.resolveCounterparty ? await deps.resolveCounterparty(a.viaCounterparty) : null
    const saved = await deps.recordFinding({
      alert_id: a.alertId,
      type: a.type,
      network: a.network,
      risk_address: a.riskAddress || a.address || null,
      category: a.category || (isUpgrade ? 'RISK_UPGRADE' : null),
      via_counterparty: a.viaCounterparty,
      via_counterparty_name: viaName,
      office_wallet_id: a.officeWalletId,
      office_id: office?.id || null,
      office_label: a.officeLabel || office?.name || null,
      note: isUpgrade ? (a.note || `${a.prevScore == null ? 'предв.' : a.prevScore + '%'} → ${a.newScore ?? '—'}% (${a.level || '—'})`) : a.note,
      status: a.status,
      source_created_at: a.createdAt,
    })
    if (saved === 'new') {
      inserted += 1
      // Алерт — best-effort: сбой notify не роняет прогон и не откатывает запись.
      if (deps.notify) {
        try {
          const ok = await deps.notify({ alert: a, officeName: office?.name || null, viaName })
          if (ok !== false) {
            notified += 1
            if (deps.markNotified) await deps.markNotified(a.alertId)
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[risk-alerts] notify failed:', e?.message || e)
        }
      }
    } else {
      dup += 1
    }
    results.push({ alert_id: a.alertId, type: a.type, saved, office_id: office?.id || null, recognized: !!office })
  }
  return {
    total: (alerts || []).length,
    hop2: relevant.filter((a) => a.type === 'HOP2_RISK').length,
    upgrades: relevant.filter((a) => a.type === 'RISK_UPGRADE').length,
    inserted,
    dup,
    notified,
    results,
  }
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })
  if (!aegis.configured()) return res.status(200).json({ ok: true, skipped: 'aegis not configured', hop2: 0 })

  const deps = {
    fetchAlerts: (limit) => aegis.getAlerts({ limit }),
    // Матч офиса по aegis_wallet_id → accounts.office_id → offices.name.
    async findOffice(walletId) {
      if (!walletId) return null
      const { data } = await db.from('accounts').select('office_id').eq('aegis_wallet_id', walletId).not('office_id', 'is', null).limit(1)
      if (!data || !data.length) return null
      const officeId = data[0].office_id
      const { data: o } = await db.from('offices').select('id, name').eq('id', officeId).limit(1)
      return o && o.length ? o[0] : { id: officeId, name: null }
    },
    // Best-effort имя контрагента по on-chain адресу (participant_accounts → participants).
    async resolveCounterparty(addr) {
      const { data } = await db.from('participant_accounts').select('participant_id').eq('address', addr).limit(1)
      if (!data || !data.length || !data[0].participant_id) return null
      const { data: p } = await db.from('participants').select('display_name').eq('id', data[0].participant_id).limit(1)
      return p && p.length ? p[0].display_name : null
    },
    // Дедуп-запись находки. 23505 (alert_id уже есть) → duplicate (не двоим/не алертим).
    async recordFinding(row) {
      const { error } = await db.from('aegis_risk_findings').insert(row)
      if (error && error.code === '23505') return 'duplicate'
      if (error) throw new Error(error.message)
      return 'new'
    },
  }

  // Бот-уведомление ПОКА ВЫКЛЮЧЕНО (чтобы не дублировать алерты). Находки всё равно
  // пишутся в таблицу и видны оператору в ленте «EDD». Включить — AEGIS_RISK_NOTIFY=true.
  if (process.env.AEGIS_RISK_NOTIFY === 'true') {
    deps.notify = ({ alert, officeName, viaName }) =>
      notifyManagerBot(alert.type === 'RISK_UPGRADE' ? formatRiskUpgrade(alert, viaName) : formatRiskFinding(alert, officeName, viaName))
    deps.markNotified = async (id) => {
      await db.from('aegis_risk_findings').update({ notified: true }).eq('alert_id', id)
    }
  }

  try {
    const result = await handleRiskAlerts({ deps, limit: 100 })
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: `risk-alerts failed: ${e?.message || e}` })
  }
}
