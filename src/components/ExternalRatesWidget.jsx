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
    tone: "bg-warning-soft text-warning ring-amber-200",
    accent: "text-warning",
    origin: "api.binance.com · Spot bookTicker",
    description:
      "Крупнейшая в мире криптобиржа по суточному обороту (~$25–50 млрд). " +
      "Цены USDT/TRY, USDT/EUR — это реальные сделки на Spot-рынке P2P, " +
      "обновляются в реальном времени. Используется как ориентир «настоящего» " +
      "крипто-курса без посреднических наценок.",
  },
  harem: {
    label: "Harem (улица TR)",
    tone: "bg-success-soft text-success ring-emerald-200",
    accent: "text-success",
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
    tone: "bg-info-soft text-info ring-sky-200",
    accent: "text-info",
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
    tone: "bg-danger-soft text-danger ring-rose-200",
    accent: "text-danger",
    origin: "cbr-xml-daily.ru · daily JSON",
    description:
      "Центральный банк России — официальный курс на следующий банковский день. " +
      "Объявляется ежедневно около 13:00 МСК по итогам торгов на Мосбирже. " +
      "Используется для расчётов по контрактам, налогам, отчётности. Уличный " +
      "(наличный) курс может отличаться на 1–3%.",
  },
  ecb: {
    label: "ЕЦБ",
    tone: "bg-accent-bg text-accent ring-violet-200",
    accent: "text-accent",
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


function fmtRate(v) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(4);
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
      <span className="block bg-ink text-white text-tiny leading-snug rounded-lg px-2.5 py-2 shadow-xl whitespace-normal">
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

// Bank-board: купим (BUY) и продадим (SELL) — две цены на mid, разведённые
// спредом. BUY ниже mid (мы платим меньше TRY за 1 USD когда покупаем USD у
// клиента), SELL выше (мы получаем больше TRY когда продаём USD клиенту).
//   spread = 0.5% → BUY = mid × 0.995, SELL = mid × 1.005
// Пустой/0 спред → BUY = SELL = mid.
function computeBuySell(mid, spreadStr) {
  if (!Number.isFinite(mid)) return { buy: null, sell: null };
  const s = Number(String(spreadStr ?? "").replace(",", "."));
  if (!Number.isFinite(s) || s === 0) return { buy: mid, sell: mid };
  const half = s / 100;
  return { buy: mid * (1 - half), sell: mid * (1 + half) };
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
  // Per-pair spread: { "source:pair": spreadPctString } — хранится локально.
  // Пустая строка / отсутствие ключа = спред 0 (показываем mid как есть).
  const [perPairSpread, setPerPairSpread] = useState(() => {
    try {
      const raw = localStorage.getItem(PER_PAIR_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      // Backwards-compat: если в storage остались old-shape объекты вида
      // { mode, spreadPct, manualValue } — вытащим оттуда spreadPct.
      const flat = {};
      Object.entries(parsed || {}).forEach(([k, v]) => {
        if (typeof v === "string" || typeof v === "number") flat[k] = String(v);
        else if (v && typeof v === "object" && v.spreadPct != null) flat[k] = String(v.spreadPct);
      });
      return flat;
    } catch {
      return {};
    }
  });
  const updatePairSpread = (key, value) => {
    setPerPairSpread((prev) => {
      const next = { ...prev };
      const cleaned = String(value || "").replace(/[^\d.,-]/g, "").replace(",", ".");
      // Удаляем ключ ТОЛЬКО при пустой строке. Раньше также чистили "0",
      // из-за чего юзер не мог набрать "0.5" — после ввода "0" поле
      // сбрасывалось и точка попадала в пустое поле.
      if (cleaned === "") delete next[key];
      else next[key] = cleaned;
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
    <section className="bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] overflow-hidden">
      {/* Шапка кликабельная — сворачивает / разворачивает блок. Кнопки
          обновления и chevron справа; клик в любую часть шапки toggle'ит. */}
      <header
        onClick={() => setCollapsed((v) => !v)}
        className="px-4 py-3 border-b border-[rgba(18,22,26,0.08)] cursor-pointer select-none hover:bg-[rgba(18,22,26,0.022)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted shrink-0" />
          <h2 className="text-body font-bold text-ink tracking-tight truncate flex-1">
            Внешние котировки
          </h2>
          {!collapsed && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => !v); }}
                className={`p-1 rounded transition-colors shrink-0 ${
                  settingsOpen
                    ? "bg-ink text-white"
                    : "text-muted-soft hover:text-ink hover:bg-surface-sunk"
                }`}
                title="Настроить какие пары показывать"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); reload(); }}
                className="p-1 rounded text-muted-soft hover:text-ink hover:bg-surface-sunk transition-colors shrink-0"
                title="Обновить вручную"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </>
          )}
          {collapsed
            ? <ChevronDown className="w-4 h-4 text-muted-soft shrink-0" />
            : <ChevronUp className="w-4 h-4 text-muted-soft shrink-0" />}
        </div>
        <div className="text-tiny text-muted mt-1">
          {collapsed
            ? `${bySource.size || 0} источников · ${rows.length} пар · клик чтобы раскрыть`
            : `Авто-обновление ${REFRESH_INTERVAL}`}
        </div>
      </header>
      {/* Settings panel — список всех (source, pair) с галочками. */}
      {!collapsed && settingsOpen && (
        <div className="px-3 py-2 border-b border-border-soft bg-surface-soft/40 max-h-[240px] overflow-y-auto">
          <div className="text-tiny font-bold text-muted uppercase tracking-wider mb-1.5">
            Какие курсы показывать
          </div>
          {SOURCE_ORDER.filter((s) => bySource.has(s)).map((source) => {
            const meta = SOURCES[source];
            return (
              <div key={`s_${source}`} className="mb-2 last:mb-0">
                <div className={`text-tiny font-bold uppercase tracking-wider mb-1 ${meta?.accent || "text-ink-soft"}`}>
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
                        className="w-3.5 h-3.5 rounded border-border text-ink focus:ring-2 focus:ring-accent/30 cursor-pointer"
                      />
                      <span className="text-caption text-ink-soft font-semibold tabular-nums">
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
        <div className="px-4 py-6 text-center text-caption text-muted-soft">
          {loading ? "Загрузка…" : "Нет данных. Cron подтянет в течение 5 минут."}
        </div>
      ) : (
        <div className="divide-y divide-border-soft max-h-[60vh] overflow-y-auto">
          {SOURCE_ORDER.filter((s) => bySource.has(s)).map((source) => {
            const meta = SOURCES[source] || { label: source, tone: "bg-surface-sunk text-ink-soft ring-border-soft", origin: "" };
            const allSourceRows = bySource.get(source);
            const sourceRows = allSourceRows.filter((r) => !hidden.has(`${r.source}:${r.pair}`));
            if (sourceRows.length === 0) return null;
            const fetchedAt = sourceRows[0]?.fetchedAt;
            return (
              <div key={source} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Source-pill — hover показывает описание через title= */}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-caption font-bold uppercase tracking-wider ring-1 cursor-help ${meta.tone}`}
                    title={meta.description || meta.origin}
                  >
                    {meta.label}
                    <Info className="w-3 h-3 ml-1 opacity-60" />
                  </span>
                  <span className="text-tiny text-muted tabular-nums">
                    {timeAgo(fetchedAt, nowMs)} назад
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div
                    className="text-tiny text-muted-soft truncate"
                    title={meta.origin}
                  >
                    {meta.origin}
                  </div>
                  {meta.note && (
                    <div
                      className={`inline-flex items-center gap-1 text-tiny font-bold px-1.5 py-0.5 rounded ${meta.tone}`}
                      title={meta.description}
                    >
                      <Info className="w-2.5 h-2.5" />
                      {meta.note}
                    </div>
                  )}
                </div>

                {/* Bank-board: одна строка на пару, у каждой свой спред
                    и обе цены (КУПИМ ниже mid, ПРОДАДИМ выше). */}
                <div className="divide-y divide-border-soft -mx-1">
                  {sourceRows.map((r) => {
                    const mid = Number.isFinite(r.mid)
                      ? r.mid
                      : (r.bid != null && r.ask != null ? (r.bid + r.ask) / 2 : (r.bid ?? r.ask));
                    const pairKey = `${r.source}:${r.pair}`;
                    const spreadStr = perPairSpread[pairKey] ?? "";
                    const { buy, sell } = computeBuySell(mid, spreadStr);
                    const buyKey = `${r.source}_${r.pair}_buy`;
                    const sellKey = `${r.source}_${r.pair}_sell`;
                    const buyCopied = copiedKey === buyKey;
                    const sellCopied = copiedKey === sellKey;
                    const hasSpread =
                      spreadStr !== "" && Number.isFinite(Number(spreadStr)) && Number(spreadStr) !== 0;
                    return (
                      <PerPairRow
                        key={`${r.source}_${r.pair}`}
                        pair={r.pair}
                        mid={mid}
                        spread={spreadStr}
                        onSpreadChange={(v) => updatePairSpread(pairKey, v)}
                        buy={buy}
                        sell={sell}
                        hasSpread={hasSpread}
                        accent={meta.accent}
                        buyCopied={buyCopied}
                        sellCopied={sellCopied}
                        onCopyBuy={() => copyValue(buyKey, buy)}
                        onCopySell={() => copyValue(sellKey, sell)}
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

// Одна строка котировки: пара · своё поле спреда % · итоговый курс · копи.
// Никаких чипов/режимов. Пустой спред = 0 = показываем mid. Любой ненулевой
// = mid × (1 + spread/100). Хранится в localStorage per pair.
// Банковское табло: пара · спред% · КУПИМ / ПРОДАДИМ. Два значения на
// одну строку, без реверс-строки и без «за N». Спред разводит mid в обе
// стороны симметрично: buy = mid × (1 − s/2 эквивалент s%), sell = mid × (1 + s%).
function PerPairRow({
  pair,
  mid,
  spread,
  onSpreadChange,
  buy,
  sell,
  hasSpread,
  accent,
  buyCopied,
  sellCopied,
  onCopyBuy,
  onCopySell,
}) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1.5 flex-wrap sm:flex-nowrap">
      <span className="text-tiny font-bold tracking-wide w-[56px] shrink-0 text-ink-soft">
        {formatPair(pair)}
      </span>
      <div className="relative shrink-0 inline-flex items-center gap-0.5">
        {/* Sign-toggle: «±» — флипает знак текущего спреда (для случаев
            когда у клиента надо НЕ задирать а наоборот подвинуть курс
            «в его пользу»). Особенно нужен на мобильной decimal-клавиатуре
            где нет минуса. */}
        <button
          type="button"
          onClick={() => {
            const s = String(spread ?? "").trim();
            if (!s || s === "-") return;
            const next = s.startsWith("-") ? s.slice(1) : "-" + s;
            onSpreadChange(next);
          }}
          title="Перевернуть знак спреда (плюс ↔ минус)"
          className="w-5 h-[22px] rounded text-tiny font-bold text-muted bg-surface-sunk hover:bg-surface-sunk transition-colors"
        >
          ±
        </button>
        <div className="relative">
          {/* inputMode='text' — даём полную клавиатуру на мобиле, чтобы
              можно было набрать минус. На десктопе ничем не отличается. */}
          <input
            type="text"
            inputMode="text"
            value={spread}
            onChange={(e) => onSpreadChange(e.target.value)}
            placeholder="0"
            title="Спред % — на сколько разводим купим/продадим относительно mid. Может быть отрицательным (тогда КУПИМ выше mid а ПРОДАДИМ ниже)."
            className={`w-[58px] border rounded-[6px] pl-1.5 pr-4 py-0.5 text-tiny tabular-nums outline-none text-right focus:bg-white ${
              hasSpread
                ? "bg-success-soft border-success/20 focus:border-emerald-400"
                : "bg-surface-soft border-border-soft focus:border-accent"
            }`}
          />
          <span
            className={`absolute right-1 top-1/2 -translate-y-1/2 text-tiny font-bold ${
              hasSpread ? "text-success" : "text-muted-soft"
            }`}
          >
            %
          </span>
        </div>
      </div>
      <BuySellCell
        label="КУПИМ"
        value={buy}
        tone="rose"
        copied={buyCopied}
        onCopy={onCopyBuy}
      />
      <BuySellCell
        label="ПРОДАДИМ"
        value={sell}
        tone="emerald"
        copied={sellCopied}
        onCopy={onCopySell}
      />
    </div>
  );
}

function BuySellCell({ label, value, tone, copied, onCopy }) {
  const toneCls =
    tone === "rose"
      ? "text-danger"
      : tone === "emerald"
      ? "text-success"
      : "text-ink";
  return (
    <button
      type="button"
      onClick={onCopy}
      title={`${label} ${fmtRate(value)} — клик копирует`}
      className={`flex-1 min-w-0 text-right leading-tight px-1 py-0.5 rounded transition-colors ${
        copied ? "bg-success-soft ring-1 ring-emerald-200" : "hover:bg-surface-soft"
      }`}
    >
      <span className="block text-micro font-bold text-muted-soft uppercase tracking-wider">
        {label}
      </span>
      <span
        className={`block text-body font-bold tabular-nums ${toneCls}`}
      >
        {fmtRate(value)}
      </span>
    </button>
  );
}
