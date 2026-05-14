// src/components/ExternalRatesWidget.jsx
//
// Внешние котировки — Binance, Harem, TCMB. Источник: view
// v_external_rates_latest, Edge Function fetch-external-rates пишет
// каждые 5 минут (cron external-rates-fetch).
//
// Виджет:
//   • Группировка по source с цветной пиллой.
//   • Подпись origin URL + частоты обновления — кассир видит откуда
//     цифра и насколько свежая.
//   • PER-PAIR режим отображения (хранится локально в localStorage):
//       1. "auto"    — показываем mid как есть («Без спреда»)
//       2. "spread"  — mid × (1 + spread%) («Фил со спредом»)
//       3. "manual"  — ручное число, перекрывает mid («Ручная корректировка»)
//     Каждой паре свой режим и свои поля. Никакого общего калькулятора
//     на весь источник — каждая котировка независима.

import React, { useEffect, useState } from "react";
import { Globe, RefreshCcw, ChevronDown, ChevronUp, Copy, Check, Pencil, Info } from "lucide-react";
import { loadExternalRatesLatest } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";
import { useNow } from "../hooks/useNow.js";

const SOURCES = {
  binance: {
    label: "Binance",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    accent: "text-amber-700",
    origin: "api.binance.com · Spot bookTicker",
    description:
      "Крупнейшая в мире криптобиржа по суточному обороту (~$25–50 млрд). " +
      "Цены USDT/TRY, USDT/EUR — это реальные сделки на Spot-рынке P2P, " +
      "обновляются в реальном времени. Используется как ориентир «настоящего» " +
      "крипто-курса без посреднических наценок.",
  },
  harem: {
    label: "Harem (улица TR)",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    accent: "text-emerald-700",
    origin: "finans.truncgil.com · уличный курс TR",
    note: "≈ 0.05% от Harem Döviz",
    description:
      "Уличный курс Турции — то что показывает Harem Döviz (Eminönü, Стамбул). " +
      "Берём из бесплатного агрегатора truncgil.com (haremaltin.com прямой " +
      "fetch заблокирован Cloudflare). Расхождение с самим Harem ≈ 0.05% — " +
      "по факту это тот же уличный курс, обновляется чаще TCMB. Обычно на " +
      "0.5–1.5% выше официального TCMB.",
  },
  tcmb: {
    label: "TCMB",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
    accent: "text-sky-700",
    origin: "tcmb.gov.tr · resmi kurlar XML",
    description:
      "Türkiye Cumhuriyet Merkez Bankası — Центральный банк Турции. " +
      "Официальные курсы USD/TRY, EUR/TRY, GBP/TRY, обновляются раз в " +
      "рабочий день в 15:30 по Стамбулу. Это «документальная» цена, по " +
      "ней банки и налоговая считают официальные операции. Уличный курс " +
      "обычно немного выше (особенно USD/TRY).",
  },
  cbr: {
    label: "ЦБ РФ",
    tone: "bg-rose-50 text-rose-700 ring-rose-200",
    accent: "text-rose-700",
    origin: "cbr-xml-daily.ru · daily JSON",
    description:
      "Центральный банк России — официальный курс на следующий банковский день. " +
      "Объявляется ежедневно около 13:00 МСК по итогам торгов на Мосбирже. " +
      "Используется для расчётов по контрактам, налогам, отчётности. Уличный " +
      "(наличный) курс может отличаться на 1–3%.",
  },
  ecb: {
    label: "ЕЦБ",
    tone: "bg-violet-50 text-violet-700 ring-violet-200",
    accent: "text-violet-700",
    origin: "frankfurter.dev · ECB derived",
    description:
      "European Central Bank — Европейский центральный банк. Reference rates " +
      "EUR к 30+ валютам, публикуются ежедневно в 16:00 CET. Это «золотой " +
      "стандарт» курсов EUR/USD, EUR/GBP, EUR/CHF в банковском мире — все " +
      "европейские банки считают по нему свои переоценки.",
  },
};

// Порядок: уличный TR (важнее всего для турецких офисов), потом крипто,
// дальше центробанки и ECB-кроссы.
const SOURCE_ORDER = ["harem", "binance", "tcmb", "cbr", "ecb"];
const REFRESH_INTERVAL = "каждые 5 мин";
// Per-pair config: { "source:pair": { mode: "auto"|"spread"|"manual",
//                                     spreadPct?: number, manualValue?: number } }
const PER_PAIR_KEY = "coinplata.externalRatesPerPair";
const COLLAPSED_KEY = "coinplata.externalRatesCollapsed";
// Скрытые пары — Set<"source:pair">. По умолчанию ничего не скрыто.
const HIDDEN_KEY = "coinplata.externalRatesHidden";

const MODES = {
  auto: { label: "Без спреда", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
  spread: { label: "Фил со спредом", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  manual: { label: "Ручная корректировка", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function modeShortLabel(cfg) {
  if (!cfg || cfg.mode === "auto" || !cfg.mode) return "Авто";
  if (cfg.mode === "spread") {
    const n = Number(cfg.spreadPct);
    if (Number.isFinite(n) && n !== 0) return `+${n}%`;
    return "Спред";
  }
  if (cfg.mode === "manual") return "Ручной";
  return "Авто";
}

function fmtRate(v) {
  if (!Number.isFinite(v)) return "—";
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

// Лёгкий tooltip — показывается по hover/focus родителя через group-hover.
// Position: absolute сверху или снизу в зависимости от места. Без портала
// (не нужен — родитель z-index достаточно высокий).
function InfoTooltip({ children, side = "bottom", maxWidth = 280 }) {
  const sideCls = side === "bottom"
    ? "top-full mt-1.5 left-0"
    : "bottom-full mb-1.5 left-0";
  return (
    <span
      className={`pointer-events-none absolute ${sideCls} z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150`}
      style={{ maxWidth }}
    >
      <span className="block bg-slate-900 text-white text-[11px] leading-snug rounded-lg px-2.5 py-2 shadow-xl whitespace-normal">
        {children}
      </span>
    </span>
  );
}

function timeAgo(iso, nowMs) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Math.floor((nowMs - t) / 1000);
  if (diff < 60) return `${diff} сек`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  return `${Math.floor(diff / 86400)} д`;
}

function formatPair(pair) {
  if (!pair) return "";
  const [a, b] = pair.split("_");
  return `${a}/${b}`;
}

// Вычисление отображаемого числа в зависимости от режима строки.
//   "auto"   → mid как есть
//   "spread" → mid × (1 + spreadPct/100)
//   "manual" → cfg.manualValue (mid игнорируется)
// Возвращает null, если данных не хватает (нет mid в режиме auto/spread,
// или manualValue не число в режиме manual).
function computePerPairValue(mid, cfg) {
  if (!cfg || cfg.mode === "auto" || !cfg.mode) {
    return Number.isFinite(mid) ? mid : null;
  }
  if (cfg.mode === "spread") {
    if (!Number.isFinite(mid)) return null;
    const s = Number(cfg.spreadPct);
    if (!Number.isFinite(s)) return mid;
    return mid * (1 + s / 100);
  }
  if (cfg.mode === "manual") {
    const v = Number(cfg.manualValue);
    return Number.isFinite(v) ? v : null;
  }
  return Number.isFinite(mid) ? mid : null;
}

export default function ExternalRatesWidget({ compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const nowMs = useNow(60_000);
  // Сворачиваемый блок — persist в localStorage чтобы юзер не открывал заново.
  // По умолчанию РАСКРЫТ (per-pair настройки иначе не видны новому юзеру).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      return raw == null ? false : raw === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed]);
  // Per-pair config: режим + опциональные значения. Key — "source:pair".
  // Хранится в localStorage; по умолчанию режим "auto" (показываем mid).
  const [perPairConfig, setPerPairConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(PER_PAIR_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const updatePerPair = (key, patch) => {
    setPerPairConfig((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || { mode: "auto" }), ...patch } };
      // Если ушли в auto и нет полезных значений — чистим запись.
      if (next[key].mode === "auto" && next[key].spreadPct == null && next[key].manualValue == null) {
        delete next[key];
      }
      try {
        localStorage.setItem(PER_PAIR_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  // Hidden pairs Set — фильтр для отображения. Юзер выключает в settings.
  const [hidden, setHidden] = useState(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const persistHidden = (next) => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {}
  };
  const toggleHidden = (key) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistHidden(next);
      return next;
    });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Copy-to-clipboard с feedback (галочка 1.2 сек).
  const [copiedKey, setCopiedKey] = useState(null);
  const copyValue = (key, value) => {
    if (value == null || !Number.isFinite(value)) return;
    const text = String(value).replace(/\.?0+$/, "");
    try {
      navigator.clipboard?.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {}
  };
  const reload = React.useCallback(() => {
    setLoading(true);
    loadExternalRatesLatest()
      .then((data) => setRows(data))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[external rates] load failed", err);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const unsub = onDataBump(reload);
    const id = setInterval(reload, 60_000);
    return () => {
      unsub?.();
      clearInterval(id);
    };
  }, [reload]);

  const bySource = new Map();
  rows.forEach((r) => {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source).push(r);
  });

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      {/* Шапка кликабельная — сворачивает / разворачивает блок. Кнопки
          обновления и chevron справа; клик в любую часть шапки toggle'ит. */}
      <header
        onClick={() => setCollapsed((v) => !v)}
        className="px-4 py-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/40 to-transparent cursor-pointer select-none hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-slate-500 shrink-0" />
          <h2 className="text-[14px] font-bold text-slate-900 tracking-tight truncate flex-1">
            Внешние котировки
          </h2>
          {!collapsed && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => !v); }}
                className={`p-1 rounded transition-colors shrink-0 ${
                  settingsOpen
                    ? "bg-slate-900 text-white"
                    : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                }`}
                title="Настроить какие пары показывать"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); reload(); }}
                className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                title="Обновить вручную"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </>
          )}
          {collapsed
            ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            : <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          {collapsed
            ? `${bySource.size || 0} источников · ${rows.length} пар · клик чтобы раскрыть`
            : `Авто-обновление ${REFRESH_INTERVAL}`}
        </div>
      </header>
      {/* Settings panel — список всех (source, pair) с галочками. */}
      {!collapsed && settingsOpen && (
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/40 max-h-[240px] overflow-y-auto">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            Какие курсы показывать
          </div>
          {SOURCE_ORDER.filter((s) => bySource.has(s)).map((source) => {
            const meta = SOURCES[source];
            return (
              <div key={`s_${source}`} className="mb-2 last:mb-0">
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${meta?.accent || "text-slate-700"}`}>
                  {meta?.label || source}
                </div>
                {bySource.get(source).map((r) => {
                  const key = `${r.source}:${r.pair}`;
                  const visible = !hidden.has(key);
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-white cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleHidden(key)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/20 cursor-pointer"
                      />
                      <span className="text-[11.5px] text-slate-700 font-semibold tabular-nums">
                        {formatPair(r.pair)}
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {!collapsed && (rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-slate-400">
          {loading ? "Загрузка…" : "Нет данных. Cron подтянет в течение 5 минут."}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {SOURCE_ORDER.filter((s) => bySource.has(s)).map((source) => {
            const meta = SOURCES[source] || { label: source, tone: "bg-slate-100 text-slate-700 ring-slate-200", origin: "" };
            const allSourceRows = bySource.get(source);
            const sourceRows = allSourceRows.filter((r) => !hidden.has(`${r.source}:${r.pair}`));
            if (sourceRows.length === 0) return null;
            const fetchedAt = sourceRows[0]?.fetchedAt;
            return (
              <div key={source} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Source-pill — hover показывает описание через title= */}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-bold uppercase tracking-wider ring-1 cursor-help ${meta.tone}`}
                    title={meta.description || meta.origin}
                  >
                    {meta.label}
                    <Info className="w-3 h-3 ml-1 opacity-60" />
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {timeAgo(fetchedAt, nowMs)} назад
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div
                    className="text-[10.5px] text-slate-400 truncate"
                    title={meta.origin}
                  >
                    {meta.origin}
                  </div>
                  {meta.note && (
                    <div
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.tone}`}
                      title={meta.description}
                    >
                      <Info className="w-2.5 h-2.5" />
                      {meta.note}
                    </div>
                  )}
                </div>

                {/* Список пар: каждая строка независима. У каждой пары —
                    свой режим (Без спреда / Фил со спредом / Ручная
                    корректировка) и свои поля. Никакого общего калькулятора
                    на источник. */}
                <div className="divide-y divide-slate-100 -mx-1">
                  {sourceRows.map((r) => {
                    const mid = Number.isFinite(r.mid)
                      ? r.mid
                      : (r.bid != null && r.ask != null ? (r.bid + r.ask) / 2 : (r.bid ?? r.ask));
                    const pairKey = `${r.source}:${r.pair}`;
                    const cfg = perPairConfig[pairKey] || { mode: "auto" };
                    const displayValue = computePerPairValue(mid, cfg);
                    const copyKey = `${r.source}_${r.pair}`;
                    const copied = copiedKey === copyKey;
                    const isCustom = cfg.mode && cfg.mode !== "auto";
                    return (
                      <PerPairRow
                        key={copyKey}
                        pair={r.pair}
                        mid={mid}
                        cfg={cfg}
                        onUpdate={(patch) => updatePerPair(pairKey, patch)}
                        displayValue={displayValue}
                        isCustom={isCustom}
                        accent={meta.accent}
                        copied={copied}
                        onCopy={() => copyValue(copyKey, displayValue)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// Одна строка котировки — независимая. Слева: пара + chip с режимом
// (клик меняет режим по кругу: auto → spread → manual → auto). Справа:
// значение + копировать. При режиме spread/manual в строке появляется
// поле ввода соответствующего значения.
function PerPairRow({ pair, mid, cfg, onUpdate, displayValue, isCustom, accent, copied, onCopy }) {
  const mode = cfg?.mode || "auto";
  const meta = MODES[mode] || MODES.auto;
  const cycleMode = () => {
    const next = mode === "auto" ? "spread" : mode === "spread" ? "manual" : "auto";
    const patch = { mode: next };
    // Auto-инициализируем поля при переключении, чтобы юзеру не приходилось
    // нажимать ещё раз — режим уже «осмысленный».
    if (next === "spread" && cfg?.spreadPct == null) patch.spreadPct = 0;
    if (next === "manual" && cfg?.manualValue == null && Number.isFinite(mid)) {
      patch.manualValue = Number(mid).toFixed(4);
    }
    onUpdate(patch);
  };
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <span className="text-[13.5px] font-bold text-slate-700 tracking-wide w-[78px] shrink-0">
        {formatPair(pair)}
      </span>
      <button
        type="button"
        onClick={cycleMode}
        title={`Режим: ${meta.label}. Клик — переключить.`}
        className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1 shrink-0 ${meta.chip} hover:brightness-95 transition-all`}
      >
        {modeShortLabel(cfg)}
      </button>
      {mode === "spread" && (
        <div className="relative shrink-0">
          <input
            type="text"
            inputMode="decimal"
            value={cfg.spreadPct == null ? "" : String(cfg.spreadPct)}
            onChange={(e) =>
              onUpdate({
                spreadPct: e.target.value.replace(/[^\d.,-]/g, "").replace(",", "."),
              })
            }
            placeholder="0"
            className="w-[60px] bg-emerald-50 border border-emerald-200 focus:bg-white focus:border-emerald-400 rounded-[6px] pl-2 pr-4 py-0.5 text-[11px] tabular-nums outline-none text-right"
          />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-emerald-600 font-bold">%</span>
        </div>
      )}
      {mode === "manual" && (
        <input
          type="text"
          inputMode="decimal"
          value={cfg.manualValue == null ? "" : String(cfg.manualValue)}
          onChange={(e) =>
            onUpdate({
              manualValue: e.target.value.replace(/[^\d.,-]/g, "").replace(",", "."),
            })
          }
          placeholder={Number.isFinite(mid) ? fmtRate(mid) : "0.0000"}
          className="w-[88px] bg-amber-50 border border-amber-200 focus:bg-white focus:border-amber-400 rounded-[6px] px-2 py-0.5 text-[11px] tabular-nums outline-none text-right shrink-0"
        />
      )}
      <span className="ml-auto text-right leading-tight">
        <span
          className={`text-[15px] font-bold tabular-nums ${
            isCustom ? accent || "text-emerald-700" : "text-slate-900"
          }`}
        >
          {fmtRate(displayValue)}
        </span>
        {isCustom && Number.isFinite(mid) && (
          <span className="block text-[10px] text-slate-400 tabular-nums">
            от {fmtRate(mid)}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onCopy}
        title={`Скопировать ${fmtRate(displayValue)}`}
        className={`p-1 rounded transition-colors shrink-0 ${
          copied
            ? "text-emerald-600 bg-emerald-50"
            : "text-slate-300 hover:text-slate-900 hover:bg-slate-100"
        }`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}
