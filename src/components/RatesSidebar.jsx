// src/components/RatesSidebar.jsx
// Виджет «Курсы» — белый терминал (read-only). Плоский: hairline-границы, без
// теней/чипов/плашек. Офисы — аккордеон (текущий открыт), внутри MasterRatesPanel
// (→USDT / USDT→) + CrossRatesPanel, ниже — НЕРЕЗ для RU. Один акцент — зелёная
// точка live/свежести. Клик по числу копирует. Структура/порядок/направления и
// расчёты — без изменений; правка/импорт — на странице «Изм.».

import React, { useEffect, useRef, useState, useCallback } from "react";
import { ChevronRight, Check } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useNow } from "../hooks/useNow.js";
import MasterRatesPanel from "./rates/MasterRatesPanel.jsx";
import CrossRatesPanel from "./rates/CrossRatesPanel.jsx";
import NerezPanel from "./rates/NerezPanel.jsx";
import QrRubPanel from "./rates/QrRubPanel.jsx";
import { loadExternalRatesLatest } from "../lib/supabaseReaders.js";

const RU_OFFICE_RE = /москв|moscow|питер|петербург|санкт|spb|st\.?\s*pt|peterburg/i;
const FRESH_MS = 60 * 60 * 1000; // <1ч = live (зелёная точка)

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

  // Курс ЦБ (для блока QR-рубль) — тот же ридер, что и на странице «Изм.».
  const [cbr, setCbr] = useState(null);
  useEffect(() => {
    let alive = true;
    loadExternalRatesLatest()
      .then((rows) => {
        if (!alive) return;
        const c = {};
        (rows || []).forEach((r) => { if (r.source === "cbr") c[r.pair] = r.mid; });
        setCbr(c);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

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

  // Текущий офис первым (порядок как был)
  const offices = React.useMemo(() => {
    const list = [...(activeOffices || [])];
    const idx = currentOffice ? list.findIndex((o) => o.id === currentOffice) : -1;
    if (idx > 0) list.unshift(list.splice(idx, 1)[0]);
    return list;
  }, [activeOffices, currentOffice]);

  // Аккордеон: по умолчанию открыт текущий офис (или первый). Локальный state.
  const [openOffices, setOpenOffices] = useState(null);
  useEffect(() => {
    if (openOffices !== null) return;
    const first = currentOffice || offices[0]?.id;
    if (first) setOpenOffices(new Set([first]));
  }, [openOffices, currentOffice, offices]);
  const openSet = openOffices || new Set(currentOffice ? [currentOffice] : []);
  const toggleOffice = (id) =>
    setOpenOffices((s) => {
      const n = new Set(s || []);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const hasNerez = (specialRates || []).some((s) => s && s.kind === "nerez");
  const nerezAt = (specialRates || []).reduce((acc, s) => {
    const ts = s?.importedAt ? new Date(s.importedAt).getTime() : NaN;
    return Number.isFinite(ts) && ts > acc ? ts : acc;
  }, 0);
  const nerezFresh = nerezAt ? timeAgoShort(new Date(nerezAt), nowMs) : null;

  const cardCls = "bg-white border border-[rgba(18,22,26,0.08)] rounded-[12px] overflow-hidden";

  return (
    <aside className="flex flex-col gap-2">
      {/* ── Контейнер 1: КУРСЫ — белый терминал, офисы аккордеоном ── */}
      <div className={cardCls}>
        <header className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[rgba(18,22,26,0.08)]">
          <h2 className="text-[12.5px] font-extrabold tracking-[1.6px] text-[#15191d]">
            {t("rates") || "КУРСЫ"}
          </h2>
          {onOpenRates && (
            <button
              type="button"
              onClick={onOpenRates}
              className="ml-auto text-[11px] font-medium text-[#6a717a] border-b border-dotted border-[#aeb4bb] pb-px hover:text-[#15191d] hover:border-[#6a717a] transition-colors focus-visible:outline-none focus-visible:text-[#15191d]"
              title={t("edit_rates") || "Редактировать курсы"}
            >
              редактировать
            </button>
          )}
        </header>

        {offices.map((office) => {
          const quotes = quotesForOffice(office);
          const getRate = (from, to) => getRateRaw(from, to, office.id);
          const freshDate = officeFreshness(getOfficeOverride, office.id, quotes);
          const ageMs = freshDate ? nowMs - freshDate.getTime() : Infinity;
          const isFresh = ageMs < FRESH_MS;
          const fresh = timeAgoShort(freshDate, nowMs);
          const isOpen = openSet.has(office.id);
          return (
            <div key={office.id} className="border-b border-[rgba(18,22,26,0.08)] last:border-b-0">
              <button
                type="button"
                onClick={() => toggleOffice(office.id)}
                aria-expanded={isOpen}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 hover:bg-[rgba(18,22,26,0.018)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c9c6b]/30 focus-visible:ring-inset"
              >
                <ChevronRight
                  className={`w-3 h-3 text-[#aeb4bb] shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  strokeWidth={2.4}
                />
                <span className="text-[13px] font-bold tracking-tight text-[#15191d] truncate">
                  {office.name || office.city || "Office"}
                </span>
                {office.city && office.name && (
                  <span className="text-[11px] font-medium text-[#6a717a] truncate">· {office.city}</span>
                )}
                <span className="ml-auto inline-flex items-center gap-1.5 shrink-0 text-[10px] tracking-[0.3px] text-[#aeb4bb]">
                  <span
                    className={`w-[5px] h-[5px] rounded-full ${isFresh ? "bg-[#0c9c6b]" : "bg-[#aeb4bb]"}`}
                    aria-hidden
                  />
                  {fresh || "—"}
                </span>
              </button>

              {isOpen && (
                <div className="pb-2.5">
                  <MasterRatesPanel getRate={getRate} quotes={quotes} onCopy={handleCopy} />
                  <CrossRatesPanel getRate={getRate} ccys={quotes} onCopy={handleCopy} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Контейнер 2: спец-блоки (НЕРЕЗ, QR-рубль) ── */}
      {hasNerez && (
        <div className={`${cardCls} px-3.5 py-3`}>
          <NerezPanel specialRates={specialRates} onCopy={handleCopy} fresh={nerezFresh} />
        </div>
      )}
      {cbr && (cbr.USD_RUB || cbr.EUR_RUB || cbr.TRY_RUB) && (
        <div className={`${cardCls} px-3.5 py-3`}>
          <QrRubPanel cbr={cbr} onCopy={handleCopy} />
        </div>
      )}

      {/* Тост копирования */}
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
