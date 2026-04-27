// src/lib/supabaseReaders.js
// Централизованные async-loader'ы для stores + маппинг snake_case → camelCase.
// Каждый reader → чистая функция (supabase) → Promise<shape>. Ошибки прокидываем,
// вызывающий код решает что делать (обычно console.warn + fallback to empty).
//
// Важно: эти reader'ы ЧИТАЮТ. Write ops пока остаются in-memory (Stage 4).
// Весь shape результата сохраняет интерфейс существующих stores, чтобы UI
// не требовал переделки.

import { supabase } from "./supabase.js";

// ---------- helpers ----------
const num = (v) => (v == null ? 0 : Number(v));

function ensureSupabase() {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

// ---------- reference data ----------

export async function loadCurrencies() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("currencies").select("*").eq("active", true);
  if (error) throw error;
  return (data || []).map((r) => ({
    code: r.code,
    type: r.type,
    symbol: r.symbol || "",
    name: r.name || r.code,
    decimals: r.decimals || 2,
  }));
}

export async function loadOffices() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("offices").select("*");
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city || "",
    status: r.status,
    active: r.active,
    timezone: r.timezone,
    workingDays: r.working_days || [1, 2, 3, 4, 5, 6],
    workingHours: r.working_hours || { start: "09:00", end: "21:00" },
    // Расширенные поля из 0017_office_schedule
    workingHoursByDay: r.working_hours_by_day || null,
    holidays: Array.isArray(r.holidays) ? r.holidays : [],
    tempClosedUntil: r.temp_closed_until || null,
    tempClosedReason: r.temp_closed_reason || "",
    minFeeUsd: num(r.min_fee_usd),
    feePercent: num(r.fee_percent),
  }));
}

export async function loadNetworks() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("networks").select("*");
  if (error) throw error;
  // Frontend rates store historically called это "channels" — маппим в совместимый
  // shape {id, currencyCode, kind='network', network, gasFee, isDefaultForCurrency}.
  // Для MVP gas_fee хранится в accounts, channels = только networks.
  return (data || []).map((r) => ({
    id: r.id,
    kind: "network",
    network: r.id,
    currencyCode: "USDT", // для совместимости — переопределяется вызывающим кодом
    name: r.name,
    nativeCurrency: r.native_currency,
    explorerUrl: r.explorer_url,
    requiredConfirmations: r.required_confirmations,
  }));
}

export async function loadCategories() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("categories").select("*").eq("active", true);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    group: r.group_name,
    parentId: r.parent_id || null,
  }));
}

export async function loadSystemSettings() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("system_settings").select("*");
  if (error) throw error;
  const map = {};
  (data || []).forEach((r) => {
    map[r.key] = r.value;
  });
  return {
    referralPct: num(map.referral_pct),
    baseCurrency:
      typeof map.base_currency === "string" ? map.base_currency : "USD",
    minFeeUsd: num(map.min_fee_usd) || 10, // legacy fallback
  };
}

// ---------- pairs (rates) ----------

export async function loadPairs() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("pairs").select("*");
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    baseRate: num(r.base_rate),
    spreadPercent: num(r.spread_percent),
    rate: num(r.rate),
    isDefault: r.is_default,
    priority: r.priority ?? 50,
    updatedAt: r.updated_at,
    // legacy shape compat — frontend rates.jsx строит pair с fromChannelId/toChannelId,
    // для read-only Stage 3 достаточно полей выше. Channel-based операции полноценно
    // заработают на Stage 4.
  }));
}

// ---------- accounts + balances ----------

export async function loadAccounts() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("accounts").select("*").eq("active", true);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    officeId: r.office_id,
    currency: r.currency_code,
    type: r.type,
    name: r.name,
    active: r.active,
    balance: num(r.opening_balance), // seed opening balance; реальный current — через view
    bankRef: r.bank_ref,
    address: r.address,
    network: r.network_id,
    // channelId НЕ ставим из r.network_id — это значения типа 'TRC20',
    // а channel.id имеет формат 'ch_usdt_trc20'. Раньше здесь был
    // неправильный mapping → resolveAccountChannel возвращал null для
    // всех DB-loaded crypto accounts ("без соединения" в UI).
    // Без channelId — fallback derivation по (currency, type, network)
    // корректно находит channel.
    channelId: null,
    isDeposit: r.is_deposit || false,
    isWithdrawal: r.is_withdrawal || false,
    lastCheckedBlock: num(r.last_checked_block),
    lastCheckedAt: r.last_checked_at,
  }));
}

export async function loadAccountBalances() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("v_account_balances").select("*");
  if (error) throw error;
  const map = new Map();
  (data || []).forEach((r) => {
    map.set(r.account_id, {
      total: num(r.total),
      reserved: num(r.reserved),
    });
  });
  return map;
}

// Movements нужны для истории по конкретному аккаунту. Грузим все разом —
// для MVP масштаб ОК, для прода добавим пагинацию.
export async function loadMovements() {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("account_movements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    amount: num(r.amount),
    direction: r.direction,
    currency: r.currency_code,
    reserved: r.reserved,
    source: {
      kind: r.source_kind,
      refId: r.source_ref_id,
      outputIndex: r.source_leg_index,
      note: r.note,
    },
    movementGroupId: r.movement_group_id,
    createdBy: r.created_by,
    timestamp: r.created_at,
  }));
}

// ---------- clients + wallets ----------

export async function loadClients() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("clients").select("*");
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    nickname: r.nickname,
    name: r.full_name || r.nickname,
    telegram: r.telegram || "",
    tag: r.tag || "",
    note: r.note || "",
    riskScore: r.risk_score,
    riskLevel: r.risk_level,
    createdAt: r.created_at,
    archivedAt: r.archived_at || null,
  }));
}

export async function loadClientWallets() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("client_wallets").select("*");
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    address: r.address,
    network: r.network_id,
    firstSeenAt: r.first_seen_at,
    lastUsedAt: r.last_used_at,
    usageCount: r.usage_count,
    riskScore: r.risk_score,
    riskLevel: r.risk_level,
    riskFlags: r.risk_flags,
  }));
}

// ---------- deals + legs ----------

function mapLegToOutput(r) {
  return {
    currency: r.currency,
    amount: num(r.amount),
    plannedAmount: num(r.amount),
    actualAmount: num(r.actual_amount),
    plannedAt: r.planned_at,
    completedAt: r.completed_at,
    rate: num(r.rate),
    accountId: r.account_id || "",
    address: r.address || "",
    network: r.network_id || null,
    sendStatus: r.send_status || undefined,
    sendTxHash: r.send_tx_hash || "",
    isInternal: r.is_internal || false,
  };
}

// Грузим deals + legs отдельными запросами и склеиваем по deal_id.
// Для UI shape: tx.outputs = sorted legs.
// Historic PnL per deal — из view v_deal_pnl (0019).
// Возвращает Map<dealId, {profitRecordedUsd, marginInCurIn, marginAtCurrent}>.
export async function loadDealPnl() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("v_deal_pnl").select("*");
  if (error) throw error;
  const m = new Map();
  (data || []).forEach((r) => {
    m.set(r.deal_id, {
      profitRecordedUsd: num(r.profit_recorded_usd),
      marginInCurIn: num(r.margin_in_curin),
      marginAtCurrent: num(r.margin_at_current_rates),
      rateSnapshotId: r.rate_snapshot_id || null,
    });
  });
  return m;
}

export async function loadDealsWithLegs(usersById = {}) {
  const sb = ensureSupabase();
  const [dealsRes, legsRes] = await Promise.all([
    sb.from("deals").select("*").order("created_at", { ascending: false }).limit(2000),
    sb.from("deal_legs").select("*"),
  ]);
  if (dealsRes.error) throw dealsRes.error;
  if (legsRes.error) throw legsRes.error;

  const legsByDeal = new Map();
  (legsRes.data || []).forEach((l) => {
    if (!legsByDeal.has(l.deal_id)) legsByDeal.set(l.deal_id, []);
    legsByDeal.get(l.deal_id).push(l);
  });

  return (dealsRes.data || []).map((d) => {
    const legs = (legsByDeal.get(d.id) || [])
      .sort((a, b) => a.leg_index - b.leg_index)
      .map(mapLegToOutput);
    const created = new Date(d.created_at);
    const manager = usersById[d.manager_id];
    return {
      id: d.id,
      time: created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      date: created.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      officeId: d.office_id,
      type: d.type,
      curIn: d.currency_in,
      amtIn: num(d.amount_in),
      outputs: legs,
      curOut: legs[0]?.currency,
      amtOut: legs[0]?.amount,
      rate: legs[0]?.rate,
      fee: num(d.fee_usd),
      profit: num(d.profit_usd),
      manager: manager?.full_name || "—",
      managerId: d.manager_id,
      counterparty: d.client_nickname || "",
      counterpartyId: d.client_id,
      referral: d.referral,
      comment: d.comment || "",
      accountId: d.in_account_id || "",
      inTxHash: d.in_tx_hash || "",
      status: d.status,
      confirmedAt: d.confirmed_at,
      confirmedTxHash: d.confirmed_tx_hash,
      rateSnapshotId: d.rate_snapshot_id,
      inPlannedAmount: num(d.amount_in),
      inActualAmount: num(d.in_actual_amount),
      inPlannedAt: d.in_planned_at,
      inCompletedAt: d.in_completed_at,
      pinned: d.pinned,
      riskScore: d.risk_score,
      riskLevel: d.risk_level,
      riskFlags: d.risk_flags,
      flaggedAt: d.flagged_at,
      flaggedReason: d.flagged_reason,
      deletedAt: d.deleted_at,
      checkingStartedAt: d.checking_started_at,
      checkingBy: d.checking_by,
      createdAtMs: created.getTime(),
    };
  });
}

// ---------- obligations ----------

export async function loadObligations() {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("obligations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    officeId: r.office_id,
    dealId: r.deal_id,
    dealLegIndex: null,
    dealLegId: r.deal_leg_id,
    clientId: r.client_id,
    currency: r.currency_code,
    amount: num(r.amount),
    paidAmount: num(r.paid_amount),
    direction: r.direction,
    status: r.status,
    note: r.note || "",
    createdAt: r.created_at,
    createdBy: r.created_by,
    closedAt: r.closed_at,
    closedBy: r.closed_by,
  }));
}

// ---------- office rate overrides (0021) ----------

// Загружает все office-overrides в Map<officeId, Map<"FROM_TO", rate>>.
// Используется в useRates для effective-rate расчёта.
export async function loadOfficeRateOverrides() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("office_rate_overrides").select("*");
  if (error) throw error;
  const m = new Map();
  (data || []).forEach((r) => {
    const off = r.office_id;
    if (!m.has(off)) m.set(off, new Map());
    m.get(off).set(`${r.from_currency}_${r.to_currency}`, {
      rate: num(r.rate),
      baseRate: num(r.base_rate),
      spreadPercent: num(r.spread_percent),
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    });
  });
  return m;
}

// ---------- rate snapshots ----------

export async function loadRateSnapshots() {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("rate_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    timestamp: r.created_at,
    officeId: r.office_id,
    createdBy: r.created_by,
    reason: r.reason || "",
    rates: r.rates || {},
    pairsCount: r.pairs_count,
  }));
}

// ---------- expenses (income/expense entries) ----------

export async function loadExpenses() {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("expenses")
    .select("*, categories(name)")
    .order("entry_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    type: r.type,
    officeId: r.office_id,
    accountId: r.account_id,
    category: r.categories?.name || "",
    categoryId: r.category_id,
    amount: num(r.amount),
    currency: r.currency_code,
    date: r.entry_date,
    note: r.note || "",
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

// ---------- audit log ----------

export async function loadAuditLog() {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    timestamp: r.created_at,
    userId: r.user_id,
    userName: r.user_name || "",
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id || "",
    summary: r.summary || "",
    ip: r.ip || "",
  }));
}

// ---------- users + current user profile ----------

export async function loadUsers() {
  const sb = ensureSupabase();
  const { data, error } = await sb.from("users").select("*");
  if (error) throw error;
  return (data || []).map(mapUser);
}

// pending_invites — заявки на приглашение, для которых auth.users ещё не
// создался (magic-link не клацнули или OTP упал). UsersTab показывает их
// отдельной секцией, чтобы админ видел "что отправлено, но не доехало".
export async function loadPendingInvites() {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("pending_invites")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    email: r.email,
    fullName: r.full_name || "",
    role: r.role || "manager",
    officeId: r.office_id || null,
    invitedBy: r.invited_by || null,
    createdAt: r.created_at,
  }));
}

export function mapUser(r) {
  const fullName = r.full_name || r.email || "User";
  const initials = fullName
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return {
    id: r.id,
    name: fullName,
    initials,
    email: r.email || "",
    role: r.role,
    officeId: r.office_id || null,
    status: r.status,
    passwordSet: r.password_set === true,
    inviteToken: r.invite_token || "",
    invitedAt: r.invited_at,
    activatedAt: r.activated_at,
    active: r.status !== "disabled",
    createdAt: r.created_at?.slice(0, 10) || null,
    preferences: r.preferences && typeof r.preferences === "object" ? r.preferences : {},
  };
}

export async function loadCurrentUserProfile(authUserId) {
  if (!authUserId) return null;
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from("users")
    .select("*")
    .eq("id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapUser(data) : null;
}
