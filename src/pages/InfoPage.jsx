// src/pages/InfoPage.jsx
// Справка / Info — a plain-language manual of every feature in the service, with
// step-by-step "how it works" and worked examples (incl. mini Дт/Кт journal tables).
// Renders INFO_SECTIONS as a collapsible accordion. Sections/examples may carry a
// `try` hint: section.try.page → "Открыть раздел" jumps to that page; an example's
// try.dealSeed → "Попробовать в форме" opens the deal form pre-filled with those
// values (so reading turns into doing — onboarding by example).
import React, { useState } from "react";
import { ChevronRight, ChevronDown, Play, ArrowUpRight } from "lucide-react";
import { INFO_SECTIONS } from "./info/content.js";

const numFmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Navigation / "try it" callbacks threaded down without prop-drilling through every card.
const InfoActionsCtx = React.createContext({ onNavigate: null, onTryDeal: null });

function TryButton({ label, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[11.5px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors"
    >
      {icon || <Play className="w-3 h-3" />}
      {label}
    </button>
  );
}

function Bullets({ items, ordered }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`mt-1.5 space-y-1 text-[12.5px] text-slate-700 ${ordered ? "list-decimal" : "list-disc"} pl-5`}>
      {items.map((b, i) => <li key={i}>{b}</li>)}
    </Tag>
  );
}

// Mini Дт/Кт journal-entries table for a worked example (one transaction's worth of lines).
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

function ExampleCard({ ex }) {
  const { onTryDeal } = React.useContext(InfoActionsCtx);
  const dealSeed = ex.try?.dealSeed;
  return (
    <div className="rounded-[10px] border border-slate-200/80 bg-white px-3 py-2.5">
      <div className="text-[12.5px] font-semibold text-slate-900">{ex.title}</div>
      {ex.intro && <div className="text-[12px] text-slate-500 mt-0.5">{ex.intro}</div>}
      {Array.isArray(ex.steps) && ex.steps.length > 0 && <Bullets items={ex.steps} ordered />}
      {Array.isArray(ex.journal) && ex.journal.length > 0 && <JournalMini lines={ex.journal} />}
      {ex.note && <div className="text-[12px] text-slate-500 italic mt-2">{ex.note}</div>}
      {dealSeed && onTryDeal && (
        <div className="mt-2">
          <TryButton label={ex.try?.label || "Попробовать в форме"} onClick={() => onTryDeal(dealSeed)} />
        </div>
      )}
    </div>
  );
}

function HowAndExamples({ how, examples }) {
  return (
    <>
      {Array.isArray(how) && how.length > 0 && (
        <div>
          <div className="text-[12px] font-medium text-slate-700 mt-2">Как работает:</div>
          <Bullets items={how} ordered />
        </div>
      )}
      {Array.isArray(examples) && examples.length > 0 && (
        <div className="mt-2 space-y-2">
          {examples.map((ex, i) => <ExampleCard key={i} ex={ex} />)}
        </div>
      )}
    </>
  );
}

function SubCard({ sub }) {
  return (
    <div className="rounded-[10px] border border-slate-100 bg-slate-50/50 px-3 py-2">
      <div className="text-[12.5px] font-bold text-slate-900">{sub.title}</div>
      {sub.what && <div className="text-[12px] text-slate-500 italic mt-0.5">{sub.what}</div>}
      {sub.related && <div className="text-[12px] text-slate-500 mt-0.5"><span className="font-medium text-slate-600">Связано: </span>{sub.related}</div>}
      {Array.isArray(sub.can) && sub.can.length > 0 && <Bullets items={sub.can} />}
      <HowAndExamples how={sub.how} examples={sub.examples} />
    </div>
  );
}

function InfoCard({ section, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const { onNavigate } = React.useContext(InfoActionsCtx);
  const goPage = section.try?.page;
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-slate-50" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        <h2 className="text-[14px] font-bold text-slate-900">{section.title}</h2>
      </header>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2">
          <p className="text-[12.5px] text-slate-500 italic">{section.what}</p>
          <p className="text-[12.5px] text-slate-600"><span className="font-medium text-slate-700">С чем связано: </span>{section.related}</p>
          {goPage && onNavigate && (
            <TryButton
              label={section.try?.label || "Открыть раздел"}
              icon={<ArrowUpRight className="w-3 h-3" />}
              onClick={() => onNavigate(goPage)}
            />
          )}
          {Array.isArray(section.can) && section.can.length > 0 && (
            <>
              <div className="text-[12px] font-medium text-slate-700">Что умеет:</div>
              <Bullets items={section.can} />
            </>
          )}
          <HowAndExamples how={section.how} examples={section.examples} />
          {section.sub && (
            <div className="mt-2 space-y-2">
              {section.sub.map((ss) => <SubCard key={ss.id || ss.title} sub={ss} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function InfoPage({ onNavigate = null, onTryDeal = null }) {
  return (
    <InfoActionsCtx.Provider value={{ onNavigate, onTryDeal }}>
      <main className="max-w-[900px] mx-auto px-6 py-6 space-y-3">
        <header className="space-y-1">
          <h1 className="text-[22px] font-bold tracking-tight">Справка</h1>
          <p className="text-[13px] text-slate-500">Что есть в сервисе, как оно работает и примеры — простым языком. Разверни любой раздел; где есть кнопка «Попробовать» — она откроет нужный экран (а у примеров сделок — форму с уже подставленными значениями).</p>
        </header>
        {INFO_SECTIONS.map((s, i) => <InfoCard key={s.id} section={s} defaultOpen={i === 0} />)}
      </main>
    </InfoActionsCtx.Provider>
  );
}
