// src/pages/settings/PartnersTab.jsx
// CRUD контрагентов (партнёров) для OTC сделок. Доступен из Settings →
// Партнёры. Все могут читать; manager+ могут создавать; admin/owner —
// редактировать и деактивировать.

import React, { useState, useMemo } from "react";
import {
  Handshake, UserPlus, Search, X, Edit2, Trash2, Send, Phone, History as HistoryIcon,
  ChevronDown, ChevronUp, Plus, Banknote, Building2, Coins, Wallet,
  ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { usePartners } from "../../store/partners.jsx";
import { usePartnerAccounts } from "../../store/partnerAccounts.jsx";
import { useAuth } from "../../store/auth.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import PartnerAccountFormModal from "../../components/settings/PartnerAccountFormModal.jsx";
import PartnerAccountHistoryModal from "../../components/settings/PartnerAccountHistoryModal.jsx";
import PartnerSettlementModal from "../../components/settings/PartnerSettlementModal.jsx";
import DeleteDealButton from "../../components/DeleteDealButton.jsx";
import { loadDealsForPartner } from "../../lib/supabaseReaders.js";

const TYPE_ICONS = { cash: Banknote, bank: Building2, crypto: Coins };

export default function PartnersTab() {
  const { partners, addPartner, updatePartner, removePartner } = usePartners();
  const {
    accounts: partnerAccounts,
    balanceOf: partnerBalanceOf,
    accountsByPartner,
    addPartnerAccount,
    updatePartnerAccount,
    removePartnerAccount,
  } = usePartnerAccounts();
  const { isAdmin, isOwner } = useAuth();
  const canEdit = isAdmin || isOwner;
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // Состояние раскрытых партнёров (показ счетов)
  const [expandedSet, setExpandedSet] = useState(() => new Set());
  // Модалки счетов партнёра
  const [accountModalState, setAccountModalState] = useState(null);
  const [historyAccount, setHistoryAccount] = useState(null);
  // { account, partnerName, mode: 'inflow'|'outflow' }
  const [settlementState, setSettlementState] = useState(null);
  // { mode: 'add' | 'edit', partnerId, accountId? }

  const toggleExpanded = (id) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => {
      const hay = [p.name, p.telegram, p.phone, p.note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [partners, query]);

  const editingPartner = editingId ? partners.find((p) => p.id === editingId) : null;

  const handleAdd = async (data) => {
    try {
      await addPartner(data);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
    setShowAdd(false);
  };

  const handleEdit = async (data) => {
    if (!editingId) return;
    try {
      await updatePartner(editingId, data);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
    setEditingId(null);
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Деактивировать партнёра "${name}"?`)) return;
    try {
      await removePartner(id);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
  };

  const handleAccountSubmit = async (data) => {
    if (!accountModalState) return;
    try {
      if (accountModalState.mode === "add") {
        await addPartnerAccount({ partnerId: accountModalState.partnerId, ...data });
      } else if (accountModalState.mode === "edit" && accountModalState.accountId) {
        await updatePartnerAccount(accountModalState.accountId, data);
      }
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
    setAccountModalState(null);
  };

  const handleAccountDelete = async (acc) => {
    if (!confirm(`Деактивировать счёт «${acc.name}»?`)) return;
    try {
      await removePartnerAccount(acc.id);
    } catch (e) {
      alert("Ошибка: " + (e?.message || e));
    }
  };

  const editingAccount =
    accountModalState?.mode === "edit"
      ? partnerAccounts.find((a) => a.id === accountModalState.accountId)
      : null;
  const accountModalPartnerName =
    accountModalState
      ? partners.find((p) => p.id === accountModalState.partnerId)?.name || ""
      : "";

  return (
    <div className="divide-y divide-slate-100">
      <section>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="w-4 h-4 text-slate-500" />
            <h3 className="text-[15px] font-semibold tracking-tight">Партнёры (OTC)</h3>
            <span className="text-[11px] text-slate-400 ml-1">{partners.length}</span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Добавить партнёра
          </button>
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-[8px] px-2.5 py-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени, telegram, телефону, заметке…"
              className="flex-1 bg-transparent outline-none text-[12.5px] text-slate-900 placeholder:text-slate-400 min-w-0"
            />
            {query && (
              <button onClick={() => setQuery("")} className="p-0.5 rounded hover:bg-slate-200 text-slate-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-slate-400 italic">
              {partners.length === 0
                ? "Нет партнёров. Добавьте первого, чтобы он появился в OTC-форме."
                : "Ничего не найдено."}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 bg-slate-50/40 rounded-[10px] border border-slate-200 overflow-hidden">
              {filtered.map((p) => {
                const accs = accountsByPartner(p.id);
                const activeAccs = accs.filter((a) => a.active);
                const isOpen = expandedSet.has(p.id);
                return (
                  <div key={p.id} className={p.active ? "" : "opacity-70"}>
                    {/* Header row */}
                    <div className="px-3 py-2.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(p.id)}
                        className="w-6 h-6 rounded-full hover:bg-slate-200/70 flex items-center justify-center text-slate-500"
                        title={isOpen ? "Свернуть счета" : "Показать счета"}
                      >
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-bold text-indigo-700 shrink-0">
                        {p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-900 inline-flex items-center gap-2 flex-wrap">
                          {p.name}
                          {!p.active && (
                            <span className="text-[9px] font-bold text-slate-500 bg-slate-200 px-1 py-0.5 rounded uppercase">
                              deactivated
                            </span>
                          )}
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5"
                            title={`${activeAccs.length} active accounts`}
                          >
                            <Wallet className="w-2.5 h-2.5" />
                            {activeAccs.length}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 inline-flex items-center gap-2 flex-wrap">
                          {p.telegram && (
                            <span className="inline-flex items-center gap-0.5 text-sky-600">
                              <Send className="w-2.5 h-2.5" />
                              {p.telegram}
                            </span>
                          )}
                          {p.phone && (
                            <span className="inline-flex items-center gap-0.5">
                              <Phone className="w-2.5 h-2.5" />
                              {p.phone}
                            </span>
                          )}
                          {p.note && <span className="italic truncate">{p.note}</span>}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setAccountModalState({ mode: "add", partnerId: p.id })}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200"
                            title="Добавить счёт партнёру"
                          >
                            <Plus className="w-3 h-3" />
                            Счёт
                          </button>
                          <button
                            onClick={() => setEditingId(p.id)}
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                            title="Редактировать партнёра"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {p.active && (
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              title="Деактивировать"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expanded — accounts list */}
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 bg-white border-t border-slate-100">
                        {accs.length === 0 ? (
                          <div className="text-[11.5px] text-slate-400 italic py-2 text-center">
                            Нет счетов. Добавьте первый — нажми кнопку «Счёт» справа.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                            {accs.map((a) => {
                              const Icon = TYPE_ICONS[a.type] || Wallet;
                              const bal = partnerBalanceOf(a.id);
                              return (
                                <div
                                  key={a.id}
                                  className={`flex flex-col gap-1.5 px-2.5 py-2 rounded-[10px] border ${
                                    a.active
                                      ? "bg-slate-50/60 border-slate-200"
                                      : "bg-slate-100/60 border-slate-200 opacity-60"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                                      <Icon className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[12px] font-semibold text-slate-900 truncate">
                                        {a.name}
                                        {!a.active && (
                                          <span className="ml-1.5 text-[8.5px] font-bold text-slate-500 bg-slate-200 px-1 py-0.5 rounded uppercase">
                                            off
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-slate-500 tabular-nums">
                                        {curSymbol(a.currency)}
                                        {fmt(bal, a.currency)}{" "}
                                        <span className="opacity-60">{a.currency}</span>
                                        {a.networkId && (
                                          <span className="ml-1 text-slate-400">· {a.networkId}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {/* Actions row — крупные кнопки на отдельной строке. */}
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <button
                                      onClick={() => setSettlementState({
                                        account: a, partnerName: p.name, mode: "inflow",
                                      })}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 text-[11px] font-bold"
                                      title="Контрагент внёс — фиксируем только partner-side"
                                    >
                                      <ArrowDownLeft className="w-3 h-3" />
                                      Внёс
                                    </button>
                                    <button
                                      onClick={() => setSettlementState({
                                        account: a, partnerName: p.name, mode: "outflow",
                                      })}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 text-[11px] font-bold"
                                      title="Контрагент забрал у нас — указываем с какой кассы"
                                    >
                                      <ArrowUpRight className="w-3 h-3" />
                                      Забрал
                                    </button>
                                    <div className="ml-auto flex items-center gap-0.5">
                                    <button
                                      onClick={() => setHistoryAccount({ ...a, partnerName: p.name })}
                                      className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                                      title="История движений"
                                    >
                                      <HistoryIcon className="w-3 h-3" />
                                    </button>
                                    {canEdit && (
                                      <>
                                        <button
                                          onClick={() => setAccountModalState({
                                            mode: "edit",
                                            partnerId: p.id,
                                            accountId: a.id,
                                          })}
                                          className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                                          title="Редактировать"
                                        >
                                          <Edit2 className="w-3 h-3" />
                                        </button>
                                        {a.active && (
                                          <button
                                            onClick={() => handleAccountDelete(a)}
                                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                            title="Деактивировать"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        )}
                                      </>
                                    )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* Сделки с этим партнёром (внешние OTC) */}
                        <PartnerDealsSection partnerId={p.id} partnerName={p.name} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <PartnerFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
        title="Новый партнёр"
      />
      <PartnerFormModal
        open={!!editingPartner}
        initial={editingPartner}
        onClose={() => setEditingId(null)}
        onSubmit={handleEdit}
        title="Редактировать партнёра"
      />
      <PartnerAccountFormModal
        open={!!accountModalState}
        initial={editingAccount}
        partnerName={accountModalPartnerName}
        onClose={() => setAccountModalState(null)}
        onSubmit={handleAccountSubmit}
      />
      <PartnerAccountHistoryModal
        open={!!historyAccount}
        account={historyAccount}
        onClose={() => setHistoryAccount(null)}
      />
      <PartnerSettlementModal
        open={!!settlementState}
        mode={settlementState?.mode}
        partnerAccount={settlementState?.account}
        partnerName={settlementState?.partnerName}
        onClose={() => setSettlementState(null)}
      />
    </div>
  );
}

function PartnerFormModal({ open, onClose, onSubmit, initial, title }) {
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  React.useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setTelegram(initial?.telegram || "");
      setPhone(initial?.phone || "");
      setNote(initial?.note || "");
    }
  }, [open, initial]);

  const submit = () => {
    if (!name.trim()) return;
    const tg = telegram.trim();
    onSubmit({
      name: name.trim(),
      telegram: tg && !tg.startsWith("@") ? `@${tg}` : tg,
      phone: phone.trim(),
      note: note.trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={title} width="md">
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Имя / Название
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Telegram
            </label>
            <input
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="@username"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Телефон
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7..."
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Заметка
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Описание / каналы / условия..."
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200">
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={!name.trim()}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${
            name.trim() ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}

// ─── Партнёрские сделки (OTC внешние) ────────────────────────────────
//
// Lazy-load: тянет deals только когда секция раскрыта пользователем.
// Кэш в локальном state — повторного клика не будет fetch'ить заново.

function PartnerDealsSection({ partnerId, partnerName }) {
  const [open, setOpen] = useState(false);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    loadDealsForPartner(partnerId, 100)
      .then((d) => { if (!cancelled) { setDeals(d); setLoaded(true); } })
      .catch((e) => { if (!cancelled) console.warn("[PartnerDeals]", e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, loaded, partnerId]);

  const handleDeleted = (dealId) => {
    setDeals((arr) => arr.filter((d) => d.id !== dealId));
  };

  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 hover:text-slate-900 transition-colors"
      >
        <span className={`text-slate-400 text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        Сделки с этим контрагентом
        {loaded && (
          <span className="text-[10px] text-slate-400 tabular-nums">({deals.length})</span>
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-[10px] border border-slate-200 bg-slate-50/60 p-2">
          {loading ? (
            <div className="text-[12px] text-slate-400 text-center py-3">Загрузка…</div>
          ) : deals.length === 0 ? (
            <div className="text-[12px] text-slate-400 text-center py-3">
              Сделок с {partnerName} ещё не было
            </div>
          ) : (
            <div className="space-y-1 max-h-56 overflow-auto">
              {deals.map((d) => {
                const dt = new Date(d.createdAt);
                const isOtc = d.kind === "otc" || d.kind === "broker";
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 rounded-[8px] bg-white border border-slate-200 px-2.5 py-1.5 text-[11.5px]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-slate-400 tabular-nums whitespace-nowrap text-[10px]">
                        {dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                      </span>
                      {isOtc && (
                        <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold ring-1 bg-indigo-50 text-indigo-700 ring-indigo-200">
                          {d.kind === "broker" ? "BROKER" : "OTC"}
                        </span>
                      )}
                      <span className="text-slate-600 truncate">
                        {d.counterparty || "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="text-right tabular-nums">
                        <div className="font-semibold text-slate-900">
                          {fmt(d.amountIn, d.currencyIn)} {d.currencyIn}
                        </div>
                        {d.profit !== 0 && (
                          <div className={`text-[9.5px] font-bold ${d.profit > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {d.profit > 0 ? "+" : ""}${fmt(d.profit, "USD")}
                          </div>
                        )}
                      </div>
                      <DeleteDealButton dealId={d.id} onDeleted={handleDeleted} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
