// src/components/TransactionsTable.jsx
import React, { useMemo, useState } from "react";
import {
  Search,
  Pencil,
  Filter,
  Calendar,
  X,
  ArrowLeftRight,
  UserPlus,
  Lock,
  Clock,
  CheckCircle2,
  Radar,
  Zap,
  Trash2,
  AlertTriangle,
  Send,
  Upload,
  Pin,
  PinOff,
  Flag,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import Select from "./ui/Select.jsx";
import { officeName } from "../store/data.js";
import { useCurrencies } from "../store/currencies.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useTransactions } from "../store/transactions.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAudit } from "../store/audit.jsx";
import { useMonitoring } from "../store/monitoring.jsx";
import { useObligations } from "../store/obligations.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { buildMovementsFromTransaction } from "../utils/exchangeMovements.js";
import { riskLevelStyle, riskLevelLabel } from "../utils/aml.js";
import { computeLegStatus, legStatusStyle, formatShortDate } from "../utils/legStatus.js";
import { Shield } from "lucide-react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  rpcDeleteDeal,
  rpcCompleteDeal,
  rpcConfirmDealLeg,
  rpcMarkDealSent,
  rpcCancelObligation,
  withToast,
} from "../lib/supabaseWrite.js";

export default function TransactionsTable({ currentOffice, justCreatedId, onEdit }) {
  const { t } = useTranslation();
  const { transactions, completeTransaction, deleteTransaction, updateOutput, updateTransaction } = useTransactions();
  const { canEditTransaction, isAdmin, currentUser } = useAuth();
  const {
    accounts,
    addMovement,
    removeMovementsByRefId,
    unreserveMovementsByRefId,
    unreserveMovementByOutputIndex,
  } = useAccounts();
  const { codes: CURRENCIES } = useCurrencies();
  const { base: baseCurrency, toBase } = useBaseCurrency();
  const { addEntry: logAudit } = useAudit();
  const { simulateIncoming } = useMonitoring();
  const { obligations, cancelObligation } = useObligations();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [sendTarget, setSendTarget] = useState(null); // { tx, outputIndex }
  // Set ID'ов tx, по которым сейчас летит RPC — блокируем повторные клики.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);

  const isBusy = (id) => busyIds.has(String(id));
  const withBusy = async (id, fn) => {
    const key = String(id);
    if (busyIds.has(key)) return { ok: false, error: "already in progress" };
    setBusyIds((prev) => new Set(prev).add(key));
    try {
      return await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSendCrypto = async (tx, outputIndex, { txHash, network }) => {
    if (isSupabaseConfigured) {
      await withBusy(tx.id, async () => {
        const res = await withToast(
          () =>
            rpcMarkDealSent({
              dealId: tx.id,
              legIndex: outputIndex,
              txHash,
              network: network || tx.outputs[outputIndex]?.network || null,
            }),
          { success: "Marked sent", errorPrefix: "Mark sent failed" }
        );
        if (res.ok) {
          logAudit({
            action: "send",
            entity: "transaction_output",
            entityId: `${tx.id}#${outputIndex}`,
            summary: `Sent crypto for #${tx.id} output ${outputIndex + 1}: tx ${txHash.slice(0, 10)}…`,
          });
        }
        return res;
      });
      return;
    }
    updateOutput(tx.id, outputIndex, {
      sendStatus: "sent",
      sendTxHash: txHash,
      network: network || tx.outputs[outputIndex]?.network || null,
    });
    logAudit({
      action: "send",
      entity: "transaction_output",
      entityId: `${tx.id}#${outputIndex}`,
      summary: `Sent crypto for #${tx.id} output ${outputIndex + 1}: tx ${txHash.slice(0, 10)}…`,
    });
  };

  const handleConfirmCryptoOut = async (tx, outputIndex) => {
    if (isSupabaseConfigured) {
      await withBusy(tx.id, async () => {
        const res = await withToast(
          () => rpcConfirmDealLeg(tx.id, outputIndex),
          { success: "Leg confirmed", errorPrefix: "Confirm failed" }
        );
        if (res.ok) {
          logAudit({
            action: "confirm",
            entity: "transaction_output",
            entityId: `${tx.id}#${outputIndex}`,
            summary: `Confirmed on-chain for #${tx.id} output ${outputIndex + 1}`,
          });
        }
        return res;
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const leg = tx.outputs?.[outputIndex];
    const planned = leg?.plannedAmount ?? leg?.amount ?? 0;
    updateOutput(tx.id, outputIndex, {
      sendStatus: "confirmed",
      actualAmount: planned,
      completedAt: nowIso,
    });
    unreserveMovementByOutputIndex(tx.id, outputIndex);
    logAudit({
      action: "confirm",
      entity: "transaction_output",
      entityId: `${tx.id}#${outputIndex}`,
      summary: `Confirmed on-chain for #${tx.id} output ${outputIndex + 1}`,
    });
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget || deleteBusy) return;
    const tx = deleteTarget;

    if (isSupabaseConfigured) {
      setDeleteBusy(true);
      try {
        // delete_deal RPC уже: сносит movements, cancel'ит obligations, soft-delete.
        const res = await withToast(
          () => rpcDeleteDeal(tx.id, "manual"),
          { success: "Deal deleted", errorPrefix: "Delete failed" }
        );
        if (res.ok) {
          logAudit({
            action: "delete",
            entity: "transaction",
            entityId: String(tx.id),
            summary: `Deleted tx #${tx.id} · ${tx.curIn} ${tx.amtIn} → ${(tx.outputs || []).map((o) => `${o.amount} ${o.currency}`).join(" + ")}`,
          });
        }
        setDeleteTarget(null);
      } finally {
        setDeleteBusy(false);
      }
      return;
    }

    // Demo: rollback in-memory.
    removeMovementsByRefId(tx.id);
    const openObs = obligations.filter(
      (o) => o.dealId === tx.id && o.status === "open"
    );
    openObs.forEach((o) => cancelObligation(o.id, currentUser.id));
    deleteTransaction(tx.id, "manual");
    logAudit({
      action: "delete",
      entity: "transaction",
      entityId: String(tx.id),
      summary: `Deleted tx #${tx.id} · ${tx.curIn} ${tx.amtIn} → ${(tx.outputs || []).map((o) => `${o.amount} ${o.currency}`).join(" + ")} · movements rolled back${openObs.length ? ` · ${openObs.length} obligation(s) cancelled` : ""}`,
    });
    setDeleteTarget(null);
  };

  // Симулирует incoming blockchain-tx, который должен подхватить данную checking-сделку.
  // Используется для demo без реальных API; реальный flow — то же через polling.
  const handleSimulateConfirm = (tx) => {
    const depositAccount = accounts.find(
      (a) =>
        a.type === "crypto" &&
        a.active &&
        a.isDeposit &&
        a.currency === tx.curIn &&
        a.officeId === tx.officeId
    );
    if (!depositAccount) {
      // eslint-disable-next-line no-alert
      alert(`No active crypto deposit account for ${tx.curIn} in this office.`);
      return;
    }
    simulateIncoming(depositAccount.id, { amount: tx.amtIn });
  };

  const handleComplete = async (tx) => {
    if (isSupabaseConfigured) {
      await withBusy(tx.id, async () => {
        const res = await withToast(
          () => rpcCompleteDeal(tx.id),
          { success: "Deal completed", errorPrefix: "Complete failed" }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "transaction",
            entityId: String(tx.id),
            summary: `[COMPLETED] Tx #${tx.id}: reserved cleared, IN/OUT closed`,
          });
        }
        return res;
      });
      return;
    }
    const nowIso = new Date().toISOString();
    completeTransaction(tx.id);
    unreserveMovementsByRefId(tx.id);
    const updatedOuts = (tx.outputs || []).map((l) => {
      if (l.completedAt) return l;
      return {
        ...l,
        actualAmount: l.plannedAmount ?? l.amount ?? 0,
        completedAt: nowIso,
      };
    });
    updateTransaction(tx.id, {
      confirmedAt: nowIso,
      outputs: updatedOuts,
      inActualAmount: tx.amtIn || 0,
      inCompletedAt: tx.inCompletedAt || nowIso,
    });
    logAudit({
      action: "update",
      entity: "transaction",
      entityId: String(tx.id),
      summary: `[COMPLETED] Tx #${tx.id}: reserved cleared, IN/OUT closed`,
    });
  };

  const [filterCurrency, setFilterCurrency] = useState("All");
  const [filterManager, setFilterManager] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterDate, setFilterDate] = useState(t("today"));
  const [search, setSearch] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const DATE_OPTIONS = [
    t("today"),
    t("yesterday"),
    t("last_7"),
    t("this_month"),
    t("all_time"),
  ];

  const STATUS_OPTIONS = ["All", "pending", "checking", "completed", "flagged", "deleted"];

  const managers = useMemo(() => {
    const s = new Set();
    transactions.forEach((tx) => tx.manager && s.add(tx.manager));
    return ["All", ...s];
  }, [transactions]);

  const hasActiveFilters =
    filterCurrency !== "All" ||
    filterManager !== "All" ||
    filterStatus !== "All" ||
    filterDate !== DATE_OPTIONS[0] ||
    search !== "" ||
    amountMin !== "" ||
    amountMax !== "";

  const officeTxs = useMemo(
    () =>
      transactions.filter(
        (tx) => tx.officeId === currentOffice && tx.type === "EXCHANGE"
      ),
    [transactions, currentOffice]
  );

  const filtered = useMemo(() => {
    const minN = parseFloat(amountMin);
    const maxN = parseFloat(amountMax);
    return officeTxs.filter((tx) => {
      if (filterCurrency !== "All") {
        const outCurrencies = (tx.outputs || []).map((o) => o.currency);
        if (tx.curIn !== filterCurrency && !outCurrencies.includes(filterCurrency)) return false;
      }
      if (filterManager !== "All" && tx.manager !== filterManager) return false;
      if (filterStatus !== "All" && (tx.status || "completed") !== filterStatus) return false;
      if (!isNaN(minN) && (tx.amtIn || 0) < minN) return false;
      if (!isNaN(maxN) && (tx.amtIn || 0) > maxN) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !tx.manager.toLowerCase().includes(q) &&
          !String(tx.amtIn).includes(q) &&
          !String(tx.amtOut).includes(q) &&
          !(tx.counterparty || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [officeTxs, filterCurrency, filterManager, filterStatus, amountMin, amountMax, search]);

  // Pinned — наверху, не попадают в пагинацию. Regular — подлежат пагинации.
  const pinnedTxs = useMemo(() => filtered.filter((tx) => tx.pinned), [filtered]);
  const regularTxs = useMemo(() => filtered.filter((tx) => !tx.pinned), [filtered]);

  const totalPages = Math.max(1, Math.ceil(regularTxs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRegular = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return regularTxs.slice(start, start + pageSize);
  }, [regularTxs, safePage, pageSize]);

  // Reset page when filters изменились.
  React.useEffect(() => {
    setPage(1);
  }, [filterCurrency, filterManager, filterStatus, filterDate, search, amountMin, amountMax, pageSize]);

  const clearFilters = () => {
    setFilterCurrency("All");
    setFilterManager("All");
    setFilterStatus("All");
    setFilterDate(DATE_OPTIONS[0]);
    setSearch("");
    setAmountMin("");
    setAmountMax("");
  };

  // Pin / Flag actions.
  const handleTogglePin = (tx) => {
    const next = !tx.pinned;
    updateTransaction(tx.id, { pinned: next });
    logAudit({
      action: "update",
      entity: "transaction",
      entityId: String(tx.id),
      summary: `${next ? "Pinned" : "Unpinned"} tx #${tx.id}`,
    });
  };

  const handleFlag = (tx) => {
    const wasFlagged = tx.status === "flagged";
    // При снятии флага возвращаем в completed (или pending если было reserved).
    const next = wasFlagged ? (tx.confirmedAt ? "completed" : "completed") : "flagged";
    updateTransaction(tx.id, { status: next });
    logAudit({
      action: "update",
      entity: "transaction",
      entityId: String(tx.id),
      summary: `${wasFlagged ? "Unflagged" : "FLAGGED"} tx #${tx.id}`,
    });
  };

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{t("transactions")}</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {filtered.length} of {officeTxs.length} · {officeName(currentOffice)}
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_placeholder")}
            className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/70 focus:bg-white focus:border-slate-300 rounded-[8px] text-[13px] outline-none w-56 transition-colors placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Filter bar — EXCHANGE only (раздел не показывает IN/OUT записи) */}
      <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-slate-500 mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold tracking-wide uppercase">{t("filters")}</span>
        </div>
        <div>
          <Select
            value={filterCurrency}
            onChange={setFilterCurrency}
            options={["All", ...CURRENCIES]}
            compact
            icon={<span className="text-[10px] font-bold text-slate-400 tracking-wider">CCY</span>}
          />
        </div>
        <div>
          <Select
            value={filterStatus}
            onChange={setFilterStatus}
            options={STATUS_OPTIONS}
            compact
            icon={<span className="text-[10px] font-bold text-slate-400 tracking-wider">STATUS</span>}
          />
        </div>
        <div>
          <Select
            value={filterManager}
            onChange={setFilterManager}
            options={managers}
            compact
            icon={<span className="text-[10px] font-bold text-slate-400 tracking-wider">MGR</span>}
          />
        </div>
        <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-[8px] px-2 py-1">
          <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase">Amt</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="min"
            className="w-14 bg-transparent outline-none text-[11px] tabular-nums"
          />
          <span className="text-slate-300 text-[10px]">—</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="max"
            className="w-14 bg-transparent outline-none text-[11px] tabular-nums"
          />
        </div>
        <div>
          <Select
            value={filterDate}
            onChange={setFilterDate}
            options={DATE_OPTIONS}
            compact
            icon={<Calendar className="w-3 h-3 text-slate-400" />}
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
          >
            <X className="w-3 h-3" /> {t("clear")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
              <th className="px-5 py-2.5 font-bold">{t("time")}</th>
              <th className="px-3 py-2.5 font-bold">{t("type")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("in")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("rate")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("out")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("fee")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("profit")}</th>
              <th className="px-3 py-2.5 font-bold">Risk</th>
              <th className="px-3 py-2.5 font-bold">{t("manager")}</th>
              <th className="px-5 py-2.5 font-bold w-10"></th>
            </tr>
          </thead>
          <tbody>
            {[...pinnedTxs, ...pagedRegular].map((tx) => {
              const isNew = tx.id === justCreatedId;
              const profitUp = tx.profit >= 0;
              const canEdit = canEditTransaction(tx);
              const outputs = tx.outputs || [{ currency: tx.curOut, amount: tx.amtOut, rate: tx.rate }];
              const firstOut = outputs[0];
              const isDeleted = tx.status === "deleted";
              const rowTooltip = [
                tx.counterparty ? `Client: ${tx.counterparty}` : null,
                tx.comment ? `Comment: ${tx.comment}` : null,
                outputs.length > 1
                  ? `Outputs:\n${outputs.map((o, i) => `  #${i + 1} ${fmt(o.amount, o.currency)} ${o.currency}${o.accountId ? ` (${accounts.find((a) => a.id === o.accountId)?.name || o.accountId})` : " (no account)"}`).join("\n")}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n");
              return (
                <tr
                  key={tx.id}
                  title={rowTooltip || undefined}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors group ${
                    isNew ? "bg-emerald-50/60" : ""
                  } ${isDeleted ? "opacity-50 grayscale line-through" : ""} ${
                    tx.pinned ? "bg-indigo-50/40" : ""
                  }`}
                >
                  <td className="px-5 py-3 whitespace-nowrap">
                    <div className="font-semibold text-slate-900 tabular-nums">{tx.time}</div>
                    <div className="text-[11px] text-slate-400">{tx.date}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                          tx.type === "EXCHANGE"
                            ? "bg-slate-100 text-slate-700"
                            : tx.type === "IN"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {tx.type === "EXCHANGE" && <ArrowLeftRight className="w-2.5 h-2.5" />}
                        {tx.type}
                      </span>
                      {tx.status === "pending" && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                          title={t("pending_hint")}
                        >
                          <Clock className="w-2.5 h-2.5" />
                          {t("pending_badge")}
                        </span>
                      )}
                      {tx.status === "checking" && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                          title={t("tip_checking")}
                        >
                          <Radar className="w-2.5 h-2.5 animate-pulse" />
                          {t("badge_checking")}
                        </span>
                      )}
                      {tx.status === "completed" && tx.confirmedAt && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          title={`${t("badge_confirmed")} ${tx.confirmedAt}${tx.confirmedTxHash ? ` · tx ${tx.confirmedTxHash.slice(0, 10)}…` : ""}`}
                        >
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          {t("badge_confirmed")}
                        </span>
                      )}
                      {isDeleted && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 text-slate-700">
                          <Trash2 className="w-2.5 h-2.5" />
                          {t("status_deleted")}
                        </span>
                      )}
                      {tx.status === "flagged" && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                          title={t("tip_flagged")}
                        >
                          <Flag className="w-2.5 h-2.5" />
                          {t("status_flagged")}
                        </span>
                      )}
                      {tx.pinned && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                          title={t("tip_pinned")}
                        >
                          <Pin className="w-2.5 h-2.5" />
                          {t("badge_pinned")}
                        </span>
                      )}
                      {(() => {
                        // Interoffice indicator: IN account или любой OUT account в другом офисе.
                        const offs = new Set();
                        offs.add(tx.officeId);
                        const inAcc = tx.accountId ? accounts.find((a) => a.id === tx.accountId) : null;
                        if (inAcc) offs.add(inAcc.officeId);
                        (tx.outputs || []).forEach((o) => {
                          if (o.accountId) {
                            const acc = accounts.find((a) => a.id === o.accountId);
                            if (acc) offs.add(acc.officeId);
                          }
                        });
                        if (offs.size <= 1) return null;
                        return (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                            title="Transaction spans more than one office"
                          >
                            <ArrowLeftRight className="w-2.5 h-2.5" />
                            Interoffice
                          </span>
                        );
                      })()}
                      {tx.referral && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700"
                          title="Referral"
                        >
                          <UserPlus className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                  </td>
                  {/* IN: сумма сверху (крупно), валюта под ней (лейбл). */}
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{fmt(tx.amtIn, tx.curIn)}</div>
                    <div className="text-[11px] text-slate-400 font-medium">{tx.curIn}</div>
                    <InStatusLine tx={tx} />
                  </td>
                  {/* RATE посередине — между IN и OUT, как просил кассир. */}
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    {firstOut.rate?.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  {/* OUT: такая же структура как IN (amount + currency label). */}
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    <OutputsCell
                      tx={tx}
                      outputs={outputs}
                      accounts={accounts}
                      canEdit={canEdit && !isDeleted}
                      onSend={(idx) => setSendTarget({ tx, outputIndex: idx })}
                      onConfirm={(idx) => handleConfirmCryptoOut(tx, idx)}
                    />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">${fmt(tx.fee)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold tabular-nums ${
                        tx.profit === 0
                          ? "bg-slate-50 text-slate-500"
                          : profitUp
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {tx.profit === 0 ? "—" : (profitUp ? "+" : "") + "$" + fmt(tx.profit)}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {tx.riskLevel ? (
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ring-1 ${riskLevelStyle(tx.riskLevel)}`}
                        title={(tx.riskFlags || []).join(", ") || "no flags"}
                      >
                        <Shield className="w-2.5 h-2.5" />
                        {riskLevelLabel(tx.riskLevel)} · {tx.riskScore}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700">
                        {tx.manager.split(". ")[1]?.[0] || tx.manager[0]}
                      </div>
                      <span className="text-slate-700 text-[13px]">{tx.manager}</span>
                      {isAdmin && tx.managerId !== undefined && (
                        <span className="text-[9px] text-slate-400">·</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      {tx.status === "pending" && canEdit && (
                        <button
                          onClick={() => handleComplete(tx)}
                          disabled={isBusy(tx.id)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                            isBusy(tx.id)
                              ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                              : "bg-emerald-600 text-white hover:bg-emerald-700"
                          }`}
                          title={t("complete_tx")}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {isBusy(tx.id) ? "…" : t("complete_tx")}
                        </button>
                      )}
                      {tx.status === "checking" && canEdit && (
                        <button
                          onClick={() => handleSimulateConfirm(tx)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-sky-600 text-white hover:bg-sky-700 transition-colors"
                          title="Simulate blockchain incoming tx (demo — stub)"
                        >
                          <Zap className="w-3 h-3" />
                          Simulate
                        </button>
                      )}
                      {canEdit && !isDeleted ? (
                        <>
                          <button
                            onClick={() => handleTogglePin(tx)}
                            className={`transition-opacity p-1.5 rounded-md ${
                              tx.pinned
                                ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 opacity-100"
                                : "text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100"
                            }`}
                            title={tx.pinned ? t("tip_unpin") : t("tip_pin")}
                          >
                            {tx.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleFlag(tx)}
                            className={`transition-opacity p-1.5 rounded-md ${
                              tx.status === "flagged"
                                ? "text-rose-600 bg-rose-50 hover:bg-rose-100 opacity-100"
                                : "text-slate-400 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100"
                            }`}
                            title={tx.status === "flagged" ? t("tip_unflag") : t("tip_flag")}
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onEdit?.(tx)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-900"
                            title={t("edit")}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(tx)}
                            disabled={isBusy(tx.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Delete transaction"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <div
                          className="opacity-0 group-hover:opacity-60 p-1.5 text-slate-400"
                          title={isDeleted ? "Deleted" : t("not_your_tx")}
                        >
                          <Lock className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-16 text-center">
                  <div className="text-slate-400 text-[13px]">{t("no_match")}</div>
                  <button
                    onClick={clearFilters}
                    className="mt-2 text-[12px] text-slate-900 font-medium hover:underline inline-flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> {t("clear_filters")}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-5 py-2 border-t border-slate-100 bg-white flex items-center justify-between flex-wrap gap-2 text-[12px]">
        <div className="flex items-center gap-2 text-slate-500">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
            className="bg-slate-50 border border-slate-200 rounded-[6px] px-2 py-1 text-[11px] font-semibold outline-none"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {pinnedTxs.length > 0 && (
            <span className="text-slate-400 ml-2">
              {pinnedTxs.length} pinned + {regularTxs.length} filtered
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 tabular-nums">
            Page <span className="font-semibold text-slate-900">{safePage}</span> / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className={`p-1 rounded-md border ${
              safePage <= 1
                ? "border-slate-100 text-slate-300 cursor-not-allowed"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className={`p-1 rounded-md border ${
              safePage >= totalPages
                ? "border-slate-100 text-slate-300 cursor-not-allowed"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Footer — totals по всем отфильтрованным (не только на странице) */}
      {(() => {
        // Считаем один раз, reuse в нескольких блоках.
        let totalFees = 0;
        let totalProfit = 0;
        let totalVolumeBase = 0; // в base currency
        let countPending = 0;
        let countCompleted = 0;
        filtered.forEach((tx) => {
          totalFees += tx.fee || 0;
          totalProfit += tx.profit || 0;
          const vol = toBase(tx.amtIn || 0, tx.curIn);
          totalVolumeBase += Number.isFinite(vol) ? vol : 0;
          if (tx.status === "pending" || tx.status === "checking") countPending += 1;
          else if (tx.status === "completed") countCompleted += 1;
        });
        const baseSym = curSymbol(baseCurrency);
        return (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-[12px] flex-wrap gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-slate-500">
                {t("showing")}{" "}
                <span className="font-semibold text-slate-900 tabular-nums">
                  {filtered.length}
                </span>{" "}
                {t("transactions").toLowerCase()}
              </span>
              {countCompleted > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="tabular-nums font-semibold">{countCompleted}</span>
                  <span className="text-emerald-600/70">completed</span>
                </span>
              )}
              {countPending > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="tabular-nums font-semibold">{countPending}</span>
                  <span className="text-amber-600/70">pending</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-5 flex-wrap">
              <div>
                <span className="text-slate-500">Volume: </span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {baseSym}
                  {fmt(totalVolumeBase, baseCurrency)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">{t("total_fees")}: </span>
                <span className="font-bold text-slate-900 tabular-nums">
                  ${fmt(totalFees)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">{t("net_profit")}: </span>
                <span
                  className={`font-bold tabular-nums ${
                    totalProfit >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {totalProfit >= 0 ? "+" : ""}${fmt(totalProfit)}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      <DeleteTxModal
        tx={deleteTarget}
        onCancel={() => !deleteBusy && setDeleteTarget(null)}
        onConfirm={handleDeleteConfirmed}
        busy={deleteBusy}
      />

      <SendCryptoModal
        data={sendTarget}
        onCancel={() => setSendTarget(null)}
        onConfirm={(args) => {
          if (!sendTarget) return;
          handleSendCrypto(sendTarget.tx, sendTarget.outputIndex, args);
          setSendTarget(null);
        }}
      />
    </section>
  );
}

// -------- OutputsCell: multi-output stacked display + crypto send actions --------
function OutputsCell({ tx, outputs, accounts, canEdit, onSend, onConfirm }) {
  if (!Array.isArray(outputs) || outputs.length === 0) return <span>—</span>;

  const tooltip = outputs
    .map((o, i) => {
      const acc = o.accountId ? accounts.find((a) => a.id === o.accountId) : null;
      const accName = acc ? acc.name : o.accountId ? "(unknown account)" : "No account";
      const sendInfo = o.sendStatus ? ` · ${o.sendStatus}` : "";
      const addrInfo = o.address ? ` · ${o.address.slice(0, 10)}…` : "";
      return `#${i + 1}: ${fmt(o.amount, o.currency)} ${o.currency} · ${accName}${addrInfo}${sendInfo}`;
    })
    .join("\n");

  // Single output без crypto flow — компактное отображение.
  if (outputs.length === 1 && !outputs[0].sendStatus) {
    const o = outputs[0];
    return (
      <div title={tooltip}>
        <div className="font-semibold text-slate-900">{fmt(o.amount, o.currency)}</div>
        <div className="text-[11px] text-slate-400 font-medium">{o.currency}</div>
      </div>
    );
  }

  // Multi-output или crypto-output: каждая выдача отдельной строкой.
  return (
    <div title={tooltip} className="space-y-1">
      {outputs.map((o, i) => (
        <OutputRowLine
          key={i}
          output={o}
          index={i}
          canEdit={canEdit}
          onSend={() => onSend?.(i)}
          onConfirm={() => onConfirm?.(i)}
        />
      ))}
    </div>
  );
}

function OutputRowLine({ output: o, index, canEdit, onSend, onConfirm }) {
  const isCryptoOut = !!o.sendStatus;
  // Leg-level status (pending / partial / delayed / completed) из planned/actual/at-fields.
  // Для legacy-сделок без этих полей fallback: считаем completed если нет явных признаков.
  const legacy = o.plannedAmount === undefined && o.actualAmount === undefined;
  const legState = legacy
    ? { status: "completed", progress: 1, planned: o.amount, actual: o.amount }
    : computeLegStatus({
        plannedAmount: o.plannedAmount ?? o.amount,
        actualAmount: o.actualAmount ?? 0,
        plannedAt: o.plannedAt,
        completedAt: o.completedAt,
      });
  const legStyle = legStatusStyle(legState.status);
  const showLegChip = !legacy && !isCryptoOut; // для crypto OUT есть отдельный SendStatusBadge

  return (
    <div className="flex items-center justify-end gap-1.5 flex-wrap">
      <span className="font-semibold text-slate-900 text-[13px] tabular-nums">
        {fmt(o.amount, o.currency)}
      </span>
      <span className="text-[10px] text-slate-500 font-bold w-10 text-left">
        {o.currency}
      </span>

      {/* Partial: показываем прогресс "actual / planned" */}
      {legState.status === "partial" && (
        <span className="text-[10px] font-bold text-violet-700 tabular-nums">
          {fmt(legState.actual, o.currency)}/{fmt(legState.planned, o.currency)}
        </span>
      )}

      {/* Leg status chip (для не-crypto) */}
      {showLegChip && legState.status !== "completed" && (
        <span
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ring-1 ${legStyle.cls}`}
          title={
            legState.status === "delayed"
              ? `Planned ${formatShortDate(o.plannedAt)} · delayed ${legState.delayDays}d`
              : `Planned ${formatShortDate(o.plannedAt)}`
          }
        >
          {legState.status === "delayed" ? "⚠ Delayed" : legStyle.label}
        </span>
      )}

      {/* Completed date (compact) — только если не legacy и сделка не свежая */}
      {showLegChip && legState.status === "completed" && o.completedAt && (
        <span className="text-[10px] text-slate-400 tabular-nums">
          ✓ {formatShortDate(o.completedAt)}
        </span>
      )}

      {/* Crypto send badge (TRC20/ERC20 lifecycle) */}
      {isCryptoOut && <SendStatusBadge status={o.sendStatus} />}

      {isCryptoOut && canEdit && o.sendStatus === "pending_send" && (
        <button
          onClick={onSend}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-600 text-white hover:bg-sky-700 transition-colors"
          title="Enter on-chain tx hash"
        >
          <Send className="w-2.5 h-2.5" />
          Send
        </button>
      )}
      {isCryptoOut && canEdit && o.sendStatus === "sent" && (
        <button
          onClick={onConfirm}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          title="Simulate blockchain confirmation (demo)"
        >
          <CheckCircle2 className="w-2.5 h-2.5" />
          Confirm
        </button>
      )}
    </div>
  );
}

// IN-сторона статус — показывает получено / ждём / delayed.
// Legacy-сделки без inPlannedAt/inCompletedAt: показываем как completed (тихо).
function InStatusLine({ tx }) {
  const legacy = tx.inPlannedAt === undefined && tx.inCompletedAt === undefined;
  if (legacy) return null;
  const state = computeLegStatus({
    plannedAmount: tx.inPlannedAmount ?? tx.amtIn ?? 0,
    actualAmount: tx.inActualAmount ?? 0,
    plannedAt: tx.inPlannedAt,
    completedAt: tx.inCompletedAt,
  });
  if (state.status === "completed") {
    return tx.inCompletedAt ? (
      <div className="text-[9px] text-slate-400 tabular-nums mt-0.5">
        ✓ {formatShortDate(tx.inCompletedAt)}
      </div>
    ) : null;
  }
  const style = legStatusStyle(state.status);
  if (state.status === "partial") {
    return (
      <div className="text-[9px] font-bold text-violet-700 tabular-nums mt-0.5">
        {fmt(state.actual, tx.curIn)}/{fmt(state.planned, tx.curIn)}
      </div>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold ring-1 mt-0.5 ${style.cls}`}
      title={
        state.status === "delayed"
          ? `Planned ${formatShortDate(tx.inPlannedAt)} · delayed ${state.delayDays}d`
          : `Waiting · planned ${formatShortDate(tx.inPlannedAt)}`
      }
    >
      {state.status === "delayed" ? "⚠ Delayed" : "🟡 Waiting"}
    </div>
  );
}

function SendStatusBadge({ status }) {
  if (!status) return null;
  const map = {
    pending_send: { label: "Pending send", cls: "bg-amber-50 text-amber-700 ring-amber-200", Icon: Clock },
    sent: { label: "Sent", cls: "bg-sky-50 text-sky-700 ring-sky-200", Icon: Upload },
    checking: { label: "Checking", cls: "bg-sky-50 text-sky-700 ring-sky-200", Icon: Radar },
    confirmed: { label: "Confirmed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", Icon: CheckCircle2 },
  };
  const m = map[status] || { label: status, cls: "bg-slate-100 text-slate-600 ring-slate-200", Icon: Clock };
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold ring-1 ${m.cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {m.label}
    </span>
  );
}

// -------- Send crypto modal: manager вводит on-chain txHash --------
function SendCryptoModal({ data, onCancel, onConfirm }) {
  const [txHash, setTxHash] = useState("");
  const [network, setNetwork] = useState("");
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (data) {
      setTxHash("");
      setNetwork(data.tx?.outputs?.[data.outputIndex]?.network || "");
      setError("");
    }
  }, [data]);

  if (!data) return null;
  const { tx, outputIndex } = data;
  const output = tx?.outputs?.[outputIndex];
  if (!output) return null;

  const handleSubmit = () => {
    setError("");
    const h = txHash.trim();
    if (!h) {
      setError("Enter a transaction hash");
      return;
    }
    // Минимальная валидация формата (0x + 64 hex или 64 hex без префикса).
    const is0x = /^0x[A-Fa-f0-9]{64}$/.test(h);
    const isTron = /^[A-Fa-f0-9]{64}$/.test(h);
    if (!is0x && !isTron) {
      setError("Unexpected tx hash format (expected 64-hex or 0x + 64-hex)");
      return;
    }
    onConfirm({ txHash: h, network });
  };

  return (
    <Modal open={!!data} onClose={onCancel} title="Record outgoing transfer" width="md">
      <div className="p-5 space-y-3">
        <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 text-[12px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-500">
              <span className="text-[10px] font-bold uppercase tracking-wider mr-1">Deal</span>
              #{tx.id} · output {outputIndex + 1}
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {fmt(output.amount, output.currency)} {output.currency}
            </span>
          </div>
          {output.address && (
            <div className="mt-1 text-[11px] text-slate-500 font-mono truncate">
              → {output.address}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Network
          </label>
          <div className="flex gap-1.5">
            {["TRC20", "ERC20", "BEP20"].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNetwork(n)}
                className={`px-3 py-1.5 text-[12px] font-semibold rounded-[8px] border transition-colors ${
                  network === n
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            On-chain tx hash
          </label>
          <input
            type="text"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value.trim())}
            autoFocus
            placeholder="0x… or 64-hex"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[12px] font-mono outline-none"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            After saving, status moves to <span className="font-semibold">Sent</span>.
            Balance stays reserved until you click <span className="font-semibold">Confirm</span> (demo)
            or polling auto-confirms in production.
          </p>
        </div>

        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="px-4 py-2 rounded-[10px] bg-sky-600 text-white text-[13px] font-semibold hover:bg-sky-700 transition-colors inline-flex items-center gap-1.5"
        >
          <Send className="w-3 h-3" />
          Mark as sent
        </button>
      </div>
    </Modal>
  );
}

// -------- Delete confirmation modal --------
function DeleteTxModal({ tx, onCancel, onConfirm, busy = false }) {
  if (!tx) return null;
  const isConfirmedCrypto = tx.status === "completed" && !!tx.confirmedTxHash;
  return (
    <Modal open={!!tx} onClose={onCancel} title="Delete transaction?" width="md">
      <div className="p-5 space-y-3">
        <p className="text-[13px] text-slate-700">
          Deleting <span className="font-semibold">#{tx.id}</span> ({tx.curIn}{" "}
          {tx.amtIn}) will roll back all its fund movements.
        </p>
        {isConfirmedCrypto && (
          <div className="text-[12px] font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 inline-flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              This deal was auto-confirmed on-chain (tx{" "}
              <span className="font-mono">{tx.confirmedTxHash?.slice(0, 10)}…</span>).
              Deleting it will remove the movements but the real blockchain transfer
              already happened. Proceed only if this is a manual correction.
            </span>
          </div>
        )}
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Row stays visible with a <span className="font-semibold">Deleted</span> badge.
          The transaction can't be restored from the UI.
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`px-4 py-2 rounded-[10px] text-white text-[13px] font-semibold transition-colors inline-flex items-center gap-1.5 ${
            busy ? "bg-rose-400 cursor-not-allowed" : "bg-rose-600 hover:bg-rose-700"
          }`}
        >
          <Trash2 className="w-3 h-3" />
          {busy ? "Deleting…" : "Delete & rollback"}
        </button>
      </div>
    </Modal>
  );
}
