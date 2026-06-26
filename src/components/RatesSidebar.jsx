// src/components/RatesSidebar.jsx
// Виджет «Курсы» — информативная панель (read-only) по образцу coinpoint-rates.
// Белые карточки-офисы (текущий первым) на лёгком фоне: пин+город+свежесть,
// строки валют (→USDT зелёная / USDT→ красная) с копированием по клику, ниже —
// кросс (или НЕРЕЗ для RU). Клик по числу копирует в буфер (тост). Light-тема.
// Правка/импорт — на странице «Изм.».

import React, { useEffect, useRef, useState, useCallback } from "react";
import { TrendingUp, Pencil, MapPin, Clock, Check } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useNow } from "../hooks/useNow.js";
import MasterRatesPanel from "./rates/MasterRatesPanel.jsx";
import CrossRatesPanel from "./rates/CrossRatesPanel.jsx";
import NerezPanel from "./rates/NerezPanel.jsx";

const RU_OFFICE_RE = /москв|moscow|питер|петербург|санкт|spb|st\.?\s*pt|peterburg/i;

function quotesForOffice(office) {
  const hay = `${office?.city || ""} ${office?.name || ""}`;
  return RU_OFFICE_RE.test(hay) ? ["RUB"] : ["USD", "TRY", "EUR"];
}

function timeAgoShort(date, nowMs = Date.now()) {
  if (!date) return null;
  const diff = Math.floor((nowMs - date.getTime()) / 1000);
  if (diff < 60) return `${diff}с`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч`;
  return `${Math.floor(diff / 86400)}д`;
}

function officeFreshness(getOfficeOverride, officeId, quotes) {
  let latest = null;
  quotes.forEach((q) => {
    [["USDT", q], [q, "USDT"]].forEach(([f, t]) => {
      const ovr = getOfficeOverride?.(officeId, f, t);
      const ts = ovr?.updatedAt ? new Date(ovr.updatedAt).getTime() : NaN;
      if (Number.isFinite(ts) && (!latest || ts > latest)) latest = ts;
    });
  });
  return latest ? new Date(latest) : null;
}

export default function RatesSidebar({ currentOffice, onOpenRates, onExpandedChange }) {
  const { getRate: getRateRaw, getOfficeOverride, specialRates } = useRates();
  const { activeOffices } = useOffices();
  const { t } = useTranslation();
  const nowMs = useNow(30_000);

  useEffect(() => {
    onExpandedChange?.(false);
  }, [onExpandedChange]);

  // Тост копирования
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const handleCopy = useCallback((value) => {
    try {
      navigator.clipboard?.writeText?.(value);
    } catch {
      /* noop */
    }
    setToast(`Скопировано · ${value}`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Текущий офис первым
  const offices = React.useMemo(() => {
    const list = [...(activeOffices || [])];
    const idx = currentOffice ? list.findIndex((o) => o.id === currentOffice) : -1;
    if (idx > 0) list.unshift(list.splice(idx, 1)[0]);
    return list;
  }, [activeOffices, currentOffice]);

  const cardShadow =
    "0 1px 2px rgba(16,24,40,.06), 0 14px 34px -16px rgba(16,24,40,.18)";

  return (
    <aside className="flex flex-col gap-3">
      {/* Шапка */}
      <header className="flex items-center justify-between gap-3 px-1 pt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="w-4 h-4 text-[#11b07a] shrink-0" strokeWidth={2.4} />
          <h2 className="text-[17px] font-extrabold tracking-[1.6px] text-ink uppercase">
            {t("rates") || "КУРСЫ"}
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-[#11b07a] uppercase ml-0.5">
            <span
              className="w-[7px] h-[7px] rounded-full bg-[#11b07a] animate-pulse-dot"
              style={{ boxShadow: "0 0 6px rgba(17,176,122,0.6)" }}
              aria-hidden
            />
            Live
          </span>
        </div>
        {onOpenRates && (
          <button
            type="button"
            onClick={onOpenRates}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[11px] bg-white border border-[#e7e9f1] text-ink-soft text-[13px] font-bold hover:border-[#d7dbe9] hover:text-ink transition-colors shrink-0"
            title={t("edit_rates") || "Редактировать курсы"}
          >
            <Pencil className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
            <span>Изм.</span>
          </button>
        )}
      </header>

      {/* Карточки офисов */}
      {offices.map((office) => {
        const quotes = quotesForOffice(office);
        const getRate = (from, to) => getRateRaw(from, to, office.id);
        const isRu = quotes.includes("RUB");
        const fresh = timeAgoShort(
          officeFreshness(getOfficeOverride, office.id, quotes),
          nowMs
        );
        return (
          <article
            key={office.id}
            className="bg-white border border-[#e7e9f1] rounded-[20px] p-4"
            style={{ boxShadow: cardShadow }}
          >
            {/* Заголовок карточки */}
            <header className="flex items-center justify-between gap-2.5 pb-3 mb-1 border-b border-[#e7e9f1]">
              <span className="flex items-center gap-2 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-[#0fa56f] shrink-0" strokeWidth={2.3} />
                <span className="text-[15px] font-bold tracking-tight text-ink truncate">
                  {office.name || office.city || "Office"}
                </span>
              </span>
              {fresh && (
                <span
                  className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-semibold text-[#8a8fa6] bg-[#f4f5fa] border border-[#e7e9f1] px-2.5 py-[3px] rounded-full"
                  title="Когда обновлён курс офиса"
                >
                  <Clock className="w-3 h-3 opacity-85" strokeWidth={2.2} />
                  {fresh}
                </span>
              )}
            </header>

            <MasterRatesPanel getRate={getRate} quotes={quotes} onCopy={handleCopy} />

            {isRu ? (
              <NerezPanel specialRates={specialRates} onCopy={handleCopy} />
            ) : (
              <CrossRatesPanel getRate={getRate} ccys={quotes} onCopy={handleCopy} />
            )}
          </article>
        );
      })}

      <p className="text-center text-[11px] text-muted-soft px-2 pt-0.5">
        Нажми на значение, чтобы <b className="font-semibold text-muted">скопировать</b>
      </p>

      {/* Тост */}
      <div
        className={`fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex items-center gap-2 bg-ink text-white text-[13px] font-semibold px-4 py-2.5 rounded-[12px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)] transition-all duration-200 ${
          toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
        }`}
        role="status"
        aria-live="polite"
      >
        <Check className="w-4 h-4 text-[#34d399]" strokeWidth={2.6} />
        <span className="font-mono tabular-nums">{toast}</span>
      </div>
    </aside>
  );
}
