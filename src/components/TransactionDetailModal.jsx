// src/components/TransactionDetailModal.jsx
// Полная карточка сделки: header + IN side + legs + obligations + audit trail.
// Открывается кликом по "Eye" кнопке в TransactionsTable row.
//
// Никаких write-операций — только read-only view. Для редактирования
// используется существующая EditTransactionModal.

import React, { useMemo } from "react";
import {
  X,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Radar,
  Flag,
  Trash2,
  Building2,
  User as UserIcon,
  Wallet,
  Send,
  FileText,
  Shield,
  Lock,
  Info,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { useObligations } from "../store/obligations.jsx";
import { useAudit } from "../store/audit.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { computeLegStatus, legStatusStyle, formatShortDate } from "../utils/legStatus.js";
import { riskLevelStyle, riskLevelLabel } from "../utils/aml.js";

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function TransactionDetailModal({ transaction, onClose }) {
  const { t } = useTranslation();
  const { findAccount } = useAccounts();
  const { findOffice } = useOffices();
  const { obligations } = useObligations();
  const { log: auditLog } = useAudit();
  const { users } = useAuth();

  if (!transaction) return null;

  const tx = transaction;
  const office = findOffice(tx.officeId);
  const inAccount = tx.accountId ? findAccount(tx.accountId) : null;

  // Obligations по этой сделке
  const dealObligations = useMemo(
    () => obligations.filter((o) => String(o.dealId) === String(tx.id)),
    [obligations, tx.id]
  );

  // Audit events — отфильтруем по entityId (если поле есть и совпадает)
  const dealAudit = useMemo(() => {
    return auditLog.filter(
      (e) =>
        e.entity === "transaction" &&
        String(e.entityId) === String(tx.id)
    );
  }, [auditLog, tx.id]);

  const StatusBadge = () => {
    const base =
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold";
    if (tx.status === "pending")
      return (
        <span className={`${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`}>
          <Clock className="w-2.5 h-2.5" />
          {t("status_pending")}
        </span>
      );
    if (tx.status === "checking")
      return (
        <span className={`${base} bg-sky-50 text-sky-700 ring-1 ring-sky-200`}>
          <Radar className="w-2.5 h-2.5" />
          {t("status_checking")}
        </span>
      );
    if (tx.status === "flagged")
      return (
        <span className={`${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`}>
          <Flag className="w-2.5 h-2.5" />
          {t("status_flagged")}
        </span>
      );
    if (tx.status === "deleted")
      return (
        <span className={`${base} bg-slate-200 text-slate-700`}>
          <Trash2 className="w-2.5 h-2.5" />
          {t("status_deleted")}
        </span>
      );
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}>
        <CheckCircle2 className="w-2.5 h-2.5" />
        {t("status_completed")}
      </span>
    );
  };

  const inLegState = useMemo(
    () =>
      computeLegStatus({
        plannedAmount: tx.inPlannedAmount ?? tx.amtIn,
        actualAmount: tx.inActualAmount ?? 0,
        plannedAt: tx.inPlannedAt,
        completedAt: tx.inCompletedAt,
      }),
    [tx]
  );

  return (
    <Modal
      open={!!transaction}
      onClose={onClose}
      title={`Deal #${tx.id}`}
      subtitle={`${office?.name || tx.officeId} · ${tx.date}, ${tx.time} · ${tx.manager || "—"}`}
      width="2xl"
    >
      <div className="p-5 max-h-[75vh] overflow-auto space-y-4">
        {/* Top bar: status + key metrics */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge />
            {tx.pinned && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
                {t("badge_pinned")}
              </span>
            )}
            {tx.riskLevel && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ${riskLevelStyle(tx.riskLevel)}`}
                title={(tx.riskFlags || []).join(", ") || "no flags"}
              >
                <Shield className="w-2.5 h-2.5" />
                {riskLevelLabel(tx.riskLevel)}
              </span>
            )}
            {tx.referral && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700">
                referral
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[12px]">
            <div className="text-slate-500">
              Fee:{" "}
              <span className="font-bold text-slate-900 tabular-nums">
                ${fmt(tx.fee)}
              </span>
            </div>
            <div className="text-slate-500">
              Profit:{" "}
              <span
                className={`font-bold tabular-nums ${
                  tx.profit > 0 ? "text-emerald-600" : tx.profit < 0 ? "text-rose-600" : "text-slate-700"
                }`}
              >
                {tx.profit > 0 ? "+" : ""}${fmt(tx.profit)}
              </span>
            </div>
          </div>
        </div>

        {/* Counterparty */}
        {(tx.counterparty || tx.counterpartyId) && (
          <div className="bg-white border border-slate-200 rounded-[12px] px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Counterparty
            </div>
            <div className="flex items-center gap-2">
              <UserIcon className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[14px] font-semibold text-slate-900">
                {tx.counterparty || "—"}
              </span>
              {tx.counterpartyId && (
                <span className="text-[10px] text-slate-400 font-mono">
                  {String(tx.counterpartyId).slice(0, 8)}…
                </span>
              )}
            </div>
          </div>
        )}

        {/* IN side */}
        <div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            Incoming
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-[12px] px-4 py-3.5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[22px] font-bold tabular-nums text-slate-900">
                    {curSymbol(tx.curIn)}{fmt(tx.amtIn, tx.curIn)}
                  </span>
                  <span className="text-[12px] font-semibold text-slate-500">
                    {tx.curIn}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                  {inAccount && (
                    <span className="inline-flex items-center gap-1">
                      <Wallet className="w-2.5 h-2.5" />
                      {inAccount.name}
                    </span>
                  )}
                  {tx.inTxHash && (
                    <span className="inline-flex items-center gap-1 font-mono text-slate-400">
                      tx {tx.inTxHash.slice(0, 12)}…
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Status
                </div>
                <LegStatusPill state={inLegState} />
                {tx.inPlannedAt && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    planned: {formatDateTime(tx.inPlannedAt)}
                  </div>
                )}
                {tx.inCompletedAt && (
                  <div className="text-[10px] text-emerald-600 mt-0.5">
                    completed: {formatDateTime(tx.inCompletedAt)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Arrow separator */}
        <div className="flex justify-center -my-1">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
            <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
          </div>
        </div>

        {/* Outputs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Outgoing ({(tx.outputs || []).length})
            </div>
            <div className="text-[10px] text-slate-400">
              Rate{(tx.outputs || []).length > 1 ? "s" : ""} shown per-leg
            </div>
          </div>
          <div className="space-y-2">
            {(tx.outputs || []).map((leg, idx) => {
              const legAcc = leg.accountId ? findAccount(leg.accountId) : null;
              const legState = computeLegStatus({
                plannedAmount: leg.plannedAmount ?? leg.amount,
                actualAmount: leg.actualAmount ?? 0,
                plannedAt: leg.plannedAt,
                completedAt: leg.completedAt,
              });
              return (
                <div
                  key={idx}
                  className="bg-white border border-slate-200 rounded-[12px] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="text-[18px] font-bold tabular-nums text-slate-900">
                          {curSymbol(leg.currency)}{fmt(leg.amount, leg.currency)}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {leg.currency}
                        </span>
                        <span className="text-[10px] text-slate-400">@</span>
                        <span className="text-[12px] font-semibold text-slate-700 tabular-nums">
                          {leg.rate?.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                        {legAcc ? (
                          <span className="inline-flex items-center gap-1">
                            <Wallet className="w-2.5 h-2.5" />
                            {legAcc.name}
                          </span>
                        ) : leg.accountId ? (
                          <span
                            className="inline-flex items-center gap-1 text-slate-400 italic"
                            title="Account из другого офиса — недоступен по RLS"
                          >
                            <Wallet className="w-2.5 h-2.5" />
                            другой офис · #{String(leg.accountId).slice(0, 8)}
                          </span>
                        ) : (
                          <span className="text-amber-600">no account</span>
                        )}
                        {leg.address && (
                          <span className="inline-flex items-center gap-1 font-mono text-slate-400">
                            → {leg.address.slice(0, 14)}…
                          </span>
                        )}
                        {leg.sendStatus && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-sky-50 text-sky-700 ring-1 ring-sky-200">
                            <Send className="w-2.5 h-2.5" />
                            {leg.sendStatus}
                          </span>
                        )}
                        {leg.isInternal && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                            interoffice
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <LegStatusPill state={legState} />
                      {legState.status === "partial" && (
                        <div className="text-[10px] text-violet-700 font-semibold tabular-nums mt-0.5">
                          {fmt(legState.actual, leg.currency)}/{fmt(legState.planned, leg.currency)}
                        </div>
                      )}
                      {leg.completedAt && (
                        <div className="text-[10px] text-emerald-600 mt-0.5">
                          {formatShortDate(leg.completedAt)}
                        </div>
                      )}
                      {leg.sendTxHash && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {leg.sendTxHash.slice(0, 10)}…
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Obligations */}
        {dealObligations.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Obligations ({dealObligations.length})
            </div>
            <div className="space-y-1.5">
              {dealObligations.map((ob) => {
                const isTheyOwe = ob.direction === "they_owe";
                const remaining = Math.max(0, ob.amount - (ob.paidAmount || 0));
                const paidPct = ob.amount > 0 ? ((ob.paidAmount || 0) / ob.amount) * 100 : 0;
                return (
                  <div
                    key={ob.id}
                    className={`bg-white border rounded-[10px] px-3 py-2 ${
                      ob.status === "open"
                        ? isTheyOwe
                          ? "border-sky-200 bg-sky-50/30"
                          : "border-amber-200 bg-amber-50/30"
                        : "border-slate-200 opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            isTheyOwe ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {isTheyOwe ? "They owe" : "We owe"}
                        </span>
                        <span className="font-bold tabular-nums text-slate-900">
                          {curSymbol(ob.currency)}{fmt(remaining, ob.currency)}
                        </span>
                        {(ob.paidAmount || 0) > 0 && (
                          <span className="text-[10px] text-slate-400 tabular-nums">
                            / {fmt(ob.amount, ob.currency)}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-500">{ob.currency}</span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          ob.status === "open"
                            ? "bg-emerald-50 text-emerald-700"
                            : ob.status === "cancelled"
                            ? "bg-slate-100 text-slate-500"
                            : "bg-slate-50 text-slate-400"
                        }`}
                      >
                        {ob.status}
                      </span>
                    </div>
                    {(ob.paidAmount || 0) > 0 && (
                      <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[200px]">
                        <div
                          className={`h-full rounded-full ${isTheyOwe ? "bg-sky-400" : "bg-amber-400"}`}
                          style={{ width: `${paidPct}%` }}
                        />
                      </div>
                    )}
                    {ob.note && (
                      <div className="text-[10px] text-slate-500 mt-1 italic">
                        {ob.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Comment */}
        {tx.comment && (
          <div className="bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              Comment
            </div>
            <div className="text-[12px] text-slate-700">{tx.comment}</div>
          </div>
        )}

        {/* Audit trail */}
        {dealAudit.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Info className="w-3 h-3" />
              History ({dealAudit.length})
            </div>
            <div className="space-y-1">
              {dealAudit.map((e) => (
                <div
                  key={e.id}
                  className="text-[11px] px-3 py-1.5 rounded-md bg-slate-50 border border-slate-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700">
                      {e.userName || "—"}
                    </span>
                    <span className="text-slate-400 tabular-nums">
                      {formatDateTime(e.timestamp)}
                    </span>
                  </div>
                  <div className="text-slate-500 mt-0.5">{e.summary}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deleted footer */}
        {tx.deletedAt && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-rose-50 border border-rose-200 text-rose-800 text-[12px]">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Deleted at {formatDateTime(tx.deletedAt)}
              {tx.deletedReason && ` · ${tx.deletedReason}`}
            </span>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          {t("btn_close")}
        </button>
      </div>
    </Modal>
  );
}

function LegStatusPill({ state }) {
  const style = legStatusStyle(state.status);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${style.cls}`}
    >
      {style.label}
    </span>
  );
}
