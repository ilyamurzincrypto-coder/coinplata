// src/pages/ObligationsPage.jsx
// Центральная страница долгов:
//   • We owe — список where direction='we_owe'  (нам надо заплатить)
//   • They owe — where direction='they_owe'    (нам должны принести)
// Фильтры: direction/office/currency/client/status. Summary cards сверху.
// Per-row actions: Settle (we_owe) / Receive (they_owe) / Cancel.
//
// Settle/Receive — универсальный SettleObligationModal с выбором аккаунта +
// amount. RPC `settle_obligation_partial` / `receive_payment` обрабатывают
// частичное погашение (paid_amount инкрементится).

import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  X,
  CheckCircle2,
  Ban,
  Search,
  Building2,
  Coins,
  Filter,
} from "lucide-react";
import { useObligations } from "../store/obligations.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useAudit } from "../store/audit.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  rpcSettleObligationPartial,
  rpcReceivePayment,
  rpcCancelObligation,
  withToast,
} from "../lib/supabaseWrite.js";
import Modal from "../components/ui/Modal.jsx";
import Select from "../components/ui/Select.jsx";
import { exportCSV } from "../utils/csv.js";

export default function ObligationsPage() {
  const { obligations } = useObligations();
  const { offices } = useOffices();
  const { counterparties } = useTransactions();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);
  const { addEntry: logAudit } = useAudit();

  const [directionFilter, setDirectionFilter] = useState("all"); // all|we_owe|they_owe
  const [officeFilter, setOfficeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [actionTarget, setActionTarget] = useState(null); // { obligation, mode: "settle"|"receive" }
  const [cancelTarget, setCancelTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Уникальные валюты среди всех obligations (для фильтра)
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
      if (directionFilter !== "all" && o.direction !== directionFilter) return false;
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
  }, [obligations, directionFilter, officeFilter, currencyFilter, statusFilter, search, counterparties]);

  // Summary: только по открытым — главный use case
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
    if (!confirm(`Cancel this obligation? (${obligation.direction}, ${obligation.amount} ${obligation.currency})`)) return;
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
      setCancelTarget(null);
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
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight flex items-center gap-2">
            <Scale className="w-5 h-5 text-slate-500" />
            Obligations
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Open debts tracker · we_owe = we still owe client · they_owe = client still owes us
          </p>
        </div>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          label="We owe"
          value={`${sym}${fmt(summary.weOwe, base)}`}
          tone="rose"
          icon={<ArrowUpRight className="w-4 h-4" />}
        />
        <SummaryCard
          label="They owe"
          value={`${sym}${fmt(summary.theyOwe, base)}`}
          tone="emerald"
          icon={<ArrowDownLeft className="w-4 h-4" />}
        />
        <SummaryCard
          label="Net"
          value={`${summary.net >= 0 ? "+" : ""}${sym}${fmt(summary.net, base)}`}
          tone={summary.net >= 0 ? "emerald" : "rose"}
          icon={<Scale className="w-4 h-4" />}
          emphasize
        />
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Filter className="w-3.5 h-3.5" />
        </div>
        <SegBtn active={directionFilter === "all"} onClick={() => setDirectionFilter("all")}>
          All
        </SegBtn>
        <SegBtn active={directionFilter === "we_owe"} onClick={() => setDirectionFilter("we_owe")}>
          We owe
        </SegBtn>
        <SegBtn active={directionFilter === "they_owe"} onClick={() => setDirectionFilter("they_owe")}>
          They owe
        </SegBtn>

        <div className="h-5 w-px bg-slate-200 mx-1" />

        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
            { value: "cancelled", label: "Cancelled" },
            { value: "all", label: "All statuses" },
          ]}
          compact
        />
        <Select
          value={officeFilter}
          onChange={setOfficeFilter}
          options={[{ value: "all", label: "All offices" }, ...offices.map((o) => ({ value: o.id, label: o.name }))]}
          compact
          icon={<Building2 className="w-3 h-3 text-slate-400" />}
        />
        <Select
          value={currencyFilter}
          onChange={setCurrencyFilter}
          options={[{ value: "all", label: "All currencies" }, ...uniqueCurrencies.map((c) => ({ value: c, label: c }))]}
          compact
          icon={<Coins className="w-3 h-3 text-slate-400" />}
        />

        <div className="flex-1 min-w-[160px] relative">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client / note / deal#"
            className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-slate-50 border border-slate-200 rounded-[8px] outline-none focus:bg-white focus:border-slate-300"
          />
        </div>

        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
                <th className="px-5 py-2.5 hidden md:table-cell">Created</th>
                <th className="px-3 py-2.5">Direction</th>
                <th className="px-3 py-2.5">Client</th>
                <th className="px-3 py-2.5 hidden lg:table-cell">Office</th>
                <th className="px-3 py-2.5 text-right hidden sm:table-cell">Amount</th>
                <th className="px-3 py-2.5 text-right hidden lg:table-cell">Paid</th>
                <th className="px-3 py-2.5 text-right">Remaining</th>
                <th className="px-3 py-2.5 hidden md:table-cell">Status</th>
                <th className="px-3 py-2.5 hidden xl:table-cell">Deal</th>
                <th className="px-5 py-2.5 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const rem = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
                const isWeOwe = o.direction === "we_owe";
                const isOpen = o.status === "open";
                return (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-500 tabular-nums hidden md:table-cell">
                      {(o.createdAt || "").slice(0, 10)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          isWeOwe
                            ? "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
                            : "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                        }`}
                      >
                        {isWeOwe ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownLeft className="w-2.5 h-2.5" />}
                        {isWeOwe ? "we owe" : "they owe"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {clientName(o.clientId) || <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-3 py-3 text-slate-600 hidden lg:table-cell">{officeName(o.officeId)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold hidden sm:table-cell">
                      {fmt(o.amount, o.currency)} {o.currency}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500 hidden lg:table-cell">
                      {(o.paidAmount || 0) > 0 ? fmt(o.paidAmount, o.currency) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {fmt(rem, o.currency)} {o.currency}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-3 py-3 text-slate-500 tabular-nums hidden xl:table-cell">
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
                                ? "bg-rose-500 hover:bg-rose-600"
                                : "bg-emerald-500 hover:bg-emerald-600"
                            } disabled:opacity-50`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {isWeOwe ? "Pay" : "Receive"}
                          </button>
                          <button
                            onClick={() => handleCancel(o)}
                            disabled={busyId === o.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            title="Cancel obligation"
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
                    <div className="text-slate-400 text-[13px]">
                      {obligations.length === 0 ? "No obligations yet" : "No obligations match the current filter"}
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
    </main>
  );
}

function SummaryCard({ label, value, tone, icon, emphasize }) {
  const toneBg = {
    emerald: "bg-emerald-50/70 border-emerald-200 text-emerald-700",
    rose: "bg-rose-50/70 border-rose-200 text-rose-700",
  }[tone];
  return (
    <div
      className={`rounded-[14px] p-4 border ${toneBg} ${
        emphasize ? "ring-2 ring-slate-900/5" : ""
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

function SegBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold transition-colors ${
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    open: "bg-amber-100 text-amber-700 ring-amber-200",
    closed: "bg-slate-100 text-slate-600 ring-slate-200",
    cancelled: "bg-slate-100 text-slate-400 ring-slate-200 line-through",
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
      ? `Pay ${fmt(remaining, obligation.currency)} ${obligation.currency}`
      : `Receive ${fmt(remaining, obligation.currency)} ${obligation.currency}`;

  return (
    <Modal open={!!obligation} onClose={onClose} title={title} width="md">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <InfoPill label="Direction" value={obligation.direction} />
          <InfoPill label="Currency" value={obligation.currency} />
          <InfoPill label="Original" value={fmt(obligation.amount, obligation.currency)} />
          <InfoPill
            label="Already paid"
            value={fmt(obligation.paidAmount || 0, obligation.currency)}
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {mode === "settle" ? "Pay from account" : "Receive into account"}
          </label>
          {candidateAccounts.length === 0 ? (
            <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              No {obligation.currency} accounts at this office.
            </div>
          ) : (
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-[8px] outline-none focus:bg-white focus:border-slate-300"
            >
              <option value="">— select account —</option>
              {candidateAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · avail {fmt(availableOf(a.id), a.currency)} {a.currency}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Amount ({obligation.currency})
          </label>
          <input
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-[8px] outline-none focus:bg-white focus:border-slate-300 tabular-nums"
          />
          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
            <span>Remaining: {fmt(remaining, obligation.currency)}</span>
            <button
              type="button"
              onClick={() => setAmount(remaining)}
              className="text-slate-700 hover:text-slate-900 font-semibold underline"
            >
              Full
            </button>
          </div>
          {insufficient && (
            <div className="text-[11px] text-rose-600 mt-1">Account balance insufficient.</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || invalidAmount || !accountId || insufficient}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-white ${
              mode === "settle" ? "bg-rose-500 hover:bg-rose-600" : "bg-emerald-500 hover:bg-emerald-600"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <CheckCircle2 className="w-3 h-3" />
            {submitting ? "Working…" : mode === "settle" ? "Pay now" : "Mark received"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-[12px] font-semibold text-slate-900">{value}</div>
    </div>
  );
}
