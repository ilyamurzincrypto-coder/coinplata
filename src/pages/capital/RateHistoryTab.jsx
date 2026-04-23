// src/pages/capital/RateHistoryTab.jsx
// Snapshot'ы курсов — append-only log для аудита и восстановления.

import React, { useState, useMemo } from "react";
import { History, Building2, User as UserIcon, ChevronRight, X } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { useRateHistory } from "../../store/rateHistory.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function RateHistoryTab() {
  const { t } = useTranslation();
  const { snapshots } = useRateHistory();
  const { findOffice } = useOffices();
  const { users } = useAuth();
  const { transactions } = useTransactions();
  const [viewing, setViewing] = useState(null);

  const userById = useMemo(() => {
    const m = new Map();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const txCountBySnapshot = useMemo(() => {
    const m = new Map();
    transactions.forEach((tx) => {
      if (tx.rateSnapshotId) m.set(tx.rateSnapshotId, (m.get(tx.rateSnapshotId) || 0) + 1);
    });
    return m;
  }, [transactions]);

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold">{t("rh_title")} · {snapshots.length}</h3>
          <span className="text-[11px] text-slate-400">
            · {t("rh_subtitle")}
          </span>
        </div>
        {snapshots.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-slate-400">
            {t("rh_empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
                  <th className="px-5 py-2.5 font-bold">{t("rh_when")}</th>
                  <th className="px-3 py-2.5 font-bold">{t("oblig_col_office")}</th>
                  <th className="px-3 py-2.5 font-bold">{t("rh_by")}</th>
                  <th className="px-3 py-2.5 font-bold text-right">{t("rh_pairs")}</th>
                  <th className="px-3 py-2.5 font-bold text-right">{t("rh_ref_tx")}</th>
                  <th className="px-5 py-2.5 font-bold w-10"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => {
                  const office = s.officeId ? findOffice(s.officeId) : null;
                  const user = s.createdBy ? userById.get(s.createdBy) : null;
                  const txCount = txCountBySnapshot.get(s.id) || 0;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setViewing(s)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3 text-slate-700 font-medium tabular-nums whitespace-nowrap">
                        {fmtDate(s.timestamp)}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {office?.name || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          <UserIcon className="w-3 h-3 text-slate-400" />
                          {user?.name || t("rh_system")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{s.pairsCount}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                        {txCount > 0 ? txCount : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SnapshotViewModal snapshot={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function SnapshotViewModal({ snapshot, onClose }) {
  const { t } = useTranslation();
  if (!snapshot) return null;
  const pairs = Object.entries(snapshot.rates).map(([k, v]) => {
    const [from, to] = k.split("_");
    return { from, to, rate: v, key: k };
  });
  // Группируем по fromCurrency
  const byFrom = new Map();
  pairs.forEach((p) => {
    if (!byFrom.has(p.from)) byFrom.set(p.from, []);
    byFrom.get(p.from).push(p);
  });

  return (
    <Modal
      open={!!snapshot}
      onClose={onClose}
      title={`${t("rh_snapshot")} · ${fmtDate(snapshot.timestamp)}`}
      subtitle={`${snapshot.pairsCount} ${t("rh_pairs_lower")} · ${t("rh_reason")}: ${snapshot.reason || "—"}`}
      width="2xl"
    >
      <div className="p-5 max-h-[60vh] overflow-auto space-y-4">
        {[...byFrom.entries()].map(([from, list]) => (
          <div key={from}>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              {from}
            </div>
            <div className="border border-slate-200 rounded-[10px] overflow-hidden divide-y divide-slate-100">
              {list.map((p) => (
                <div
                  key={p.key}
                  className="flex items-center justify-between px-3 py-1.5 text-[12px] bg-white"
                >
                  <span className="text-slate-600 font-medium">
                    {p.from} <span className="text-slate-400">→</span> {p.to}
                  </span>
                  <span className="tabular-nums font-semibold text-slate-900">
                    {Number(p.rate).toLocaleString("en-US", { maximumFractionDigits: 6 })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {pairs.length === 0 && (
          <div className="text-center text-[13px] text-slate-400 py-6">
            {t("rh_empty_snapshot")}
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <span className="font-mono">{snapshot.id}</span>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[12px] font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          {t("rh_close")}
        </button>
      </div>
    </Modal>
  );
}
