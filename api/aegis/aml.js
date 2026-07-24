/**
 * AML-обзор портфеля крипто-кошельков (комплаенс-кокпит).
 * GET /api/aegis/aml — requireStaff. Читает КЭШ (accounts + wallet_aegis_cache),
 * без live-AEGIS → мгновенно. Сводит per-кошельковый разбор в портфельную картину:
 *   - кошельки по риску (скор, рисковая экспозиция %, топ-категория);
 *   - рисковые движения (контрагент = микшер/гэмблинг/даркнет/скам/санкции или высокий риск);
 *   - итоги (кошельков warning/critical, рисковых операций, санкционных касаний).
 *
 * ENV: SUPABASE_*.
 */
import { requireStaff } from '../cashdesk/_auth.js'
import { svcClient, authEnv } from './_common.js'

const RISKY_CATS = new Set(['mixer', 'gambling', 'darknet', 'scam', 'sanctioned', 'blacklist'])
const CAT_OF = (t) => String(t?.counterpartyEntity?.category || t?.counterpartyType || '').toLowerCase()

function classifyTx(t) {
  const cat = CAT_OF(t)
  const cats = (t?.counterpartyRisk?.categories || []).map((c) => String(c).toLowerCase())
  const score = t?.counterpartyRisk?.score ?? t?.riskScore
  const sanctioned = t?.counterpartyEntity?.sanctioned === true || cats.includes('sanction') || cats.includes('sanctioned') || cats.includes('blacklist')
  const riskyCat = RISKY_CATS.has(cat) || cats.some((c) => RISKY_CATS.has(c) || c === 'sanction')
  const s = Number(score)
  const highScore = Number.isFinite(s) && s > 25
  return { risky: sanctioned || riskyCat || highScore, sanctioned, category: cat || (cats[0] || null), score: Number.isFinite(s) ? s : null }
}

// Рисковая экспозиция кошелька из stats.exposure: доля оборота от рисковых категорий.
function riskyExposure(stats) {
  const exp = stats && stats.exposure
  if (!exp) return { pct: null, top: null }
  let risky = 0, total = 0, byCat = {}
  for (const side of [exp.inbound || [], exp.outbound || []]) {
    for (const e of side) {
      const v = Number(e.volume_usd) || 0
      total += v
      if (RISKY_CATS.has(String(e.category || '').toLowerCase())) { risky += v; byCat[e.category] = (byCat[e.category] || 0) + v }
    }
  }
  // total из exposure — только атрибутированный оборот; для доли берём полный in+out.
  const full = (Number(stats.in?.sumUsd) || 0) + (Number(stats.out?.sumUsd) || 0)
  const base = full > total ? full : total
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]
  return { pct: base > 0 ? (risky / base) * 100 : 0, top: top ? top[0] : null }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })
  const { supaUrl, anon, svcKey } = authEnv()
  if (!supaUrl || !anon || !svcKey) return res.status(503).json({ error: 'backend not configured' })
  try {
    await requireStaff(req, { supaUrl, anon, svcKey })
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.error || 'forbidden' })
  }
  const db = svcClient()
  if (!db) return res.status(503).json({ error: 'backend not configured' })

  const [accRes, cacheRes] = await Promise.all([
    db.from('accounts').select('id, name, network_id, risk_level, risk_score').eq('active', true).eq('kind', 'crypto'),
    db.from('wallet_aegis_cache').select('account_id, tx_items, stats'),
  ])
  if (accRes.error || cacheRes.error) return res.status(500).json({ error: 'read failed' })
  const accById = new Map((accRes.data || []).map((a) => [a.id, a]))
  const cacheById = new Map((cacheRes.data || []).map((c) => [c.account_id, c]))

  const wallets = []
  const riskyTx = []
  let walletsWarn = 0, walletsCrit = 0, sanctionedTouch = 0

  for (const a of accRes.data || []) {
    const c = cacheById.get(a.id) || {}
    const exp = riskyExposure(c.stats || null)
    if (a.risk_level === 'warning') walletsWarn += 1
    if (a.risk_level === 'critical') walletsCrit += 1
    wallets.push({
      id: a.id, name: a.name, network: a.network_id,
      riskScore: a.risk_score ?? null, riskLevel: a.risk_level ?? null,
      riskyExposurePct: exp.pct, topRiskyCategory: exp.top,
    })
    for (const t of c.tx_items || []) {
      const cl = classifyTx(t)
      if (!cl.risky) continue
      if (cl.sanctioned) sanctionedTouch += 1
      const amt = t.amount ? Number(t.amount.amount) / 10 ** (t.amount.decimals ?? 6) : null
      riskyTx.push({
        accountId: a.id, walletName: a.name, network: a.network_id,
        direction: t.direction, amountUsdt: amt, counterparty: t.counterparty || null,
        entityName: t.counterpartyEntity?.name || null, category: cl.category,
        sanctioned: cl.sanctioned, cpScore: cl.score, ts: t.ts,
      })
    }
  }

  // Кошельки: сначала critical/warning, потом по рисковой экспозиции, потом по скору.
  const rank = { critical: 0, warning: 1, ok: 2 }
  wallets.sort((x, y) =>
    (rank[x.riskLevel] ?? 3) - (rank[y.riskLevel] ?? 3) ||
    (y.riskyExposurePct || 0) - (x.riskyExposurePct || 0) ||
    (y.riskScore || 0) - (x.riskScore || 0)
  )
  // Рисковые операции: санкции сверху, потом по скору, потом свежие.
  riskyTx.sort((x, y) => (y.sanctioned - x.sanctioned) || ((y.cpScore || 0) - (x.cpScore || 0)) || String(y.ts || '').localeCompare(String(x.ts || '')))

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    totals: { wallets: wallets.length, walletsWarn, walletsCrit, riskyTxCount: riskyTx.length, sanctionedTouch },
    wallets,
    riskyTx: riskyTx.slice(0, 150),
  })
}
