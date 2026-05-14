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
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Download,
  Star,
  Pencil,
  RotateCcw,
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
  withToast,
} from "../lib/supabaseWrite.js";
import RatesImportModal from "../components/RatesImportModal.jsx";
import RatesCoveragePanel from "../components/RatesCoveragePanel.jsx";
import ExternalRatesWidget from "../components/ExternalRatesWidget.jsx";
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
import { useNow } from "../hooks/useNow.js";

// "обновлён 5 мин назад" — относительная метка через Intl.RelativeTimeFormat
// для авто-i18n (ru/en/tr подхватываются по navigator.language). Старше
// недели — показываем абсолютную дату DD MMM.
function formatRelativeTime(dt, nowMs = Date.now(), locale) {
  if (!dt) return null;
  const ms = typeof dt === "string" || typeof dt === "number" ? new Date(dt).getTime() : dt?.getTime?.();
  if (!Number.isFinite(ms)) return null;
  const diffSec = Math.floor((nowMs - ms) / 1000);
  const lc = locale || (typeof navigator !== "undefined" ? navigator.language : "en");
  let rtf;
  try {
    rtf = new Intl.RelativeTimeFormat(lc, { numeric: "auto" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  if (diffSec < 5) return rtf.format(0, "second");
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return rtf.format(-diffHour, "hour");
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return rtf.format(-diffDay, "day");
  try {
    return new Date(ms).toLocaleDateString(lc, { day: "2-digit", month: "short" });
  } catch {
    return new Date(ms).toLocaleDateString("en", { day: "2-digit", month: "short" });
  }
}

// Форматирование "обратного" курса (1/rate) с достаточной точностью для
// мелких десятичных — чтобы не показывать "0.0000". Большие числа — 4 знака;
// мелкие — 6 значащих цифр (без хвостовых нулей).
function formatInverseRate(v) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return v.toFixed(4);
  const s = v.toPrecision(6);
  // toPrecision может вернуть экспоненту для очень мелких — в этом случае
  // оставляем как есть; иначе убираем хвостовые нули.
  return s.includes("e") ? s : s.replace(/\.?0+$/, "");
}

export default function RatesPage({ onBack }) {
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

  // Block spread — выставить spreadPercent на все пары внутри одного блока
  // (Favorites / FROM-группа USD/EUR/TRY/USDT/…). Цикл по парам через
  // handleSetRate — он сам выбирает global pair или office override в
  // зависимости от activeOffice. Используется в section-header'ах списка.
  const handleBlockSpread = async (pairsInBlock, value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    if (!Array.isArray(pairsInBlock) || pairsInBlock.length === 0) return;
    let ok = 0;
    let failed = 0;
    // Последовательно, чтобы каждая ошибка отдельным тостом не сыпала спам.
    for (const p of pairsInBlock) {
      try {
        await handleSetRate(p.from, p.to, { spreadPercent: n });
        ok += 1;
      } catch (e) {
        failed += 1;
      }
    }
    if (ok > 0) emitToast("success", `Spread ${n}% применён к ${ok} паре(ам)`);
    if (failed > 0) emitToast("error", `Не удалось обновить ${failed} пар(ы)`);
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
            {onBack && view === "list" && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                title={t("rates_back_dashboard") || "Back to dashboard"}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t("rates_back_dashboard") || "Dashboard"}
              </button>
            )}
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

        {/* Двухколоночный layout: слева внешние котировки (Binance/Harem/
            TCMB) — sticky-sidebar; справа основной контент. */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
          <aside className="lg:sticky lg:top-[76px] space-y-4">
            <ExternalRatesWidget />
          </aside>
          <div className="min-w-0 space-y-5">

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
            {/* Scope notice — редактирование override для конкретного офиса */}
            {activeOffice !== "all" && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-[10px] px-4 py-3 text-[12px] text-indigo-800 flex items-start gap-2">
                <Building2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">
                    {t("rates_office_override_title") ||
                      "Редактирование курсов для этого офиса"}
                  </div>
                  <div className="text-indigo-700 mt-0.5">
                    {t("rates_office_override_body") ||
                      "Изменение курса создаёт override только для этого офиса — global остаётся как есть. Пары с override подсвечены индиго. Кнопка ↺ рядом — вернуть на global."}
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

            {/* Bulk spread — выставить spread % на все default-пары разом.
                Только в "all" tab (bulk spread = global концепт, у офисных
                override'ов спред не bulk-овый) и только для тех кто может
                редактировать (страница уже это гейтит). */}
            {activeOffice === "all" && isSupabaseConfigured && (
              <BulkSpreadControl onApply={handleBulkSpread} />
            )}

            {/* Favorites — sticky top-секция. Каждый юзер сам выбирает свои
                избранные пары (per-user, server-persisted в preferences).
                Отдельно от dashboardFavorites — RatesSidebar и редактор не
                делят список. ⭐ toggle есть и здесь и на каждой паре в общем
                списке снизу. */}
            {editorFavorites.length > 0 && (() => {
              // Берём только те favorites которые реально существуют в pairs
              const favRows = editorFavorites
                .map(([from, to]) => existingPairs.find((p) => p.from === from && p.to === to))
                .filter(Boolean);
              if (favRows.length === 0) return null;
              return (
                <section className="bg-amber-50/40 rounded-[14px] border border-amber-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-100/40 flex items-center gap-2 flex-wrap">
                    <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                    <span className="text-[13px] font-bold text-amber-900">
                      Избранное
                    </span>
                    <span className="text-[10px] text-amber-700/70 uppercase tracking-wider">
                      {favRows.length} · быстрое редактирование
                    </span>
                    {isSupabaseConfigured && (
                      <BlockSpreadControl
                        isOfficeTab={activeOffice !== "all"}
                        pairsWithSpread={favRows.map((p) => {
                          const isOfficeTab = activeOffice !== "all";
                          const override = isOfficeTab
                            ? getOfficeOverride(activeOffice, p.from, p.to)
                            : null;
                          const globalPair = allPairs.find((pp) => {
                            const f = channels.find((c) => c.id === pp.fromChannelId)?.currencyCode;
                            const t2 = channels.find((c) => c.id === pp.toChannelId)?.currencyCode;
                            return pp.isDefault && f === p.from && t2 === p.to;
                          });
                          const currentSpread = isOfficeTab
                            ? (override?.spreadPercent ?? 0)
                            : (globalPair?.spreadPercent ?? 0);
                          return { from: p.from, to: p.to, currentSpread };
                        })}
                        onApply={(n) =>
                          handleBlockSpread(
                            favRows.map((p) => ({ from: p.from, to: p.to })),
                            n
                          )
                        }
                      />
                    )}
                  </div>
                  <div className="divide-y divide-amber-100 bg-white">
                    {favRows.map((p) => {
                      const isOfficeTab = activeOffice !== "all";
                      const override = isOfficeTab
                        ? getOfficeOverride(activeOffice, p.from, p.to)
                        : null;
                      const globalPair = allPairs.find((pp) => {
                        const f = channels.find((c) => c.id === pp.fromChannelId)?.currencyCode;
                        const t2 = channels.find((c) => c.id === pp.toChannelId)?.currencyCode;
                        return pp.isDefault && f === p.from && t2 === p.to;
                      });
                      return (
                        <PairRow
                          key={`fav_${p.key}`}
                          from={p.from}
                          to={p.to}
                          globalValue={getRate(p.from, p.to, "all")}
                          globalPair={globalPair}
                          officeOverride={override}
                          isOfficeTab={isOfficeTab}
                          canReset={isOfficeTab && !!override}
                          onUpdate={(patch) => handleSetRate(p.from, p.to, patch)}
                          onApplyGlobal={() => handleApplyGlobal(p.from, p.to)}
                          onDelete={() => handleDeletePair(p.from, p.to)}
                          onResetOverride={() => handleResetOverride(p.from, p.to)}
                          canDelete={(isOwner || isAdmin) && !isOfficeTab}
                          isFavorite={true}
                          onToggleFavorite={() => toggleEditorFav(p.from, p.to)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })()}

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
                    <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/40 flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-slate-900">{g.from}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                        {g.pairs.length} {t("rates_pairs_count") || "pairs"}
                      </span>
                      {isSupabaseConfigured && (
                        <BlockSpreadControl
                          isOfficeTab={activeOffice !== "all"}
                          pairsWithSpread={g.pairs.map((p) => {
                            const isOfficeTab = activeOffice !== "all";
                            const override = isOfficeTab
                              ? getOfficeOverride(activeOffice, p.from, p.to)
                              : null;
                            const globalPair = allPairs.find((pp) => {
                              const f = channels.find((c) => c.id === pp.fromChannelId)?.currencyCode;
                              const t2 = channels.find((c) => c.id === pp.toChannelId)?.currencyCode;
                              return pp.isDefault && f === p.from && t2 === p.to;
                            });
                            const currentSpread = isOfficeTab
                              ? (override?.spreadPercent ?? 0)
                              : (globalPair?.spreadPercent ?? 0);
                            return { from: p.from, to: p.to, currentSpread };
                          })}
                          onApply={(n) =>
                            handleBlockSpread(
                              g.pairs.map((p) => ({ from: p.from, to: p.to })),
                              n
                            )
                          }
                        />
                      )}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {g.pairs.map((p) => {
                        const isOfficeTab = activeOffice !== "all";
                        const override = isOfficeTab
                          ? getOfficeOverride(activeOffice, p.from, p.to)
                          : null;
                        // Global pair объект (для baseRate / spreadPercent)
                        const globalPair = allPairs.find((pp) => {
                          const f = channels.find((c) => c.id === pp.fromChannelId)?.currencyCode;
                          const t2 = channels.find((c) => c.id === pp.toChannelId)?.currencyCode;
                          return pp.isDefault && f === p.from && t2 === p.to;
                        });
                        return (
                          <PairRow
                            key={p.key}
                            from={p.from}
                            to={p.to}
                            globalValue={getRate(p.from, p.to, "all")}
                            globalPair={globalPair}
                            officeOverride={override}
                            isOfficeTab={isOfficeTab}
                            canReset={isOfficeTab && !!override}
                            onUpdate={(patch) => handleSetRate(p.from, p.to, patch)}
                            onApplyGlobal={() => handleApplyGlobal(p.from, p.to)}
                            onDelete={() => handleDeletePair(p.from, p.to)}
                            onResetOverride={() => handleResetOverride(p.from, p.to)}
                            canDelete={(isOwner || isAdmin) && !isOfficeTab}
                            isFavorite={isEditorFav(p.from, p.to)}
                            onToggleFavorite={() => toggleEditorFav(p.from, p.to)}
                          />
                        );
                      })}
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
// Inline-контрол спреда для секции (FROM-группы или Favorites): одно поле,
// которое применяется ко всем парам в блоке. Текущее значение = spread у пар
// блока, если все одинаковые — показываем число, иначе "mixed".
// pairsWithSpread: массив { from, to, currentSpread } (currentSpread может
// быть undefined/null — учтём как 0 для отображения).
function BlockSpreadControl({ pairsWithSpread, onApply, isOfficeTab }) {
  const { t } = useTranslation();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  // Группируем спреды → если все равны, показываем единое число; иначе mixed.
  const uniqueSpreads = React.useMemo(() => {
    const set = new Set();
    pairsWithSpread.forEach((p) => set.add(Number(p.currentSpread || 0)));
    return [...set];
  }, [pairsWithSpread]);
  const sharedSpread = uniqueSpreads.length === 1 ? uniqueSpreads[0] : null;
  const isMixed = uniqueSpreads.length > 1;

  // При входе/выходе focus — синхронизируем поле с актуальным sharedSpread.
  React.useEffect(() => {
    if (!focused) {
      setVal(sharedSpread != null ? String(sharedSpread) : "");
    }
  }, [sharedSpread, focused]);

  const num = Number(String(val).trim().replace(",", "."));
  const canApply =
    String(val).trim() !== "" &&
    Number.isFinite(num) &&
    !busy &&
    pairsWithSpread.length > 0 &&
    num !== sharedSpread;

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    try {
      await onApply(num);
    } finally {
      setBusy(false);
      setFocused(false);
    }
  };

  return (
    <div
      className="inline-flex items-center gap-1.5 ml-auto"
      onClick={(e) => e.stopPropagation()}
      title={
        isOfficeTab
          ? "Применить спред ко всем парам блока (office override)"
          : "Применить спред ко всем парам блока"
      }
    >
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
        {t("rates_spread") || "Spread"}
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={val}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setFocused(true);
            setVal(e.target.value.replace(/[^\d.,-]/g, "").replace(",", "."));
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          placeholder={isMixed ? "mixed" : "0"}
          className={`w-[68px] bg-slate-50 border rounded-[8px] pl-2 pr-5 py-0.5 text-[12px] tabular-nums outline-none focus:bg-white ${
            isMixed
              ? "border-amber-300 placeholder:text-amber-600"
              : "border-slate-200 focus:border-slate-400"
          }`}
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
          %
        </span>
      </div>
      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className={`px-2 py-0.5 rounded-[6px] text-[11px] font-semibold transition-colors ${
          canApply
            ? "bg-slate-900 text-white hover:bg-slate-800"
            : "bg-slate-100 text-slate-400 cursor-not-allowed"
        }`}
      >
        {busy ? "…" : "Apply"}
      </button>
    </div>
  );
}

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
    <div className="bg-white border border-slate-200 rounded-[12px] px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-[12px] font-semibold text-slate-700">
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
          className="w-[90px] bg-slate-50 border border-slate-200 focus:border-slate-400 focus:bg-white rounded-[8px] pl-2.5 pr-5 py-1 text-[13px] tabular-nums outline-none"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">%</span>
      </div>
      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className={`inline-flex items-center px-3 py-1.5 rounded-[10px] text-[12px] font-semibold ${
          canApply
            ? "bg-slate-900 text-white hover:bg-slate-800"
            : "bg-slate-200 text-slate-400 cursor-not-allowed"
        }`}
      >
        {busy ? "…" : (t("rates_bulk_spread_apply") || "Apply to all")}
      </button>
    </div>
  );
}

// ---------------- Pair row — обменная логика ----------------
// Global (read-only) · Apply global btn · Office base · Spread % · Effective
// В "all" tab: только одна колонка Rate + Spread (редактирует global pair).
// В office tab: global read-only + office base (edit) + spread (edit) +
//   кнопка ← apply global · reset override (↺) · индикатор override chip.
function PairRow({
  from,
  to,
  globalValue,        // текущий global rate
  globalPair,         // pair object (для base/spread global)
  officeOverride,     // {baseRate, spreadPercent, rate, updatedAt} | null
  isOfficeTab,        // true если active tab ≠ "all"
  canReset,
  onUpdate,           // ({baseRate?, spreadPercent?}) => void
  onApplyGlobal,      // () => void (копирует global в office override)
  onResetOverride,    // () => void
  onDelete,
  canDelete,
  isFavorite = false,
  onToggleFavorite,
}) {
  const { t } = useTranslation();
  // Тикер на 30s — пересчитывает "5 мин назад" без полного reload страницы.
  const nowMs = useNow(30_000);

  // В office-режиме источник значений = override > global fallback
  // В global-режиме — из globalPair (base/spread/rate)
  const effectiveBase = isOfficeTab
    ? (officeOverride?.baseRate ?? officeOverride?.rate ?? globalPair?.baseRate ?? globalValue ?? "")
    : (globalPair?.baseRate ?? globalValue ?? "");
  const effectiveSpread = isOfficeTab
    ? (officeOverride?.spreadPercent ?? 0)
    : (globalPair?.spreadPercent ?? 0);
  const effectiveRate = isOfficeTab
    ? (officeOverride?.rate ?? globalValue)
    : globalPair?.rate ?? globalValue;

  const [baseStr, setBaseStr] = useState(String(effectiveBase ?? ""));
  const [editingBase, setEditingBase] = useState(false);

  React.useEffect(() => {
    if (!editingBase) setBaseStr(String(effectiveBase ?? ""));
  }, [effectiveBase, editingBase]);

  const hasOverride = !!officeOverride;

  const commitBase = () => {
    setEditingBase(false);
    const n = Number(baseStr);
    if (Number.isFinite(n) && n > 0 && n !== Number(effectiveBase)) {
      onUpdate({ baseRate: n });
    }
  };

  return (
    <div
      className={`px-4 py-3 hover:bg-slate-50/40 ${
        hasOverride && isOfficeTab ? "bg-indigo-50/30" : ""
      }`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        {/* Pair label */}
        <div className="flex items-center gap-2 min-w-[110px]">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`shrink-0 transition-colors ${
                isFavorite
                  ? "text-amber-500 hover:text-amber-600"
                  : "text-slate-300 hover:text-amber-500"
              }`}
              title={isFavorite ? "Убрать из избранного" : "В избранное"}
            >
              <Star className={`w-3.5 h-3.5 ${isFavorite ? "fill-amber-400" : ""}`} />
            </button>
          )}
          <span className="text-[13px] font-bold text-slate-900 tabular-nums">{from}</span>
          <span className="text-slate-400">→</span>
          <span className="text-[13px] font-bold text-slate-900 tabular-nums">{to}</span>
          {/* Status pill: показываем для офис-таба, чтобы было ясно — это
              офисный или общий курс. Без pill юзер раньше путался какая из
              двух соседних кнопок что-то с офисом, а какая — с глобал. */}
          {isOfficeTab && hasOverride && (
            <span
              className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold text-indigo-700 bg-indigo-100 uppercase tracking-wider"
              title={t("rates_override_tip") || "У этого офиса свой курс поверх глобального"}
            >
              OFC
            </span>
          )}
          {isOfficeTab && !hasOverride && (
            <span
              className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold text-slate-500 bg-slate-100 uppercase tracking-wider"
              title={t("rates_status_global_tip") || "Этот офис использует общий глобальный курс"}
            >
              {t("rates_status_global") || "ГЛОБАЛ"}
            </span>
          )}
        </div>

        {/* Global (read-only в office-режиме) */}
        {isOfficeTab && (
          <div
            className="flex flex-col items-start"
            title={t("rates_global_tip") || "Общий курс для всех офисов"}
          >
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              {t("rates_global_label") || "Global"}
            </span>
            <span className="text-[12px] font-semibold text-slate-600 tabular-nums">
              {globalValue != null ? Number(globalValue).toFixed(4) : "—"}
            </span>
          </div>
        )}

        {/* Одна кнопка в зависимости от состояния. Текст описывает РЕЗУЛЬТАТ:
            • Без override → "✏️ Свой курс офиса" — создаёт office override,
              стартует от global; юзер потом может править base/spread.
            • С override → "↺ Использовать глобал" — удаляет office override;
              офис снова работает на общем глобальном курсе.
            Раньше было "Apply global" / "Use global" — две почти одинаковых
            фразы про global, делающие противоположное → путаница. */}
        {isOfficeTab && !hasOverride && (
          <button
            type="button"
            onClick={onApplyGlobal}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200"
            title={t("rates_customize_for_office_tip") || "Создать собственный курс офиса. Стартовое значение — глобальный курс, потом можно изменить базу и спред."}
          >
            <Pencil className="w-3 h-3" strokeWidth={2.5} />
            {t("rates_customize_for_office") || "Свой курс офиса"}
          </button>
        )}
        {isOfficeTab && hasOverride && (
          <button
            type="button"
            onClick={onResetOverride}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200"
            title={t("rates_remove_override_tip") || "Убрать офисный курс. Этот офис снова будет использовать общий глобальный курс."}
          >
            <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
            {t("rates_remove_override") || "Использовать глобал"}
          </button>
        )}

        {/* Base rate input */}
        <div className="flex flex-col items-start">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
            {isOfficeTab ? (t("rates_office_base") || "Office base") : (t("rates_base_rate") || "Base rate")}
          </span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={baseStr}
              onChange={(e) => {
                setEditingBase(true);
                setBaseStr(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."));
              }}
              onBlur={commitBase}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              className={`w-[120px] bg-slate-50 border rounded-[8px] px-2.5 py-1 text-[13px] tabular-nums outline-none focus:bg-white ${
                hasOverride && isOfficeTab
                  ? "border-indigo-300 focus:border-indigo-500"
                  : "border-slate-200 focus:border-slate-400"
              }`}
            />
            {/* Force re-sync обратной пары = 1/этой. Только в global ("all")
                табе — у офисных override'ов нет чистой "обратной пары".
                Обычное редактирование base уже синхронит reverse server-side;
                эта кнопка нужна когда обратная пара дрейфанула со старых
                данных. */}
            {!isOfficeTab && Number.isFinite(Number(effectiveBase)) && Number(effectiveBase) > 0 && (
              <button
                type="button"
                onClick={() => onUpdate({ baseRate: Number(effectiveBase), syncReverse: true })}
                className="shrink-0 p-1 rounded-[6px] text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title={t("rates_sync_reverse_tip") || "Пересчитать обратную пару = 1/этой"}
              >
                <ArrowLeftRight className="w-3 h-3" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {/* Spread — read-only label. Per-pair input убран: спред меняется
            одним полем на блок (Favorites / FROM-группа) в шапке секции. */}
        <div className="flex flex-col items-start">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
            {t("rates_spread") || "Spread"}
          </span>
          <span className="text-[12px] font-semibold text-slate-600 tabular-nums px-2 py-1">
            {Number.isFinite(Number(effectiveSpread))
              ? `${Number(effectiveSpread).toFixed(2)}%`
              : "—"}
          </span>
        </div>

        {/* Effective rate (computed) + inverse direction hint */}
        <div className="flex flex-col items-start">
          <span
            className="text-[9px] font-bold text-slate-400 uppercase tracking-wider cursor-help"
            title={t("rates_effective_tip") || "Итоговый курс который применяется в сделках = Base × (1 + Spread/100)"}
          >
            {t("rates_effective") || "Effective"} ⓘ
          </span>
          <span className="text-[14px] font-bold text-slate-900 tabular-nums">
            {effectiveRate != null ? Number(effectiveRate).toFixed(4) : "—"}
          </span>
          {effectiveRate != null && Number(effectiveRate) > 0 && (
            <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
              {(t("rates_inverse_hint") || "↔ 1 {to} = {rate} {from}")
                .replace("{to}", to)
                .replace("{rate}", formatInverseRate(1 / Number(effectiveRate)))
                .replace("{from}", from)}
            </span>
          )}
        </div>

        {/* Updated at — когда курс был последний раз изменён.
            В office-tab с override берём officeOverride.updatedAt;
            иначе — globalPair.updatedAt. Hover показывает точную дату. */}
        {(() => {
          const updatedAt = isOfficeTab && officeOverride?.updatedAt
            ? officeOverride.updatedAt
            : globalPair?.updatedAt;
          if (!updatedAt) return null;
          const rel = formatRelativeTime(updatedAt, nowMs);
          let abs = "";
          try {
            abs = new Date(updatedAt).toLocaleString();
          } catch {}
          return (
            <div className="flex flex-col items-start" title={abs}>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                {t("rates_updated") || "Обновлён"}
              </span>
              <span className="text-[11.5px] text-slate-500 tabular-nums whitespace-nowrap">
                {rel || "—"}
              </span>
            </div>
          );
        })()}

        <div className="ml-auto flex items-center gap-1">
          {canDelete && (
            <button
              onClick={onDelete}
              className="text-[14px] text-rose-500 hover:text-rose-700 font-semibold"
              title={t("delete") || "Delete"}
            >
              ×
            </button>
          )}
        </div>
      </div>
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
