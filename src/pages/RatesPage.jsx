// src/pages/RatesPage.jsx
// Full-page редактор курсов (вместо inline-modal из CashierPage→RatesBar).
// UI-принципы как у CashierPage Create mode: sticky header с табами офисов,
// content занимает весь экран. Import xlsx / Coverage / Add pair / Currency /
// Channel — всё в одной плоскости.
//
// БД модель пар — global (не per-office); офисные табы пока визуальные
// (copy-rates, отдельный view). При необходимости перенести overrides в БД —
// миграция + логика поверх.

import React, { useState, useMemo } from "react";
import {
  TrendingUp,
  Plus,
  Upload,
  Coins,
  Network as NetworkIcon,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Download,
} from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcUpdatePair, withToast } from "../lib/supabaseWrite.js";
import RatesImportModal from "../components/RatesImportModal.jsx";
import RatesCoveragePanel from "../components/RatesCoveragePanel.jsx";
import Modal from "../components/ui/Modal.jsx";
import { analyzeCoverage, loadDismissed } from "../utils/ratesCoverage.js";
import {
  computeSpread,
  computeRateFromSpread,
  getMidRate,
  formatSpread,
} from "../utils/spread.js";
import { rateKey } from "../store/rates.jsx";
import { fmt } from "../utils/money.js";
import { exportCSV } from "../utils/csv.js";

export default function RatesPage() {
  const { t } = useTranslation();
  const { rates, setRate, deleteRate, getRate, channels, pairs: allPairs } = useRates();
  const { currencies } = useCurrencies();
  const { activeOffices } = useOffices();
  const { isAdmin, isOwner } = useAuth();
  const { addEntry: logAudit } = useAudit();

  // Active office tab — визуальный scope (курсы пока общие в БД).
  const [activeOffice, setActiveOffice] = useState("all");
  // Full-page views: "list" | "addPair" | "addCurrency" | "addChannel" | "coverage"
  const [view, setView] = useState("list");
  const [importOpen, setImportOpen] = useState(false);
  const [addPairPreset, setAddPairPreset] = useState({ from: "", to: "" });

  const gotoAddPair = (from = "", to = "") => {
    setAddPairPreset({ from, to });
    setView("addPair");
  };

  const handleOpenImport = () => {
    setImportOpen(true);
  };

  const canEdit = isAdmin || isOwner;

  // Pairs
  const existingPairs = useMemo(
    () =>
      Object.keys(rates).map((k) => {
        const [from, to] = k.split("_");
        return { from, to, key: k };
      }),
    [rates]
  );

  // Coverage summary
  const coverageSummary = useMemo(() => {
    const r = analyzeCoverage(currencies, allPairs, channels, loadDismissed());
    const pct = r.total > 0 ? Math.round((r.existingCount / r.total) * 100) : 0;
    return {
      pct,
      existing: r.existingCount,
      total: r.total,
      missing: r.missing.length,
      oneWay: r.oneWay.length,
      isolated: r.isolated.length,
      hasIssues: r.missing.length > 0 || r.oneWay.length > 0 || r.isolated.length > 0,
    };
  }, [currencies, allPairs, channels]);

  // Группировка пар по from → для таблицы
  const curIndex = (code) => {
    const order = ["USD", "USDT", "EUR", "TRY", "GBP", "CHF", "RUB"];
    const i = order.indexOf(code);
    return i < 0 ? 999 : i;
  };
  const groups = useMemo(() => {
    const byFrom = new Map();
    existingPairs.forEach((p) => {
      if (!byFrom.has(p.from)) byFrom.set(p.from, []);
      byFrom.get(p.from).push(p);
    });
    const froms = [...byFrom.keys()].sort((a, b) => {
      const d = curIndex(a) - curIndex(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
    return froms.map((from) => ({
      from,
      pairs: byFrom.get(from).sort((a, b) => curIndex(a.to) - curIndex(b.to)),
    }));
  }, [existingPairs]);

  const handleSetRate = async (from, to, value) => {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) return;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => rpcUpdatePair({ fromCurrency: from, toCurrency: to, baseRate: n }),
        { success: null, errorPrefix: "Update failed" }
      );
      if (res.ok) {
        logAudit({
          action: "update",
          entity: "pair",
          entityId: rateKey(from, to),
          summary: `${from}→${to}: rate ${n}`,
        });
      }
      return;
    }
    const result = setRate(from, to, value);
    if (result?.ok) {
      logAudit({
        action: "update",
        entity: "pair",
        entityId: rateKey(from, to),
        summary: `${from}→${to}: rate ${n}`,
      });
    }
  };

  const handleDeletePair = async (from, to) => {
    if (!confirm(`Delete pair ${from} → ${to}?`)) return;
    deleteRate(from, to);
    logAudit({
      action: "delete",
      entity: "pair",
      entityId: rateKey(from, to),
      summary: `Removed pair ${from} → ${to}`,
    });
  };

  const handleExportCSV = () => {
    if (existingPairs.length === 0) return;
    exportCSV({
      filename: `coinplata-rates-${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "from", label: "From" },
        { key: "to", label: "To" },
        { key: "rate", label: "Rate" },
      ],
      rows: existingPairs.map((p) => ({
        from: p.from,
        to: p.to,
        rate: getRate(p.from, p.to) ?? "",
      })),
    });
  };

  // Back button handler for sub-views
  const backToList = () => {
    setView("list");
    setAddPairPreset({ from: "", to: "" });
  };

  if (!canEdit) {
    return (
      <main className="max-w-[1400px] mx-auto px-6 py-10 text-center">
        <div className="bg-white rounded-[14px] border border-slate-200 p-8 max-w-md mx-auto">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <div className="text-[15px] font-bold text-slate-900 mb-1">
            {t("rates_page_no_access") || "No access"}
          </div>
          <div className="text-[12px] text-slate-600">
            {t("rates_page_admin_only") || "Only admins and owners can edit rates."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-slate-900 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">
                {t("rates_page_title") || "Rates"}
              </h1>
              <p className="text-[12px] text-slate-500">
                {t("rates_page_subtitle") ||
                  "Manage rates, pairs, and currencies. Shared across all offices."}
              </p>
            </div>
          </div>
          {view === "list" && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setView("coverage")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border ${
                  coverageSummary.hasIssues
                    ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                }`}
              >
                {coverageSummary.hasIssues ? (
                  <AlertTriangle className="w-3.5 h-3.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {t("cov_btn_coverage") || "Coverage"} {coverageSummary.pct}%
              </button>
              <button
                onClick={handleExportCSV}
                disabled={existingPairs.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {t("export_csv")}
              </button>
              <button
                onClick={handleOpenImport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold text-white bg-slate-900 hover:bg-slate-800"
              >
                <Upload className="w-3.5 h-3.5" />
                {t("cov_import_xlsx") || "Import xlsx"}
              </button>
            </div>
          )}
          {view !== "list" && (
            <button
              onClick={backToList}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("rates_back") || "Back to list"}
            </button>
          )}
        </div>

        {/* Office tabs (visible only in list view) */}
        {view === "list" && (
          <div className="bg-white border border-slate-200 rounded-[12px] p-1 flex items-center gap-0.5 overflow-x-auto">
            <button
              onClick={() => setActiveOffice("all")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold whitespace-nowrap transition-colors ${
                activeOffice === "all"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              {t("rates_all_offices") || "All offices (global)"}
            </button>
            {activeOffices.map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveOffice(o.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold whitespace-nowrap transition-colors ${
                  activeOffice === o.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Building2 className="w-3 h-3" />
                {o.name}
              </button>
            ))}
          </div>
        )}

        {/* Sub-view: Coverage */}
        {view === "coverage" && (
          <div className="bg-white rounded-[14px] border border-slate-200 overflow-hidden">
            <RatesCoveragePanel
              onBack={backToList}
              onQuickAdd={(from, to) => gotoAddPair(from, to)}
              onOpenImport={handleOpenImport}
            />
          </div>
        )}

        {/* List view */}
        {view === "list" && (
          <>
            {/* Scope notice (non-global tab) */}
            {activeOffice !== "all" && (
              <div className="bg-sky-50 border border-sky-200 rounded-[10px] px-4 py-3 text-[12px] text-sky-800 flex items-start gap-2">
                <Building2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">
                    {t("rates_office_scope_title") || "Курсы пока общие для всех офисов"}
                  </div>
                  <div className="text-sky-700 mt-0.5">
                    {t("rates_office_scope_body") ||
                      "Просмотр по вкладке офиса — чтобы увидеть какие пары применимы. Редактирование меняет глобальный курс (то же значение у всех офисов). Per-office overrides — отдельная задача на будущее."}
                  </div>
                </div>
              </div>
            )}

            {/* Counts + action buttons */}
            <div className="flex items-center justify-between flex-wrap gap-2 bg-white border border-slate-200 rounded-[12px] px-4 py-3">
              <div className="text-[12px] text-slate-600 tabular-nums">
                <span className="font-bold text-slate-900">{currencies.length}</span>{" "}
                {t("rates_currencies_count") || "currencies"} ·{" "}
                <span className="font-bold text-slate-900">{channels.length}</span>{" "}
                {t("rates_channels_count") || "channels"} ·{" "}
                <span className="font-bold text-slate-900">{existingPairs.length}</span>{" "}
                {t("rates_pairs_count") || "pairs"}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setView("addCurrency")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50"
                >
                  <Coins className="w-3 h-3" />
                  {t("currency_add") || "Add currency"}
                </button>
                <button
                  onClick={() => setView("addChannel")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50"
                >
                  <NetworkIcon className="w-3 h-3" />
                  {t("channel_add") || "Add channel"}
                </button>
                <button
                  onClick={() => gotoAddPair()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold bg-slate-900 text-white hover:bg-slate-800"
                >
                  <Plus className="w-3 h-3" />
                  {t("add_pair") || "Add pair"}
                </button>
              </div>
            </div>

            {/* Groups (pairs table by FROM currency) */}
            {groups.length === 0 ? (
              <div className="bg-white rounded-[14px] border border-slate-200 p-10 text-center text-[13px] text-slate-400">
                {t("rates_no_pairs") ||
                  "No pairs yet. Add a currency, then channels, then a pair."}
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <section
                    key={g.from}
                    className="bg-white rounded-[14px] border border-slate-200 overflow-hidden"
                  >
                    <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/40 flex items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-900">{g.from}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                        {g.pairs.length} {t("rates_pairs_count") || "pairs"}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {g.pairs.map((p) => (
                        <PairRow
                          key={p.key}
                          from={p.from}
                          to={p.to}
                          value={getRate(p.from, p.to)}
                          getRate={getRate}
                          onChange={(v) => handleSetRate(p.from, p.to, v)}
                          onDelete={() => handleDeletePair(p.from, p.to)}
                          canDelete={isOwner || isAdmin}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {/* Sub-views: addPair / addCurrency / addChannel — используем ту же логику
            что в RatesBar, но оборачиваем в card вместо модалки */}
        {view === "addPair" && (
          <div className="bg-white rounded-[14px] border border-slate-200 p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">
              {t("add_pair") || "Add pair"}
            </div>
            <AddPairForm
              initFrom={addPairPreset.from}
              initTo={addPairPreset.to}
              onDone={backToList}
            />
          </div>
        )}

        {view === "addCurrency" && (
          <div className="bg-white rounded-[14px] border border-slate-200 p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">
              {t("currency_add") || "Add currency"}
            </div>
            <AddCurrencyForm onDone={backToList} />
          </div>
        )}

        {view === "addChannel" && (
          <div className="bg-white rounded-[14px] border border-slate-200 p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-4">
              {t("channel_add") || "Add channel"}
            </div>
            <AddChannelForm onDone={backToList} />
          </div>
        )}
      </div>

      {importOpen && (
        <RatesImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      )}
    </main>
  );
}

// ---------------- Pair row with spread edit ----------------
function PairRow({ from, to, value, getRate, onChange, onDelete, canDelete }) {
  const { t } = useTranslation();
  const [localVal, setLocalVal] = useState(value != null ? String(value) : "");
  const [editing, setEditing] = useState(false);

  React.useEffect(() => {
    if (!editing) setLocalVal(value != null ? String(value) : "");
  }, [value, editing]);

  const mid = getMidRate(from, to, getRate);
  const spread = computeSpread(localVal, from, to, getRate);

  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60">
      <div className="flex items-center gap-2 min-w-[140px]">
        <span className="text-[13px] font-bold text-slate-900 tabular-nums">{from}</span>
        <span className="text-slate-400">→</span>
        <span className="text-[13px] font-bold text-slate-900 tabular-nums">{to}</span>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={localVal}
        onChange={(e) => {
          setEditing(true);
          setLocalVal(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."));
        }}
        onBlur={() => {
          setEditing(false);
          if (localVal && Number(localVal) > 0 && Number(localVal) !== Number(value)) {
            onChange(localVal);
          }
        }}
        className="flex-1 max-w-[200px] bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[8px] px-3 py-1.5 text-[13px] tabular-nums outline-none"
      />
      {mid && (
        <span className="text-[10px] text-slate-400 font-mono">
          mid: {mid.toFixed(mid < 1 ? 6 : 4)}
        </span>
      )}
      {spread != null && (
        <span
          className={`text-[10px] font-semibold tabular-nums ${
            Math.abs(spread) < 0.5 ? "text-slate-500" : "text-emerald-700"
          }`}
        >
          {formatSpread(spread)}
        </span>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          className="ml-auto text-[11px] text-rose-500 hover:text-rose-700 font-semibold"
          title={t("delete") || "Delete"}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ---------------- Add Pair form ----------------
function AddPairForm({ initFrom, initTo, onDone }) {
  const { t } = useTranslation();
  const { currencies } = useCurrencies();
  const { channels, pairs, addPair, getRate } = useRates();
  const { addEntry: logAudit } = useAudit();

  const [fromCurrency, setFromCurrency] = useState(initFrom || currencies[0]?.code || "");
  const [toCurrency, setToCurrency] = useState(
    initTo || currencies.find((c) => c.code !== (initFrom || currencies[0]?.code))?.code || ""
  );
  const [fromChannelId, setFromChannelId] = useState("");
  const [toChannelId, setToChannelId] = useState("");
  const [rate, setRate] = useState("");

  const fromChannels = useMemo(
    () => channels.filter((c) => c.currencyCode === fromCurrency),
    [channels, fromCurrency]
  );
  const toChannels = useMemo(
    () => channels.filter((c) => c.currencyCode === toCurrency),
    [channels, toCurrency]
  );

  React.useEffect(() => { setFromChannelId(fromChannels[0]?.id || ""); }, [fromCurrency, fromChannels]);
  React.useEffect(() => { setToChannelId(toChannels[0]?.id || ""); }, [toCurrency, toChannels]);

  const sameCurrency = fromCurrency === toCurrency;
  const duplicate = pairs.some((p) => p.fromChannelId === fromChannelId && p.toChannelId === toChannelId);
  const canSubmit = !sameCurrency && !duplicate && fromChannelId && toChannelId && parseFloat(rate) > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const res = addPair({ fromChannelId, toChannelId, rate, priority: 10 });
    if (!res.ok) return;
    logAudit({
      action: "create",
      entity: "pair",
      entityId: `${fromCurrency}_${toCurrency}`,
      summary: `Added pair ${fromCurrency}→${toCurrency}: ${rate}`,
    });
    onDone?.();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("from") || "From"}
        </label>
        <select
          value={fromCurrency}
          onChange={(e) => setFromCurrency(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("to") || "To"}
        </label>
        <select
          value={toCurrency}
          onChange={(e) => setToCurrency(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code} disabled={c.code === fromCurrency}>
              {c.code}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("rate") || "Rate"}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          placeholder={`1 ${fromCurrency} in ${toCurrency}`}
          className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[8px] px-3 py-2 text-[14px] tabular-nums outline-none"
        />
      </div>

      {sameCurrency && (
        <div className="md:col-span-2 text-[11px] text-amber-700">
          {t("rates_same_currency") || "From and to are the same currency"}
        </div>
      )}
      {duplicate && (
        <div className="md:col-span-2 text-[11px] text-amber-700">
          {t("rates_duplicate") || "Pair already exists"}
        </div>
      )}

      <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          onClick={onDone}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${
            canSubmit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("save") || "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Add Currency form ----------------
function AddCurrencyForm({ onDone }) {
  const { t } = useTranslation();
  const { addCurrency } = useCurrencies();
  const { addEntry: logAudit } = useAudit();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState("fiat");

  const handleSubmit = () => {
    const res = addCurrency({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      symbol: symbol.trim(),
      type,
      decimals: type === "crypto" ? 6 : 2,
    });
    if (res.ok) {
      logAudit({
        action: "create",
        entity: "currency",
        entityId: res.currency.code,
        summary: `Added currency ${res.currency.code}`,
      });
      onDone?.();
    }
  };

  const canSubmit = code.trim().length >= 2;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("currency_code") || "Code"}
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="USD"
          className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[14px] tabular-nums outline-none"
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("cat_type") || "Type"}
        </label>
        <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px] w-full">
          {["fiat", "crypto"].map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setType(tp)}
              className={`flex-1 px-3 py-1.5 text-[12px] font-semibold rounded-[6px] ${
                type === tp ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              {tp}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("currency_name") || "Name"}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="US Dollar"
          className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("currency_symbol") || "Symbol"}
        </label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="$"
          className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
        />
      </div>
      <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onDone} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200">{t("cancel")}</button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${
            canSubmit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("save") || "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Add Channel form ----------------
function AddChannelForm({ onDone }) {
  const { t } = useTranslation();
  const { currencies } = useCurrencies();
  const { addChannel } = useRates();
  const { addEntry: logAudit } = useAudit();
  const [currencyCode, setCurrencyCode] = useState(currencies[0]?.code || "");
  const [kind, setKind] = useState("cash");
  const [network, setNetwork] = useState("");

  const cur = currencies.find((c) => c.code === currencyCode);
  const isCrypto = cur?.type === "crypto";

  const handleSubmit = () => {
    const res = addChannel({
      currencyCode,
      kind: isCrypto ? "network" : kind,
      network: isCrypto ? network : null,
    });
    if (res?.ok) {
      logAudit({
        action: "create",
        entity: "channel",
        entityId: res.channel?.id || currencyCode,
        summary: `Added channel for ${currencyCode}`,
      });
      onDone?.();
    }
  };

  const canSubmit = currencyCode && (isCrypto ? network.trim().length > 0 : true);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
          {t("currency") || "Currency"}
        </label>
        <select
          value={currencyCode}
          onChange={(e) => setCurrencyCode(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>
      {!isCrypto && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {t("channel_kind") || "Kind"}
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
          >
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="sepa">SEPA</option>
            <option value="swift">SWIFT</option>
          </select>
        </div>
      )}
      {isCrypto && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {t("network") || "Network"}
          </label>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 text-[13px] outline-none"
          >
            <option value="">—</option>
            <option value="TRC20">TRC20</option>
            <option value="ERC20">ERC20</option>
            <option value="BEP20">BEP20</option>
          </select>
        </div>
      )}
      <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onDone} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200">{t("cancel")}</button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold ${
            canSubmit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("save") || "Save"}
        </button>
      </div>
    </div>
  );
}
