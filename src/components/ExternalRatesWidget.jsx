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


function fmtRate(v) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

// Bank-style форматирование: для маленьких чисел масштабируем на 10/100/1000…
// чтобы получить читаемое значение (>= 1). Возвращает { display, scale,
// scaledValue }: scale > 1 означает «значение × scale», подписываем «за {scale}».
//   0.022016 → { display: "2.2016", scale: 100,  scaledValue: 2.2016 } → «2.2016 за 100»
//   0.000035 → { display: "3.5000", scale: 100000, scaledValue: 3.5 } → «3.5000 за 100 000»
function formatBankRate(v) {
  if (!Number.isFinite(v)) return { display: "—", scale: 1, scaledValue: null };
  const abs = Math.abs(v);
  if (abs >= 1 || abs === 0) {
    return { display: fmtRate(v), scale: 1, scaledValue: v };
  }
  let scale = 1;
  let scaled = v;
  // Подбираем минимальный scale из {10, 100, 1000, …} такой что |v*scale| >= 1.
  while (Math.abs(scaled) < 1 && scale < 1e9) {
    scale *= 10;
    scaled = v * scale;
  }
  return { display: fmtRate(scaled), scale, scaledValue: scaled };
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

// Считаем итоговый курс = mid × (1 + spread%/100). Если spread пуст/0 — = mid.
function computePairRate(mid, spreadStr) {
  if (!Number.isFinite(mid)) return null;
  const s = Number(String(spreadStr ?? "").replace(",", "."));
  if (!Number.isFinite(s) || s === 0) return mid;
  return mid * (1 + s / 100);
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
                    свой спред и значение. Плюс реверс — обратное
                    направление (1/mid) тоже видно отдельной строкой со
                    своим спредом. */}
                <div className="divide-y divide-slate-100 -mx-1">
                  {sourceRows.map((r) => {
                    const mid = Number.isFinite(r.mid)
                      ? r.mid
                      : (r.bid != null && r.ask != null ? (r.bid + r.ask) / 2 : (r.bid ?? r.ask));
                    const pairKey = `${r.source}:${r.pair}`;
                    const spreadStr = perPairSpread[pairKey] ?? "";
                    const finalRate = computePairRate(mid, spreadStr);
                    const copyKey = `${r.source}_${r.pair}`;
                    const copied = copiedKey === copyKey;
                    const hasSpread =
                      spreadStr !== "" && Number.isFinite(Number(spreadStr)) && Number(spreadStr) !== 0;

                    // Реверс: 1/mid (если 0 или NaN → null, скрываем)
                    const reverseMid =
                      Number.isFinite(mid) && Math.abs(mid) > 1e-12 ? 1 / mid : null;
                    const reversePairStr = (() => {
                      const parts = String(r.pair).split("_");
                      return parts.length === 2 ? `${parts[1]}_${parts[0]}` : null;
                    })();
                    const reverseKey = `${r.source}:${r.pair}:rev`;
                    const reverseSpreadStr = perPairSpread[reverseKey] ?? "";
                    const reverseFinal = computePairRate(reverseMid, reverseSpreadStr);
                    const reverseCopyKey = `${r.source}_${r.pair}_rev`;
                    const reverseCopied = copiedKey === reverseCopyKey;
                    const reverseHasSpread =
                      reverseSpreadStr !== "" &&
                      Number.isFinite(Number(reverseSpreadStr)) &&
                      Number(reverseSpreadStr) !== 0;

                    // Копируем то ЧТО ВИДИТ юзер — отмасштабированный bank-вид
                    const fwdScaled = formatBankRate(finalRate).scaledValue;
                    const revScaled = formatBankRate(reverseFinal).scaledValue;
                    return (
                      <React.Fragment key={copyKey}>
                        <PerPairRow
                          pair={r.pair}
                          mid={mid}
                          spread={spreadStr}
                          onSpreadChange={(v) => updatePairSpread(pairKey, v)}
                          finalRate={finalRate}
                          hasSpread={hasSpread}
                          accent={meta.accent}
                          copied={copied}
                          onCopy={() => copyValue(copyKey, fwdScaled ?? finalRate)}
                        />
                        {reverseMid != null && reversePairStr && (
                          <PerPairRow
                            pair={reversePairStr}
                            mid={reverseMid}
                            spread={reverseSpreadStr}
                            onSpreadChange={(v) => updatePairSpread(reverseKey, v)}
                            finalRate={reverseFinal}
                            hasSpread={reverseHasSpread}
                            accent={meta.accent}
                            copied={reverseCopied}
                            onCopy={() => copyValue(reverseCopyKey, revScaled ?? reverseFinal)}
                            isReverse
                          />
                        )}
                      </React.Fragment>
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
function PerPairRow({ pair, mid, spread, onSpreadChange, finalRate, hasSpread, accent, copied, onCopy, isReverse = false }) {
  // Bank-style scaling — для маленьких реверсов показываем «2.2016 за 100».
  const { display: rateDisplay, scale: rateScale } = formatBankRate(finalRate);
  const { display: midDisplay, scale: midScale } = formatBankRate(mid);
  return (
    <div
      className={`flex items-center gap-2 px-1 py-1.5 ${
        isReverse ? "bg-slate-50/40" : ""
      }`}
    >
      <span
        className={`text-[13.5px] font-bold tracking-wide w-[78px] shrink-0 inline-flex items-center gap-1 ${
          isReverse ? "text-slate-500 italic" : "text-slate-700"
        }`}
        title={isReverse ? "Реверс — 1 / прямой курс" : undefined}
      >
        {isReverse && <span className="text-[10px] text-slate-300">↔</span>}
        {formatPair(pair)}
      </span>
      <div className="relative shrink-0">
        <input
          type="text"
          inputMode="decimal"
          value={spread}
          onChange={(e) => onSpreadChange(e.target.value)}
          placeholder="0"
          title="Спред % для этой пары — итог = mid × (1 + spread/100)"
          className={`w-[64px] border rounded-[6px] pl-2 pr-5 py-0.5 text-[11px] tabular-nums outline-none text-right focus:bg-white ${
            hasSpread
              ? "bg-emerald-50 border-emerald-200 focus:border-emerald-400"
              : "bg-slate-50 border-slate-200 focus:border-slate-400"
          }`}
        />
        <span
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold ${
            hasSpread ? "text-emerald-600" : "text-slate-400"
          }`}
        >
          %
        </span>
      </div>
      <span className="ml-auto text-right leading-tight">
        <span
          className={`text-[15px] font-bold tabular-nums ${
            hasSpread ? accent || "text-emerald-700" : "text-slate-900"
          }`}
        >
          {rateDisplay}
        </span>
        {rateScale > 1 && (
          <span className="ml-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
            за {rateScale.toLocaleString("ru-RU")}
          </span>
        )}
        {hasSpread && Number.isFinite(mid) && (
          <span className="block text-[10px] text-slate-400 tabular-nums">
            от {midDisplay}
            {midScale > 1 && ` (за ${midScale.toLocaleString("ru-RU")})`}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onCopy}
        title={`Скопировать ${rateDisplay}${rateScale > 1 ? ` (за ${rateScale})` : ""}`}
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
