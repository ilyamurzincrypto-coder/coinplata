// src/pages/capital/AccountingTab.jsx
//
// Бухгалтерский репорт — лента операций со статусом проверки бухгалтером.
// Доступен только при can('accounting'). Гард ставится в CapitalPage.
//
// Источник данных: v_accounting_feed (миграция 0088).
// UNION ALL по 5 типам: deal, transfer, expense, balance_adjustment, cash_closure.
//
// UX:
//   - Filters bar (period, office, manager, type, status, search)
//   - Status tabs (Pending / Approved / Rejected) с counter'ами
//   - Feed table с expand для деталей (для deal — legs+payments+obligations)
//   - Approve / Reject модалки + Bulk-approve через checkboxes

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, XCircle, Clock, AlertCircle, Filter, Search, Building2,
  User, Tag, ChevronDown, ChevronRight, FileText, RotateCcw, ListChecks,
  ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import Select from "../../components/ui/Select.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { officeName } from "../../store/data.js";
import { useTranslation } from "../../i18n/translations.jsx";
import {
  loadAccountingFeed,
  loadAccountingDealDetail,
} from "../../lib/supabaseReaders.js";
import {
  rpcAccountingReview,
  rpcAccountingReviewBulk,
  withToast,
} from "../../lib/supabaseWrite.js";
import DealDetailPanel from "../../components/DealDetailPanel.jsx";

const ENTITY_TYPE_LABELS = {
  deal: "Сделка",
  transfer: "Трансфер",
  expense: "Доход/расход",
  balance_adjustment: "Корректировка",
  cash_closure: "Закрытие кассы",
};

const STATUS_LABELS = {
  pending_review: "На проверке",
  approved: "Подтверждено",
  rejected: "Отклонено",
};

const STATUS_TONE = {
  pending_review: "amber",
  approved: "emerald",
  rejected: "rose",
};

export default function AccountingTab({ range }) {
  const { t } = useTranslation();
  const { offices } = useOffices();
  const { users } = useAuth();
  const { accounts } = useAccounts();
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusTab, setStatusTab] = useState("pending_review");
  const [filterOffice, setFilterOffice] = useState("all");
  const [filterManager, setFilterManager] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);     // entity_id
  const [reviewTarget, setReviewTarget] = useState(null); // single
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null); // 'approve' | 'reject'
  const [refreshTick, setRefreshTick] = useState(0);

  // Load feed
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadAccountingFeed({
      from: range?.from,
      to: range?.to,
      officeId: filterOffice !== "all" ? filterOffice : null,
      managerId: filterManager !== "all" ? filterManager : null,
      entityType: filterType !== "all" ? filterType : null,
      search,
    })
      .then((data) => {
        if (cancelled) return;
        setFeed(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range?.from, range?.to, filterOffice, filterManager, filterType, search, refreshTick]);

  // Counters by status
  const statusCounts = useMemo(() => {
    const c = { pending_review: 0, approved: 0, rejected: 0 };
    feed.forEach((r) => {
      if (c[r.accountingStatus] !== undefined) c[r.accountingStatus] += 1;
    });
    return c;
  }, [feed]);

  // Filter by status tab
  const visible = useMemo(
    () => feed.filter((r) => r.accountingStatus === statusTab),
    [feed, statusTab]
  );

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    setSelectedIds(new Set(visible.map((r) => `${r.entityType}:${r.entityId}`)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const refreshFeed = () => setRefreshTick((t) => t + 1);

  return (
    <div className="space-y-4">
      {/* Header / counters */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex items-center gap-3 flex-wrap">
        <FileText className="w-4 h-4 text-slate-500" />
        <span className="text-[14px] font-bold text-slate-900">{t("acc_title")}</span>
        <span className="text-[11px] text-slate-500">— {t("acc_subtitle")}</span>
        <div className="ml-auto flex items-center gap-1">
          <StatusTab
            active={statusTab === "pending_review"}
            onClick={() => setStatusTab("pending_review")}
            count={statusCounts.pending_review}
            tone="amber"
            icon={Clock}
            label="На проверке"
          />
          <StatusTab
            active={statusTab === "approved"}
            onClick={() => setStatusTab("approved")}
            count={statusCounts.approved}
            tone="emerald"
            icon={CheckCircle2}
            label="Подтверждено"
          />
          <StatusTab
            active={statusTab === "rejected"}
            onClick={() => setStatusTab("rejected")}
            count={statusCounts.rejected}
            tone="rose"
            icon={XCircle}
            label="Отклонено"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-slate-400">
          <Filter className="w-3.5 h-3.5" />
        </div>
        <Select
          value={filterOffice} onChange={setFilterOffice}
          options={[{ value: "all", label: "Все офисы" }, ...offices.map((o) => ({ value: o.id, label: o.name }))]}
          compact icon={<Building2 className="w-3 h-3 text-slate-400" />}
        />
        <Select
          value={filterManager} onChange={setFilterManager}
          options={[
            { value: "all", label: "Все менеджеры" },
            ...users.filter((u) => u.role === "manager" || u.role === "admin")
              .map((u) => ({ value: u.id, label: u.full_name || u.email }))
          ]}
          compact icon={<User className="w-3 h-3 text-slate-400" />}
        />
        <Select
          value={filterType} onChange={setFilterType}
          options={[
            { value: "all", label: "Все типы" },
            { value: "deal", label: "Сделки" },
            { value: "transfer", label: "Трансферы" },
            { value: "expense", label: "Доход/расход" },
            { value: "balance_adjustment", label: "Корректировки" },
            { value: "cash_closure", label: "Закрытия кассы" },
          ]}
          compact icon={<Tag className="w-3 h-3 text-slate-400" />}
        />
        <div className="flex-1 min-w-[160px] relative">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по контрагенту / комменту / id"
            className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-slate-50 border border-slate-200 rounded-[8px] outline-none focus:bg-white focus:border-slate-300"
          />
        </div>
        <button
          onClick={refreshFeed}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300"
          title="Обновить"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && statusTab === "pending_review" && (
        <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2 flex items-center gap-3">
          <ListChecks className="w-4 h-4 text-amber-700" />
          <span className="text-[12px] font-bold text-amber-900">
            Выбрано: {selectedIds.size}
          </span>
          <button
            onClick={clearSelection}
            className="text-[11px] text-amber-800 hover:text-amber-900 underline"
          >
            Снять выбор
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setBulkAction("approve")}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-[8px] bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700"
            >
              <CheckCircle2 className="w-3 h-3" />
              Подтвердить выбранные
            </button>
            <button
              onClick={() => setBulkAction("reject")}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-[8px] bg-rose-600 text-white text-[12px] font-bold hover:bg-rose-700"
            >
              <XCircle className="w-3 h-3" />
              Отклонить выбранные
            </button>
          </div>
        </div>
      )}

      {/* Feed */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] overflow-hidden">
        {loading && (
          <div className="px-5 py-12 text-center text-[13px] text-slate-400">Загрузка…</div>
        )}
        {error && !loading && (
          <div className="px-5 py-8 text-center text-[12.5px] text-rose-600 bg-rose-50">
            <AlertCircle className="inline w-4 h-4 mr-1" />
            Ошибка загрузки: {error}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="px-5 py-12 text-center text-[13px] text-slate-400">
            {statusTab === "pending_review" ? "Нет операций на проверке" :
             statusTab === "approved" ? "Нет подтверждённых операций в выбранном диапазоне" :
             "Нет отклонённых операций"}
          </div>
        )}
        {!loading && !error && visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 tracking-wider uppercase">
                <tr>
                  {statusTab === "pending_review" && (
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === visible.length}
                        onChange={(e) => e.target.checked ? selectAll() : clearSelection()}
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 text-left">Дата</th>
                  <th className="px-3 py-2 text-left">Тип</th>
                  <th className="px-3 py-2 text-left">Офис</th>
                  <th className="px-3 py-2 text-left">Менеджер</th>
                  <th className="px-3 py-2 text-left">Контрагент</th>
                  <th className="px-3 py-2 text-right">Поступило</th>
                  <th className="px-3 py-2 text-right">Выдано</th>
                  <th className="px-3 py-2 text-right">Profit</th>
                  <th className="px-3 py-2 text-left">Статус сделки</th>
                  <th className="px-5 py-2 text-right w-32">Действие</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const key = `${r.entityType}:${r.entityId}`;
                  const isExpanded = expanded === key;
                  const isSelected = selectedIds.has(key);
                  const manager = r.managerId ? usersById[r.managerId] : null;
                  const approver = r.approvedBy ? usersById[r.approvedBy] : null;
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${
                          isExpanded ? "bg-slate-50" : ""
                        }`}
                        onClick={() => setExpanded(isExpanded ? null : key)}
                      >
                        {statusTab === "pending_review" && (
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(key)}
                            />
                          </td>
                        )}
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 tabular-nums">
                          {formatDate(r.occurredAt)}
                          {r.underlyingUpdatedAt && (
                            <div className="text-[9.5px] text-amber-600" title="Подтверждение устарело — операция была изменена">
                              ↻ ред. {formatDate(r.underlyingUpdatedAt)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <EntityBadge type={r.entityType} dealKind={r.dealKind} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{officeName(r.officeId) || "—"}</td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {manager?.full_name || (r.createdBy ? usersById[r.createdBy]?.full_name : "—") || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate">
                          {r.counterpartyLabel || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {r.primaryAmount != null && r.primaryCurrency ? (
                            <>
                              <span className="font-semibold">{fmt(r.primaryAmount, r.primaryCurrency)}</span>
                              <span className="text-[10px] text-slate-400 ml-1">{r.primaryCurrency}</span>
                            </>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {r.secondaryAmount != null && r.secondaryCurrency ? (
                            <>
                              <span className="font-semibold">{fmt(r.secondaryAmount, r.secondaryCurrency)}</span>
                              <span className="text-[10px] text-slate-400 ml-1">{r.secondaryCurrency}</span>
                            </>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {r.profitUsd > 0 && (
                            <span className="text-emerald-700 font-bold">+${fmt(r.profitUsd, "USD")}</span>
                          )}
                          {r.profitUsd < 0 && (
                            <span className="text-rose-700 font-bold">−${fmt(Math.abs(r.profitUsd), "USD")}</span>
                          )}
                          {(!r.profitUsd || r.profitUsd === 0) && <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 text-[11px]">
                          {r.opStatus || "—"}
                        </td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          {r.accountingStatus === "pending_review" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setReviewTarget(r);
                              }}
                              className="px-2 py-1 rounded-[6px] bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800"
                            >
                              Проверить
                            </button>
                          )}
                          {r.accountingStatus === "approved" && approver && (
                            <div className="text-[10px] text-emerald-700">
                              ✓ {approver.full_name?.split(" ")[0] || "—"}
                              <div className="text-[9px] text-slate-400">{formatDate(r.approvedAt)}</div>
                            </div>
                          )}
                          {r.accountingStatus === "rejected" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setReviewTarget(r);
                              }}
                              className="px-2 py-1 rounded-[6px] bg-rose-50 text-rose-700 text-[11px] font-semibold hover:bg-rose-100 border border-rose-200"
                              title={r.rejectionReason}
                            >
                              Пересмотреть
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-slate-200">
                          <td colSpan={statusTab === "pending_review" ? 11 : 10} className="bg-slate-50 px-5 py-3">
                            <ExpandedDetail
                              row={r}
                              accountsById={accountsById}
                              usersById={usersById}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Single review modal */}
      {reviewTarget && (
        <ReviewModal
          row={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onDone={() => {
            setReviewTarget(null);
            refreshFeed();
          }}
        />
      )}

      {/* Bulk action modal */}
      {bulkAction && (
        <BulkActionModal
          action={bulkAction}
          items={[...selectedIds].map((k) => {
            const [entityType, entityId] = k.split(":");
            return { entityType, entityId };
          })}
          onClose={() => setBulkAction(null)}
          onDone={() => {
            setBulkAction(null);
            clearSelection();
            refreshFeed();
          }}
        />
      )}
    </div>
  );
}

// ─── Status tab ────────────────────────────────────────────────────────

function StatusTab({ active, onClick, count, tone, icon: Icon, label }) {
  const cls = active
    ? {
        amber: "bg-amber-600 text-white",
        emerald: "bg-emerald-600 text-white",
        rose: "bg-rose-600 text-white",
      }[tone]
    : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[11.5px] font-semibold ${cls} transition-colors`}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
      {count > 0 && (
        <span className={`text-[10px] font-bold px-1 rounded ${active ? "bg-white/20" : "bg-slate-100"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Entity badge ──────────────────────────────────────────────────────

function EntityBadge({ type, dealKind }) {
  const cls = {
    deal: dealKind === "otc" ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
        : dealKind === "broker" ? "bg-violet-50 text-violet-700 ring-violet-200"
        : "bg-slate-50 text-slate-700 ring-slate-200",
    transfer: "bg-sky-50 text-sky-700 ring-sky-200",
    expense: "bg-amber-50 text-amber-700 ring-amber-200",
    balance_adjustment: "bg-orange-50 text-orange-700 ring-orange-200",
    cash_closure: "bg-purple-50 text-purple-700 ring-purple-200",
  }[type] || "bg-slate-50 text-slate-700 ring-slate-200";
  const label = type === "deal" && dealKind && dealKind !== "regular"
    ? dealKind.toUpperCase()
    : ENTITY_TYPE_LABELS[type] || type;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-bold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

// ─── Expanded detail ───────────────────────────────────────────────────

function ExpandedDetail({ row, accountsById, usersById }) {
  if (row.entityType === "deal") {
    return (
      <DealDetailPanel
        dealId={row.entityId}
        hint={{
          amountIn: row.primaryAmount,
          currencyIn: row.primaryCurrency,
          inKind: row.dealInKind,
          feeUsd: row.feeUsd,
          commissionUsd: row.commissionUsd,
          profit: row.profitUsd,
        }}
        accountsById={accountsById}
      />
    );
  }
  return (
    <div className="space-y-1.5 text-[12px]">
      <DetailRow label="ID" value={row.entityId} />
      {row.transferKind && <DetailRow label="Тип трансфера" value={row.transferKind} />}
      {row.expenseType && <DetailRow label="Тип" value={row.expenseType} />}
      {row.comment && <DetailRow label="Комментарий" value={row.comment} />}
      {row.rejectionReason && (
        <DetailRow label="Причина отклонения" value={row.rejectionReason} tone="rose" />
      )}
      {row.reviewerNotes && <DetailRow label="Заметка бухгалтера" value={row.reviewerNotes} />}
    </div>
  );
}

function DealDetail({ row, accountsById }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    loadAccountingDealDetail(row.entityId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && console.warn("[AccountingTab] dealDetail", e))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [row.entityId]);

  if (loading) return <div className="text-[12px] text-slate-400">Загрузка деталей сделки…</div>;
  if (!detail) return <div className="text-[12px] text-slate-400">Не удалось загрузить детали.</div>;

  const accLabel = (id) => accountsById[id]?.name || (id ? `#${String(id).slice(0, 8)}` : "—");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-[12px]">
      {/* IN side */}
      <div className="rounded-[8px] border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          <ArrowDownLeft className="w-3 h-3 text-rose-500" />
          IN — клиент отдал
        </div>
        <div className="text-[15px] font-bold text-slate-900 tabular-nums mb-1">
          {fmt(row.primaryAmount, row.primaryCurrency)} {row.primaryCurrency}
        </div>
        <div className="text-[10.5px] text-slate-500">
          Тип: {row.dealInKind || "—"}
        </div>
        {detail.inPayments.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[9.5px] font-bold text-slate-400 uppercase">Платежи</div>
            {detail.inPayments.map((p) => (
              <div key={p.id} className="text-[10.5px] text-slate-600 flex items-center justify-between">
                <span>{formatDate(p.paidAt)} · {p.kind === "ours_now" ? accLabel(p.accountId) : `Партнёр #${String(p.partnerAccountId || "").slice(0, 8)}`}</span>
                <span className="font-semibold tabular-nums">{fmt(p.amount, p.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* OUT legs */}
      <div className="rounded-[8px] border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          <ArrowUpRight className="w-3 h-3 text-emerald-500" />
          OUT — клиент получил
        </div>
        {detail.legs.length === 0 && <div className="text-[11px] text-slate-400">Нет legs</div>}
        {detail.legs.map((l) => (
          <div key={l.id} className="border-b border-slate-100 last:border-0 py-1">
            <div className="flex items-center justify-between text-[11.5px]">
              <div>
                <span className="font-semibold tabular-nums">{fmt(l.amount, l.currency)} {l.currency}</span>
                <span className="text-slate-400 ml-1.5">@ {l.rate}</span>
              </div>
              <span className="text-[9.5px] text-slate-500">{l.outKind}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              {l.outKind === "ours_now" ? accLabel(l.accountId) : l.outKind === "partner_now" ? `Партнёр #${String(l.partnerAccountId || "").slice(0, 8)}` : "—"}
              {l.completedAt ? <span className="text-emerald-600 ml-1">✓</span> : <span className="text-amber-600 ml-1">⏳</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Obligations */}
      <div className="rounded-[8px] border border-slate-200 bg-white p-3">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          Обязательства
        </div>
        {detail.obligations.length === 0 && <div className="text-[11px] text-slate-400">Нет</div>}
        {detail.obligations.map((o) => {
          const remaining = o.amount - o.paidAmount;
          return (
            <div key={o.id} className="border-b border-slate-100 last:border-0 py-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {o.direction === "we_owe" ? "Мы должны" : "Должны нам"} ·
                  <span className="text-slate-500 ml-1">{o.counterpartyName || "—"}</span>
                </span>
                <span className="tabular-nums font-bold">{fmt(remaining, o.currency)} {o.currency}</span>
              </div>
              <div className="text-[9.5px] text-slate-500">
                {o.status} · paid {fmt(o.paidAmount, o.currency)} / {fmt(o.amount, o.currency)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Comment / reviewer notes */}
      {(row.comment || row.rejectionReason || row.reviewerNotes) && (
        <div className="lg:col-span-3 rounded-[8px] border border-slate-200 bg-white p-3 text-[11.5px] space-y-1.5">
          {row.comment && <DetailRow label="Комментарий" value={row.comment} />}
          {row.rejectionReason && (
            <DetailRow label="Причина отклонения" value={row.rejectionReason} tone="rose" />
          )}
          {row.reviewerNotes && <DetailRow label="Заметка бухгалтера" value={row.reviewerNotes} />}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, tone }) {
  const cls = tone === "rose" ? "text-rose-700" : "text-slate-700";
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider w-32 shrink-0">{label}</span>
      <span className={`text-[12px] ${cls}`}>{value}</span>
    </div>
  );
}

// ─── Review modal (single) ────────────────────────────────────────────

function ReviewModal({ row, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (action) => {
    if (busy) return;
    if (action === "reject" && !reason.trim()) {
      alert("Укажи причину отклонения");
      return;
    }
    setBusy(true);
    try {
      const res = await withToast(
        () => rpcAccountingReview({
          entityType: row.entityType,
          entityId: row.entityId,
          action,
          reason: action === "reject" ? reason : null,
          notes,
        }),
        { success: action === "approve" ? "Подтверждено" : action === "reject" ? "Отклонено" : "Сброшено", errorPrefix: "Review failed" }
      );
      if (res.ok) onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Проверка операции #${row.entityId}`}
      subtitle={`${ENTITY_TYPE_LABELS[row.entityType]} · ${formatDate(row.occurredAt)}`}
      width="md"
    >
      <div className="p-5 space-y-3">
        <div className="text-[12px] text-slate-600">
          {row.primaryAmount != null && (
            <div>Сумма: <span className="font-bold tabular-nums">{fmt(row.primaryAmount, row.primaryCurrency)} {row.primaryCurrency}</span></div>
          )}
          {row.counterpartyLabel && <div>Контрагент/клиент: {row.counterpartyLabel}</div>}
          {row.comment && <div className="mt-1 text-slate-500">«{row.comment}»</div>}
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Заметка бухгалтера (опционально)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Коротко что проверил"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Причина отклонения <span className="text-rose-500">(если reject)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Что не так — менеджер должен поправить"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none resize-none"
          />
        </div>
      </div>
      <div className="px-5 py-3.5 border-t border-slate-100 flex items-center gap-2 flex-wrap">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-3 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[12.5px] font-semibold hover:bg-slate-200"
        >
          Отмена
        </button>
        {row.accountingStatus !== "pending_review" && (
          <button
            onClick={() => submit("reset")}
            disabled={busy}
            className="px-3 py-2 rounded-[10px] bg-slate-200 text-slate-800 text-[12.5px] font-semibold hover:bg-slate-300"
          >
            Сбросить статус
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => submit("reject")}
            disabled={busy || !reason.trim()}
            className={`px-3 py-2 rounded-[10px] text-[12.5px] font-bold ${
              reason.trim() && !busy ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <XCircle className="w-3.5 h-3.5 inline mr-1" />
            Отклонить
          </button>
          <button
            onClick={() => submit("approve")}
            disabled={busy}
            className="px-3 py-2 rounded-[10px] bg-emerald-600 text-white text-[12.5px] font-bold hover:bg-emerald-700 disabled:opacity-60"
          >
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
            Подтвердить
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Bulk action modal ─────────────────────────────────────────────────

function BulkActionModal({ action, items, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isReject = action === "reject";

  const submit = async () => {
    if (busy) return;
    if (isReject && !reason.trim()) return;
    setBusy(true);
    try {
      const res = await withToast(
        () => rpcAccountingReviewBulk({
          items,
          action,
          reason: isReject ? reason : null,
        }),
        { success: `${action === "approve" ? "Подтверждено" : "Отклонено"} ${items.length}`, errorPrefix: "Bulk failed" }
      );
      if (res.ok) onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={isReject ? "Массовое отклонение" : "Массовое подтверждение"}
      subtitle={`${items.length} операций`}
      width="md"
    >
      <div className="p-5 space-y-3">
        {isReject ? (
          <>
            <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[8px] p-3">
              ⚠ Все {items.length} операций получат одинаковую причину отклонения.
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Причина (одна на всё)"
              autoFocus
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none resize-none"
            />
          </>
        ) : (
          <div className="text-[12px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-[8px] p-3">
            ✓ Подтвердить {items.length} операций — каждой будет проставлен approver и время.
          </div>
        )}
      </div>
      <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-3 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[12.5px] font-semibold hover:bg-slate-200"
        >
          Отмена
        </button>
        <button
          onClick={submit}
          disabled={busy || (isReject && !reason.trim())}
          className={`px-3 py-2 rounded-[10px] text-[12.5px] font-bold ${
            (!isReject || reason.trim()) && !busy
              ? isReject
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? "Обработка…" : isReject ? "Отклонить все" : "Подтвердить все"}
        </button>
      </div>
    </Modal>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.toLocaleDateString("ru-RU")} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}
