// src/components/accounts/TransferHistoryModal.jsx
// История всех перемещений между счетами (transfers таблица).
// Фильтры по статусу + поиску. Открывается с AccountsPage.

import React, { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  XCircle,
  Ban,
  Clock,
  Search,
  X,
  Download,
  Building2,
} from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAuth } from "../../store/auth.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { officeName } from "../../store/data.js";
import { exportCSV } from "../../utils/csv.js";

const STATUS_FILTERS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Pending" },
  { id: "confirmed", label: "Подтверждены" },
  { id: "rejected", label: "Отклонены" },
  { id: "cancelled", label: "Отменены" },
];

const STATUS_STYLE = {
  pending: { icon: Clock, bg: "bg-warning-soft", text: "text-warning", border: "border-warning/20", label: "Pending" },
  confirmed: { icon: CheckCircle2, bg: "bg-success-soft", text: "text-success", border: "border-success/20", label: "Подтверждено" },
  rejected: { icon: XCircle, bg: "bg-danger-soft", text: "text-danger", border: "border-danger/20", label: "Отклонено" },
  cancelled: { icon: Ban, bg: "bg-surface-sunk", text: "text-ink-soft", border: "border-border-soft", label: "Отменено" },
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TransferHistoryModal({ open, onClose }) {
  const { transfers, accounts } = useAccounts();
  const { users } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  const accById = (id) => accounts.find((a) => a.id === id);
  const userById = (id) => (users || []).find((u) => u.id === id);

  // Sorted desc by createdAt
  const sortedTransfers = useMemo(() => {
    if (!Array.isArray(transfers)) return [];
    return [...transfers].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }, [transfers]);

  const filtered = useMemo(() => {
    let list = sortedTransfers;
    if (statusFilter !== "all") {
      list = list.filter((t) => t.status === statusFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const fromAcc = accById(t.fromAccountId);
        const toAcc = accById(t.toAccountId);
        const sender = userById(t.createdBy);
        const receiver = userById(t.toManagerId);
        const haystack = [
          fromAcc?.name,
          toAcc?.name,
          fromAcc?.currency,
          toAcc?.currency,
          fromAcc?.officeId && officeName(fromAcc.officeId),
          toAcc?.officeId && officeName(toAcc.officeId),
          sender?.name,
          receiver?.name,
          t.note,
          t.confirmationNote,
          t.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return list;
  }, [sortedTransfers, statusFilter, query, accounts, users]);

  // Counts per status для табов
  const counts = useMemo(() => {
    const c = { all: sortedTransfers.length };
    sortedTransfers.forEach((t) => {
      c[t.status] = (c[t.status] || 0) + 1;
    });
    return c;
  }, [sortedTransfers]);

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportCSV({
      filename: `coinplata-transfers-${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "createdAt", label: "Date" },
        { key: "fromOffice", label: "From Office" },
        { key: "fromAccount", label: "From Account" },
        { key: "fromAmount", label: "From Amount" },
        { key: "fromCurrency", label: "From CCY" },
        { key: "toOffice", label: "To Office" },
        { key: "toAccount", label: "To Account" },
        { key: "toAmount", label: "To Amount" },
        { key: "toCurrency", label: "To CCY" },
        { key: "rate", label: "Rate" },
        { key: "status", label: "Status" },
        { key: "sender", label: "Sender" },
        { key: "receiver", label: "Receiver" },
        { key: "note", label: "Note" },
      ],
      rows: filtered.map((t) => {
        const fromAcc = accById(t.fromAccountId);
        const toAcc = accById(t.toAccountId);
        const sender = userById(t.createdBy);
        const receiver = userById(t.toManagerId);
        return {
          createdAt: formatDate(t.createdAt),
          fromOffice: fromAcc ? officeName(fromAcc.officeId) : "—",
          fromAccount: fromAcc?.name || "—",
          fromAmount: t.fromAmount,
          fromCurrency: fromAcc?.currency || "—",
          toOffice: toAcc ? officeName(toAcc.officeId) : "—",
          toAccount: toAcc?.name || "—",
          toAmount: t.toAmount,
          toCurrency: toAcc?.currency || "—",
          rate: t.rate || "",
          status: t.status,
          sender: sender?.name || "",
          receiver: receiver?.name || "",
          note: t.note || "",
        };
      }),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="История перемещений"
      subtitle={`${filtered.length} из ${sortedTransfers.length} транзакций`}
      width="3xl"
    >
      <div className="p-5">
        {/* Filters bar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.id;
            const count = counts[f.id] || 0;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-button text-[11px] font-bold transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "bg-surface-sunk text-ink-soft hover:bg-surface-sunk"
                }`}
              >
                {f.label}
                <span
                  className={`tabular-nums text-[10px] px-1 rounded ${
                    active ? "bg-white/20" : "bg-surface-sunk/70 text-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
          <div className="flex-1 min-w-[180px] flex items-center gap-1.5 bg-surface-soft border border-border-soft rounded-button px-2 py-1.5">
            <Search className="w-3.5 h-3.5 text-muted-soft shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по счёту, офису, менеджеру, заметке…"
              className="flex-1 bg-transparent outline-none text-[12px] text-ink placeholder:text-muted-soft min-w-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-0.5 rounded hover:bg-surface-sunk text-muted transition-colors shrink-0"
                title="Очистить"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-button text-[11px] font-semibold bg-white border border-border-soft text-ink-soft hover:text-ink hover:border-border disabled:opacity-50 transition-colors"
            title="Export CSV"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>

        {/* Список */}
        <div className="bg-surface-soft/40 border border-border-soft rounded-card overflow-hidden max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-soft italic">
              Ничего не найдено
            </div>
          ) : (
            <div className="divide-y divide-border-soft bg-white">
              {filtered.map((t) => {
                const fromAcc = accById(t.fromAccountId);
                const toAcc = accById(t.toAccountId);
                const sender = userById(t.createdBy);
                const receiver = userById(t.toManagerId);
                const isInterOffice = fromAcc && toAcc && fromAcc.officeId !== toAcc.officeId;
                const styl = STATUS_STYLE[t.status] || STATUS_STYLE.confirmed;
                const StatusIcon = styl.icon;
                const fromCur = fromAcc?.currency || "—";
                const toCur = toAcc?.currency || "—";
                return (
                  <div key={t.id} className="px-4 py-3 hover:bg-surface-soft/60 transition-colors">
                    <div className="flex items-center gap-3 flex-wrap">
                      {isInterOffice ? (
                        <ArrowUpFromLine className="w-4 h-4 text-accent shrink-0" />
                      ) : (
                        <ArrowDownToLine className="w-4 h-4 text-muted-soft shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-ink inline-flex items-center gap-2 flex-wrap">
                          <span className="tabular-nums">
                            {curSymbol(fromCur)}
                            {fmt(t.fromAmount, fromCur)} {fromCur}
                          </span>
                          {fromCur !== toCur && (
                            <>
                              <span className="text-muted-soft">→</span>
                              <span className="tabular-nums">
                                {curSymbol(toCur)}
                                {fmt(t.toAmount, toCur)} {toCur}
                              </span>
                              {t.rate && (
                                <span className="text-[10px] text-muted font-normal">
                                  @ {t.rate}
                                </span>
                              )}
                            </>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${styl.bg} ${styl.text} ${styl.border}`}
                          >
                            <StatusIcon className="w-2.5 h-2.5" />
                            {styl.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted inline-flex items-center gap-1.5 flex-wrap mt-0.5">
                          <Building2 className="w-3 h-3" />
                          <span className="truncate">
                            {fromAcc ? `${officeName(fromAcc.officeId)} · ${fromAcc.name}` : "—"}
                          </span>
                          <span className="text-muted-soft">→</span>
                          <span className="truncate">
                            {toAcc ? `${officeName(toAcc.officeId)} · ${toAcc.name}` : "—"}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-muted-soft inline-flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span>{formatDate(t.createdAt)}</span>
                          {sender && (
                            <>
                              <span className="text-muted-soft">·</span>
                              <span>от {sender.name}</span>
                            </>
                          )}
                          {receiver && (
                            <>
                              <span className="text-muted-soft">→</span>
                              <span>{receiver.name}</span>
                            </>
                          )}
                          {t.note && (
                            <>
                              <span className="text-muted-soft">·</span>
                              <span className="italic truncate">{t.note}</span>
                            </>
                          )}
                          {t.confirmationNote && (
                            <>
                              <span className="text-muted-soft">·</span>
                              <span className="italic text-muted truncate">
                                {t.status === "rejected" || t.status === "cancelled"
                                  ? "причина: "
                                  : "заметка: "}
                                {t.confirmationNote}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
