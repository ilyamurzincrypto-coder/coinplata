// src/pages/InfoPage.jsx
// Справка / Info — a plain-language manual of every feature in the service.
// Pure render of INFO_SECTIONS as a collapsible accordion. No store, no permissions.
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { INFO_SECTIONS } from "./info/content.js";

function Bullets({ items }) {
  return (
    <ul className="mt-1.5 space-y-1 text-[12.5px] text-slate-700 list-disc pl-5">
      {items.map((b, i) => <li key={i}>{b}</li>)}
    </ul>
  );
}

function SubCard({ sub }) {
  return (
    <div className="rounded-[10px] border border-slate-100 bg-slate-50/50 px-3 py-2">
      <div className="text-[12.5px] font-bold text-slate-900">{sub.title}</div>
      {sub.what && <div className="text-[12px] text-slate-500 italic mt-0.5">{sub.what}</div>}
      {sub.related && <div className="text-[12px] text-slate-500 mt-0.5"><span className="font-medium text-slate-600">Связано: </span>{sub.related}</div>}
      <Bullets items={sub.can} />
    </div>
  );
}

function InfoCard({ section, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
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
          <div className="text-[12px] font-medium text-slate-700">Что умеет:</div>
          <Bullets items={section.can} />
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

export default function InfoPage() {
  return (
    <main className="max-w-[900px] mx-auto px-6 py-6 space-y-3">
      <header className="space-y-1">
        <h1 className="text-[22px] font-bold tracking-tight">Справка</h1>
        <p className="text-[13px] text-slate-500">Что есть в сервисе и что оно умеет — простым языком. Разверни любой раздел.</p>
      </header>
      {INFO_SECTIONS.map((s, i) => <InfoCard key={s.id} section={s} defaultOpen={i === 0} />)}
    </main>
  );
}
