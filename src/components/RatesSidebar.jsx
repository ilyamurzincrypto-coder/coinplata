// src/components/RatesSidebar.jsx
// Виджет «Курсы» — левая колонка главной (Касса). Две секции:
//   • Мастер (USDT кеш-кеш, их 6 строк, % для USD / абсолют TRY/EUR) —
//     правка inline + паст.
//   • Авто (производные кросс-курсы кеш-кеш) — read-only.
// Шапка (время + «Изм.») и офис-свитчер остаются здесь.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { TrendingUp, Pencil, ClipboardPaste } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useNow } from "../hooks/useNow.js";
import MasterRatesPanel from "./rates/MasterRatesPanel.jsx";
import AutoRatesPanel from "./rates/AutoRatesPanel.jsx";
import NerezPanel from "./rates/NerezPanel.jsx";
import RatesImportModal from "./RatesImportModal.jsx";
const GLOBAL_TAB = "__global__";

// Валюты курса по офису: российские (Москва/СПб) → RUB, иначе турецкий набор.
// Детект по городу/названию (ловит и «Москва Вася», которую узкий импорт-матчер
// пропускает — он матчит только английское «Moscow»).
const RU_OFFICE_RE = /москв|moscow|питер|петербург|санкт|spb|st\.?\s*pt|peterburg/i;

function quotesForOffice(office) {
  if (!office) return ["USD", "TRY", "EUR", "RUB"]; // Global — весь набор
  const hay = `${office.city || ""} ${office.name || ""}`;
  return RU_OFFICE_RE.test(hay) ? ["RUB"] : ["USD", "TRY", "EUR"];
}

function timeAgoShort(date, nowMs = Date.now()) {
  if (!date) return "—";
  const diff = Math.floor((nowMs - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function shortOfficeName(name) {
  if (!name) return "Office";
  const firstWord = String(name).trim().split(/\s+/)[0];
  return firstWord.length > 10 ? firstWord.slice(0, 10) : firstWord;
}

export default function RatesSidebar({ currentOffice, onOpenRates, onExpandedChange }) {
  const {
    getRate: getRateRaw,
    lastUpdated,
    getOfficeOverride,
    specialRates,
  } = useRates();
  const { activeOffices } = useOffices();
  const { t } = useTranslation();
  const nowMs = useNow(30_000);

  // Виджет всегда компактный (фикс. набор строк) — гасим expand у родителя.
  useEffect(() => {
    onExpandedChange?.(false);
  }, [onExpandedChange]);

  const [selectedTab, setSelectedTab] = useState(currentOffice || GLOBAL_TAB);
  useEffect(() => {
    if (currentOffice) setSelectedTab(currentOffice);
  }, [currentOffice]);

  const selectedOfficeId = selectedTab !== GLOBAL_TAB ? selectedTab : null;

  const masterQuotes = useMemo(() => {
    const office = selectedOfficeId
      ? (activeOffices || []).find((o) => o.id === selectedOfficeId)
      : null;
    return quotesForOffice(office);
  }, [selectedOfficeId, activeOffices]);

  const getRateForTab = useCallback(
    (from, to) => getRateRaw(from, to, selectedOfficeId),
    [getRateRaw, selectedOfficeId]
  );

  const hasOverride = useCallback(
    (from, to) => {
      if (!selectedOfficeId) return false;
      const ovr = getOfficeOverride?.(selectedOfficeId, from, to);
      const global = getRateRaw(from, to, null);
      return (
        !!ovr &&
        Number.isFinite(ovr.rate) &&
        Number.isFinite(global) &&
        Math.abs(ovr.rate - global) > 1e-9
      );
    },
    [selectedOfficeId, getOfficeOverride, getRateRaw]
  );

  // Блок read-only: правка через «Изм.» / «Вставить курсы». «Вставить курсы»
  // открывает настоящий импорт-модал (вкладка «Текст») — он парсит города/НЕРЕЗ
  // и персистит в Supabase через RPC.
  const [pasteOpen, setPasteOpen] = useState(false);

  return (
    <aside className="bg-surface rounded-card p-1.5 flex flex-col">
      <header className="px-2 pt-2 pb-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <TrendingUp className="w-3 h-3 text-accent shrink-0" strokeWidth={2.5} />
            <h2 className="text-caption text-ink font-semibold uppercase tracking-wide truncate">
              {t("rates") || "Курсы"}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 text-tiny text-muted font-mono tabular">
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot"
                style={{ boxShadow: "0 0 6px rgba(16,185,129,0.6)" }}
                aria-hidden
              />
              {timeAgoShort(lastUpdated, nowMs)}
            </span>
            {onOpenRates && (
              <button
                type="button"
                onClick={onOpenRates}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-[7px] bg-surface border border-border text-ink text-tiny font-medium hover:bg-surface-soft transition-colors"
                title={t("edit_rates") || "Редактировать курсы"}
              >
                <Pencil className="w-2.5 h-2.5 text-muted" strokeWidth={2.2} />
                <span>Изм.</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Office switcher */}
      <div className="mx-2 my-1.5 inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill overflow-x-auto shrink-0">
        <button
          type="button"
          onClick={() => setSelectedTab(GLOBAL_TAB)}
          className={`h-6 px-2 rounded-pill text-tiny font-medium font-mono tracking-wider transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
            selectedTab === GLOBAL_TAB
              ? "bg-surface text-ink shadow-seg"
              : "text-muted hover:text-ink"
          }`}
          title="Global rates"
        >
          Global
        </button>
        {(activeOffices || []).map((off) => {
          const isSel = selectedTab === off.id;
          return (
            <button
              key={off.id}
              type="button"
              onClick={() => setSelectedTab(off.id)}
              className={`h-6 px-2 rounded-pill text-tiny font-medium tracking-wide transition-all duration-150 ease-apple whitespace-nowrap shrink-0 ${
                isSel
                  ? "bg-surface text-ink shadow-seg"
                  : "text-muted hover:text-ink"
              }`}
              title={off.name || "Office"}
            >
              {shortOfficeName(off.name)}
            </button>
          );
        })}
      </div>

      {/* Секции курсов */}
      <div className="py-1">
        <MasterRatesPanel
          getRate={getRateForTab}
          hasOverride={hasOverride}
          quotes={masterQuotes}
        />
        {masterQuotes.includes("RUB") && <NerezPanel specialRates={specialRates} />}
        <AutoRatesPanel getRate={getRateForTab} />
      </div>

      {/* Паст-ввод */}
      <div className="px-2 pt-2 pb-1 mt-1 border-t border-border-soft shrink-0">
        <button
          type="button"
          onClick={() => setPasteOpen(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-button text-caption font-semibold text-ink-soft bg-surface-soft hover:bg-surface-sunk border border-border transition-colors"
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-muted" strokeWidth={2} />
          Вставить курсы
        </button>
      </div>

      <RatesImportModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        initialSource="text"
      />
    </aside>
  );
}
