// src/components/RatesSidebar.jsx
// Виджет «Курсы» — белый терминал (read-only). Плоский: hairline-границы, без
// теней/чипов/плашек. Офисы — аккордеон (текущий открыт), внутри MasterRatesPanel
// (→USDT / USDT→) + CrossRatesPanel, ниже — НЕРЕЗ для RU. Один акцент — зелёная
// точка live/свежести. Клик по числу копирует. Структура/порядок/направления и
// расчёты — без изменений; правка/импорт — на странице «Изм.».

import React, { useEffect, useRef, useState, useCallback } from "react";
import { ChevronRight, Check, ArrowUpRight } from "lucide-react";
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
  // Ретрай, пока ЦБ не подъедет: на раннем маунте сайдбара запрос иногда уходит
  // до готовности сессии/клиента и возвращается пустым — тогда QR-блок висел «—».
  const [cbr, setCbr] = useState(null);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = () => {
      loadExternalRatesLatest()
        .then((rows) => {
          if (!alive) return;
          const c = {};
          (rows || []).forEach((r) => { if (r.source === "cbr") c[r.pair] = r.mid; });
          setCbr(c);
          if (!c.USD_RUB && tries < 6) { tries += 1; setTimeout(load, 1500); }
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn("[QR] загрузка курса ЦБ не удалась:", e?.message || e);
          if (alive && tries < 6) { tries += 1; setTimeout(load, 1500); }
        });
    };
    load();
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

  // Самое свежее обновление среди офисов — метка в шапке «Курсы».
  // ЧЕЛОВЕЧЕСКОЕ время вместо «62д»: сегодняшнее — просто HH:MM, более
  // раннее — с датой. Голое «обновлено 14:03» для двухмесячной давности
  // было бы враньём, поэтому дата не отбрасывается.
  const panelFresh = React.useMemo(() => {
    let latest = null;
    offices.forEach((o) => {
      const d = officeFreshness(getOfficeOverride, o.id, quotesForOffice(o));
      if (d && (!latest || d > latest)) latest = d;
    });
    if (!latest) return null;
    const hhmm = `${String(latest.getHours()).padStart(2, "0")}:${String(latest.getMinutes()).padStart(2, "0")}`;
    const now = new Date(nowMs);
    const sameDay =
      latest.getFullYear() === now.getFullYear() &&
      latest.getMonth() === now.getMonth() &&
      latest.getDate() === now.getDate();
    if (sameDay) return hhmm;
    const dd = String(latest.getDate()).padStart(2, "0");
    const mm = String(latest.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm} ${hhmm}`;
  }, [offices, getOfficeOverride, nowMs]);

  // СЛОТ под номер версии прайса. Намеренно null: публикаций ещё нет —
  // rate_publications пуста, publish_rates появится в фазе 2 проекта курсов.
  // Номер из воздуха не изобретаем; когда снапшоты поедут, сюда придёт
  // version последней публикации и встанет рядом со временем, как в эталоне
  // («v. 148 · 10:41»). До тех пор ветка просто не рендерится.
  const publishedVersion = null;

  const cardCls = "bg-card border border-line rounded-card-2 overflow-hidden";

  return (
    <aside className="flex flex-col gap-2">
      {/* ── Контейнер 1: КУРСЫ — белый терминал, офисы аккордеоном ── */}
      <div className={cardCls}>
        <header className="flex items-center gap-2.5 px-5 pt-4 pb-3.5 border-b border-line">
          <h2 className="text-[15px] font-normal tracking-tight text-ink">
            {t("rates") || "Курсы"}
          </h2>
          {(publishedVersion != null || panelFresh) && (
            <span className="text-[12px] text-muted tabular-nums" title="Самое свежее обновление курсов по офисам">
              {publishedVersion != null && <>v.&nbsp;{publishedVersion} · </>}
              {panelFresh && <>обновлено {panelFresh}</>}
            </span>
          )}
          {onOpenRates && (
            <button
              type="button"
              onClick={onOpenRates}
              className="ml-auto w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-full border border-line-2 text-muted hover:text-ink hover:border-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
              title={t("edit_rates") || "Редактировать курсы"}
              aria-label={t("edit_rates") || "Редактировать курсы"}
            >
              <ArrowUpRight className="w-4 h-4" strokeWidth={1.8} />
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
            <div key={office.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => toggleOffice(office.id)}
                aria-expanded={isOpen}
                className="flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 hover:bg-surface-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15 focus-visible:ring-inset"
              >
                <ChevronRight
                  className={`w-3 h-3 text-muted-soft shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  strokeWidth={2.4}
                />
                <span className="text-[13px] font-bold tracking-tight text-ink truncate">
                  {office.name || office.city || "Office"}
                </span>
                {office.city && office.name && (
                  <span className="text-[11px] font-medium text-muted truncate">· {office.city}</span>
                )}
                <span className="ml-auto inline-flex items-center gap-1.5 shrink-0 text-[10px] tracking-[0.3px] text-muted-soft">
                  <span
                    className={`w-[5px] h-[5px] rounded-full ${isFresh ? "bg-lime" : "bg-line-2"}`}
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
      <div className={`${cardCls} px-3.5 py-3`}>
        <QrRubPanel cbr={cbr || {}} getRate={getRateRaw} onCopy={handleCopy} />
      </div>

      {/* Тост копирования */}
      <div
        className={`fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex items-center gap-2 bg-ink text-cream text-[13px] font-semibold px-4 py-2.5 rounded-card-sm shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)] transition-all duration-200 ${
          toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
        }`}
        role="status"
        aria-live="polite"
      >
        <Check className="w-4 h-4 text-lime" strokeWidth={2.6} />
        <span className="tabular-nums">{toast}</span>
      </div>
    </aside>
  );
}
