// src/pages/counterparties/ListTab.jsx
// Объединённый список клиентов и партнёров — заменяет отдельные Clients
// и Counterparties (PartnersTab) страницы как top-level раздел. Партнёры
// продолжают редактироваться через Settings → Партнёры (там CRUD счетов
// партнёра); здесь — обзор + быстрый профиль клиента.
//
// Шаг 2.1: профиль партнёра пока не открывается из ряда (заглушка с
// подсказкой). Унифицированный профиль будет в 2.2.

import React, { useMemo, useState, useCallback } from "react";
import {
  Search, Send, Phone, Users, Handshake, Archive, Trash2, ArchiveRestore, UserPlus,
} from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { usePartners } from "../../store/partners.jsx";
import { useWallets } from "../../store/wallets.jsx";
import { useObligations } from "../../store/obligations.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
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

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // all | client | partner
  const [archiveFilter, setArchiveFilter] = useState("active"); // active | archived | all
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

  const totalVolume = useMemo(
    () => clientRows.reduce((s, r) => s + (r.volume || 0), 0),
    [clientRows]
  );
  const totalDeals = useMemo(
    () => clientRows.reduce((s, r) => s + (r.deals || 0), 0),
    [clientRows]
  );

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

  return (
    <div className="space-y-5">
      {/* Subtitle row — counts */}
      <div className="text-[12.5px] text-slate-500">
        {counts.all} {t("cp_total")} · {counts.client} {t("cp_clients_lc")} · {counts.partner} {t("cp_partners_lc")} · {totalDeals} {t("cp_deals_lc")} · {sym}{fmt(totalVolume, base)} {t("cp_volume_lc")}
      </div>

      {/* Filters bar */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeChip
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
              count={counts.all}
              icon={null}
            >
              {t("cp_type_all")}
            </TypeChip>
            <TypeChip
              active={typeFilter === "client"}
              onClick={() => setTypeFilter("client")}
              count={counts.client}
              icon={<Users className="w-3 h-3" />}
              tone="emerald"
            >
              {t("cp_type_clients")}
            </TypeChip>
            <TypeChip
              active={typeFilter === "partner"}
              onClick={() => setTypeFilter("partner")}
              count={counts.partner}
              icon={<Handshake className="w-3 h-3" />}
              tone="indigo"
            >
              {t("cp_type_partners")}
            </TypeChip>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("cp_search_ph")}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/70 focus:bg-white focus:border-slate-300 rounded-[8px] text-[13px] outline-none w-64 transition-colors placeholder:text-slate-400"
              />
            </div>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px] gap-0.5">
              {[
                { id: "active", label: t("client_filter_active") },
                {
                  id: "archived",
                  label: `${t("client_filter_archived")}${archivedCount > 0 ? ` (${archivedCount})` : ""}`,
                },
                { id: "all", label: t("client_filter_all") },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setArchiveFilter(o.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-[6px] transition-all ${
                    archiveFilter === o.id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors shadow-[0_4px_14px_-4px_rgba(16,185,129,0.5)]"
              title="Добавить нового клиента"
            >
              <Users className="w-3 h-3" />
              + Клиента
            </button>
            <button
              onClick={() => setAddPartnerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 transition-colors shadow-[0_4px_14px_-4px_rgba(99,102,241,0.5)]"
              title="Добавить нового партнёра (контрагента для OTC сделок)"
            >
              <Handshake className="w-3 h-3" />
              + Партнёра
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-5 py-2.5 font-bold">{t("cp_col_name")}</th>
                <th className="px-3 py-2.5 font-bold">{t("cp_col_type")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("cp_col_activity")}</th>
                <th className="px-3 py-2.5 font-bold text-right hidden sm:table-cell">{t("cp_col_volume")}</th>
                <th className="px-3 py-2.5 font-bold text-right hidden md:table-cell">{t("cp_col_net")}</th>
                <th className="px-5 py-2.5 font-bold hidden lg:table-cell">{t("cp_col_last_activity")}</th>
                <th className="px-3 py-2.5 font-bold w-24 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Row
                  key={`${r.kind}:${r.id || r.nickname}`}
                  row={r}
                  base={base}
                  sym={sym}
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
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    {search
                      ? t("cp_no_match")
                      : archiveFilter === "archived"
                      ? t("cp_no_archived")
                      : t("cp_no_yet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
        onSubmit={async (data) => {
          if (isSupabaseConfigured) {
            const res = await withToast(
              () =>
                insertClient({
                  nickname: data.nickname,
                  fullName: data.name,
                  telegram: data.telegram,
                  tag: data.tag,
                  note: data.note,
                }),
              { success: "Client added", errorPrefix: "Failed to add client" }
            );
            setAddOpen(false);
            if (res.ok && res.result?.id) setProfileFor({ kind: "client", id: res.result.id });
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

function Row({ row, base, sym, onClick, onArchive, onDelete, busy, t }) {
  const initials = row.name
    .split(/\s+/)
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const isClient = row.kind === "client";
  const clickable = isClient && !!row.id;
  const showActions = isClient && row.id && isUuid(row.id);

  return (
    <tr
      onClick={clickable ? onClick : undefined}
      className={`group border-b border-slate-100 hover:bg-slate-50 transition-colors ${
        clickable ? "cursor-pointer" : "cursor-default"
      } ${row.archived ? "opacity-60" : ""}`}
    >
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${
              isClient
                ? "bg-gradient-to-br from-slate-200 to-slate-300 text-slate-700"
                : "bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700"
            }`}
          >
            {initials}
          </div>
          <div>
            <div className="font-semibold text-slate-900 text-[13px] flex items-center gap-1.5">
              {row.name}
              {isClient && <ClientTag tag={row.tag} size="xs" />}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              {row.telegram && (
                <span className="inline-flex items-center gap-0.5 text-sky-600">
                  <Send className="w-2.5 h-2.5" />
                  {row.telegram}
                </span>
              )}
              {row.phone && (
                <span className="inline-flex items-center gap-0.5">
                  <Phone className="w-2.5 h-2.5" />
                  {row.phone}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <TypeBadge kind={row.kind} t={t} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-semibold">
        {row.deals == null ? <span className="text-slate-300">—</span> : row.deals}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-slate-700 hidden sm:table-cell">
        {row.volume == null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <>{sym}{fmt(row.volume, base)}</>
        )}
      </td>
      <td className="px-3 py-3 text-right tabular-nums hidden md:table-cell">
        {row.net == null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span
            className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold ${
              row.net >= 0
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
            }`}
          >
            {row.net >= 0 ? "+" : ""}{sym}{fmt(row.net, base)}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-slate-500 text-[12px] tabular-nums whitespace-nowrap hidden lg:table-cell">
        {row.lastActivity || "—"}
      </td>
      <td
        className="px-3 py-3 text-right whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        {showActions ? (
          <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {row.archived ? (
              <button
                onClick={() => onArchive(false)}
                disabled={busy}
                title={t("client_restore_tip")}
                className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => onArchive(true)}
                disabled={busy}
                title={t("client_archive_tip")}
                className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onDelete}
              disabled={busy || (row.deals || 0) > 0}
              title={
                (row.deals || 0) > 0
                  ? t("client_delete_blocked_tip").replace("{n}", String(row.deals))
                  : t("client_delete_tip")
              }
              className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-slate-300 italic">—</span>
        )}
      </td>
    </tr>
  );
}

function TypeBadge({ kind, t }) {
  if (kind === "client") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
        <Users className="w-2.5 h-2.5" />
        {t("cp_type_client_badge")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
      <Handshake className="w-2.5 h-2.5" />
      {t("cp_type_partner_badge")}
    </span>
  );
}

function TypeChip({ active, onClick, count, icon, tone = "slate", children }) {
  const toneActive = {
    slate: "bg-slate-900 text-white border-slate-900",
    emerald: "bg-emerald-600 text-white border-emerald-600",
    indigo: "bg-indigo-600 text-white border-indigo-600",
  }[tone];
  const toneIdle = {
    slate: "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
    emerald: "bg-white text-emerald-700 border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50",
    indigo: "bg-white text-indigo-700 border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border text-[12px] font-semibold transition-colors ${
        active ? toneActive : toneIdle
      }`}
    >
      {icon}
      <span>{children}</span>
      <span
        className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
          active ? "bg-white/20" : "bg-slate-100"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
