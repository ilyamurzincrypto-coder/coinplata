// src/components/RatesSidebar.jsx
// Виджет «Курсы» — левая колонка главной (Касса). Информативный, read-only:
// показывает курсы ПО ВСЕМ городам сразу (без переключения). По каждому офису —
// USDT-курсы (со спредом), под российскими — НЕРЕЗ TOD/TOM. Внизу один раз —
// производные кросс-автокурсы. Правка — через «Изм.» / «Вставить курсы».

import React, { useState, useEffect } from "react";
import { TrendingUp, Pencil, ClipboardPaste, MapPin } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useNow } from "../hooks/useNow.js";
import MasterRatesPanel from "./rates/MasterRatesPanel.jsx";
import AutoRatesPanel from "./rates/AutoRatesPanel.jsx";
import NerezPanel from "./rates/NerezPanel.jsx";
import RatesImportModal from "./RatesImportModal.jsx";

// Валюты курса по офису: российские (Москва/СПб) → RUB, иначе турецкий набор.
// Детект по городу/названию (ловит и «Москва Вася», которую узкий импорт-матчер
// пропускает — он матчит только английское «Moscow»).
const RU_OFFICE_RE = /москв|moscow|питер|петербург|санкт|spb|st\.?\s*pt|peterburg/i;

function quotesForOffice(office) {
  const hay = `${office?.city || ""} ${office?.name || ""}`;
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

function cityLabel(office) {
  const name = office?.name || office?.city || "Office";
  return String(name).trim();
}

export default function RatesSidebar({ onOpenRates, onExpandedChange }) {
  const { getRate: getRateRaw, lastUpdated, specialRates } = useRates();
  const { activeOffices } = useOffices();
  const { t } = useTranslation();
  const nowMs = useNow(30_000);

  useEffect(() => {
    onExpandedChange?.(false);
  }, [onExpandedChange]);

  const [pasteOpen, setPasteOpen] = useState(false);

  const offices = activeOffices || [];

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

      {/* Все города сразу — стопкой, без переключения */}
      <div className="py-1 space-y-2">
        {offices.map((office) => {
          const quotes = quotesForOffice(office);
          const getRate = (from, to) => getRateRaw(from, to, office.id);
          const isRu = quotes.includes("RUB");
          return (
            <div key={office.id}>
              {/* Заголовок города */}
              <div className="flex items-center gap-1.5 px-2 pb-0.5">
                <MapPin className="w-3 h-3 text-muted-soft shrink-0" strokeWidth={2.2} />
                <span className="text-caption font-bold text-ink-soft tracking-wide truncate">
                  {cityLabel(office)}
                </span>
                <span className="flex-1 h-px bg-border-soft" />
              </div>
              <MasterRatesPanel getRate={getRate} quotes={quotes} />
              {isRu && <NerezPanel specialRates={specialRates} />}
            </div>
          );
        })}

        {/* Производные кросс-автокурсы — один раз внизу (глобальные) */}
        <AutoRatesPanel getRate={(from, to) => getRateRaw(from, to, null)} />
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
