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

// Per-user favorites для editor курсов — отдельный ключ от dashboardFavorites.
// Per-office: users.preferences.editorFavoritesByOffice = {
//   "all": [["from","to"], ...],
//   "<officeId>": [["from","to"], ...]
// }
// Legacy ключ editorFavorites (плоский [["from","to"]]) читается как fallback
// только для вкладки "all" — пока юзер не перетоглит. Не мигрируется
// автоматически, чтобы не затирать выбор тех, кто уже что-то выставил.
const EDITOR_FAV_BY_OFFICE_KEY = "editorFavoritesByOffice";
const LEGACY_EDITOR_FAV_KEY = "editorFavorites";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useOffices } from "../store/offices.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { emitToast } from "../lib/toast.jsx";
import {
  rpcUpdatePair,
  rpcSetAllPairSpreads,
  rpcUpsertOfficeRate,
  rpcDeleteOfficeRate,
  rpcSetPairMargins,
  withToast,
} from "../lib/supabaseWrite.js";
import RatesImportModal from "../components/RatesImportModal.jsx";
import RatesCoveragePanel from "../components/RatesCoveragePanel.jsx";
import ExternalRatesWidget from "../components/ExternalRatesWidget.jsx";
import RatesTable from "../components/rates/RatesTable.jsx";
import { analyzeCoverage, loadDismissed } from "../utils/ratesCoverage.js";
import { rateKey } from "../store/rates.jsx";
import { exportCSV } from "../utils/csv.js";

export default function RatesPage({ onBack, drawer = false }) {
  const { t } = useTranslation();
  const {
    rates,
    setRate,
    deleteRate,
    getRate,
    channels,
    pairs: allPairs,
    getOfficeOverride,
    applyOfficeOverrideLocal,
    specialRates,
  } = useRates();
  const { currencies } = useCurrencies();
  const { activeOffices } = useOffices();
  const { isAdmin, isOwner, currentUser, updatePreferences } = useAuth();
  const { addEntry: logAudit } = useAudit();

  // Active office tab — визуальный scope (курсы пока общие в БД).
  const [activeOffice, setActiveOffice] = useState("all");

  // --- Editor favorites — per-office ---
  // Полный объект {officeId|"all": [["from","to"]]}. Используется в
  // toggleEditorFav для записи всех scope'ов разом.
  const editorFavoritesByOffice = useMemo(() => {
    const raw = currentUser?.preferences?.[EDITOR_FAV_BY_OFFICE_KEY];
    const safe = (v) =>
      Array.isArray(v)
        ? v.filter(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              typeof p[0] === "string" &&
              typeof p[1] === "string"
          )
        : [];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const out = {};
      Object.keys(raw).forEach((k) => {
        out[k] = safe(raw[k]);
      });
      return out;
    }
    // Legacy fallback: старый плоский editorFavorites → как избранные для "all".
    const legacy = safe(currentUser?.preferences?.[LEGACY_EDITOR_FAV_KEY]);
    return legacy.length > 0 ? { all: legacy } : {};
  }, [currentUser]);

  // Избранные текущего scope (активный офис или "all").
  const editorFavorites = useMemo(
    () => editorFavoritesByOffice[activeOffice] || [],
    [editorFavoritesByOffice, activeOffice]
  );
  const editorFavKeys = useMemo(() => {
    const set = new Set();
    editorFavorites.forEach(([a, b]) => set.add(`${a}_${b}`));
    return set;
  }, [editorFavorites]);
  const isEditorFav = React.useCallback(
    (a, b) => editorFavKeys.has(`${a}_${b}`),
    [editorFavKeys]
  );
  const toggleEditorFav = React.useCallback(
    async (a, b) => {
      if (!updatePreferences) return;
      const key = `${a}_${b}`;
      const exists = editorFavKeys.has(key);
      const nextForScope = exists
        ? editorFavorites.filter((p) => !(p[0] === a && p[1] === b))
        : [...editorFavorites, [a, b]];
      const nextMap = { ...editorFavoritesByOffice, [activeOffice]: nextForScope };
      await updatePreferences({ [EDITOR_FAV_BY_OFFICE_KEY]: nextMap });
    },
    [editorFavKeys, editorFavorites, editorFavoritesByOffice, activeOffice, updatePreferences]
  );
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

  // Унифицированный updater: передать {baseRate?, spreadPercent?, syncReverse?}.
  // update_pair с p_sync_reverse=true (дефолт): любое изменение base_rate
  // автоматически выставляет обратной default-паре base_rate = 1/new.
  // Передай syncReverse:false чтобы поправить ТОЛЬКО эту пару.
  const handleSetRate = async (from, to, { baseRate, spreadPercent, syncReverse } = {}) => {
    if (baseRate != null) {
      const n = Number(baseRate);
      if (!Number.isFinite(n) || n <= 0) return;
    }
    if (spreadPercent != null && !Number.isFinite(Number(spreadPercent))) return;

    if (isSupabaseConfigured && activeOffice !== "all") {
      // Office override — нужны оба поля; если одно не передано — берём из текущего состояния
      const existing = getOfficeOverride(activeOffice, from, to);
      const currentBase = existing?.baseRate ?? existing?.rate ?? getRate(from, to, "all");
      const currentSpread = existing?.spreadPercent ?? 0;
      const nextBase = baseRate != null ? Number(baseRate) : Number(currentBase);
      const nextSpread = spreadPercent != null ? Number(spreadPercent) : Number(currentSpread);
      if (!Number.isFinite(nextBase) || nextBase <= 0) return;
      const res = await withToast(
        () =>
          rpcUpsertOfficeRate({
            officeId: activeOffice,
            from,
            to,
            rate: nextBase,
            spreadPercent: nextSpread,
          }),
        { success: null, errorPrefix: "Office rate update failed" }
      );
      if (res.ok) {
        // Мгновенный апдейт Map — UI сразу видит новый base/spread/OFC chip,
        // не ждёт reload через bumpDataVersion.
        applyOfficeOverrideLocal?.(activeOffice, from, to, {
          baseRate: nextBase,
          spreadPercent: nextSpread,
          rate: nextBase * (1 + nextSpread / 100),
          updatedAt: new Date().toISOString(),
        });
        const officeLabel = activeOffices.find((o) => o.id === activeOffice)?.name || activeOffice;
        logAudit({
          action: "update",
          entity: "office_rate",
          entityId: `${activeOffice}:${rateKey(from, to)}`,
          summary: `${officeLabel}: ${from}→${to} base=${nextBase} spread=${nextSpread}%`,
        });
      }
      return;
    }

    // Global rate
    if (isSupabaseConfigured) {
      const res = await withToast(
        () =>
          rpcUpdatePair({
            fromCurrency: from,
            toCurrency: to,
            ...(baseRate != null ? { baseRate: Number(baseRate) } : {}),
            ...(spreadPercent != null ? { spreadPercent: Number(spreadPercent) } : {}),
            ...(syncReverse != null ? { syncReverse } : {}),
          }),
        { success: null, errorPrefix: "Update failed" }
      );
      if (res.ok) {
        logAudit({
          action: "update",
          entity: "pair",
          entityId: rateKey(from, to),
          summary: `${from}→${to}: base=${baseRate ?? "-"} spread=${spreadPercent ?? "-"}`,
        });
      }
      return;
    }
    // Demo fallback (legacy)
    if (baseRate != null) {
      const result = setRate(from, to, baseRate);
      if (result?.ok) {
        logAudit({
          action: "update",
          entity: "pair",
          entityId: rateKey(from, to),
          summary: `${from}→${to}: rate ${baseRate}`,
        });
      }
    }
  };

  // Bulk spread — выставить spread_percent на ВСЕ default-пары разом.
  // RPC set_all_pair_spreads возвращает число обновлённых пар. После успеха
  // bumpDataVersion → rates store перезагружается → строки обновляются.
  const handleBulkSpread = async (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    if (!isSupabaseConfigured) return;
    const res = await withToast(
      () => rpcSetAllPairSpreads(n),
      { success: null, errorPrefix: "Bulk spread failed" }
    );
    if (res.ok) {
      const count = Number(res.result) || 0;
      const msg = (t("rates_bulk_spread_done") || "Spread {n}% set on {count} pairs")
        .replace("{n}", String(n))
        .replace("{count}", String(count));
      emitToast("success", msg);
      logAudit({
        action: "update",
        entity: "pair",
        entityId: "all",
        summary: `Bulk spread ${n}% applied to ${count} pairs`,
      });
    }
  };

  // Правка через модель «рынок + маржа» (global-таб). rate = market + buyMargin.
  // market/buyMargin берутся текущие, если не переданы, чтобы правка одного поля
  // не обнуляла другое.
  const handleSetMargins = async (from, to, { market, buyMargin } = {}) => {
    if (!isSupabaseConfigured) return;
    const gp = allPairs.find((pp) => {
      const f = channels.find((c) => c.id === pp.fromChannelId)?.currencyCode;
      const t2 = channels.find((c) => c.id === pp.toChannelId)?.currencyCode;
      return pp.isDefault && f === from && t2 === to;
    });
    const curMarket = Number(gp?.marketRate ?? gp?.baseRate ?? getRate(from, to, "all"));
    const curMargin = Number(gp?.buyMargin ?? 0);
    const nextMarket = market != null ? Number(market) : curMarket;
    const nextMargin = buyMargin != null ? Number(buyMargin) : curMargin;
    if (!Number.isFinite(nextMarket) || nextMarket <= 0) return;
    if (!Number.isFinite(nextMargin)) return;
    const res = await withToast(
      () => rpcSetPairMargins({ fromCurrency: from, toCurrency: to, marketRate: nextMarket, buyMargin: nextMargin }),
      { success: null, errorPrefix: "Update failed" }
    );
    if (res.ok) {
      logAudit({
        action: "update",
        entity: "pair",
        entityId: rateKey(from, to),
        summary: `${from}→${to}: market=${nextMarket} margin=${nextMargin} → rate=${nextMarket + nextMargin}`,
      });
    }
  };

  // "Apply global to office" — копирует global rate в office override
  const handleApplyGlobal = async (from, to) => {
    if (activeOffice === "all") return;
    const globalRate = getRate(from, to, "all");
    if (!globalRate || globalRate <= 0) return;
    await handleSetRate(from, to, { baseRate: globalRate, spreadPercent: 0 });
  };

  // Сбросить override офиса — вернуться на global rate
  const handleResetOverride = async (from, to) => {
    if (activeOffice === "all") return;
    const res = await withToast(
      () => rpcDeleteOfficeRate({ officeId: activeOffice, from, to }),
      { success: "Reverted to global", errorPrefix: "Reset failed" }
    );
    if (res.ok) {
      // Сразу чистим override локально — не ждём reload через bumpDataVersion.
      // Раньше UI продолжал показывать старые base/spread/OFC chip, пока async
      // loadOfficeRateOverrides не завершится; на flaky сети выглядело как
      // "reset не сработал".
      applyOfficeOverrideLocal?.(activeOffice, from, to, null);
      const officeLabel = activeOffices.find((o) => o.id === activeOffice)?.name || activeOffice;
      logAudit({
        action: "delete",
        entity: "office_rate",
        entityId: `${activeOffice}:${rateKey(from, to)}`,
        summary: `${officeLabel}: ${from}→${to} override removed (global ${getRate(from, to)})`,
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
        <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] p-8 max-w-md mx-auto">
          <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-3" />
          <div className="text-[15px] font-bold text-ink mb-1">
            {t("rates_page_no_access") || "No access"}
          </div>
          <div className="text-caption text-ink-soft">
            {t("rates_page_admin_only") || "Only admins and owners can edit rates."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={drawer ? "" : "min-h-screen"}>
      <div className={drawer ? "px-5 py-4 space-y-4" : "max-w-[1400px] mx-auto px-6 py-6 space-y-5"}>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* В drawer страничную шапку (назад + заголовок) даёт обёртка — скрываем */}
          {!drawer && (
          <div className="flex items-center gap-3">
            {onBack && view === "list" && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-card text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
                title={t("rates_back_dashboard") || "Back to dashboard"}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t("rates_back_dashboard") || "Dashboard"}
              </button>
            )}
            <div className="w-9 h-9 rounded-card bg-ink flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-success" />
            </div>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">
                {t("rates_page_title") || "Rates"}
              </h1>
              <p className="text-caption text-muted">
                {t("rates_page_subtitle") ||
                  "Manage rates, pairs, and currencies. Shared across all offices."}
              </p>
            </div>
          </div>
          )}
          {view === "list" && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setView("coverage")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-caption font-bold border border-[rgba(18,22,26,0.12)] hover:bg-[rgba(18,22,26,0.03)] ${
                  coverageSummary.hasIssues ? "text-[#b8923a]" : "text-[#0c9c6b]"
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-caption font-bold text-[#6a717a] hover:text-[#15191d] border border-[rgba(18,22,26,0.12)] hover:bg-[rgba(18,22,26,0.03)] disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {t("export_csv")}
              </button>
              <button
                onClick={handleOpenImport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-caption font-bold text-white bg-[#0c9c6b] hover:bg-[#0b8c60]"
              >
                <Upload className="w-3.5 h-3.5" />
                {t("cov_import_xlsx") || "Import xlsx"}
              </button>
            </div>
          )}
          {view !== "list" && (
            <button
              onClick={backToList}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("rates_back") || "Back to list"}
            </button>
          )}
        </div>

        {/* Двухколоночный layout: слева внешние котировки (Binance/Harem/
            TCMB) — sticky-sidebar; справа основной контент. */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
          <aside className="lg:sticky lg:top-[76px] space-y-4">
            <ExternalRatesWidget />
          </aside>
          <div className="min-w-0 space-y-5">

        {/* Office tabs (visible only in list view) */}
        {view === "list" && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-[rgba(18,22,26,0.08)] pb-1.5">
            <button
              onClick={() => setActiveOffice("all")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] text-[11.5px] font-bold whitespace-nowrap transition-colors ${
                activeOffice === "all"
                  ? "bg-[rgba(18,22,26,0.06)] text-[#15191d]"
                  : "text-[#6a717a] hover:bg-[rgba(18,22,26,0.03)] hover:text-[#15191d]"
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              {t("rates_all_offices") || "All offices (global)"}
            </button>
            {activeOffices.map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveOffice(o.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] text-[11.5px] font-bold whitespace-nowrap transition-colors ${
                  activeOffice === o.id
                    ? "bg-[rgba(18,22,26,0.06)] text-[#15191d]"
                    : "text-[#6a717a] hover:bg-[rgba(18,22,26,0.03)] hover:text-[#15191d]"
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
          <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] overflow-hidden">
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
            {/* Scope notice — редактирование override для конкретного офиса */}
            {activeOffice !== "all" && (
              <div className="border border-[rgba(18,22,26,0.12)] rounded-[10px] px-4 py-3 text-caption text-[#6a717a] flex items-start gap-2">
                <Building2 className="w-4 h-4 shrink-0 mt-0.5 text-[#0c9c6b]" />
                <div>
                  <div className="font-bold text-[#15191d]">
                    {t("rates_office_override_title") ||
                      "Редактирование курсов для этого офиса"}
                  </div>
                  <div className="text-[#6a717a] mt-0.5">
                    {t("rates_office_override_body") ||
                      "Изменение курса создаёт override только для этого офиса — global остаётся как есть. Пары с override подсвечены индиго. Кнопка ↺ рядом — вернуть на global."}
                  </div>
                </div>
              </div>
            )}

            {/* Counts + action buttons */}
            <div className="flex items-center justify-between flex-wrap gap-2 px-1 py-2 border-b border-[rgba(18,22,26,0.08)]">
              <div className="text-caption text-ink-soft tabular-nums">
                <span className="font-bold text-ink">{currencies.length}</span>{" "}
                {t("rates_currencies_count") || "currencies"} ·{" "}
                <span className="font-bold text-ink">{channels.length}</span>{" "}
                {t("rates_channels_count") || "channels"} ·{" "}
                <span className="font-bold text-ink">{existingPairs.length}</span>{" "}
                {t("rates_pairs_count") || "pairs"}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setView("addCurrency")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-button text-caption font-semibold text-ink-soft hover:text-ink bg-white border border-border-soft hover:bg-surface-soft"
                >
                  <Coins className="w-3 h-3" />
                  {t("currency_add") || "Add currency"}
                </button>
                <button
                  onClick={() => setView("addChannel")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-button text-caption font-semibold text-ink-soft hover:text-ink bg-white border border-border-soft hover:bg-surface-soft"
                >
                  <NetworkIcon className="w-3 h-3" />
                  {t("channel_add") || "Add channel"}
                </button>
                <button
                  onClick={() => gotoAddPair()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-caption font-bold text-white bg-[#0c9c6b] hover:bg-[#0b8c60]"
                >
                  <Plus className="w-3 h-3" />
                  {t("add_pair") || "Add pair"}
                </button>
              </div>
            </div>

            {/* Bulk spread — выставить spread % на все default-пары разом.
                Только в "all" tab (bulk spread = global концепт, у офисных
                override'ов спред не bulk-овый) и только для тех кто может
                редактировать (страница уже это гейтит). */}
            {activeOffice === "all" && isSupabaseConfigured && (
              <BulkSpreadControl onApply={handleBulkSpread} />
            )}

            {/* Единая табличная сетка для всех пар.
                Сортировка: ★ Избранные сверху, дальше по FROM → TO
                (curIndex). Inline-редактирование Курса/Spread% в каждой
                строке. OFC-чип в строках с office override (клик = вернуть
                на global). × delete показывается на hover (только owner/admin
                в global-tab — публичные пары удаляются глобально). */}
            <RatesPageEditTable
              activeOffice={activeOffice}
              activeOffices={activeOffices}
              existingPairs={existingPairs}
              allPairs={allPairs}
              channels={channels}
              groups={groups}
              getRate={getRate}
              getOfficeOverride={getOfficeOverride}
              isEditorFav={isEditorFav}
              editorFavorites={editorFavorites}
              editorFavKeys={editorFavKeys}
              toggleEditorFav={toggleEditorFav}
              handleSetRate={handleSetRate}
              handleSetMargins={handleSetMargins}
              handleResetOverride={handleResetOverride}
              handleDeletePair={handleDeletePair}
              canDelete={isOwner || isAdmin}
              t={t}
            />

            {/* Спец-курсы (НЕРЕЗ / СБП) — информационная панель из утреннего
                импорта. В сделках пока не участвует. */}
            {specialRates && specialRates.length > 0 && (
              <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] p-5">
                <div className="text-tiny font-bold uppercase tracking-wider text-muted mb-3">
                  {t("rimport_special_title")}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-body-sm">
                  {specialRates.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="text-ink-soft">
                        {s.kind === "sbp"
                          ? `СБП · ${s.from}→${s.to}`
                          : `НЕРЕЗ · ${s.side} · ${s.settle}`}
                      </span>
                      <span className="font-mono tabular-nums text-ink">{s.value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-caption text-muted-soft">
                  {t("rimport_special_note")}
                </p>
              </div>
            )}
          </>
        )}

        {/* Sub-views: addPair / addCurrency / addChannel — используем ту же логику
            что в RatesBar, но оборачиваем в card вместо модалки */}
        {view === "addPair" && (
          <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] p-5">
            <div className="text-tiny font-bold uppercase tracking-wider text-muted mb-4">
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
          <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] p-5">
            <div className="text-tiny font-bold uppercase tracking-wider text-muted mb-4">
              {t("currency_add") || "Add currency"}
            </div>
            <AddCurrencyForm onDone={backToList} />
          </div>
        )}

        {view === "addChannel" && (
          <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] p-5">
            <div className="text-tiny font-bold uppercase tracking-wider text-muted mb-4">
              {t("channel_add") || "Add channel"}
            </div>
            <AddChannelForm onDone={backToList} />
          </div>
        )}
          </div>
        </div>
      </div>

      {importOpen && (
        <RatesImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      )}
    </main>
  );
}

// ---------------- Bulk spread control ----------------
// Маленький inline-блок: number input + "Применить ко всем" → ставит spread %
// на все default-пары через set_all_pair_spreads. После успеха rates store
// перезагружается (bumpDataVersion) и строки обновляются.
function BulkSpreadControl({ onApply }) {
  const { t } = useTranslation();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const num = Number(String(val).trim().replace(",", "."));
  const canApply = String(val).trim() !== "" && Number.isFinite(num) && !busy;

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    try {
      await onApply(num);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-1 py-2 border-b border-[rgba(18,22,26,0.08)] flex items-center gap-3 flex-wrap">
      <span className="text-caption font-semibold text-[#6a717a]">
        {t("rates_bulk_spread_label") || "Spread on all pairs"}
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^\d.,-]/g, "").replace(",", "."))}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
          placeholder="0.5"
          className="w-[90px] bg-surface-soft border border-border-soft focus:border-accent focus:bg-white rounded-button pl-2.5 pr-5 py-1 text-body-sm tabular-nums outline-none"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-tiny text-muted-soft">%</span>
      </div>
      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className={`inline-flex items-center px-3 py-1.5 rounded-card text-caption font-semibold ${
          canApply
            ? "bg-ink text-white hover:bg-ink"
            : "bg-surface-sunk text-muted-soft cursor-not-allowed"
        }`}
      >
        {busy ? "…" : (t("rates_bulk_spread_apply") || "Apply to all")}
      </button>
    </div>
  );
}

// ---------------- Edit-таблица курсов ----------------
// Адаптер между state RatesPage и общим компонентом RatesTable. Строит
// единый список пар (избранные сверху + группа «Все пары»), вычисляет
// base/spread/effective с учётом активного офис-таба, прокидывает commit
// handlers и onResetOverride/onDelete.
function RatesPageEditTable({
  activeOffice,
  existingPairs,
  allPairs,
  channels,
  groups,
  getRate,
  getOfficeOverride,
  isEditorFav,
  editorFavorites,
  editorFavKeys,
  toggleEditorFav,
  handleSetRate,
  handleSetMargins,
  handleResetOverride,
  handleDeletePair,
  canDelete,
  t,
}) {
  const isOfficeTab = activeOffice !== "all";

  // Лукап global pair объекта по from/to — берётся base_rate / spread_percent
  // / updated_at когда нет office override.
  const findGlobalPair = React.useCallback(
    (from, to) =>
      allPairs.find((pp) => {
        const f = channels.find((c) => c.id === pp.fromChannelId)?.currencyCode;
        const t2 = channels.find((c) => c.id === pp.toChannelId)?.currencyCode;
        return pp.isDefault && f === from && t2 === to;
      }),
    [allPairs, channels]
  );

  // Flat ordered list: ★ favorites (в порядке как юзер сохранил) → остальные
  // (по группам как было: from → to via curIndex).
  const { orderedPairs, groupSeparators } = React.useMemo(() => {
    const favRows = editorFavorites
      .map(([from, to]) =>
        existingPairs.find((p) => p.from === from && p.to === to)
      )
      .filter(Boolean)
      .map((p) => [p.from, p.to]);

    const restRows = [];
    groups.forEach((g) => {
      g.pairs.forEach((p) => {
        if (!editorFavKeys.has(`${p.from}_${p.to}`)) {
          restRows.push([p.from, p.to]);
        }
      });
    });

    const seps = [];
    if (favRows.length > 0) {
      seps.push({
        beforeIndex: 0,
        label: "★ Избранные",
        count: favRows.length,
      });
    }
    if (restRows.length > 0) {
      seps.push({
        beforeIndex: favRows.length,
        label: "Все пары",
        count: restRows.length,
      });
    }

    return {
      orderedPairs: [...favRows, ...restRows],
      groupSeparators: seps,
    };
  }, [editorFavorites, editorFavKeys, existingPairs, groups]);

  const favoritesSet = React.useMemo(() => {
    // Конвертация в формат «sorted key» для RatesTable.
    const s = new Set();
    editorFavorites.forEach(([a, b]) => s.add([a, b].sort().join("_")));
    return s;
  }, [editorFavorites]);

  // Обёртка над isEditorFav, чтобы toggle работал по точному порядку (a,b),
  // а не по sorted-варианту — иначе при ★ на «TRY/USD» сохранится «TRY,USD»,
  // а в данных существует «USD/TRY».
  const onToggleFav = React.useCallback(
    (a, b) => {
      // Если пара уже favorite в обратном порядке, тогглим её.
      if (editorFavKeys.has(`${b}_${a}`)) {
        toggleEditorFav(b, a);
      } else {
        toggleEditorFav(a, b);
      }
    },
    [editorFavKeys, toggleEditorFav]
  );

  const effectiveGetRate = React.useCallback(
    (a, b) => Number(getRate(a, b, isOfficeTab ? activeOffice : "all")),
    [getRate, isOfficeTab, activeOffice]
  );

  const getBaseRate = React.useCallback(
    (a, b) => {
      const gp = findGlobalPair(a, b);
      if (isOfficeTab) {
        const ovr = getOfficeOverride(activeOffice, a, b);
        if (ovr && Number.isFinite(ovr.baseRate)) return ovr.baseRate;
        if (ovr && Number.isFinite(ovr.rate)) return ovr.rate;
      }
      return gp?.baseRate ?? gp?.rate ?? getRate(a, b, "all");
    },
    [isOfficeTab, activeOffice, getOfficeOverride, findGlobalPair, getRate]
  );

  const getSpreadPercent = React.useCallback(
    (a, b) => {
      if (isOfficeTab) {
        const ovr = getOfficeOverride(activeOffice, a, b);
        if (ovr) return Number(ovr.spreadPercent ?? 0);
      }
      const gp = findGlobalPair(a, b);
      return Number(gp?.spreadPercent ?? 0);
    },
    [isOfficeTab, activeOffice, getOfficeOverride, findGlobalPair]
  );

  // Модель «рынок + маржа» (global-таб). rate = market + buyMargin.
  const getMarketRate = React.useCallback(
    (a, b) => {
      const gp = findGlobalPair(a, b);
      return Number(gp?.marketRate ?? gp?.baseRate ?? gp?.rate ?? getRate(a, b, "all"));
    },
    [findGlobalPair, getRate]
  );
  const getBuyMargin = React.useCallback(
    (a, b) => {
      const gp = findGlobalPair(a, b);
      return Number(gp?.buyMargin ?? 0);
    },
    [findGlobalPair]
  );

  const pairUpdatedAt = React.useCallback(
    (a, b) => {
      if (isOfficeTab) {
        const ovr = getOfficeOverride(activeOffice, a, b);
        if (ovr?.updatedAt) return new Date(ovr.updatedAt);
      }
      const gp = findGlobalPair(a, b);
      return gp?.updatedAt ? new Date(gp.updatedAt) : null;
    },
    [isOfficeTab, activeOffice, getOfficeOverride, findGlobalPair]
  );

  const pairHasOverride = React.useCallback(
    (a, b) => {
      if (!isOfficeTab) return false;
      return !!getOfficeOverride(activeOffice, a, b);
    },
    [isOfficeTab, activeOffice, getOfficeOverride]
  );

  if (existingPairs.length === 0) {
    return (
      <div className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] p-10 text-center text-body-sm text-muted-soft">
        {t("rates_no_pairs") ||
          "No pairs yet. Add a currency, then channels, then a pair."}
      </div>
    );
  }

  return (
    <section className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] overflow-hidden">
      <div className="px-3 pt-3 pb-1">
        <RatesTable
          mode={isOfficeTab ? "edit" : "editMargin"}
          pairs={orderedPairs}
          favorites={favoritesSet}
          onToggleFavorite={onToggleFav}
          getRate={effectiveGetRate}
          getBaseRate={getBaseRate}
          getSpreadPercent={getSpreadPercent}
          getMarketRate={getMarketRate}
          getBuyMargin={getBuyMargin}
          hasOverride={pairHasOverride}
          pairUpdatedAt={pairUpdatedAt}
          onCommitBase={(a, b, n) => handleSetRate(a, b, { baseRate: n })}
          onCommitSpread={(a, b, n) =>
            handleSetRate(a, b, { spreadPercent: n })
          }
          onCommitMarket={(a, b, n) => handleSetMargins(a, b, { market: n })}
          onCommitMargin={(a, b, n) => handleSetMargins(a, b, { buyMargin: n })}
          onResetOverride={
            isOfficeTab ? (a, b) => handleResetOverride(a, b) : undefined
          }
          onDelete={!isOfficeTab ? (a, b) => handleDeletePair(a, b) : undefined}
          canDelete={!isOfficeTab && canDelete ? () => true : undefined}
          groupSeparators={groupSeparators}
        />
      </div>
    </section>
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

  const [submitting, setSubmitting] = React.useState(false);
  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const res = await addPair({ fromChannelId, toChannelId, rate, priority: 10 });
      if (!res.ok) return;
      logAudit({
        action: "create",
        entity: "pair",
        entityId: `${fromCurrency}_${toCurrency}`,
        summary: `Added pair ${fromCurrency}→${toCurrency}: ${rate}`,
      });
      onDone?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("from") || "From"}
        </label>
        <select
          value={fromCurrency}
          onChange={(e) => setFromCurrency(e.target.value)}
          className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("to") || "To"}
        </label>
        <select
          value={toCurrency}
          onChange={(e) => setToCurrency(e.target.value)}
          className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code} disabled={c.code === fromCurrency}>
              {c.code}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("rate") || "Rate"}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          placeholder={`1 ${fromCurrency} in ${toCurrency}`}
          className="w-full bg-surface-soft border border-border-soft focus:bg-white focus:border-accent rounded-button px-3 py-2 text-body tabular-nums outline-none"
        />
      </div>

      {sameCurrency && (
        <div className="md:col-span-2 text-tiny text-warning">
          {t("rates_same_currency") || "From and to are the same currency"}
        </div>
      )}
      {duplicate && (
        <div className="md:col-span-2 text-tiny text-warning">
          {t("rates_duplicate") || "Pair already exists"}
        </div>
      )}

      <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-border-soft">
        <button
          onClick={onDone}
          className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold ${
            canSubmit ? "bg-ink text-white hover:bg-ink" : "bg-surface-sunk text-muted-soft cursor-not-allowed"
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
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("currency_code") || "Code"}
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="USD"
          className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body tabular-nums outline-none"
        />
      </div>
      <div>
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("cat_type") || "Type"}
        </label>
        <div className="inline-flex bg-surface-sunk p-0.5 rounded-button w-full">
          {["fiat", "crypto"].map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setType(tp)}
              className={`flex-1 px-3 py-1.5 text-caption font-semibold rounded-[6px] ${
                type === tp ? "bg-white text-ink shadow-sm" : "text-muted"
              }`}
            >
              {tp}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("currency_name") || "Name"}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="US Dollar"
          className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
        />
      </div>
      <div>
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("currency_symbol") || "Symbol"}
        </label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="$"
          className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
        />
      </div>
      <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-border-soft">
        <button onClick={onDone} className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk">{t("cancel")}</button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold ${
            canSubmit ? "bg-ink text-white hover:bg-ink" : "bg-surface-sunk text-muted-soft cursor-not-allowed"
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
        <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
          {t("currency") || "Currency"}
        </label>
        <select
          value={currencyCode}
          onChange={(e) => setCurrencyCode(e.target.value)}
          className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>
      {!isCrypto && (
        <div>
          <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
            {t("channel_kind") || "Kind"}
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
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
          <label className="block text-tiny font-bold uppercase tracking-wider text-muted mb-1">
            {t("network") || "Network"}
          </label>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className="w-full bg-surface-soft border border-border-soft rounded-button px-3 py-2 text-body-sm outline-none"
          >
            <option value="">—</option>
            <option value="TRC20">TRC20</option>
            <option value="ERC20">ERC20</option>
            <option value="BEP20">BEP20</option>
          </select>
        </div>
      )}
      <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-border-soft">
        <button onClick={onDone} className="px-4 py-2 rounded-card bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-sunk">{t("cancel")}</button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-card text-body-sm font-semibold ${
            canSubmit ? "bg-ink text-white hover:bg-ink" : "bg-surface-sunk text-muted-soft cursor-not-allowed"
          }`}
        >
          {t("save") || "Save"}
        </button>
      </div>
    </div>
  );
}
