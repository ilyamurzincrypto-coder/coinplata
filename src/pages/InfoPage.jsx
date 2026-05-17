// src/pages/InfoPage.jsx
// Интерактивный manual — Справка с поиском, TOC, прогрессом чтения,
// иконками и tabs. Контент берётся из info/content.js (INFO_SECTIONS).
//
// Структура:
//   • Hero — приветствие, поиск, «что нового»
//   • Two-column layout (на lg+): sticky TOC слева, контент справа
//   • Каждая секция = карточка с accent-полосой, иконкой, tabs
//   • Прогресс прочитанного хранится в localStorage
//
// Search — простой fuzzy substring по всему контенту секции
// (title/what/related/can/how/examples). Подсвечивает совпадения.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight, ChevronDown, Play, ArrowUpRight, Search, X,
  Wallet, TrendingUp, Banknote, Users, Building2, Settings as SettingsIcon,
  ShieldCheck, BookOpen, Sparkles, CheckCircle2, Clock, FileText,
  Lightbulb, BookMarked, Hash, Printer,
} from "lucide-react";
import { INFO_SECTIONS } from "./info/content.js";

const numFmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const READ_KEY = "coinplata.info.readSections";
const ACTIVE_TAB_KEY = "coinplata.info.activeTab";

const InfoActionsCtx = React.createContext({ onNavigate: null, onTryDeal: null });

// ─── Section meta ──────────────────────────────────────────────────────
// Иконка + цветовой акцент + краткое описание (TL;DR) для каждого
// top-level раздела. Цвета взяты статически (Tailwind JIT) чтобы билд
// корректно их выдернул.
const SECTION_META = {
  cashier: {
    icon: Wallet,
    accentBg: "bg-emerald-500",
    accentSoft: "bg-emerald-50",
    accentText: "text-emerald-700",
    accentRing: "ring-emerald-200",
    tldr: "Главный экран оператора: курсы, балансы, создание сделок, переводов, пополнений. Сюда оператор заходит каждую смену.",
  },
  capital: {
    icon: TrendingUp,
    accentBg: "bg-amber-500",
    accentSoft: "bg-amber-50",
    accentText: "text-amber-700",
    accentRing: "ring-amber-200",
    tldr: "Обзор капитала, прибыли и денежной позиции — теперь это лендинг Казначейства (страница «Капитал» удалена).",
  },
  accounts: {
    icon: Banknote,
    accentBg: "bg-blue-500",
    accentSoft: "bg-blue-50",
    accentText: "text-blue-700",
    accentRing: "ring-blue-200",
    tldr: "Все операционные счета: кассы, банки, крипто-кошельки. История движений по каждому, пополнения, переводы между счетами.",
  },
  counterparties: {
    icon: Users,
    accentBg: "bg-indigo-500",
    accentSoft: "bg-indigo-50",
    accentText: "text-indigo-700",
    accentRing: "ring-indigo-200",
    tldr: "Клиенты и OTC-партнёры. Профили, обязательства, история сделок с каждым.",
  },
  treasury: {
    icon: Building2,
    accentBg: "bg-violet-500",
    accentSoft: "bg-violet-50",
    accentText: "text-violet-700",
    accentRing: "ring-violet-200",
    tldr: "Бухгалтерия на двойной записи: транзакции, проводки Дт/Кт, план счетов (~174). 9 разрезов: Дашборд, Сделки, Активы/Пассивы/Капитал, P&L, Обороты, ДДС, Журнал, Платёжный календарь.",
  },
  settings: {
    icon: SettingsIcon,
    accentBg: "bg-slate-500",
    accentSoft: "bg-slate-100",
    accentText: "text-slate-700",
    accentRing: "ring-slate-200",
    tldr: "Пользователи, права, офисы, курсы, базовая валюта. Матрица «роль × раздел × уровень».",
  },
  audit: {
    icon: ShieldCheck,
    accentBg: "bg-rose-500",
    accentSoft: "bg-rose-50",
    accentText: "text-rose-700",
    accentRing: "ring-rose-200",
    tldr: "Журнал действий пользователей — кто что менял и когда. Для разборов и compliance.",
  },
  glossary: {
    icon: BookOpen,
    accentBg: "bg-teal-500",
    accentSoft: "bg-teal-50",
    accentText: "text-teal-700",
    accentRing: "ring-teal-200",
    tldr: "Как разделы связаны между собой — leдger → агрегаты → витрины. Полезно держать в голове общую картину.",
  },
};

const DEFAULT_META = {
  icon: FileText,
  accentBg: "bg-slate-400",
  accentSoft: "bg-slate-50",
  accentText: "text-slate-700",
  accentRing: "ring-slate-200",
  tldr: null,
};

function metaFor(sectionId) {
  return SECTION_META[sectionId] || DEFAULT_META;
}

// ─── «Что нового» лента ────────────────────────────────────────────────
const RECENT_UPDATES = [
  {
    date: "2026-05-17",
    sectionId: "treasury",
    title: "ДДС: IFRS-структура, алерты, валютные пары, прогноз",
    summary: "Cash flow перепилен под стандарт IAS 7 (Operating / Investing / Financing). Добавлены: алерты ликвидности, топ валютных пар по марже с drill-down, прогноз к концу периода, sparkline дневной активности, per-office, CSV.",
  },
  {
    date: "2026-05-15",
    sectionId: "treasury",
    title: "Inline-edit остатков и субсчетов с попровером",
    summary: "Янтарная плашка на любой цифре баланса в Активы/Пассивы/Капитал → попровер «Новый остаток + комментарий + дата эффекта». Для пустого dimensioned-счёта — кнопка «+ Клиент»/«+ Партнёр».",
  },
  {
    date: "2026-05-14",
    sectionId: "treasury",
    title: "USDT/USDC/DAI/BUSD = 1:1 USD в агрегированных метриках",
    summary: "Стэйблкоин-пегла применяется по умолчанию во всех расчётах в base. Можно явно выставить курс в Settings → fxRates (например 0.9995 при де-пеге).",
  },
];

// ─── Search ────────────────────────────────────────────────────────────
function sectionToSearchText(section) {
  const parts = [
    section.title,
    section.what,
    section.related,
    ...(section.can || []),
    ...(section.how || []),
    ...((section.examples || []).flatMap((ex) => [ex.title, ex.intro, ex.note, ...(ex.steps || [])])),
    ...((section.sub || []).flatMap((ss) => [
      ss.title, ss.what, ss.related,
      ...(ss.can || []),
      ...(ss.how || []),
      ...((ss.examples || []).flatMap((ex) => [ex.title, ex.intro, ex.note, ...(ex.steps || [])])),
    ])),
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function sectionMatches(section, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return sectionToSearchText(section).includes(q);
}

// Подсветка совпадений в строке.
function Highlight({ text, query }) {
  if (!query || !text) return text;
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-amber-900 rounded-[3px] px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ─── Components ────────────────────────────────────────────────────────
function TryButton({ label, icon, onClick, variant = "indigo" }) {
  const cls = variant === "emerald"
    ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200"
    : "text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[11.5px] font-semibold border transition-colors ${cls}`}
    >
      {icon || <Play className="w-3 h-3" />}
      {label}
    </button>
  );
}

function Bullets({ items, ordered, query }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`mt-1.5 space-y-1 text-[12.5px] text-slate-700 ${ordered ? "list-decimal" : "list-disc"} pl-5`}>
      {items.map((b, i) => <li key={i}><Highlight text={b} query={query} /></li>)}
    </Tag>
  );
}

// Парсим "Term (опц. короткое уточнение) — определение" → { term, definition }.
// Если разделитель «—» не найден — возвращаем всё как determination, term=entry.
function parseGlossaryEntry(entry) {
  const dashRe = /\s+—\s+/;
  const idx = entry.search(dashRe);
  if (idx < 0) return { term: entry, definition: "" };
  const term = entry.slice(0, idx).trim();
  const definition = entry.slice(idx).replace(dashRe, "").trim();
  return { term, definition };
}

// Рендер глоссария — карточки «термин · определение» вместо обычного bullet'а.
function GlossaryGrid({ items, query }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
      {items.map((entry, i) => {
        const { term, definition } = parseGlossaryEntry(entry);
        return (
          <div key={i} className="rounded-[10px] bg-slate-50/60 border border-slate-100 px-3 py-2">
            <div className="text-[12.5px] font-bold text-slate-900">
              <Highlight text={term} query={query} />
            </div>
            {definition && (
              <div className="text-[11.5px] text-slate-600 mt-0.5 leading-snug">
                <Highlight text={definition} query={query} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function JournalMini({ lines }) {
  return (
    <table className="w-full mt-2 text-[11.5px] bg-slate-50/70 rounded-[8px] overflow-hidden">
      <tbody>
        {lines.map((l, i) => {
          const dr = l.dir === "dr";
          return (
            <tr key={i} className="border-t border-slate-100 first:border-t-0">
              <td className={`px-2 py-1 w-8 font-semibold ${dr ? "text-emerald-700" : "text-rose-700"}`}>{dr ? "Дт" : "Кт"}</td>
              <td className="px-2 py-1">{l.account}{l.note ? <span className="text-slate-400"> · {l.note}</span> : null}</td>
              <td className={`px-2 py-1 text-right tabular-nums w-28 ${dr ? "text-emerald-700" : "text-rose-700"}`}>{numFmt(l.amount)} {l.cur}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExampleCard({ ex, query }) {
  const { onTryDeal } = React.useContext(InfoActionsCtx);
  const dealSeed = ex.try?.dealSeed;
  return (
    <div className="rounded-[10px] border border-slate-200/80 bg-white px-3 py-2.5">
      <div className="text-[12.5px] font-semibold text-slate-900 inline-flex items-center gap-1.5">
        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
        <Highlight text={ex.title} query={query} />
      </div>
      {ex.intro && <div className="text-[12px] text-slate-500 mt-0.5"><Highlight text={ex.intro} query={query} /></div>}
      {Array.isArray(ex.steps) && ex.steps.length > 0 && <Bullets items={ex.steps} ordered query={query} />}
      {Array.isArray(ex.journal) && ex.journal.length > 0 && <JournalMini lines={ex.journal} />}
      {ex.note && <div className="text-[12px] text-slate-500 italic mt-2"><Highlight text={ex.note} query={query} /></div>}
      {dealSeed && onTryDeal && (
        <div className="mt-2">
          <TryButton label={ex.try?.label || "Попробовать в форме"} onClick={() => onTryDeal(dealSeed)} variant="emerald" />
        </div>
      )}
    </div>
  );
}

// Tabs внутри секции — переключение между Кратко / Как / Примеры.
const TABS = [
  { id: "tldr", label: "Кратко", icon: BookMarked },
  { id: "how", label: "Как работает", icon: Hash },
  { id: "examples", label: "Примеры", icon: Lightbulb },
];

function SectionTabs({ active, onChange, hasHow, hasExamples }) {
  const visible = TABS.filter((t) =>
    t.id === "tldr" ||
    (t.id === "how" && hasHow) ||
    (t.id === "examples" && hasExamples)
  );
  if (visible.length <= 1) return null;
  return (
    <div className="inline-flex gap-1 bg-slate-100 rounded-[10px] p-0.5">
      {visible.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11.5px] font-semibold transition-colors ${
              isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="w-3 h-3" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function SubCard({ sub, query }) {
  return (
    <div className="rounded-[10px] border border-slate-100 bg-slate-50/50 px-3 py-2">
      <div className="text-[12.5px] font-bold text-slate-900"><Highlight text={sub.title} query={query} /></div>
      {sub.what && <div className="text-[12px] text-slate-500 italic mt-0.5"><Highlight text={sub.what} query={query} /></div>}
      {sub.related && <div className="text-[12px] text-slate-500 mt-0.5"><span className="font-medium text-slate-600">Связано: </span><Highlight text={sub.related} query={query} /></div>}
      {Array.isArray(sub.can) && sub.can.length > 0 && <Bullets items={sub.can} query={query} />}
      {Array.isArray(sub.how) && sub.how.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Как работает</div>
          <Bullets items={sub.how} ordered query={query} />
        </div>
      )}
      {Array.isArray(sub.examples) && sub.examples.length > 0 && (
        <div className="mt-2 space-y-2">
          {sub.examples.map((ex, i) => <ExampleCard key={i} ex={ex} query={query} />)}
        </div>
      )}
    </div>
  );
}

function SectionCard({ section, defaultOpen, query, isRead, markRead, sectionRef }) {
  const [open, setOpen] = useState(!!defaultOpen || !!query);
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem(`${ACTIVE_TAB_KEY}.${section.id}`) || "tldr";
    } catch { return "tldr"; }
  });
  const { onNavigate } = React.useContext(InfoActionsCtx);
  const meta = metaFor(section.id);
  const Icon = meta.icon;
  const goPage = section.try?.page;
  const hasHow = Array.isArray(section.how) && section.how.length > 0;
  const hasExamples = Array.isArray(section.examples) && section.examples.length > 0;
  const hasSub = section.sub && section.sub.length > 0;

  // Force open when search active
  useEffect(() => {
    if (query) setOpen(true);
  }, [query]);

  // Mark read when opened
  useEffect(() => {
    if (open && markRead) markRead(section.id);
  }, [open, markRead, section.id]);

  const setTab = (t) => {
    setActiveTab(t);
    try { localStorage.setItem(`${ACTIVE_TAB_KEY}.${section.id}`, t); } catch {}
  };

  return (
    <section
      ref={sectionRef}
      id={`info-section-${section.id}`}
      className="info-card bg-white rounded-[14px] border border-slate-200/70 overflow-hidden scroll-mt-20"
    >
      {/* Accent stripe сверху */}
      <div className={`h-1 ${meta.accentBg}`} />
      <header
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${meta.accentSoft} ${meta.accentText}`}>
          <Icon className="w-4 h-4" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[14.5px] font-bold text-slate-900 inline-flex items-center gap-2">
            <Highlight text={section.title} query={query} />
            {isRead && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2.5} />}
          </h2>
          {meta.tldr && !open && (
            <p className="text-[11.5px] text-slate-500 mt-0.5 line-clamp-1">{meta.tldr}</p>
          )}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
      </header>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* TL;DR + try-button + tabs */}
          {meta.tldr && (
            <div className={`rounded-[10px] px-3 py-2 ring-1 ${meta.accentSoft} ${meta.accentRing}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${meta.accentText}`}>TL;DR</div>
              <div className="text-[12.5px] text-slate-700">{meta.tldr}</div>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <SectionTabs active={activeTab} onChange={setTab} hasHow={hasHow} hasExamples={hasExamples} />
            {goPage && onNavigate && (
              <TryButton
                label={section.try?.label || "Открыть раздел"}
                icon={<ArrowUpRight className="w-3 h-3" />}
                onClick={() => onNavigate(goPage)}
              />
            )}
          </div>

          {/* Tabs content. При активном поиске показываем ВСЁ. */}
          {(activeTab === "tldr" || query) && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-slate-500 italic"><Highlight text={section.what} query={query} /></p>
              <p className="text-[12.5px] text-slate-600"><span className="font-medium text-slate-700">С чем связано: </span><Highlight text={section.related} query={query} /></p>
              {Array.isArray(section.can) && section.can.length > 0 && (
                <>
                  <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    {section.id === "glossary" ? "Термины" : "Что умеет"}
                  </div>
                  {section.id === "glossary"
                    ? <GlossaryGrid items={section.can} query={query} />
                    : <Bullets items={section.can} query={query} />}
                </>
              )}
            </div>
          )}

          {(activeTab === "how" || query) && hasHow && (
            <div>
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Как работает</div>
              <Bullets items={section.how} ordered query={query} />
            </div>
          )}

          {(activeTab === "examples" || query) && hasExamples && (
            <div className="space-y-2">
              {section.examples.map((ex, i) => <ExampleCard key={i} ex={ex} query={query} />)}
            </div>
          )}

          {/* Подразделы — всегда видны если есть */}
          {hasSub && (
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Подразделы</div>
              {section.sub.map((ss) => <SubCard key={ss.id || ss.title} sub={ss} query={query} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────
function greetingByTime() {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 11) return "Доброе утро";
  if (h < 17) return "Добрый день";
  if (h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function HeroSection({ query, setQuery, searchRef, readCount, totalCount, onJumpTo, onPrint }) {
  const greeting = greetingByTime();
  return (
    <section className="bg-gradient-to-br from-violet-50 via-indigo-50 to-emerald-50 rounded-[18px] border border-slate-200/70 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-[12px] bg-white flex items-center justify-center shadow-sm shrink-0">
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] sm:text-[24px] font-bold tracking-tight text-slate-900">
            {greeting}! Это справочник по сервису.
          </h1>
          <p className="text-[12.5px] sm:text-[13px] text-slate-600 mt-1">
            Здесь все фичи кассы, казначейства и настроек простым языком. Разворачивай разделы,
            щёлкай «Попробовать» — попадёшь сразу на нужный экран. Поиск моментальный по всему тексту.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mt-4 relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по справке…  (Cmd / Ctrl + K)"
          className="w-full bg-white border border-slate-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-100 rounded-[12px] pl-10 pr-10 py-2.5 text-[14px] outline-none transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-[6px] text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Очистить (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Stats strip */}
      <div className="mt-4 flex items-center gap-4 flex-wrap text-[11.5px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-bold text-slate-900">{totalCount}</span> разделов
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="font-bold text-slate-900">{readCount}</span> прочитано
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          обновлено {RECENT_UPDATES[0]?.date}
        </span>
        {onPrint && (
          <button
            type="button"
            onClick={onPrint}
            className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-[8px] text-[11.5px] font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 print:hidden"
            title="Раскрыть все секции и открыть диалог печати"
          >
            <Printer className="w-3 h-3" strokeWidth={2.5} />
            Печать / PDF
          </button>
        )}
      </div>

      {/* What's new (скрывается при печати) */}
      <div className="mt-4 info-hero-extras">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-500" />
          Что нового
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {RECENT_UPDATES.map((u, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpTo && onJumpTo(u.sectionId)}
              className="text-left bg-white rounded-[10px] border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all px-3 py-2"
            >
              <div className="text-[10px] text-slate-400 tabular-nums">{u.date}</div>
              <div className="text-[12px] font-semibold text-slate-900 mt-0.5">{u.title}</div>
              <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{u.summary}</div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── TOC sidebar ───────────────────────────────────────────────────────
function TocSidebar({ sections, readSet, activeId, onClickItem }) {
  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <div className="bg-white rounded-[14px] border border-slate-200/70 p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 px-2">
          Содержание
        </div>
        <nav className="space-y-0.5">
          {sections.map((s) => {
            const meta = metaFor(s.id);
            const Icon = meta.icon;
            const isActive = activeId === s.id;
            const isRead = readSet.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onClickItem(s.id)}
                className={`w-full inline-flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-[12.5px] text-left transition-colors ${
                  isActive ? `${meta.accentSoft} ${meta.accentText} font-semibold` : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "" : "text-slate-400"}`} strokeWidth={2.5} />
                <span className="flex-1 truncate">{s.title}</span>
                {isRead && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

// ─── Main InfoPage ─────────────────────────────────────────────────────
export default function InfoPage({ onNavigate = null, onTryDeal = null, initialTarget = null }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(() => initialTarget?.sectionId || INFO_SECTIONS[0]?.id || "");
  const [forceExpandAll, setForceExpandAll] = useState(false);
  const [readSet, setReadSet] = useState(() => {
    try {
      const raw = localStorage.getItem(READ_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const searchRef = useRef(null);
  const sectionRefs = useRef(new Map());

  // «Печать / PDF» — раскрываем все секции, ждём reflow, потом window.print().
  // После dialog'а закрытия — оставляем как было (user может закрыть руками).
  const handlePrint = () => {
    setForceExpandAll(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { window.print(); } catch {}
      });
    });
  };

  // Cmd/Ctrl + K, Esc — toggle search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(
    () => INFO_SECTIONS.filter((s) => sectionMatches(s, query)),
    [query]
  );

  const markRead = (id) => {
    setReadSet((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(READ_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const jumpTo = (id) => {
    setActiveId(id);
    const el = sectionRefs.current.get(id);
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Если запросили открыть конкретную секцию (контекстная справка) — скроллим
  // к ней после рендера.
  useEffect(() => {
    if (initialTarget?.sectionId) {
      const id = initialTarget.sectionId;
      // requestAnimationFrame чтобы refs успели подцепиться
      requestAnimationFrame(() => {
        const el = sectionRefs.current.get(id);
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveId(id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTarget]);

  // Observer — обновляет activeId при скролле
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          const id = visible.target.id.replace("info-section-", "");
          if (id) setActiveId(id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );
    sectionRefs.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [filtered.length]);

  const setRef = (id) => (el) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  };

  return (
    <InfoActionsCtx.Provider value={{ onNavigate, onTryDeal }}>
      <style>{`
        @media print {
          /* На печати — узкий моноблок, без sidebar / hero декора. */
          .info-toc-sidebar, .info-hero-extras { display: none !important; }
          .info-grid { display: block !important; }
          .info-card { break-inside: avoid; box-shadow: none !important; border-color: #e2e8f0 !important; margin-bottom: 8px; }
        }
      `}</style>
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <HeroSection
          query={query}
          setQuery={setQuery}
          searchRef={searchRef}
          readCount={readSet.size}
          totalCount={INFO_SECTIONS.length}
          onJumpTo={jumpTo}
          onPrint={handlePrint}
        />

        <div className="info-grid grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
          <div className="info-toc-sidebar">
            <TocSidebar
              sections={INFO_SECTIONS}
              readSet={readSet}
              activeId={activeId}
              onClickItem={jumpTo}
            />
          </div>

          <div className="min-w-0 space-y-3">
            {filtered.length === 0 ? (
              <div className="bg-white rounded-[14px] border border-slate-200/70 p-10 text-center">
                <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <div className="text-[13px] font-medium text-slate-600">Ничего не найдено по запросу «{query}»</div>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-3 text-[12px] text-indigo-600 hover:text-indigo-700 underline"
                >
                  Очистить поиск
                </button>
              </div>
            ) : (
              filtered.map((s, i) => (
                <SectionCard
                  key={s.id}
                  section={s}
                  defaultOpen={(i === 0 && !query) || forceExpandAll}
                  query={query}
                  isRead={readSet.has(s.id)}
                  markRead={markRead}
                  sectionRef={setRef(s.id)}
                />
              ))
            )}
          </div>
        </div>
      </main>
    </InfoActionsCtx.Provider>
  );
}
