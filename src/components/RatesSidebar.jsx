// src/components/RatesSidebar.jsx
// Виджет «Курсы» — левая колонка главной (Касса). Чисто информативный, read-only.
// Показывает курсы по ВСЕМ городам сразу (без переключения): текущий офис первым,
// по каждому — USDT-курсы (со спредом) → его кросс кеш-кеш → НЕРЕЗ (для RU).
// Свежесть курса — по каждому офису. Правка/импорт — на странице «Изм.».

import React, { useEffect } from "react";
import { TrendingUp, Pencil, MapPin } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { useNow } from "../hooks/useNow.js";
import MasterRatesPanel from "./rates/MasterRatesPanel.jsx";
import CrossRatesPanel from "./rates/CrossRatesPanel.jsx";
import NerezPanel from "./rates/NerezPanel.jsx";

// Валюты курса по офису: российские (Москва/СПб) → RUB, иначе турецкий набор.
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

function cityLabel(office) {
  return String(office?.name || office?.city || "Office").trim();
}

// Самый свежий updatedAt среди пар офиса (для значка «обновлено N назад»).
function officeFreshness(getOfficeOverride, officeId, quotes) {
  let latest = null;
  quotes.forEach((q) => {
    [
      ["USDT", q],
      [q, "USDT"],
    ].forEach(([f, t]) => {
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

  // Текущий офис первым, остальные — следом.
  const offices = React.useMemo(() => {
    const list = [...(activeOffices || [])];
    if (!currentOffice) return list;
    const idx = list.findIndex((o) => o.id === currentOffice);
    if (idx > 0) {
      const [cur] = list.splice(idx, 1);
      list.unshift(cur);
    }
    return list;
  }, [activeOffices, currentOffice]);

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
          {onOpenRates && (
            <button
              type="button"
              onClick={onOpenRates}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-[7px] bg-surface border border-border text-ink text-tiny font-medium hover:bg-surface-soft transition-colors shrink-0"
              title={t("edit_rates") || "Редактировать курсы"}
            >
              <Pencil className="w-2.5 h-2.5 text-muted" strokeWidth={2.2} />
              <span>Изм.</span>
            </button>
          )}
        </div>
      </header>

      {/* Все города сразу — текущий первым */}
      <div className="py-1 space-y-2.5">
        {offices.map((office, i) => {
          const quotes = quotesForOffice(office);
          const getRate = (from, to) => getRateRaw(from, to, office.id);
          const isRu = quotes.includes("RUB");
          const fresh = timeAgoShort(
            officeFreshness(getOfficeOverride, office.id, quotes),
            nowMs
          );
          const isCurrent = currentOffice && office.id === currentOffice && i === 0;
          return (
            <div key={office.id}>
              {/* Заголовок города + свежесть */}
              <div className="flex items-center gap-1.5 px-2 pb-0.5">
                <MapPin
                  className={`w-3 h-3 shrink-0 ${isCurrent ? "text-accent" : "text-muted-soft"}`}
                  strokeWidth={2.2}
                />
                <span
                  className={`text-caption font-bold tracking-wide truncate ${
                    isCurrent ? "text-ink" : "text-ink-soft"
                  }`}
                >
                  {cityLabel(office)}
                </span>
                <span className="flex-1 h-px bg-border-soft" />
                {fresh && (
                  <span
                    className="text-tiny text-muted-soft font-mono whitespace-nowrap"
                    title="Когда обновлён курс офиса"
                  >
                    {fresh}
                  </span>
                )}
              </div>
              <MasterRatesPanel getRate={getRate} quotes={quotes} />
              <CrossRatesPanel getRate={getRate} ccys={quotes} />
              {isRu && <NerezPanel specialRates={specialRates} />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
