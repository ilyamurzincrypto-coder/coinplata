// src/components/deal-form/DealClientAutocomplete.jsx
//
// Расширенный autocomplete клиента (Phase 2+):
//   • Поиск по nickname/name/telegram/tag (substring case-insensitive)
//   • Подсветка совпадений через <mark>
//   • "Недавние клиенты" если query пустой (последние 5 за 7 дней)
//   • Per-клиент: dealCount, turnover (USD), last deal amount + age
//   • Цветные balances (positive=success, negative=danger) через useClientBalances
//   • Inline quick-create форма (без отдельного модала)
//   • Keyboard: ↑↓ Enter Esc
//
// Семантика балансов (из useClientBalances):
//   • balance > 0 → мы должны клиенту → зелёный +
//   • balance < 0 → клиент должен нам → красный
//   (та же что в legacy v2 LegRow)

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Search, Plus, X, Star } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useRates } from "../../store/rates.jsx";
import { convert } from "../../utils/convert.js";
import { fmt, curSymbol } from "../../utils/money.js";
import { useClientsBalancesBatch } from "../../hooks/useClientLedgerBalances.js";
import { insertClient } from "../../lib/supabaseWrite.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";

// ── Helpers ────────────────────────────────────────────────────────────
function initialsOf(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || s[0].toUpperCase();
}

const AVATAR_GRADIENTS = [
  "from-rose-400 to-orange-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-600",
  "from-cyan-400 to-blue-600",
  "from-violet-400 to-indigo-600",
  "from-fuchsia-400 to-purple-600",
  "from-pink-400 to-rose-600",
  "from-lime-400 to-emerald-600",
];
function avatarGradient(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

function fmtCompact(value) {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`.replace(/\.0M$/, "M");
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`.replace(/\.0k$/, "k");
  return `${Math.round(v)}`;
}

function relativeTimeRu(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 60) return "только что";
  if (secs < 3600) return `${Math.floor(secs / 60)} мин назад`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} ч назад`;
  const days = Math.floor(secs / 86400);
  if (days < 14) return `${days} дн назад`;
  if (days < 90) return `${Math.floor(days / 7)} нед назад`;
  return `${Math.floor(days / 30)} мес назад`;
}

// Подсветка
function HighlightedText({ text, query }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-warning-soft px-0.5 text-ink font-bold rounded-[2px]">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

export default function DealClientAutocomplete({
  value,
  onChange,
  onSelectClient,
  placeholder = "Имя клиента или контрагента",
  autoFocus = false,
}) {
  const { counterparties, addCounterparty, transactions } = useTransactions();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [mode, setMode] = useState("list"); // "list" | "create"
  const [createTelegram, setCreateTelegram] = useState("");
  const [createIsReferral, setCreateIsReferral] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  // Per-client статистика и last-deal — считаем один раз через memo,
  // получаем Map<lowerNick, { dealCount, turnover, lastAt, lastAmt }>.
  const { base: baseCcy } = useBaseCurrency();
  const { getRate } = useRates();
  const clientStats = useMemo(() => {
    const map = new Map();
    (transactions || []).forEach((tx) => {
      if (tx.status === "deleted") return;
      const nick = (tx.counterparty || "").toLowerCase();
      if (!nick) return;
      const usd = convert(Number(tx.amtIn) || 0, tx.curIn, baseCcy, getRate);
      const txDate = tx.completedAt || tx.createdAt || tx.effectiveDate;
      const cur = map.get(nick) || { count: 0, turnover: 0, lastAt: null, lastAmt: 0 };
      cur.count += 1;
      if (Number.isFinite(usd)) cur.turnover += usd;
      const at = txDate ? new Date(txDate) : null;
      if (at && (!cur.lastAt || at > cur.lastAt)) {
        cur.lastAt = at;
        cur.lastAmt = Number.isFinite(usd) ? usd : 0;
      }
      map.set(nick, cur);
    });
    return map;
  }, [transactions, baseCcy, getRate]);

  // Фильтрация + sort recent-first
  const results = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    const enrich = (c) => {
      const stats = clientStats.get(c.nickname.toLowerCase()) || { count: 0, turnover: 0, lastAt: null, lastAmt: 0 };
      return { ...c, _stats: stats };
    };
    const filtered = !q
      ? counterparties.map(enrich)
      : counterparties
          .filter((c) => {
            const fields = [c.nickname, c.name, c.telegram, c.tag].filter(Boolean).map((s) => s.toLowerCase());
            return fields.some((f) => f.includes(q));
          })
          .map(enrich);
    // Sort: по lastAt desc, потом по count desc
    filtered.sort((a, b) => {
      const aT = a._stats.lastAt?.getTime() || 0;
      const bT = b._stats.lastAt?.getTime() || 0;
      if (aT !== bT) return bT - aT;
      return b._stats.count - a._stats.count;
    });
    return filtered.slice(0, 20);
  }, [counterparties, value, clientStats]);

  // "Недавние клиенты" — за последние 7 дней (когда query пустой)
  const isRecentMode = !value || !value.trim();
  const sectionTitle = isRecentMode ? "Недавние клиенты" : "Совпадения";

  // Batch-балансы из ledger.v_client_balances для всех видимых клиентов.
  // Один SELECT с IN на все ID вместо N запросов.
  const visibleIds = useMemo(() => results.map((c) => c.id).filter(Boolean), [results]);
  const { data: balancesMap } = useClientsBalancesBatch(visibleIds);

  useEffect(() => { setHi(0); }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setMode("list");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selectClient = useCallback((c) => {
    onChange(c.nickname);
    onSelectClient?.(c);
    setOpen(false);
    setMode("list");
    inputRef.current?.blur();
  }, [onChange, onSelectClient]);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const startQuickCreate = useCallback(() => {
    setMode("create");
    setCreateTelegram("");
    setCreateIsReferral(false);
    setCreateError(null);
  }, []);

  const cancelQuickCreate = useCallback(() => {
    setMode("list");
    setCreateError(null);
  }, []);

  // Создание клиента: пишем сразу в БД через insertClient → получаем
  // реальный UUID. Локальный addCounterparty оставляем для UI-fallback
  // когда Supabase не настроен. Тег "referral" не пишем в clients.tag —
  // DB constraint разрешает только VIP/Regular/New/Risky; реферал-флаг
  // живёт отдельно в state DealForm.
  const commitQuickCreate = useCallback(async () => {
    const q = (value || "").trim();
    if (!q) return;
    setCreating(true);
    setCreateError(null);
    try {
      let created = null;
      if (isSupabaseConfigured) {
        const row = await insertClient({
          nickname: q,
          telegram: createTelegram.trim() || "",
          tag: null,
          // DB constraint на clients.tag разрешает только VIP/Regular/New/Risky.
          // Признак реферала сохраняем в note как [referral] чтобы он переживал
          // reload (auto-detect в DealForm.onSelectClient смотрит на note).
          note: createIsReferral ? "[referral]" : "",
        });
        if (row?.id) {
          created = {
            id: row.id,
            nickname: row.nickname || q,
            telegram: row.telegram || createTelegram.trim() || "",
            tag: createIsReferral ? "referral" : "",
            note: row.note || "",
          };
        }
      }
      if (!created) {
        // Fallback (без supabase) — в-памяти
        created = addCounterparty({
          nickname: q,
          telegram: createTelegram.trim() || "",
          tag: createIsReferral ? "referral" : "",
        });
      } else {
        addCounterparty(created); // зеркалим в локальный store для autocomplete
      }
      if (created) selectClient(created);
    } catch (err) {
      setCreateError(err?.message || "Не удалось создать клиента");
    } finally {
      setCreating(false);
    }
  }, [value, createTelegram, createIsReferral, addCounterparty, selectClient]);

  const onKeyDown = useCallback((e) => {
    if (mode === "create") {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelQuickCreate();
      } else if (e.key === "Enter") {
        e.preventDefault();
        commitQuickCreate();
      }
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hi < results.length) selectClient(results[hi]);
      else startQuickCreate();
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }, [mode, open, results, hi, selectClient, startQuickCreate, cancelQuickCreate, commitQuickCreate]);

  const showCreate =
    value &&
    value.trim() &&
    !results.some((c) => c.nickname.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-xl">
      {/* Input */}
      <div className="flex items-center gap-2 h-10 px-3.5 rounded-input bg-surface-sunk ring-1 ring-inset ring-transparent focus-within:bg-surface focus-within:ring-accent focus-within:shadow-input-focus transition-all duration-150 ease-apple">
        <Search className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2.2} />
        <input
          ref={inputRef}
          type="text"
          value={value || ""}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setMode("list"); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-body text-ink placeholder:text-muted-soft outline-none border-0"
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(""); inputRef.current?.focus(); }}
            className="p-0.5 rounded text-muted hover:text-ink hover:bg-surface-soft transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface rounded-card border border-border shadow-soft-deep z-50 overflow-hidden max-h-[460px] overflow-y-auto">
          {mode === "create" ? (
            <QuickCreateForm
              draftName={value}
              telegram={createTelegram}
              onTelegramChange={setCreateTelegram}
              isReferral={createIsReferral}
              onIsReferralChange={setCreateIsReferral}
              onCancel={cancelQuickCreate}
              onCommit={commitQuickCreate}
              busy={creating}
              error={createError}
            />
          ) : (
            <>
              {results.length > 0 && (
                <div className="px-3.5 pt-2 pb-1 text-tiny uppercase tracking-wider font-bold text-muted-soft">
                  {sectionTitle}
                </div>
              )}
              {results.map((c, i) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  query={value}
                  highlighted={i === hi}
                  balances={balancesMap[c.id] || []}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => selectClient(c)}
                />
              ))}
              {results.length === 0 && !showCreate && (
                <div className="px-3.5 py-4 text-center text-caption text-muted">
                  Никого не найдено
                </div>
              )}
              {showCreate && (
                <button
                  type="button"
                  onMouseEnter={() => setHi(results.length)}
                  onClick={startQuickCreate}
                  className={`w-full grid grid-cols-[32px_1fr] items-center gap-3 px-3.5 py-3 border-t border-border-soft transition-colors text-left ${
                    hi === results.length ? "bg-accent-bg" : "hover:bg-accent-bg"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-accent-soft text-success flex items-center justify-center shrink-0">
                    <Plus className="w-4 h-4" strokeWidth={2.2} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-body-sm font-semibold text-ink truncate">
                      Создать клиента «{value.trim()}»
                    </div>
                    <div className="text-tiny text-muted">
                      быстрая форма прямо в сделке
                    </div>
                  </div>
                </button>
              )}
              {/* Keyboard hints footer */}
              <div className="px-3.5 py-1.5 bg-surface-soft text-tiny text-muted flex items-center gap-3 border-t border-border-soft">
                <span><kbd className="px-1 rounded bg-surface border border-border font-mono text-tiny">↑↓</kbd> навигация</span>
                <span><kbd className="px-1 rounded bg-surface border border-border font-mono text-tiny">↵</kbd> выбрать</span>
                <span><kbd className="px-1 rounded bg-surface border border-border font-mono text-tiny">Esc</kbd> закрыть</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── ClientRow ──────────────────────────────────────────────────────────
// balances приходит сверху из batch-запроса useClientsBalancesBatch
// (один SELECT для всех видимых строк) — не вызываем useClientBalances
// per-row чтобы не множить запросы.
function ClientRow({ client, query, highlighted, balances = [], onMouseEnter, onClick }) {
  const stats = client._stats || {};
  const isReferral = !!(client.tag && /referral|реферал/i.test(client.tag));
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`w-full grid grid-cols-[32px_1fr_auto] items-start gap-3 px-3.5 py-2.5 transition-colors text-left ${
        highlighted ? "bg-surface-soft" : "hover:bg-surface-soft"
      }`}
    >
      <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradient(client.nickname || client.id)} text-white text-tiny font-bold flex items-center justify-center shrink-0 mt-0.5`}>
        {initialsOf(client.nickname || client.name)}
      </div>
      <div className="min-w-0 flex flex-col gap-0.5">
        {/* Line 1: name + telegram */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-body-sm font-semibold text-ink truncate">
            <HighlightedText text={client.nickname || client.name || "—"} query={query} />
          </span>
          {client.telegram && (
            <span className="text-tiny text-muted font-mono truncate">
              <HighlightedText text={client.telegram} query={query} />
            </span>
          )}
        </div>
        {/* Line 2: referral + stats */}
        {(isReferral || stats.count > 0) && (
          <div className="flex items-center gap-1.5 text-tiny text-muted">
            {isReferral && (
              <>
                <span className="inline-flex items-center gap-0.5 text-warning font-semibold">
                  <Star className="w-2.5 h-2.5 fill-current" strokeWidth={0} />
                  Реферал
                </span>
                {stats.count > 0 && <span className="text-muted-soft">·</span>}
              </>
            )}
            {stats.count > 0 && (
              <>
                <span className="font-mono tabular">{stats.count} {plural(stats.count)}</span>
                {stats.turnover > 0 && (
                  <>
                    <span className="text-muted-soft">·</span>
                    <span className="font-mono tabular">оборот ${fmtCompact(stats.turnover)}</span>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {/* Line 3: balances из ledger.v_client_balances (через batch hook) */}
        {balances.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-tiny text-muted-soft uppercase tracking-wider font-semibold">баланс:</span>
            {balances.slice(0, 3).map((b) => (
              <span
                key={b.currency}
                className={`text-tiny font-mono tabular font-semibold ${
                  b.balance > 0 ? "text-success" :
                  b.balance < 0 ? "text-danger" :
                  "text-muted-soft"
                }`}
              >
                {b.balance > 0 ? "+" : ""}{fmt(b.balance, b.currency)} {curSymbol(b.currency) || b.currency}
              </span>
            ))}
            {balances.length > 3 && (
              <span className="text-tiny text-muted-soft">…+{balances.length - 3}</span>
            )}
          </div>
        )}
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
        {stats.lastAmt > 0 && (
          <span className="text-tiny font-mono tabular text-ink-soft">
            ${fmtCompact(stats.lastAmt)}
          </span>
        )}
        {stats.lastAt && (
          <span className="text-tiny text-muted-soft">
            {relativeTimeRu(stats.lastAt)}
          </span>
        )}
      </div>
    </button>
  );
}

function plural(n) {
  const last = n % 10;
  const last2 = n % 100;
  if (last2 >= 11 && last2 <= 14) return "сделок";
  if (last === 1) return "сделка";
  if (last >= 2 && last <= 4) return "сделки";
  return "сделок";
}

// ── QuickCreateForm ────────────────────────────────────────────────────
function QuickCreateForm({
  draftName,
  telegram,
  onTelegramChange,
  isReferral,
  onIsReferralChange,
  onCancel,
  onCommit,
  busy = false,
  error = null,
}) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-tiny uppercase tracking-wider font-bold text-muted-soft">
          Новый клиент
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-6 h-6 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-soft transition-colors"
        >
          <X className="w-3 h-3" strokeWidth={2.2} />
        </button>
      </div>
      <div className="space-y-3">
        <Field label="Имя">
          <div className="h-9 px-3 rounded-input bg-surface-sunk flex items-center text-body-sm text-ink font-semibold">
            {draftName?.trim() || "—"}
          </div>
        </Field>
        <Field label="Telegram (опционально)">
          <input
            type="text"
            value={telegram}
            onChange={(e) => onTelegramChange(e.target.value)}
            placeholder="@nickname"
            autoFocus
            className="w-full h-9 px-3 rounded-input bg-surface-sunk text-ink placeholder:text-muted-soft text-body-sm border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:shadow-input-focus focus:outline-none transition-all"
          />
        </Field>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isReferral}
            onChange={(e) => onIsReferralChange(e.target.checked)}
            className="w-4 h-4 accent-accent"
          />
          <span className="text-body-sm text-ink-soft inline-flex items-center gap-1">
            <Star className="w-3 h-3 text-warning" strokeWidth={2} fill={isReferral ? "currentColor" : "none"} />
            Реферальный клиент
          </span>
        </label>
      </div>
      {error && (
        <div className="mt-3 px-2 py-1.5 rounded-card text-caption text-danger bg-danger-soft border border-danger/20">
          {error}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-9 px-3.5 rounded-button bg-surface border border-border text-ink text-caption font-semibold hover:bg-surface-soft disabled:opacity-50 transition-colors"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={!draftName?.trim() || busy}
          className="h-9 px-4 rounded-button bg-ink text-white text-caption font-semibold hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Создаём…" : "Создать и продолжить"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-tiny uppercase tracking-wider font-bold text-muted-soft">{label}</span>
      {children}
    </label>
  );
}
