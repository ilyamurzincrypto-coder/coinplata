// src/pages/ClientsPage.jsx
// Агрегация по counterparty: deals count, volume, avg ticket, LTV, last deal date.
// + простой monthly bar chart общей активности (по всем клиентам).

import React, { useMemo, useState } from "react";
import { Users, Send, Search, BarChart3, UserPlus, X, Network as NetworkIcon, Wallet, Archive, Trash2, ArchiveRestore } from "lucide-react";
import { useTransactions } from "../store/transactions.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useWallets } from "../store/wallets.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { toISODate, monthKey, monthLabel } from "../utils/date.js";
import Modal from "../components/ui/Modal.jsx";
import { ClientTag } from "../components/CounterpartySelect.jsx";
import { CLIENT_TAGS } from "../store/data.js";
import { checkWalletRisk, riskLevelStyle, riskLevelLabel } from "../utils/aml.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcArchiveClient, rpcDeleteClient, withToast, isUuid } from "../lib/supabaseWrite.js";

export default function ClientsPage() {
  const { t } = useTranslation();
  const { transactions, counterparties, addCounterparty, updateCounterparty } = useTransactions();
  const { walletsByClient } = useWallets();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);
  const [search, setSearch] = useState("");
  const [profileFor, setProfileFor] = useState(null); // counterparty id
  const [addOpen, setAddOpen] = useState(false);
  const [archiveFilter, setArchiveFilter] = useState("active"); // active | archived | all
  const [busyId, setBusyId] = useState(null); // клиент над которым сейчас выполняется RPC

  // Агрегация по counterparty nickname
  const clients = useMemo(() => {
    const bucket = new Map();
    transactions.forEach((tx) => {
      const cp = (tx.counterparty || "").trim();
      if (!cp) return;
      if (!bucket.has(cp)) {
        bucket.set(cp, { nickname: cp, txs: [], volume: 0, profit: 0 });
      }
      const b = bucket.get(cp);
      const inBase = toBase(tx.amtIn, tx.curIn);
      b.txs.push(tx);
      b.volume += inBase;
      // tx.profit в USD — нормализуем в base
      b.profit += toBase(tx.profit || 0, "USD");
    });

    const rows = [];
    bucket.forEach((b) => {
      const deals = b.txs.length;
      const avgTicket = deals > 0 ? b.volume / deals : 0;
      // LTV — общая прибыль, которую принёс клиент
      const ltv = b.profit;
      // Найдём мета-данные контрагента если есть в counterparties
      const meta = counterparties.find(
        (c) => c.nickname.toLowerCase() === b.nickname.toLowerCase()
      );
      // Last deal date
      const lastDealDate = b.txs
        .map((t) => toISODate(t.date) + " " + (t.time || ""))
        .sort()
        .pop();

      rows.push({
        id: meta?.id || null,
        nickname: b.nickname,
        name: meta?.name || b.nickname,
        telegram: meta?.telegram || "",
        tag: meta?.tag || "",
        note: meta?.note || "",
        archivedAt: meta?.archivedAt || null,
        deals,
        volume: b.volume,
        profit: b.profit,
        avgTicket,
        ltv,
        lastDealDate,
        txs: b.txs,
      });
    });

    // Также добавим counterparties без сделок (только-что созданных)
    counterparties.forEach((cp) => {
      if (rows.some((r) => r.nickname.toLowerCase() === cp.nickname.toLowerCase())) return;
      rows.push({
        id: cp.id,
        nickname: cp.nickname,
        name: cp.name || cp.nickname,
        telegram: cp.telegram || "",
        tag: cp.tag || "",
        note: cp.note || "",
        archivedAt: cp.archivedAt || null,
        deals: 0,
        volume: 0,
        profit: 0,
        avgTicket: 0,
        ltv: 0,
        lastDealDate: "",
        txs: [],
      });
    });

    return rows.sort((a, b) => b.volume - a.volume);
  }, [transactions, counterparties, toBase]);

  const filtered = useMemo(() => {
    // archive filter первым — не показываем archived в active view и наоборот
    let base = clients;
    if (archiveFilter === "active") base = clients.filter((c) => !c.archivedAt);
    else if (archiveFilter === "archived") base = clients.filter((c) => !!c.archivedAt);
    if (!search.trim()) return base;
    const q = search.trim().toLowerCase().replace(/^@/, "");
    return base.filter(
      (c) =>
        c.nickname.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.telegram.toLowerCase().replace(/^@/, "").includes(q)
    );
  }, [clients, search, archiveFilter]);

  const archivedCount = useMemo(
    () => clients.filter((c) => c.archivedAt).length,
    [clients]
  );

  // Архивация / восстановление / удаление.
  // Доступны только если client имеет DB-id (UUID). Legacy-строки (без id)
  // пропускают — ничего не хранится на бэке.
  const handleArchive = async (client, archive = true) => {
    if (!client?.id || !isUuid(client.id)) return;
    if (busyId) return;
    setBusyId(client.id);
    try {
      if (isSupabaseConfigured) {
        await withToast(
          () => rpcArchiveClient(client.id, archive),
          {
            success: archive ? "Client archived" : "Client restored",
            errorPrefix: archive ? "Archive failed" : "Restore failed",
          }
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (client) => {
    if (!client?.id || !isUuid(client.id)) return;
    if (client.deals > 0) return; // guard — DB тоже защитит, но уважим UI
    if (busyId) return;
    if (!confirm(`Delete client "${client.name}" permanently? This cannot be undone.`))
      return;
    setBusyId(client.id);
    try {
      if (isSupabaseConfigured) {
        await withToast(
          () => rpcDeleteClient(client.id),
          { success: "Client deleted", errorPrefix: "Delete failed" }
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const [chartMetric, setChartMetric] = useState("count"); // count | volume
  const [chartFilter, setChartFilter] = useState("all");   // all | new | returning

  // Monthly activity — классификация new vs returning per месяц.
  // Клиент "new" в месяце M, если первая его сделка вообще — в этом M.
  // Иначе "returning" (был активен в предыдущие месяцы).
  const monthly = useMemo(() => {
    // Группируем транзакции по (clientKey, monthKey), параллельно запоминаем
    // самую раннюю дату каждого клиента — она решает когда клиент "new".
    const firstSeen = new Map(); // clientKey → YYYY-MM
    const perClientMonth = new Map(); // `${client}|${month}` → volume + count

    transactions.forEach((tx) => {
      const cp = (tx.counterparty || "").trim();
      if (!cp) return;
      if (tx.status === "deleted") return;
      const iso = toISODate(tx.date);
      const m = monthKey(iso);
      const key = cp.toLowerCase();
      if (!firstSeen.has(key) || firstSeen.get(key) > m) firstSeen.set(key, m);
      const compKey = `${key}|${m}`;
      if (!perClientMonth.has(compKey)) perClientMonth.set(compKey, { volume: 0, count: 0 });
      const b = perClientMonth.get(compKey);
      b.volume += toBase(tx.amtIn, tx.curIn);
      b.count += 1;
    });

    // Агрегация по месяцам: для каждого (client, month) определяем new/returning.
    const byMonth = {};
    perClientMonth.forEach((val, compKey) => {
      const [client, m] = compKey.split("|");
      const isNew = firstSeen.get(client) === m;
      if (!byMonth[m]) {
        byMonth[m] = { newCount: 0, newVolume: 0, retCount: 0, retVolume: 0 };
      }
      if (isNew) {
        byMonth[m].newCount += 1;
        byMonth[m].newVolume += val.volume;
      } else {
        byMonth[m].retCount += 1;
        byMonth[m].retVolume += val.volume;
      }
    });

    // Последние 6 месяцев (от текущего).
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = d.toISOString().slice(0, 7);
      const b = byMonth[k] || { newCount: 0, newVolume: 0, retCount: 0, retVolume: 0 };
      result.push({
        key: k,
        label: monthLabel(k),
        ...b,
        totalCount: b.newCount + b.retCount,
        totalVolume: b.newVolume + b.retVolume,
      });
    }
    return result;
  }, [transactions, toBase]);

  // Выбор метрики и фильтра — готовим сегменты для стек-чарта.
  const chartData = useMemo(() => {
    return monthly.map((m) => {
      let newVal = chartMetric === "count" ? m.newCount : m.newVolume;
      let retVal = chartMetric === "count" ? m.retCount : m.retVolume;
      if (chartFilter === "new") retVal = 0;
      if (chartFilter === "returning") newVal = 0;
      return { ...m, newVal, retVal, total: newVal + retVal };
    });
  }, [monthly, chartMetric, chartFilter]);

  const chartMax = Math.max(...chartData.map((d) => d.total), 1);

  const totals = useMemo(
    () => ({
      clientsCount: clients.length,
      deals: clients.reduce((s, c) => s + c.deals, 0),
      volume: clients.reduce((s, c) => s + c.volume, 0),
      ltv: clients.reduce((s, c) => s + c.ltv, 0),
    }),
    [clients]
  );

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight">{t("clients_title")}</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {totals.clientsCount} clients · {totals.deals} deals · {sym}{fmt(totals.volume, base)} total volume
        </p>
      </div>

      {/* Monthly activity — stacked new vs returning */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-slate-500" />
            <h2 className="text-[14px] font-semibold tracking-tight">{t("clients_monthly") || "Monthly activity"}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[10px]">
              {[
                { id: "count", label: "Count" },
                { id: "volume", label: "Volume" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setChartMetric(opt.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-[8px] transition-all ${
                    chartMetric === opt.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[10px]">
              {[
                { id: "all", label: "All" },
                { id: "new", label: "New" },
                { id: "returning", label: "Returning" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setChartFilter(opt.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-[8px] transition-all ${
                    chartFilter === opt.id ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-end gap-2 h-40">
          {chartData.map((m) => {
            const newH = (m.newVal / chartMax) * 100;
            const retH = (m.retVal / chartMax) * 100;
            const hasData = m.newVal > 0 || m.retVal > 0;
            const tip =
              chartMetric === "count"
                ? `${m.label}: new ${m.newCount} · returning ${m.retCount}`
                : `${m.label}: new ${sym}${fmt(m.newVolume, base)} · returning ${sym}${fmt(m.retVolume, base)}`;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1 group" title={tip}>
                <div className="flex-1 w-full flex flex-col justify-end relative">
                  {!hasData && (
                    <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-slate-200 rounded" />
                  )}
                  {m.retVal > 0 && (
                    <div
                      className="w-full bg-slate-300 transition-all"
                      style={{ height: `${retH}%` }}
                    />
                  )}
                  {m.newVal > 0 && (
                    <div
                      className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-[4px] transition-all"
                      style={{ height: `${newH}%` }}
                    />
                  )}
                  {hasData && (
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-semibold rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap tabular-nums">
                      {chartMetric === "count"
                        ? `${m.newVal + m.retVal}`
                        : `${sym}${fmt(m.newVal + m.retVal, base)}`}
                    </div>
                  )}
                </div>
                <div className="text-[10px] font-medium text-slate-500 tabular-nums">{m.label}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-4 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-emerald-600 to-emerald-400" />
            New clients (first deal in the month)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-300" />
            Returning
          </span>
        </div>
      </section>

      {/* Clients table */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            <h2 className="text-[15px] font-semibold tracking-tight">All clients</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or @telegram…"
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/70 focus:bg-white focus:border-slate-300 rounded-[8px] text-[13px] outline-none w-64 transition-colors placeholder:text-slate-400"
              />
            </div>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px] gap-0.5">
              {[
                { id: "active", label: "Active" },
                { id: "archived", label: `Archived${archivedCount > 0 ? ` (${archivedCount})` : ""}` },
                { id: "all", label: "All" },
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-slate-900 text-white text-[12px] font-semibold hover:bg-slate-800 transition-colors"
            >
              <UserPlus className="w-3 h-3" />
              Add client
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-5 py-2.5 font-bold">{t("clients_name")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_deals")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_volume")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_avg_ticket")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("clients_ltv")}</th>
                <th className="px-5 py-2.5 font-bold">{t("clients_last_deal")}</th>
                <th className="px-3 py-2.5 font-bold w-24 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.nickname}
                  onClick={() => c.id && setProfileFor(c.id)}
                  className={`group border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${
                    c.archivedAt ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[11px] font-bold text-slate-700">
                        {c.name
                          .split(/\s+/)
                          .map((w) => w[0] || "")
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-[13px] flex items-center gap-1.5">
                          {c.name}
                          <ClientTag tag={c.tag} size="xs" />
                        </div>
                        {c.telegram && (
                          <div className="inline-flex items-center gap-0.5 text-[11px] text-sky-600">
                            <Send className="w-2.5 h-2.5" />
                            {c.telegram}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{c.deals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                    {sym}{fmt(c.volume, base)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                    {sym}{fmt(c.avgTicket, base)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold ${
                        c.ltv >= 0
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {c.ltv >= 0 ? "+" : ""}{sym}{fmt(c.ltv, base)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-[12px] tabular-nums whitespace-nowrap">
                    {c.lastDealDate}
                  </td>
                  <td
                    className="px-3 py-3 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.id && isUuid(c.id) ? (
                      <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {c.archivedAt ? (
                          <button
                            onClick={() => handleArchive(c, false)}
                            disabled={busyId === c.id}
                            title="Restore from archive"
                            className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleArchive(c, true)}
                            disabled={busyId === c.id}
                            title="Archive client (soft-delete, preserves history)"
                            className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={busyId === c.id || c.deals > 0}
                          title={
                            c.deals > 0
                              ? `Client has ${c.deals} deal(s) — cannot hard-delete, archive instead`
                              : "Delete permanently"
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
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    {search
                      ? "No clients match your search"
                      : archiveFilter === "archived"
                      ? "No archived clients"
                      : "No clients yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AddClientModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(data) => {
          const created = addCounterparty(data);
          setAddOpen(false);
          if (created?.id) setProfileFor(created.id);
        }}
      />

      <ClientProfileModal
        clientId={profileFor}
        onClose={() => setProfileFor(null)}
        counterparties={counterparties}
        transactions={transactions}
        walletsByClient={walletsByClient}
        updateCounterparty={updateCounterparty}
        base={base}
        sym={sym}
        toBase={toBase}
      />
    </main>
  );
}

// -------- Add client modal (direct on Clients page) --------
function AddClientModal({ open, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");

  React.useEffect(() => {
    if (open) {
      setName("");
      setTelegram("");
      setTag("");
      setNote("");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    const tg = telegram.trim();
    onSubmit({
      nickname: name.trim(),
      name: name.trim(),
      telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
      tag,
      note: note.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add client" width="md">
      <div className="p-5 space-y-3">
        <FormField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Jane Doe"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
        <FormField label="Telegram (optional)">
          <input
            type="text"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@username"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
        <FormField label="Tag">
          <div className="flex flex-wrap gap-1.5">
            <TagBtn active={!tag} onClick={() => setTag("")}>None</TagBtn>
            {CLIENT_TAGS.map((tg) => (
              <TagBtn key={tg} active={tag === tg} onClick={() => setTag(tg)}>{tg}</TagBtn>
            ))}
          </div>
        </FormField>
        <FormField label="Note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </FormField>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors">Cancel</button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            name.trim() ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >Save</button>
      </div>
    </Modal>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">{label}</label>
      {children}
    </div>
  );
}

function TagBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold border transition-colors ${
        active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

// -------- Client profile modal --------
function ClientProfileModal({ clientId, onClose, counterparties, transactions, walletsByClient, updateCounterparty, base, sym, toBase }) {
  const client = clientId ? counterparties.find((c) => c.id === clientId) : null;
  const [statusFilter, setStatusFilter] = useState("all");
  const [curFilter, setCurFilter] = useState("all");

  const clientTxs = useMemo(() => {
    if (!client) return [];
    return transactions.filter(
      (tx) => (tx.counterparty || "").toLowerCase() === client.nickname.toLowerCase()
    );
  }, [client, transactions]);

  const stats = useMemo(() => {
    let volume = 0, profit = 0;
    clientTxs.forEach((tx) => {
      volume += toBase(tx.amtIn, tx.curIn);
      profit += toBase(tx.profit || 0, "USD");
    });
    const deals = clientTxs.length;
    const avgDeal = deals > 0 ? volume / deals : 0;
    const last = clientTxs
      .map((tx) => toISODate(tx.date) + " " + (tx.time || ""))
      .sort()
      .pop() || "—";
    return { volume, profit, deals, avgDeal, last };
  }, [clientTxs, toBase]);

  const walletGroups = useMemo(() => {
    if (!client) return [];
    const wallets = walletsByClient(client.id);
    const byNetwork = new Map();
    wallets.forEach((w) => {
      const risk = checkWalletRisk(w.address);
      const enriched = { ...w, risk };
      if (!byNetwork.has(w.network)) byNetwork.set(w.network, []);
      byNetwork.get(w.network).push(enriched);
    });
    return Array.from(byNetwork.entries()).map(([network, list]) => ({ network, wallets: list }));
  }, [client, walletsByClient]);

  const clientRisk = useMemo(() => {
    let maxScore = 0;
    let worstLevel = "low";
    const weight = { low: 1, medium: 2, high: 3 };
    walletGroups.forEach((g) => {
      g.wallets.forEach((w) => {
        if (w.risk.riskScore > maxScore) maxScore = w.risk.riskScore;
        if ((weight[w.risk.riskLevel] || 0) > (weight[worstLevel] || 0)) worstLevel = w.risk.riskLevel;
      });
    });
    return { score: maxScore, level: worstLevel };
  }, [walletGroups]);

  const filteredTxs = useMemo(() => {
    return clientTxs.filter((tx) => {
      if (statusFilter !== "all" && (tx.status || "completed") !== statusFilter) return false;
      if (curFilter !== "all") {
        const hasCur = tx.curIn === curFilter || (tx.outputs || []).some((o) => o.currency === curFilter);
        if (!hasCur) return false;
      }
      return true;
    });
  }, [clientTxs, statusFilter, curFilter]);

  const uniqueCurrencies = useMemo(() => {
    const s = new Set();
    clientTxs.forEach((tx) => {
      s.add(tx.curIn);
      (tx.outputs || []).forEach((o) => s.add(o.currency));
    });
    return Array.from(s);
  }, [clientTxs]);

  if (!client) return null;

  return (
    <Modal open={!!client} onClose={onClose} title={client.name || client.nickname} subtitle={client.telegram || "no telegram"} width="2xl">
      <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
        {/* Tag selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tag:</span>
          <TagBtn active={!client.tag} onClick={() => updateCounterparty(client.id, { tag: "" })}>None</TagBtn>
          {CLIENT_TAGS.map((tg) => (
            <TagBtn key={tg} active={client.tag === tg} onClick={() => updateCounterparty(client.id, { tag: tg })}>{tg}</TagBtn>
          ))}
        </div>

        {/* Stats grid + risk */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCard label="Deals" value={stats.deals} />
          <StatCard label="Volume" value={`${sym}${fmt(stats.volume, base)}`} />
          <StatCard label="Profit" value={`${stats.profit >= 0 ? "+" : ""}${sym}${fmt(stats.profit, base)}`} tone={stats.profit >= 0 ? "emerald" : "rose"} />
          <StatCard label="Avg deal" value={`${sym}${fmt(stats.avgDeal, base)}`} />
          <StatCard label="Last" value={stats.last} small />
        </div>
        {walletGroups.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Overall risk:</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ring-1 ${riskLevelStyle(clientRisk.level)}`}>
              {riskLevelLabel(clientRisk.level)} · {clientRisk.score}
            </span>
          </div>
        )}

        {client.note && (
          <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            <span className="font-semibold text-slate-500 uppercase text-[10px] tracking-wider mr-1.5">Note:</span>
            {client.note}
          </div>
        )}

        {/* Wallets */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Wallet className="w-3.5 h-3.5 text-slate-500" />
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">Crypto wallets</h3>
          </div>
          {walletGroups.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic py-2">No wallets detected yet</div>
          ) : (
            <div className="space-y-2">
              {walletGroups.map((g) => (
                <div key={g.network} className="bg-slate-50/60 border border-slate-200 rounded-[10px] p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <NetworkIcon className="w-3 h-3 text-indigo-500" />
                    <span className="text-[11px] font-bold tracking-wider text-slate-700">{g.network}</span>
                    <span className="text-[10px] text-slate-400">· {g.wallets.length}</span>
                  </div>
                  <div className="space-y-1">
                    {g.wallets.map((w) => (
                      <div key={w.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono text-slate-600 truncate flex-1 min-w-0">{w.address}</span>
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ring-1 ${riskLevelStyle(w.risk.riskLevel)}`}
                          title={(w.risk.flags || []).join(", ") || "no flags"}
                        >
                          {riskLevelLabel(w.risk.riskLevel)} · {w.risk.riskScore}
                        </span>
                        <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                          {w.usageCount} tx
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transactions */}
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">Transactions · {clientTxs.length}</h3>
            <div className="flex items-center gap-1">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[11px] font-medium outline-none"
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="checking">Checking</option>
                <option value="pending">Pending</option>
                <option value="deleted">Deleted</option>
              </select>
              <select
                value={curFilter}
                onChange={(e) => setCurFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-[8px] px-2 py-1 text-[11px] font-medium outline-none"
              >
                <option value="all">All currencies</option>
                {uniqueCurrencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          {filteredTxs.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic py-4 text-center">No transactions match filter</div>
          ) : (
            <div className="border border-slate-200 rounded-[10px] overflow-hidden divide-y divide-slate-100">
              {filteredTxs.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-slate-50">
                  <span className="text-slate-400 tabular-nums">{tx.date} {tx.time}</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {fmt(tx.amtIn, tx.curIn)} {tx.curIn}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-slate-900 tabular-nums flex-1">
                    {(tx.outputs || []).map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`).join(" + ")}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{tx.status || "completed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors">Close</button>
      </div>
    </Modal>
  );
}

function StatCard({ label, value, tone, small }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-700 bg-emerald-50 border-emerald-100"
    : tone === "rose" ? "text-rose-700 bg-rose-50 border-rose-100"
    : "text-slate-900 bg-slate-50/60 border-slate-200";
  return (
    <div className={`rounded-[8px] border p-2 ${toneCls}`}>
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`${small ? "text-[11px]" : "text-[15px]"} font-bold tabular-nums leading-tight mt-0.5`}>
        {value}
      </div>
    </div>
  );
}
