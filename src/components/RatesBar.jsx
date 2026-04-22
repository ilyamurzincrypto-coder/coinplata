// src/components/RatesBar.jsx
import React, { useState } from "react";
import { TrendingUp, Pencil, RefreshCw, Plus, Trash2, X } from "lucide-react";
import { useRates, FEATURED_PAIRS, rateKey } from "../store/rates.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
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
  const {
    rates,
    getRate,
    setRate,
    deleteRate,
    ratesFromBase,
    lastUpdated,
    // новый API для корректного добавления пар
    addPair,
    defaultChannelOf,
  } = useRates();
  const { isAdmin } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);
  const [hoveredBase, setHoveredBase] = useState(null);

  // Обёртки с audit-логированием (только когда не seed-initial)
  const setRateLogged = (from, to, value) => {
    const old = rates[rateKey(from, to)];
    const result = setRate(from, to, value);
    const newVal = parseFloat(value) || 0;
    // Логируем только существенные изменения (не каждый символ ввода)
    if (result.ok && old !== undefined && Math.abs(old - newVal) > 0.0001) {
      logAudit({
        action: "update",
        entity: "rate",
        entityId: rateKey(from, to),
        summary: `${from} → ${to}: ${old} → ${newVal}`,
      });
    }
  };

  const deleteRateLogged = (from, to) => {
    deleteRate(from, to);
    logAudit({
      action: "delete",
      entity: "rate",
      entityId: rateKey(from, to),
      summary: `Removed pair ${from} → ${to}`,
    });
  };

  const addRateLogged = (from, to, rate) => {
    // Сначала пробуем через setRate (если default pair уже существует).
    // Если нет — создаём новую пару через addPair() с default channels у обеих валют.
    const tryUpdate = setRate(from, to, rate);
    if (tryUpdate.ok) {
      logAudit({
        action: "update",
        entity: "rate",
        entityId: rateKey(from, to),
        summary: `${from} → ${to}: rate changed to ${rate}`,
      });
      return;
    }
    // Default pair не найден — создаём через addPair с default channels
    const fromCh = defaultChannelOf(from);
    const toCh = defaultChannelOf(to);
    if (!fromCh || !toCh) {
      // eslint-disable-next-line no-console
      console.warn("Cannot create pair: missing default channels");
      return;
    }
    const result = addPair({
      fromChannelId: fromCh.id,
      toChannelId: toCh.id,
      rate,
      priority: 10,
    });
    if (result.ok) {
      logAudit({
        action: "create",
        entity: "rate",
        entityId: rateKey(from, to),
        summary: `Added pair ${from} → ${to} @ ${rate} (${fromCh.kind}${fromCh.network ? ` ${fromCh.network}` : ""} → ${toCh.kind}${toCh.network ? ` ${toCh.network}` : ""})`,
      });
    }
  };

  // Для hover expansion показываем уникальные base валюты из FEATURED_PAIRS.
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

        <div className="bg-white rounded-[12px] border border-slate-200/70 p-1 flex overflow-visible">
          {FEATURED_PAIRS.map(([from, to]) => {
            const r = getRate(from, to);
            const isExpanded = hoveredBase === from;
            const siblings = ratesFromBase(from).filter((x) => x.to !== to);
            return (
              <div
                key={`${from}-${to}`}
                onMouseEnter={() => setHoveredBase(from)}
                onMouseLeave={() => setHoveredBase(null)}
                className="relative flex-1 min-w-[140px]"
              >
                <div className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 rounded-[10px] transition-colors border-r last:border-r-0 border-slate-100 cursor-default">
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

                {/* Hover expansion — все остальные пары от этого base */}
                {isExpanded && siblings.length > 0 && (
                  <div
                    className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-[12px] shadow-xl shadow-slate-900/10 p-2 animate-[fadeSlide_160ms_ease-out]"
                  >
                    <div className="text-[9px] font-bold text-slate-400 tracking-[0.15em] uppercase px-2 py-1">
                      {from} → all
                    </div>
                    <div className="space-y-0.5">
                      {siblings.map(({ to: t2, rate: r2 }) => (
                        <div
                          key={t2}
                          className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-slate-50"
                        >
                          <span className="text-[11px] font-semibold text-slate-600">
                            {t2}
                          </span>
                          <span className="text-[12px] font-bold tabular-nums text-slate-900">
                            {formatRate(r2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
          setRate={setRateLogged}
          deleteRate={deleteRateLogged}
          onAdd={addRateLogged}
          canDelete={isAdmin}
        />
      )}

      <style>{`
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

// ---------- Rates Edit Modal ----------
function RatesEditModal({ open, onClose, rates, setRate, deleteRate, onAdd, canDelete }) {
  const { t } = useTranslation();
  const [showAddPanel, setShowAddPanel] = useState(false);

  const existingPairs = Object.keys(rates).map((k) => {
    const [from, to] = k.split("_");
    return { from, to, key: k };
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("edit_rates")}
      subtitle="1 unit of FROM in TO"
      width="2xl"
    >
      {/* Sliding container: left = current rates, right = add form */}
      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: showAddPanel ? "translateX(-50%)" : "translateX(0)", width: "200%" }}
        >
          {/* ========== LIST ========== */}
          <div className="w-1/2 flex-shrink-0">
            <div className="p-5 max-h-[60vh] overflow-auto">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {existingPairs.length} pairs
                </div>
                <button
                  onClick={() => setShowAddPanel(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t("add_pair")}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {existingPairs.map(({ from, to, key }) => (
                  <RateField
                    key={key}
                    from={from}
                    to={to}
                    value={rates[key]}
                    onChange={(v) => setRate(from, to, v)}
                    onDelete={canDelete ? () => deleteRate(from, to) : null}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ========== ADD PANEL ========== */}
          <div className="w-1/2 flex-shrink-0">
            <AddPairPanel
              onBack={() => setShowAddPanel(false)}
              onAdd={(from, to, rate) => {
                onAdd(from, to, rate);
                setShowAddPanel(false);
              }}
              existingPairs={existingPairs}
            />
          </div>
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

function RateField({ from, to, value, onChange, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="relative group">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-slate-500 tracking-wide">
          {from} → {to}
        </span>
        {onDelete && (
          <button
            onClick={() => (confirm ? onDelete() : setConfirm(true))}
            onBlur={() => setConfirm(false)}
            className={`opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded-md transition-all ${
              confirm
                ? "bg-rose-500 text-white opacity-100"
                : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
            }`}
            title={confirm ? "Confirm delete" : "Delete pair"}
          >
            {confirm ? <Trash2 className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
          </button>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
        className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[14px] font-semibold text-slate-900 tabular-nums outline-none transition-colors"
      />
    </div>
  );
}

function AddPairPanel({ onBack, onAdd, existingPairs }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState("USDT");
  const [to, setTo] = useState("TRY");
  const [rate, setRate] = useState("");

  const exists = existingPairs.some((p) => p.from === from && p.to === to);
  const sameCurrency = from === to;
  const canSubmit = !exists && !sameCurrency && parseFloat(rate) > 0;

  return (
    <div className="p-5 max-h-[60vh] overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200 transition-colors"
        >
          ← Back
        </button>
        <div className="text-[13px] font-semibold text-slate-900">{t("add_pair")}</div>
      </div>

      <div className="space-y-3 max-w-sm">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("base_currency")}
          </label>
          <CurrencyRow value={from} onChange={setFrom} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("quote_currency")}
          </label>
          <CurrencyRow value={to} onChange={setTo} disabled={from} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("rate")}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder="0.00"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[16px] font-bold text-slate-900 tabular-nums outline-none transition-colors"
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            1 {from} = <span className="font-bold text-slate-700 tabular-nums">{rate || "?"}</span> {to}
          </p>
        </div>

        {exists && (
          <div className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Pair {from} → {to} already exists
          </div>
        )}
        {sameCurrency && (
          <div className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Base and quote must differ
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={() => onAdd(from, to, rate)}
            disabled={!canSubmit}
            className={`flex-1 px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              canSubmit
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {t("add_pair")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CurrencyRow({ value, onChange }) {
  return (
    <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5 flex-wrap">
      {CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`px-3 py-1.5 text-[12px] font-bold rounded-[8px] transition-all ${
            value === c
              ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
