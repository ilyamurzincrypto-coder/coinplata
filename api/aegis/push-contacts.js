/**
 * Заливка контактов (адрес↔имя) в AEGIS для деанонимизации — имена появляются в
 * counterparty_entity во всех выдачах и в риск-раскладке. ПОКА только наши кошельки
 * (type=own): внешних связок адрес↔имя в БД нет (deals/partner_accounts пусты).
 * Периодически (крон) — новые кошельки подхватятся. Идемпотентно: дедуп по (network,
 * address) у нас + upsert по (network,address) на стороне AEGIS. Деньги/леджер не трогаем.
 *
 * Гейт CRON_SECRET. ENV: AEGIS_API_URL/KEY, SUPABASE_*, CRON_SECRET.
 */
import { aegis } from '../../src/lib/aegisClient.js'
import { svcClient } from './_common.js'

export const config = { maxDuration: 60 }

// --- ядро: инъекция deps. Дедуп по (network,address), батчами. Чистое и тестируемое. ---
export async function handlePushContacts({ deps, batchSize = 500 }) {
  const contacts = await deps.loadContacts()
  const seen = new Set()
  const uniq = []
  for (const c of contacts || []) {
    if (!c || !c.address || !c.network) continue
    const key = `${c.network}:${c.address}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(c)
  }
  let upserted = 0
  let skipped = 0
  for (let i = 0; i < uniq.length; i += batchSize) {
    const r = await deps.push(uniq.slice(i, i + batchSize))
    upserted += r?.upserted || 0
    skipped += r?.skipped || 0
  }
  return { total: uniq.length, upserted, skipped }
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })
  if (!aegis.configured()) return res.status(200).json({ ok: true, skipped: 'aegis not configured', total: 0 })

  const deps = {
    // ТОЛЬКО наши крипто-кошельки → type=own. Внешних адрес↔имя в БД нет — не заливаем.
    async loadContacts() {
      const { data, error } = await db
        .from('accounts')
        .select('name, network_id, address')
        .eq('kind', 'crypto')
        .eq('active', true)
        .not('address', 'is', null)
      if (error) throw new Error(error.message)
      return (data || []).map((a) => ({ network: a.network_id, address: a.address, name: a.name, type: 'own' }))
    },
    push: (batch) => aegis.addContacts(batch),
  }

  try {
    const result = await handlePushContacts({ deps })
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: `push-contacts failed: ${e?.message || e}` })
  }
}
