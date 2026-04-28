// src/components/DailyRatesModal.jsx
// Компактная модалка быстрого ежедневного обновления курсов.
// Показывает все default pairs в две колонки (a→b и b→a на одной строке).
// Инпут пустой = не трогать; заполненный и отличающийся от текущего — в diff.
// На submit батчом через rpcImportRates (atomic + snapshot для истории).

import React, { useState, useEffect, useMemo } from "react";
import { Zap, Search, X } from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useRates } from "../store/rates.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcImportRates, withToast } from "../lib/supabaseWrite.js";

function formatRate(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function timeAgo(date) {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// Короткая подпись "изм. DD.MM HH:MM" для метки под курсом.
function formatUpdatedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DailyRatesModal({ open, onClose }) {
  const { t } = useTranslation();
  const { allTradePairs, getRate, lastUpdated, pairs, channels } = useRates();
  const { addEntry: logAudit } = useAudit();
  // { "FROM_TO": { sell, buy } } — sell = master direction, buy = reverse direction.
  // Обе стороны редактируются независимо. Если buy не введён — reverse
  // синхронизируется автоматом через trigger (= 1/sell со spread'ом).
  const [inputs, setInputs] = useState({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setInputs({});
      setQuery("");
    }
  }, [open]);

  // Helper: найти pair по валютам и вернуть {updatedAt, rate, baseRate, spreadPercent, isMaster}
  const pairInfo = useMemo(() => {
    const m = new Map();
    const channelCur = (chId) => channels.find((c) => c.id === chId)?.currencyCode;
    pairs.forEach((p) => {
      if (!p.isDefault) return;
      const f = channelCur(p.fromChannelId);
      const t = channelCur(p.toChannelId);
      if (f && t) {
        m.set(`${f}_${t}`, {
          updatedAt: p.updatedAt,
          rate: p.rate,
          baseRate: p.baseRate,
          spreadPercent: p.spreadPercent,
          isMaster: p.isMaster === true,
        });
      }
    });
    return m;
  }, [pairs, channels]);

  // НОВАЯ модель: одна строка на логическую пару = master direction.
  // Reverse считается автоматически по 1/master через trigger в БД (0046).
  // Если master pair найдена — используем её; если нет (legacy data до
  // миграции) — fallback на первую существующую sторону.
  const rows = useMemo(() => {
    const out = [];
    (allTradePairs || []).forEach(([a, b]) => {
      const ab = pairInfo.get(`${a}_${b}`);
      const ba = pairInfo.get(`${b}_${a}`);
      // Master direction: где is_master=true. Если ни одна не master,
      // берём ту что соответствует приоритету (a первый в allTradePairs
      // уже отсортирован priority-aware).
      let from, to;
      if (ab?.isMaster) {
        from = a; to = b;
      } else if (ba?.isMaster) {
        from = b; to = a;
      } else {
        from = a; to = b;
      }
      out.push({ from, to });
    });
    return out;
  }, [allTradePairs, pairInfo]);

  // Фильтр по поиску — match по FROM или TO (case-insensitive)
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.from.toLowerCase().includes(q) ||
        r.to.toLowerCase().includes(q) ||
        `${r.from}${r.to}`.toLowerCase().includes(q) ||
        `${r.from} ${r.to}`.toLowerCase().includes(q) ||
        `${r.from}→${r.to}`.toLowerCase().includes(q)
    );
  }, [rows, query]);

  // Собираем "изменения" — sell и/или buy для каждой пары.
  // - Если sell изменён → отправляем rate (master direction).
  // - Если buy изменён → отправляем buy_rate (reverse direction).
  //   При этом sell тоже передаётся (текущий или новый) — backend
  //   сначала пишет master, trigger синхронизирует reverse, затем
  //   наш buy_rate override'ит reverse.
  const changes = useMemo(() => {
    const list = [];
    Object.entries(inputs).forEach(([key, vals]) => {
      const [from, to] = key.split("_");
      const currentSell = getRate(from, to);
      const currentBuy = getRate(to, from);

      const sellStr = String(vals?.sell || "").trim().replace(",", ".");
      const sellNum = sellStr ? Number(sellStr) : NaN;
      const sellChanged =
        sellStr !== "" &&
        Number.isFinite(sellNum) &&
        sellNum > 0 &&
        (!Number.isFinite(currentSell) || Math.abs(sellNum - currentSell) > 1e-9);

      const buyStr = String(vals?.buy || "").trim().replace(",", ".");
      const buyNum = buyStr ? Number(buyStr) : NaN;
      const buyChanged =
        buyStr !== "" &&
        Number.isFinite(buyNum) &&
        buyNum > 0 &&
        (!Number.isFinite(currentBuy) || Math.abs(buyNum - currentBuy) > 1e-9);

      if (!sellChanged && !buyChanged) return;

      // Если sell не менялся, передаём текущий rate чтобы master не переписался зря,
      // но import_rates всё равно сделает UPDATE. OK — base_rate тот же.
      const finalSell = sellChanged ? sellNum : currentSell;
      if (!Number.isFinite(finalSell) || finalSell <= 0) return; // защита

      const item = { from, to, rate: finalSell };
      if (buyChanged) item.buy_rate = buyNum;
      list.push(item);
    });
    return list;
  }, [inputs, getRate]);

  const handleChange = (from, to, side, val) => {
    setInputs((prev) => {
      const key = `${from}_${to}`;
      return { ...prev, [key]: { ...(prev[key] || {}), [side]: val } };
    });
  };

  const handleSubmit = async () => {
    if (changes.length === 0 || busy) return;
    if (!isSupabaseConfigured) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await withToast(
        () => rpcImportRates(changes, `Daily update ${today}`),
        { success: `Updated ${changes.length} rate(s)`, errorPrefix: "Update failed" }
      );
      if (res.ok) {
        logAudit({
          action: "update",
          entity: "rate",
          entityId: `daily_${today}`,
          summary: `Daily update: ${changes
            .map((c) =>
              c.buy_rate != null
                ? `${c.from}→${c.to}=${c.rate}/buy=${c.buy_rate}`
                : `${c.from}→${c.to}=${c.rate}`
            )
            .join(", ")}`,
        });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("quick_rates_title") || "Быстрое обновление курсов"}
      subtitle={`${rows.length} пар · sell/buy раздельно · обновлено ${timeAgo(lastUpdated)}`}
      width="2xl"
    >
      <div className="p-5">
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 mb-3 inline-flex items-start gap-1.5">
          <Zap className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
          <span>
            <strong className="text-emerald-700">Sell</strong> — продажа{" "}
            (1 X → Y), <strong className="text-sky-700">Buy</strong> —{" "}
            покупка (1 Y → X). Если Buy пустой — синхронизируется
            автоматически (1/Sell со спредом). Если задан — сохранится
            как независимый override. Пустые инпуты не трогаем.
          </span>
        </div>

        {/* Поиск — более тёмный контейнер slate-200, визуально отделён
            от обычных row-контейнеров (slate-50/60). */}
        <div className="mb-3 flex items-center gap-2 bg-slate-200/70 border border-slate-300 rounded-[10px] px-3 py-2">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по валюте (USD, TRY, USDT → TRY…)"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-slate-900 placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="p-0.5 rounded hover:bg-slate-300 text-slate-600 hover:text-slate-900 transition-colors shrink-0"
              title="Очистить поиск"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="text-[10px] text-slate-500 tabular-nums shrink-0 pl-1 border-l border-slate-300">
            {visibleRows.length} / {rows.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {visibleRows.map(({ from, to }) => {
            const key = `${from}_${to}`;
            const currentSell = getRate(from, to);    // master rate (forward)
            const currentBuy = getRate(to, from);     // reverse rate
            const vals = inputs[key] || {};
            const typedSell = vals.sell ?? "";
            const typedBuy = vals.buy ?? "";
            const sellNum = Number(String(typedSell).trim().replace(",", "."));
            const buyNum = Number(String(typedBuy).trim().replace(",", "."));
            const sellChanged =
              typedSell !== "" &&
              Number.isFinite(sellNum) &&
              sellNum > 0 &&
              Number.isFinite(currentSell) &&
              Math.abs(sellNum - currentSell) > 1e-9;
            const buyChanged =
              typedBuy !== "" &&
              Number.isFinite(buyNum) &&
              buyNum > 0 &&
              Number.isFinite(currentBuy) &&
              Math.abs(buyNum - currentBuy) > 1e-9;
            const info = pairInfo.get(key);
            const updatedLabel = formatUpdatedAt(info?.updatedAt);
            // Auto-buy preview: что подставится если admin не введёт buy
            // явно. Используем effective sell base + spread (1+s/100) / sell.
            const spreadPct = info?.spreadPercent != null ? info.spreadPercent : 0;
            const spreadFactor = 1 + spreadPct / 100;
            const effectiveSellBase = sellChanged
              ? sellNum
              : info?.baseRate != null
              ? info.baseRate
              : currentSell;
            const autoBuy =
              Number.isFinite(effectiveSellBase) && effectiveSellBase > 0
                ? (1 / effectiveSellBase) * spreadFactor
                : null;
            // Sanity warning: USDT→fiat должен быть < ~1.5
            const looksInverted = (() => {
              if (!sellChanged) return false;
              if (from !== "USDT") return false;
              if (to === "USD" && sellNum > 1.5) return true;
              if (to === "EUR" && sellNum > 1.5) return true;
              if (to === "GBP" && sellNum > 1.5) return true;
              return false;
            })();
            const anyChanged = sellChanged || buyChanged;
            return (
              <div
                key={key}
                className={`flex flex-col gap-1.5 p-2 rounded-[10px] border transition-colors ${
                  looksInverted
                    ? "bg-amber-50/80 border-amber-400"
                    : anyChanged
                    ? "bg-emerald-50/40 border-emerald-300"
                    : "bg-slate-50/60 border-slate-200"
                }`}
              >
                {/* Заголовок пары + время последнего изменения */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-slate-700 tracking-tight">
                    {from} <span className="text-slate-400">↔</span> {to}
                  </span>
                  {updatedLabel && (
                    <span className="text-slate-400 tabular-nums">
                      изм. {updatedLabel}
                    </span>
                  )}
                </div>

                {/* Два контейнера: SELL + BUY */}
                <div className="grid grid-cols-2 gap-1.5">
                  {/* SELL — master direction (from → to) */}
                  <div
                    className={`flex flex-col gap-1 p-1.5 rounded-[8px] border transition-colors ${
                      sellChanged
                        ? "bg-emerald-50 border-emerald-300"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider">
                        Sell
                      </span>
                      <span className="text-[9px] text-slate-400 tabular-nums">
                        {formatRate(currentSell)}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-500">
                      1 <span className="font-semibold text-slate-700">{from}</span>
                      {" → "}
                      <span className="font-semibold text-slate-700">{to}</span>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={typedSell}
                      onChange={(e) => handleChange(from, to, "sell", e.target.value)}
                      placeholder={formatRate(currentSell)}
                      className={`w-full min-w-0 bg-white border rounded-[6px] px-2 py-1 text-[12.5px] font-semibold tabular-nums outline-none transition-colors ${
                        looksInverted
                          ? "border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                          : sellChanged
                          ? "border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          : "border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                      }`}
                    />
                  </div>

                  {/* BUY — reverse direction (to → from) */}
                  <div
                    className={`flex flex-col gap-1 p-1.5 rounded-[8px] border transition-colors ${
                      buyChanged
                        ? "bg-sky-50 border-sky-300"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-sky-700 uppercase tracking-wider">
                        Buy
                      </span>
                      <span className="text-[9px] text-slate-400 tabular-nums">
                        {formatRate(currentBuy)}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-500">
                      1 <span className="font-semibold text-slate-700">{to}</span>
                      {" → "}
                      <span className="font-semibold text-slate-700">{from}</span>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={typedBuy}
                      onChange={(e) => handleChange(from, to, "buy", e.target.value)}
                      placeholder={autoBuy != null ? formatRate(autoBuy) : formatRate(currentBuy)}
                      className={`w-full min-w-0 bg-white border rounded-[6px] px-2 py-1 text-[12.5px] font-semibold tabular-nums outline-none transition-colors ${
                        buyChanged
                          ? "border-sky-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                          : "border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                      }`}
                    />
                  </div>
                </div>

                {/* Подсказка: если buy пустой и sell изменён — auto-sync,
                    если buy введён — будет explicit override. */}
                {(sellChanged || buyChanged) && (
                  <div className="flex items-center justify-between text-[9px] text-slate-500 tabular-nums">
                    {!buyChanged && autoBuy != null && (
                      <span>
                        <span className="text-slate-400">↩ buy auto =</span>{" "}
                        <span className="font-semibold text-slate-700">
                          {formatRate(autoBuy)}
                        </span>
                        {spreadPct > 0 && (
                          <span className="text-amber-700 font-semibold">
                            {" "}spread {spreadPct}%
                          </span>
                        )}
                      </span>
                    )}
                    {buyChanged && (
                      <span className="text-sky-700 font-semibold">
                        ✓ buy override
                      </span>
                    )}
                    {sellChanged && (
                      <span className="text-emerald-700 font-semibold">
                        ✓ sell {formatRate(sellNum)}
                      </span>
                    )}
                  </div>
                )}

                {/* Sanity warning по sell */}
                {looksInverted && (
                  <div className="text-[10px] text-amber-800 font-medium">
                    ⚠ 1 {from} = {formatRate(sellNum)} {to}? Похоже на
                    обратный курс. Возможно правильно вписать{" "}
                    {formatRate(1 / sellNum)} в Sell.
                  </div>
                )}
              </div>
            );
          })}
          {visibleRows.length === 0 && (
            <div className="col-span-full py-6 text-center text-[12px] text-slate-400 italic">
              Ничего не найдено по «{query}»
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
        <div className="text-[12px] text-slate-600">
          {changes.length > 0 ? (
            <span>
              <span className="font-bold text-emerald-700 tabular-nums">{changes.length}</span> изменений к сохранению
            </span>
          ) : (
            <span className="text-slate-400">Нет изменений</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
          >
            {t("cancel") || "Отмена"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={changes.length === 0 || busy}
            className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              changes.length > 0 && !busy
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {busy ? "Сохранение…" : `Сохранить ${changes.length || ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
