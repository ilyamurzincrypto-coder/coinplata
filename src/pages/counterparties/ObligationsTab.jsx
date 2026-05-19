// src/pages/counterparties/ObligationsTab.jsx
// Контент бывшей ObligationsPage — теперь таб внутри Контрагентов.
// Логика 1:1: 6-направленный flow-фильтр, summary cards, таблица обязательств.
// Убран только outer <main> wrapper и top-level <header> (страница-родитель
// держит свой chrome).

import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  CheckCircle2,
  Ban,
  Search,
  Building2,
  Coins,
  Filter,
} from "lucide-react";
import { useObligations } from "../../store/obligations.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useAudit } from "../../store/audit.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { officeName } from "../../store/data.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { withToast } from "../../lib/supabaseWrite.js";
import {
  settleObligationPartial as rpcSettleObligationPartial,
  receivePayment as rpcReceivePayment,
  cancelObligation as rpcCancelObligation,
} from "../../lib/dealOperations.js";
import Modal from "../../components/ui/Modal.jsx";
import Select from "../../components/ui/Select.jsx";
import { exportCSV } from "../../utils/csv.js";
import { useTranslation } from "../../i18n/translations.jsx";

export default function ObligationsTab() {
  const { t } = useTranslation();
  const { obligations } = useObligations();
  const { offices } = useOffices();
  const { counterparties } = useTransactions();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);
  const { addEntry: logAudit } = useAudit();

  const [flowFilter, setFlowFilter] = useState("all");
  const [officeFilter, setOfficeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [actionTarget, setActionTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const uniqueCurrencies = useMemo(() => {
    const s = new Set();
    obligations.forEach((o) => s.add(o.currency));
    return [...s].sort();
  }, [obligations]);

  const clientName = (id) => {
    if (!id) return "";
    const c = counterparties.find((cp) => cp.id === id);
    return c?.nickname || c?.name || "";
  };

  const filtered = useMemo(() => {
    return obligations.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (flowFilter !== "all" && o.flow !== flowFilter) return false;
      if (officeFilter !== "all" && o.officeId !== officeFilter) return false;
      if (currencyFilter !== "all" && o.currency !== currencyFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const cname = clientName(o.clientId).toLowerCase();
        const note = (o.note || "").toLowerCase();
        const dealId = String(o.dealId || "");
        if (!cname.includes(q) && !note.includes(q) && !dealId.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obligations, flowFilter, officeFilter, currencyFilter, statusFilter, search, counterparties]);

  const flowCounts = useMemo(() => {
    const c = {
      all: 0,
      us_to_client: 0, client_to_us: 0,
      us_to_partner: 0, partner_to_us: 0,
      client_to_partner: 0, partner_to_client: 0,
    };
    obligations.forEach((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return;
      c.all += 1;
      if (c[o.flow] !== undefined) c[o.flow] += 1;
    });
    return c;
  }, [obligations, statusFilter]);

  const summary = useMemo(() => {
    let weOwe = 0;
    let theyOwe = 0;
    obligations.forEach((o) => {
      if (o.status !== "open") return;
      const rem = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
      const inBase = toBase(rem, o.currency);
      if (o.direction === "we_owe") weOwe += inBase;
      else if (o.direction === "they_owe") theyOwe += inBase;
    });
    return { weOwe, theyOwe, net: theyOwe - weOwe };
  }, [obligations, toBase]);

  const handleCancel = async (obligation) => {
    if (busyId) return;
    if (!confirm(`${t("oblig_confirm_cancel")} (${obligation.direction}, ${obligation.amount} ${obligation.currency})`)) return;
    setBusyId(obligation.id);
    try {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () => rpcCancelObligation(obligation.id),
          { success: "Obligation cancelled", errorPrefix: "Cancel failed" }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "obligation",
            entityId: obligation.id,
            summary: `Cancelled ${obligation.direction} ${obligation.amount} ${obligation.currency}`,
          });
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCSV({
      filename: `coinplata-obligations-${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "createdAt", label: "Created" },
        { key: "direction", label: "Direction" },
        { key: "status", label: "Status" },
        { key: "office", label: "Office" },
        { key: "client", label: "Client" },
        { key: "currency", label: "Currency" },
        { key: "amount", label: "Amount" },
        { key: "paid", label: "Paid" },
        { key: "remaining", label: "Remaining" },
        { key: "dealId", label: "Deal" },
        { key: "note", label: "Note" },
      ],
      rows: filtered.map((o) => ({
        createdAt: (o.createdAt || "").slice(0, 19).replace("T", " "),
        direction: o.direction,
        status: o.status,
        office: officeName(o.officeId) || "",
        client: clientName(o.clientId),
        currency: o.currency,
        amount: o.amount,
        paid: o.paidAmount || 0,
        remaining: (Number(o.amount) || 0) - (Number(o.paidAmount) || 0),
        dealId: o.dealId || "",
        note: o.note || "",
      })),
    });
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          label={t("oblig_we_owe")}
          value={`${sym}${fmt(summary.weOwe, base)}`}
          tone="rose"
          icon={<ArrowUpRight className="w-4 h-4" />}
        />
        <SummaryCard
          label={t("oblig_they_owe")}
          value={`${sym}${fmt(summary.theyOwe, base)}`}
          tone="emerald"
          icon={<ArrowDownLeft className="w-4 h-4" />}
        />
        <SummaryCard
          label={t("oblig_net")}
          value={`${summary.net >= 0 ? "+" : ""}${sym}${fmt(summary.net, base)}`}
          tone={summary.net >= 0 ? "emerald" : "rose"}
          icon={<Scale className="w-4 h-4" />}
          emphasize
        />
      </div>

      {/* Filter bar — 6-direction flow chips */}
      <div className="bg-white border border-border-soft rounded-card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-soft">
            <Filter className="w-3.5 h-3.5" />
          </div>
          <FlowChip active={flowFilter === "all"} onClick={() => setFlowFilter("all")} count={flowCounts.all}>
            Все
          </FlowChip>
          <span className="text-[10px] font-bold text-muted-soft ml-1">Клиент:</span>
          <FlowChip active={flowFilter === "us_to_client"} onClick={() => setFlowFilter("us_to_client")} count={flowCounts.us_to_client} tone="rose">
            Мы → клиент
          </FlowChip>
          <FlowChip active={flowFilter === "client_to_us"} onClick={() => setFlowFilter("client_to_us")} count={flowCounts.client_to_us} tone="emerald">
            Клиент → нам
          </FlowChip>
          <span className="text-[10px] font-bold text-muted-soft ml-1">Партнёр:</span>
          <FlowChip active={flowFilter === "us_to_partner"} onClick={() => setFlowFilter("us_to_partner")} count={flowCounts.us_to_partner} tone="rose">
            Мы → партнёр
          </FlowChip>
          <FlowChip active={flowFilter === "partner_to_us"} onClick={() => setFlowFilter("partner_to_us")} count={flowCounts.partner_to_us} tone="emerald">
            Партнёр → нам
          </FlowChip>
          <span className="text-[10px] font-bold text-muted-soft ml-1">Внешние:</span>
          <FlowChip active={flowFilter === "client_to_partner"} onClick={() => setFlowFilter("client_to_partner")} count={flowCounts.client_to_partner} tone="slate">
            Клиент → партнёр
          </FlowChip>
          <FlowChip active={flowFilter === "partner_to_client"} onClick={() => setFlowFilter("partner_to_client")} count={flowCounts.partner_to_client} tone="slate">
            Партнёр → клиент
          </FlowChip>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "open", label: t("oblig_status_open") },
              { value: "closed", label: t("oblig_status_closed") },
              { value: "cancelled", label: t("oblig_status_cancelled") },
              { value: "all", label: t("oblig_status_all") },
            ]}
            compact
          />
          <Select
            value={officeFilter}
            onChange={setOfficeFilter}
            options={[{ value: "all", label: t("oblig_all_offices") }, ...offices.map((o) => ({ value: o.id, label: o.name }))]}
            compact
            icon={<Building2 className="w-3 h-3 text-muted-soft" />}
          />
          <Select
            value={currencyFilter}
            onChange={setCurrencyFilter}
            options={[{ value: "all", label: t("oblig_all_currencies") }, ...uniqueCurrencies.map((c) => ({ value: c, label: c }))]}
            compact
            icon={<Coins className="w-3 h-3 text-muted-soft" />}
          />
          <div className="flex-1 min-w-[160px] relative">
            <Search className="w-3 h-3 text-muted-soft absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("oblig_search_ph")}
              className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-surface-soft border border-border-soft rounded-button outline-none focus:bg-white focus:border-border"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-button text-[12px] font-semibold text-ink-soft hover:text-ink bg-white border border-border-soft hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("export_csv")}
          </button>
        </div>
      </div>

      {/* Table */}
      <section className="bg-white rounded-card-lg border border-border-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-muted tracking-[0.1em] uppercase border-b border-border-soft">
                <th className="px-5 py-2.5 hidden md:table-cell">{t("oblig_col_created")}</th>
                <th className="px-3 py-2.5">{t("oblig_col_direction")}</th>
                <th className="px-3 py-2.5">{t("oblig_col_client")}</th>
                <th className="px-3 py-2.5 hidden lg:table-cell">{t("oblig_col_office")}</th>
                <th className="px-3 py-2.5 text-right hidden sm:table-cell">{t("oblig_col_amount")}</th>
                <th className="px-3 py-2.5 text-right hidden lg:table-cell">{t("oblig_col_paid")}</th>
                <th className="px-3 py-2.5 text-right">{t("oblig_col_remaining")}</th>
                <th className="px-3 py-2.5 hidden md:table-cell">{t("oblig_col_status")}</th>
                <th className="px-3 py-2.5 hidden xl:table-cell">{t("oblig_col_deal")}</th>
                <th className="px-5 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const rem = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
                const isWeOwe = o.direction === "we_owe";
                const isOpen = o.status === "open";
                return (
                  <tr key={o.id} className="border-b border-border-soft last:border-0 hover:bg-surface-soft/60">
                    <td className="px-5 py-3 whitespace-nowrap text-muted tabular-nums hidden md:table-cell">
                      {(o.createdAt || "").slice(0, 10)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          isWeOwe
                            ? "bg-rose-100 text-danger ring-1 ring-rose-200"
                            : "bg-emerald-100 text-success ring-1 ring-emerald-200"
                        }`}
                      >
                        {isWeOwe ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownLeft className="w-2.5 h-2.5" />}
                        {isWeOwe ? t("oblig_we_owe") : t("oblig_they_owe")}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-ink">
                      {clientName(o.clientId) || <span className="text-muted-soft italic">—</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-soft hidden lg:table-cell">{officeName(o.officeId)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold hidden sm:table-cell">
                      {fmt(o.amount, o.currency)} {o.currency}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted hidden lg:table-cell">
                      {(o.paidAmount || 0) > 0 ? fmt(o.paidAmount, o.currency) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-bold text-ink whitespace-nowrap">
                      {fmt(rem, o.currency)} {o.currency}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-3 py-3 text-muted tabular-nums hidden xl:table-cell">
                      {o.dealId ? `#${o.dealId}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isOpen && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => setActionTarget({ obligation: o, mode: isWeOwe ? "settle" : "receive" })}
                            disabled={busyId === o.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-white ${
                              isWeOwe
                                ? "bg-danger hover:bg-danger"
                                : "bg-success hover:bg-emerald-600"
                            } disabled:opacity-50`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {isWeOwe ? t("oblig_pay") : t("oblig_receive")}
                          </button>
                          <button
                            onClick={() => handleCancel(o)}
                            disabled={busyId === o.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-ink-soft hover:text-danger hover:bg-danger-soft disabled:opacity-50"
                            title={t("oblig_cancel_tip")}
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-16 text-center">
                    <div className="text-muted-soft text-[13px]">
                      {obligations.length === 0 ? t("oblig_empty") : t("oblig_no_match")}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {actionTarget && (
        <SettleObligationModal
          obligation={actionTarget.obligation}
          mode={actionTarget.mode}
          onClose={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone, icon, emphasize }) {
  const toneBg = {
    emerald: "bg-success-soft/70 border-success/20 text-success",
    rose: "bg-danger-soft/70 border-danger/20 text-danger",
  }[tone];
  return (
    <div
      className={`rounded-card-lg p-4 border ${toneBg} ${
        emphasize ? "ring-2 ring-ink/5" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider opacity-70">
        {icon}
        {label}
      </div>
      <div className="text-[22px] font-bold tabular-nums tracking-tight mt-1">{value}</div>
    </div>
  );
}

function FlowChip({ active, onClick, count = 0, tone = "slate", children }) {
  const toneActive = {
    rose:    "bg-danger text-white border-rose-600",
    emerald: "bg-emerald-600 text-white border-emerald-600",
    slate:   "bg-ink text-white border-ink",
  }[tone];
  const toneIdle = {
    rose:    "bg-white text-danger border-danger/20 hover:border-danger/40 hover:bg-danger-soft",
    emerald: "bg-white text-success border-success/20 hover:border-emerald-300 hover:bg-success-soft",
    slate:   "bg-white text-ink-soft border-border-soft hover:border-border hover:bg-surface-soft",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-button border text-[11.5px] font-semibold transition-colors ${
        active ? toneActive : toneIdle
      }`}
    >
      <span>{children}</span>
      {count > 0 && (
        <span className={`text-[9.5px] font-bold tabular-nums px-1 rounded ${
          active ? "bg-white/20" : "bg-surface-sunk"
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    open: "bg-amber-100 text-warning ring-amber-200",
    closed: "bg-surface-sunk text-ink-soft ring-border-soft",
    cancelled: "bg-surface-sunk text-muted-soft ring-border-soft line-through",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${map[status] || map.open}`}
    >
      {status}
    </span>
  );
}

function SettleObligationModal({ obligation, mode, onClose }) {
  const { t } = useTranslation();
  const { accountsByOffice, availableOf } = useAccounts();
  const { addEntry: logAudit } = useAudit();
  const remaining = (Number(obligation.amount) || 0) - (Number(obligation.paidAmount) || 0);

  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(remaining);
  const [submitting, setSubmitting] = useState(false);

  const candidateAccounts = useMemo(
    () =>
      accountsByOffice(obligation.officeId, {
        currency: obligation.currency,
        activeOnly: true,
      }),
    [accountsByOffice, obligation]
  );

  const parsedAmount = Number(amount) || 0;
  const invalidAmount = parsedAmount <= 0 || parsedAmount > remaining + 1e-9;
  const insufficient =
    mode === "settle" && accountId && availableOf(accountId) < parsedAmount;

  const handleSubmit = async () => {
    if (submitting || invalidAmount || !accountId || insufficient) return;
    setSubmitting(true);
    try {
      if (isSupabaseConfigured) {
        const fn = mode === "settle" ? rpcSettleObligationPartial : rpcReceivePayment;
        const res = await withToast(
          () => fn(obligation.id, accountId, parsedAmount),
          {
            success: mode === "settle" ? "Paid" : "Payment received",
            errorPrefix: mode === "settle" ? "Settle failed" : "Receive failed",
          }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "obligation",
            entityId: obligation.id,
            summary: `${mode === "settle" ? "Paid" : "Received"} ${parsedAmount} ${obligation.currency} (remaining before: ${remaining})`,
          });
          onClose?.();
        }
      } else {
        onClose?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    mode === "settle"
      ? `${t("oblig_pay_title")} ${fmt(remaining, obligation.currency)} ${obligation.currency}`
      : `${t("oblig_receive_title")} ${fmt(remaining, obligation.currency)} ${obligation.currency}`;

  return (
    <Modal open={!!obligation} onClose={onClose} title={title} width="md">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <InfoPill label={t("oblig_direction_label")} value={obligation.direction} />
          <InfoPill label={t("oblig_currency_label")} value={obligation.currency} />
          <InfoPill label={t("oblig_original_label")} value={fmt(obligation.amount, obligation.currency)} />
          <InfoPill
            label={t("oblig_already_paid_label")}
            value={fmt(obligation.paidAmount || 0, obligation.currency)}
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">
            {mode === "settle" ? t("oblig_pay_from_account") : t("oblig_receive_to_account")}
          </label>
          {candidateAccounts.length === 0 ? (
            <div className="text-[12px] text-danger bg-danger-soft border border-danger/20 rounded-md px-3 py-2">
              {t("oblig_no_accounts").replace("{cur}", obligation.currency)}
            </div>
          ) : (
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 text-[13px] bg-surface-soft border border-border-soft rounded-button outline-none focus:bg-white focus:border-border"
            >
              <option value="">{t("oblig_select_account")}</option>
              {candidateAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {fmt(availableOf(a.id), a.currency)} {a.currency}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">
            {t("oblig_amount_label")} ({obligation.currency})
          </label>
          <input
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 text-[13px] bg-surface-soft border border-border-soft rounded-button outline-none focus:bg-white focus:border-border tabular-nums"
          />
          <div className="flex items-center justify-between text-[11px] text-muted mt-1">
            <span>{t("oblig_remaining_hint")} {fmt(remaining, obligation.currency)}</span>
            <button
              type="button"
              onClick={() => setAmount(remaining)}
              className="text-ink-soft hover:text-ink font-semibold underline"
            >
              {t("oblig_full_btn")}
            </button>
          </div>
          {insufficient && (
            <div className="text-[11px] text-danger mt-1">{t("oblig_insufficient")}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-soft">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-button text-[12px] font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || invalidAmount || !accountId || insufficient}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-[12px] font-semibold text-white ${
              mode === "settle" ? "bg-danger hover:bg-danger" : "bg-success hover:bg-emerald-600"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <CheckCircle2 className="w-3 h-3" />
            {submitting ? t("oblig_working") : mode === "settle" ? t("oblig_pay_now") : t("oblig_mark_received")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="bg-surface-soft border border-border-soft rounded-md px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-soft">{label}</div>
      <div className="text-[12px] font-semibold text-ink">{value}</div>
    </div>
  );
}
