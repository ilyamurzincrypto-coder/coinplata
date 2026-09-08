// src/pages/counterparties/ListTab.jsx
// Объединённый список клиентов и партнёров — заменяет отдельные Clients
// и Counterparties (PartnersTab) страницы как top-level раздел. Партнёры
// продолжают редактироваться через Settings → Партнёры (там CRUD счетов
// партнёра); здесь — обзор + быстрый профиль клиента.
//
// Шаг 2.1: профиль партнёра пока не открывается из ряда (заглушка с
// подсказкой). Унифицированный профиль будет в 2.2.

import React, { useMemo, useState, useCallback } from "react";
import { Search, Plus, ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { usePartners } from "../../store/partners.jsx";
import { useWallets } from "../../store/wallets.jsx";
import { useObligations } from "../../store/obligations.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useLedger } from "../../store/ledger.jsx";
import { rpcCreateClientWithLiab } from "../../lib/newLedger.js";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { ClientTag } from "../../components/CounterpartySelect.jsx";
import { ClientProfileModal } from "../../components/clients/ClientProfileModal.jsx";
import { PartnerProfileModal } from "../../components/clients/PartnerProfileModal.jsx";
import AddClientModal from "../../components/clients/AddClientModal.jsx";
import AddPartnerModal from "../../components/clients/AddPartnerModal.jsx";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import {
  rpcArchiveClient, rpcDeleteClient, updateClientRow, withToast, isUuid, insertClient,
} from "../../lib/supabaseWrite.js";

export default function ListTab() {
  const { t } = useTranslation();
  const {
    transactions,
    counterparties,
    addCounterparty,
    updateCounterparty: updateCounterpartyLocal,
  } = useTransactions();
  const { partners } = usePartners();
  const { walletsByClient } = useWallets();
  const { obligations } = useObligations();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);
  // Ledger-контекст для «Расчётных счетов» клиента в карточке (слайс 1.5.f).
  const { accounts: ledgerAccounts, balances: ledgerBalances, entries: ledgerEntries, transactions: ledgerTransactions } = useLedger();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | client | partner
  const [archiveFilter, setArchiveFilter] = useState("active"); // active | archived | all
  const [archiveMenu, setArchiveMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  // profileFor: { kind: 'client'|'partner', id } — раздельный модал на тип
  const [profileFor, setProfileFor] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addPartnerOpen, setAddPartnerOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const updateCounterparty = useCallback((id, patch) => {
    updateCounterpartyLocal(id, patch);
    if (isSupabaseConfigured && isUuid(id)) {
      updateClientRow(id, patch).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[updateCounterparty DB]", err);
      });
    }
  }, [updateCounterpartyLocal]);

  // === Aggregate clients (1:1 с ClientsPage логикой) ===
  const clientRows = useMemo(() => {
    const bucket = new Map();
    transactions.forEach((tx) => {
      const cp = (tx.counterparty || "").trim();
      if (!cp) return;
      if (!bucket.has(cp)) {
        bucket.set(cp, { nickname: cp, txs: [], volume: 0, profit: 0 });
      }
      const b = bucket.get(cp);
      b.txs.push(tx);
      b.volume += toBase(tx.amtIn, tx.curIn);
      b.profit += toBase(tx.profit || 0, "USD");
    });

    const rows = [];
    bucket.forEach((b) => {
      const meta = counterparties.find(
        (c) => c.nickname.toLowerCase() === b.nickname.toLowerCase()
      );
      const lastDealDate = b.txs
        .map((t) => toISODate(t.date) + " " + (t.time || ""))
        .sort()
        .pop();
      rows.push({
        kind: "client",
        id: meta?.id || null,
        nickname: b.nickname,
        name: meta?.name || b.nickname,
        telegram: meta?.telegram || "",
        phone: "",
        tag: meta?.tag || "",
        note: meta?.note || "",
        archived: !!meta?.archivedAt,
        deals: b.txs.length,
        volume: b.volume,
        net: b.profit, // LTV для клиента
        lastActivity: lastDealDate || "",
      });
    });

    // counterparties без сделок (только-что созданных)
    counterparties.forEach((cp) => {
      if (rows.some((r) => r.kind === "client" && r.nickname.toLowerCase() === cp.nickname.toLowerCase())) return;
      rows.push({
        kind: "client",
        id: cp.id,
        nickname: cp.nickname,
        name: cp.name || cp.nickname,
        telegram: cp.telegram || "",
        phone: "",
        tag: cp.tag || "",
        note: cp.note || "",
        archived: !!cp.archivedAt,
        deals: 0,
        volume: 0,
        net: 0,
        lastActivity: "",
      });
    });
    return rows;
  }, [transactions, counterparties, toBase]);

  // === Partners → unified row shape ===
  const partnerRows = useMemo(() => {
    return partners.map((p) => ({
      kind: "partner",
      id: p.id,
      nickname: p.name,
      name: p.name,
      telegram: p.telegram || "",
      phone: p.phone || "",
      tag: "",
      note: p.note || "",
      archived: p.active === false,
      // OTC-метрики появятся в 2.2 когда подключим аггрегацию по deals.kind='otc'
      deals: null,
      volume: null,
      net: null,
      lastActivity: (p.updatedAt || p.createdAt || "").slice(0, 10),
    }));
  }, [partners]);

  const merged = useMemo(
    () => [...clientRows, ...partnerRows],
    [clientRows, partnerRows]
  );

  const counts = useMemo(
    () => ({
      all: merged.length,
      client: clientRows.length,
      partner: partnerRows.length,
    }),
    [merged, clientRows, partnerRows]
  );

  const archivedCount = useMemo(
    () => merged.filter((r) => r.archived).length,
    [merged]
  );

  const filtered = useMemo(() => {
    let rows = merged;
    if (typeFilter !== "all") rows = rows.filter((r) => r.kind === typeFilter);
    if (archiveFilter === "active") rows = rows.filter((r) => !r.archived);
    else if (archiveFilter === "archived") rows = rows.filter((r) => r.archived);

    if (search.trim()) {
      const q = search.trim().toLowerCase().replace(/^@/, "");
      rows = rows.filter((r) => {
        const tg = (r.telegram || "").toLowerCase().replace(/^@/, "");
        return (
          r.name.toLowerCase().includes(q) ||
          r.nickname.toLowerCase().includes(q) ||
          tg.includes(q) ||
          (r.phone || "").toLowerCase().includes(q)
        );
      });
    }

    return rows.sort((a, b) => {
      // Партнёры с null volume в конце своей категории
      const av = a.volume ?? -1;
      const bv = b.volume ?? -1;
      return bv - av;
    });
  }, [merged, typeFilter, archiveFilter, search]);

  // Сводка в шапке — ЗА МЕСЯЦ, как обещает подпись эталона. Считать её по всей
  // истории значило бы подписать «за месяц» под числом за всё время: цифра
  // выглядит правдоподобно, и ошибку никто не заметит.
  const monthStartMs = useMemo(() => Date.now() - 30 * 24 * 3600 * 1000, []);
  const monthStats = useMemo(() => {
    let deals = 0;
    let volume = 0;
    transactions.forEach((tx) => {
      if (!(tx.counterparty || "").trim()) return;
      const ts = new Date(`${toISODate(tx.date)}T${tx.time || "00:00"}`).getTime();
      if (!Number.isFinite(ts) || ts < monthStartMs) return;
      deals += 1;
      volume += toBase(tx.amtIn, tx.curIn);
    });
    return { deals, volume };
  }, [transactions, monthStartMs, toBase]);

  const handleArchive = async (row, archive = true) => {
    if (row.kind !== "client") return;
    if (!row.id || !isUuid(row.id)) return;
    if (busyId) return;
    setBusyId(row.id);
    try {
      if (isSupabaseConfigured) {
        await withToast(
          () => rpcArchiveClient(row.id, archive),
          {
            success: archive ? t("toast_client_archived") : t("toast_client_restored"),
            errorPrefix: archive ? t("err_archive_client") : t("err_restore_client"),
          }
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row) => {
    if (row.kind !== "client") return;
    if (!row.id || !isUuid(row.id)) return;
    if ((row.deals || 0) > 0) return;
    if (busyId) return;
    if (!confirm(t("client_delete_confirm").replace("{name}", row.name))) return;
    setBusyId(row.id);
    try {
      if (isSupabaseConfigured) {
        await withToast(
          () => rpcDeleteClient(row.id),
          { success: t("toast_client_deleted"), errorPrefix: t("err_delete_client") }
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  // Колонки убираются по одной, начиная с наименее нужной. Имя не ужимается
  // никогда: строка без имени бесполезна, а именно оно схлопывается первым,
  // когда фиксированные колонки не влезают.
  const GRID =
    "grid-cols-[minmax(0,1fr)_88px_34px] " +
    "sm:grid-cols-[minmax(0,1fr)_100px_120px_34px] " +
    "xl:grid-cols-[minmax(240px,1.6fr)_90px_120px_120px_150px_40px]";

  return (
    <div>
      {/* Сводка — под заголовком страницы, как в эталоне. */}
      <div className="text-[13px] text-muted -mt-1.5 mb-3.5">
        <b className="text-ink font-semibold">{counts.all}</b> {t("cp_total")} ·{" "}
        {counts.client} {t("cp_clients_lc")} · {counts.partner} {t("cp_partners_lc")} ·{" "}
        {t("cp_per_month") || "за месяц"}{" "}
        <b className="text-ink font-semibold">{monthStats.deals} {t("cp_deals_lc")}</b> ·{" "}
        {t("cp_volume_lc")} <b className="text-ink font-semibold">{sym}{fmt(monthStats.volume, base)}</b>
      </div>

      <section className="bg-cream-2 rounded-[26px] p-2">
        <div className="flex items-center gap-2 flex-wrap px-2.5 py-2.5">
          {/* Сегмент типа со счётчиками */}
          <div className="flex gap-0.5 bg-surface border border-line rounded-full p-[3px]">
            {[
              { id: "all", label: t("cp_type_all"), n: counts.all },
              { id: "client", label: t("cp_type_clients"), n: counts.client },
              { id: "partner", label: t("cp_type_partners"), n: counts.partner },
            ].map((o) => {
              const on = typeFilter === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setTypeFilter(o.id)}
                  className={`px-[15px] py-[7px] rounded-full font-medium transition-colors ${
                    on ? "bg-dark text-cream" : "text-ink-soft hover:bg-cream-2"
                  }`}
                >
                  {o.label}
                  <b className={`ml-1.5 text-[12px] font-semibold ${on ? "text-cream/60" : "text-muted-soft"}`}>
                    {o.n}
                  </b>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-[200px] max-w-[360px] flex items-center gap-2.5 bg-surface border border-line rounded-full px-[15px] py-2.5">
            <Search className="w-3.5 h-3.5 text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cp_search_ph")}
              className="w-full bg-transparent border-none outline-none text-[13px] placeholder:text-muted-soft"
            />
          </div>

          {/* Архив — одной кнопкой с меню: три пилюли занимали место ради
              состояния, которое переключают раз в месяц. */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setArchiveMenu((v) => !v)}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-ink px-3.5 py-2.5 rounded-full hover:bg-[rgba(26,25,21,.05)] transition-colors"
            >
              {archiveFilter === "active"
                ? t("client_filter_active")
                : archiveFilter === "archived"
                ? `${t("client_filter_archived")}${archivedCount > 0 ? ` (${archivedCount})` : ""}`
                : t("client_filter_all")}
              <ChevronDown className="w-3 h-3" strokeWidth={2.2} />
            </button>
            {archiveMenu && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[190px] bg-surface border border-line rounded-[18px] shadow-[0_14px_40px_rgba(26,25,21,.16)] p-1.5">
                {[
                  { id: "active", label: t("client_filter_active") },
                  { id: "archived", label: `${t("client_filter_archived")}${archivedCount > 0 ? ` (${archivedCount})` : ""}` },
                  { id: "all", label: t("client_filter_all") },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setArchiveFilter(o.id); setArchiveMenu(false); }}
                    className={`flex w-full text-left px-3.5 py-2.5 rounded-xl font-medium transition-colors ${
                      archiveFilter === o.id ? "bg-cream-2 text-ink" : "text-ink-soft hover:bg-cream-2"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* «Добавить» — одна кнопка на оба типа: клиент и партнёр заводятся
              разными формами, но для кассира это одно действие. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddMenu((v) => !v)}
              className="inline-flex items-center gap-2 bg-lime text-lime-ink px-5 py-2.5 rounded-full font-semibold hover:brightness-[1.03] transition-[filter]"
            >
              <Plus className="w-4 h-4" strokeWidth={2.6} />
              {t("cp_add") || "Добавить"}
            </button>
            {addMenu && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] bg-surface border border-line rounded-[18px] shadow-[0_14px_40px_rgba(26,25,21,.16)] p-1.5">
                <button
                  type="button"
                  onClick={() => { setAddMenu(false); setAddOpen(true); }}
                  className="flex w-full text-left px-3.5 py-2.5 rounded-xl font-medium text-ink-soft hover:bg-cream-2 hover:text-ink transition-colors"
                >
                  {t("cp_add_client") || "Клиента"}
                </button>
                <button
                  type="button"
                  onClick={() => { setAddMenu(false); setAddPartnerOpen(true); }}
                  className="flex w-full text-left px-3.5 py-2.5 rounded-xl font-medium text-ink-soft hover:bg-cream-2 hover:text-ink transition-colors"
                >
                  {t("cp_add_partner") || "Партнёра"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={`grid ${GRID} gap-3.5 items-center px-[18px] py-2 text-[11.5px] text-muted`}>
          <div>{t("cp_col_name")}</div>
          <div className="text-right hidden xl:block">{t("cp_col_activity")}</div>
          <div className="text-right hidden xl:block">{t("cp_col_volume")}</div>
          <div className="text-right">{t("cp_col_net")}</div>
          <div className="text-right hidden sm:block">{t("cp_col_last_activity")}</div>
          <div />
        </div>

        <div className="bg-surface rounded-[18px] overflow-hidden">
          {filtered.map((r) => (
            <Row
              key={`${r.kind}:${r.id || r.nickname}`}
              row={r}
              base={base}
              sym={sym}
              grid={GRID}
              onClick={() => {
                if (!r.id) return;
                setProfileFor({ kind: r.kind, id: r.id });
              }}
              onArchive={(archive) => handleArchive(r, archive)}
              onDelete={() => handleDelete(r)}
              busy={busyId === r.id}
              t={t}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-5 py-12 text-center text-[13px] text-muted-soft">
              {search
                ? t("cp_no_match")
                : archiveFilter === "archived"
                ? t("cp_no_archived")
                : t("cp_no_yet")}
            </div>
          )}
        </div>
      </section>

      <AddPartnerModal
        open={addPartnerOpen}
        onClose={() => setAddPartnerOpen(false)}
        onSuccess={(created) => {
          setAddPartnerOpen(false);
          if (created?.id) setProfileFor({ kind: "partner", id: created.id });
        }}
      />

      <AddClientModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        ledgerCtx={{ accounts: ledgerAccounts, balances: ledgerBalances }}
        onSubmit={async (data) => {
          if (isSupabaseConfigured) {
            // 1.5.f: атомарно клиент + Лоро-счета (гейт валют на сервере, человеческий отказ).
            const res = await withToast(
              () =>
                rpcCreateClientWithLiab({
                  nickname: data.nickname,
                  fullName: data.name,
                  telegram: data.telegram,
                  tag: data.tag,
                  note: data.note,
                  referrerId: data.referrerId,
                  currencies: data.currencies,
                }),
              { success: "Клиент добавлен", errorPrefix: "Не удалось добавить клиента" }
            );
            setAddOpen(false);
            if (res.ok && res.result?.clientId) setProfileFor({ kind: "client", id: res.result.clientId });
            return;
          }
          const created = addCounterparty(data);
          setAddOpen(false);
          if (created?.id) setProfileFor({ kind: "client", id: created.id });
        }}
      />

      {/* Profile modals — раздельные на client / partner. Клик по строке выбирает */}
      <ClientProfileModal
        clientId={profileFor?.kind === "client" ? profileFor.id : null}
        onClose={() => setProfileFor(null)}
        counterparties={counterparties}
        transactions={transactions}
        walletsByClient={walletsByClient}
        updateCounterparty={updateCounterparty}
        obligations={obligations}
        base={base}
        sym={sym}
        toBase={toBase}
        ledgerCtx={{ accounts: ledgerAccounts, balances: ledgerBalances, entries: ledgerEntries, transactions: ledgerTransactions }}
      />
      <PartnerProfileModal
        partnerId={profileFor?.kind === "partner" ? profileFor.id : null}
        onClose={() => setProfileFor(null)}
        base={base}
        sym={sym}
        toBase={toBase}
      />
    </div>
  );
}

/**
 * Активность по-человечески: «сегодня · 14:03», «вчера», «3 дн назад».
 *
 * Сырая метка «2001-04-20 12:58» формально точнее, но по ней не видно
 * главного — насколько давно это было; а именно за этим в колонку и смотрят.
 * Дальше месяца показываем дату: «3 дн назад» там уже не помогает.
 */
export function formatActivity(raw, t, now = Date.now()) {
  if (!raw) return "";
  const iso = String(raw).trim().replace(" ", "T");
  const ts = new Date(iso.length <= 10 ? `${iso}T00:00` : iso).getTime();
  if (!Number.isFinite(ts)) return String(raw);

  const dayMs = 86400000;
  const startOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOf(now) - startOf(ts)) / dayMs);
  const hhmm = new Date(ts).toTimeString().slice(0, 5);
  const hasTime = String(raw).trim().length > 10 && hhmm !== "00:00";

  if (days === 0) return hasTime ? `${t("cp_today") || "сегодня"} · ${hhmm}` : (t("cp_today") || "сегодня");
  if (days === 1) return t("cp_yesterday") || "вчера";
  if (days > 1 && days <= 30) return (t("cp_days_ago") || "{n} дн назад").replace("{n}", String(days));
  return new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * Строка контрагента.
 *
 * Архив и удаление уехали из строки в профиль: hover-иконки на строке, которая
 * вся кликабельна, — способ архивировать клиента вместо того чтобы его открыть.
 */
function Row({ row, base, sym, grid, onClick, onArchive, onDelete, busy, t }) {
  const [menu, setMenu] = useState(false);
  const initials = (row.name || row.nickname || "")
    .split(/\s+/)
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const isPartner = row.kind === "partner";
  const clickable = !!row.id;
  // Подпись под именем: телеграм или телефон, что есть.
  const contact = row.telegram
    ? (row.telegram.startsWith("@") ? row.telegram : `@${row.telegram}`)
    : row.phone || "";
  const zero = !row.deals && !row.volume;
  const showActions = row.kind === "client" && row.id && isUuid(row.id);

  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`grid ${grid} gap-3.5 items-center px-[18px] py-[5px] min-h-[52px] border-b border-line last:border-b-0 transition-colors ${
        clickable ? "cursor-pointer hover:bg-[rgba(26,25,21,.02)]" : ""
      } ${row.archived ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`w-8 h-8 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${
            isPartner ? "bg-dark text-lime" : "bg-cream-2 text-ink-soft"
          }`}
        >
          {initials}
        </span>
        <div className="min-w-0">
          <b className="block text-[13.5px] font-semibold truncate">
            {row.name}
            {isPartner && (
              <em className="not-italic font-semibold text-warning ml-2 text-[12px]">
                {t("cp_type_partner_badge")}
              </em>
            )}
          </b>
          {contact && (
            <span className="block text-[11.5px] text-muted font-mono truncate">{contact}</span>
          )}
        </div>
      </div>

      <div className={`text-right tabular-nums text-[13px] hidden xl:block ${zero ? "text-muted-soft" : "text-ink-soft"}`}>
        {row.deals == null ? "—" : row.deals}
      </div>

      <div className={`text-right tabular-nums text-[13px] hidden xl:block ${zero ? "text-muted-soft" : "text-ink-soft"}`}>
        {row.volume == null ? "—" : `${sym}${fmt(row.volume, base)}`}
      </div>

      <div className="text-right tabular-nums text-[13px] whitespace-nowrap">
        {row.net == null || zero ? (
          <span className="text-muted-soft">—</span>
        ) : (
          <span className={row.net >= 0 ? "text-success font-semibold" : "text-warning font-semibold"}>
            {row.net >= 0 ? "+" : "−"}{sym}{fmt(Math.abs(row.net), base)}
          </span>
        )}
      </div>

      <div className={`text-right text-[12.5px] whitespace-nowrap hidden sm:block ${row.lastActivity ? "text-muted" : "text-muted-soft"}`}>
        {formatActivity(row.lastActivity, t) || "—"}
      </div>

      {/* В покое — только шеврон, как в эталоне. Архив и удаление живут в
          меню: убрать их совсем было нельзя — в профиле клиента этих действий
          нет, и они пропали бы из кассы вовсе. */}
      <div className="justify-self-end relative" onClick={(e) => e.stopPropagation()}>
        {showActions && menu && (
          <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[190px] bg-surface border border-line rounded-[16px] shadow-[0_14px_40px_rgba(26,25,21,.16)] p-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => { setMenu(false); onArchive(!row.archived ? true : false); }}
              className="flex w-full text-left px-3.5 py-2.5 rounded-xl font-medium text-ink-soft hover:bg-cream-2 hover:text-ink disabled:opacity-40 transition-colors"
            >
              {row.archived ? t("client_restore_tip") : t("client_archive_tip")}
            </button>
            <button
              type="button"
              disabled={busy || (row.deals || 0) > 0}
              title={(row.deals || 0) > 0 ? t("client_delete_blocked_tip").replace("{n}", String(row.deals)) : ""}
              onClick={() => { setMenu(false); onDelete(); }}
              className="flex w-full text-left px-3.5 py-2.5 rounded-xl font-medium text-danger hover:bg-danger-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t("client_delete_tip")}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={(e) => {
            if (!showActions) { onClick?.(); return; }
            e.stopPropagation();
            setMenu((v) => !v);
          }}
          className="w-[26px] h-[26px] rounded-full grid place-items-center bg-[rgba(26,25,21,.045)] hover:bg-[rgba(26,25,21,.09)] transition-colors"
          aria-label={showActions ? "Действия" : "Открыть"}
        >
          {menu ? (
            <MoreHorizontal className="w-3.5 h-3.5 text-ink" strokeWidth={2} />
          ) : (
            <ChevronRight className="w-3 h-3 text-ink" strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}

function TypeChip({ active, onClick, count, icon, tone = "slate", children }) {
  const toneActive = {
    slate: "bg-ink text-white border-ink",
    emerald: "bg-emerald-600 text-white border-emerald-600",
    indigo: "bg-indigo-600 text-white border-indigo-600",
  }[tone];
  const toneIdle = {
    slate: "bg-white text-ink-soft border-border-soft hover:border-border hover:bg-surface-soft",
    emerald: "bg-white text-success border-success/20 hover:border-emerald-300 hover:bg-success-soft",
    indigo: "bg-white text-accent border-indigo-200 hover:border-indigo-300 hover:bg-accent-bg",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border text-caption font-semibold transition-colors ${
        active ? toneActive : toneIdle
      }`}
    >
      {icon}
      <span>{children}</span>
      <span
        className={`text-tiny font-bold tabular-nums px-1.5 py-0.5 rounded ${
          active ? "bg-white/20" : "bg-surface-sunk"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
