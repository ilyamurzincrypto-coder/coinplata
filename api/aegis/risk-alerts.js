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
//
// ДВА ПУТИ РЕЗОЛВА, одно тело цикла:
//   • батч (прод) — deps.loadOffices/loadCounterparties/existingAlertIds/insertFindings.
//     4 запроса на прогон независимо от числа находок.
//   • per-item (фолбэк/тесты) — deps.findOffice/resolveCounterparty/recordFinding.
//     Историческая форма: 5 round-trip НА КАЖДУЮ находку.
// Почему это важно: при limit=100 per-item давал до 500 последовательных hops в
// Supabase и стабильно упирался в maxDuration=60 → 504, а прогон обрывался на
// середине списка (часть находок не записывалась вовсе).
export async function handleRiskAlerts({ deps, limit = 100 }) {
  const { alerts } = await deps.fetchAlerts(limit)
  // Обрабатываем HOP2_RISK (грязь в 2 хопах) и RISK_UPGRADE (оценка адреса поднялась
  // после прогрева exposure — коррекция). Прочие типы игнорируем.
  const relevant = (alerts || []).filter((a) => (a.type === 'HOP2_RISK' || a.type === 'RISK_UPGRADE') && a.alertId)

  // Резолверы приводим к единой сигнатуре async (key) => value, чтобы тело цикла
  // не знало, откуда пришло значение — из предзагруженной мапы или из точечного запроса.
  let officeOf
  if (deps.loadOffices) {
    const m = await deps.loadOffices(relevant.map((a) => a.officeWalletId))
    officeOf = (id) => (id ? m.get(id) ?? null : null)
  } else {
    officeOf = (id) => deps.findOffice(id)
  }

  let nameOf
  if (deps.loadCounterparties) {
    const m = await deps.loadCounterparties(relevant.map((a) => a.viaCounterparty))
    nameOf = (addr) => (addr ? m.get(addr) ?? null : null)
  } else if (deps.resolveCounterparty) {
    nameOf = (addr) => (addr ? deps.resolveCounterparty(addr) : null)
  } else {
    nameOf = () => null
  }

  // Дедуп: в батч-пути знаем заранее, в per-item — узнаём из ответа recordFinding.
  const known = deps.existingAlertIds ? await deps.existingAlertIds(relevant.map((a) => a.alertId)) : null

  let inserted = 0
  let dup = 0
  let notified = 0
  const results = []
  const pendingRows = []
  const pendingNotify = []

  for (const a of relevant) {
    const isUpgrade = a.type === 'RISK_UPGRADE'
    const office = await officeOf(a.officeWalletId) // {id,name} | null
    const viaName = await nameOf(a.viaCounterparty)
    const row = {
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
    }

    let saved
    if (known) {
      saved = known.has(a.alertId) ? 'duplicate' : 'new'
      if (saved === 'new') {
        pendingRows.push(row)
        known.add(a.alertId) // защита от дубля ВНУТРИ одной пачки
      }
    } else {
      saved = await deps.recordFinding(row)
    }

    if (saved === 'new') {
      inserted += 1
      pendingNotify.push({ alert: a, officeName: office?.name || null, viaName })
    } else {
      dup += 1
    }
    results.push({ alert_id: a.alertId, type: a.type, saved, office_id: office?.id || null, recognized: !!office })
  }

  // Запись — до алертов: не уведомляем о том, что не легло в таблицу.
  if (deps.insertFindings && pendingRows.length) await deps.insertFindings(pendingRows)

  // Алерт — best-effort: сбой notify не роняет прогон и не откатывает запись.
  if (deps.notify) {
    for (const n of pendingNotify) {
      try {
        const ok = await deps.notify(n)
        if (ok !== false) {
          notified += 1
          if (deps.markNotified) await deps.markNotified(n.alert.alertId)
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[risk-alerts] notify failed:', e?.message || e)
      }
    }
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

    // --- БАТЧ-ПУТЬ (ядро предпочитает его). Ровно 4 запроса на прогон вместо 5×N. ---

    // Все офисы одним заходом: accounts.aegis_wallet_id ∈ ids → office_id → offices.name.
    async loadOffices(walletIds) {
      const map = new Map()
      const ids = [...new Set((walletIds || []).filter(Boolean))]
      if (!ids.length) return map
      const { data: accs, error } = await db
        .from('accounts').select('aegis_wallet_id, office_id')
        .in('aegis_wallet_id', ids).not('office_id', 'is', null)
      if (error) throw new Error(error.message)
      const officeIds = [...new Set((accs || []).map((r) => r.office_id))]
      let byId = new Map()
      if (officeIds.length) {
        const { data: offs, error: e2 } = await db.from('offices').select('id, name').in('id', officeIds)
        if (e2) throw new Error(e2.message)
        byId = new Map((offs || []).map((o) => [o.id, o]))
      }
      // Первый аккаунт на кошелёк выигрывает — та же семантика, что .limit(1) в findOffice.
      for (const r of accs || []) {
        if (!map.has(r.aegis_wallet_id)) map.set(r.aegis_wallet_id, byId.get(r.office_id) || { id: r.office_id, name: null })
      }
      return map
    },

    // Все имена контрагентов одним заходом (best-effort, как и точечный резолв).
    async loadCounterparties(addrs) {
      const map = new Map()
      const list = [...new Set((addrs || []).filter(Boolean))]
      if (!list.length) return map
      const { data: pa, error } = await db
        .from('participant_accounts').select('address, participant_id')
        .in('address', list).not('participant_id', 'is', null)
      if (error) throw new Error(error.message)
      const pids = [...new Set((pa || []).map((r) => r.participant_id))]
      let byId = new Map()
      if (pids.length) {
        const { data: ps, error: e2 } = await db.from('participants').select('id, display_name').in('id', pids)
        if (e2) throw new Error(e2.message)
        byId = new Map((ps || []).map((p) => [p.id, p.display_name]))
      }
      for (const r of pa || []) if (!map.has(r.address)) map.set(r.address, byId.get(r.participant_id) ?? null)
      return map
    },

    // Какие alert_id уже лежат — дедуп ДО вставки, вместо ловли 23505 по одному.
    async existingAlertIds(ids) {
      const set = new Set()
      const list = [...new Set((ids || []).filter(Boolean))]
      // Чанк на случай, если limit когда-нибудь поднимут: URL PostgREST не резиновый.
      for (let i = 0; i < list.length; i += 200) {
        const { data, error } = await db
          .from('aegis_risk_findings').select('alert_id').in('alert_id', list.slice(i, i + 200))
        if (error) throw new Error(error.message)
        for (const r of data || []) set.add(r.alert_id)
      }
      return set
    },

    // Вставка пачкой. ignoreDuplicates — на случай гонки с параллельным прогоном:
    // конфликт по alert_id не должен ронять весь батч.
    async insertFindings(rows) {
      if (!rows.length) return
      const { error } = await db
        .from('aegis_risk_findings').upsert(rows, { onConflict: 'alert_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
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
