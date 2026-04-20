// src/components/RatesBar.jsx
import React, { useState } from "react";
import { TrendingUp, Pencil, RefreshCw } from "lucide-react";
import { useRates, FEATURED_PAIRS, rateKey } from "../store/rates.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import Modal from "./ui/Modal.jsx";
import { CURRENCIES } from "../store/data.js";

function formatRate(value) {
  if (!value && value !== 0) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

export default function RatesBar() {
  const { rates, getRate, setRate, lastUpdated } = useRates();
  const { isAdmin } = useAuth();
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
            <h2 className="text-[11px] font-semibold text-slate-500 tracking-widest uppercase">
              {t("rates")}
            </h2>
            <span className="text-[11px] text-slate-400">
              · {t("rate_updated")} {timeAgo(lastUpdated)} ago
            </span>
          </div>
          {isAdmin && (
            <button
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[12px] font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t("edit_rates")}
            </button>
          )}
        </div>

        <div className="bg-white rounded-[12px] border border-slate-200/70 p-1 flex overflow-x-auto">
          {FEATURED_PAIRS.map(([from, to]) => {
            const r = getRate(from, to);
            return (
              <div
                key={`${from}-${to}`}
                className="flex-1 min-w-[140px] px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 rounded-[10px] transition-colors border-r last:border-r-0 border-slate-100"
              >
                <div>
                  <div className="text-[10px] font-bold text-slate-500 tracking-[0.1em] mb-0.5">
                    {from} → {to}
                  </div>
                  <div className="text-[15px] font-semibold tabular-nums text-slate-900">
                    {formatRate(r)}
                  </div>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            );
          })}
        </div>
      </section>

      {editOpen && (
        <RatesEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          rates={rates}
          setRate={setRate}
        />
      )}
    </>
  );
}

function RatesEditModal({ open, onClose, rates, setRate }) {
  const { t } = useTranslation();
  // Все пары (без same-currency)
  const pairs = [];
  for (const from of CURRENCIES) {
    for (const to of CURRENCIES) {
      if (from !== to) pairs.push([from, to]);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("edit_rates")} subtitle="1 unit of FROM in TO" width="2xl">
      <div className="p-5 max-h-[70vh] overflow-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {pairs.map(([from, to]) => {
            const k = rateKey(from, to);
            const value = rates[k] ?? "";
            return (
              <label key={k} className="block">
                <span className="block text-[11px] font-semibold text-slate-500 mb-1 tracking-wide">
                  {from} → {to}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.,]/g, "").replace(",", ".");
                    setRate(from, to, v);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[14px] font-semibold text-slate-900 tabular-nums outline-none transition-colors"
                />
              </label>
            );
          })}
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <RefreshCw className="w-3 h-3" /> Auto-saved
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}
