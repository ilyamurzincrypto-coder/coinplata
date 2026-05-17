// src/components/GlossaryFab.jsx
// Глобальный «?» FAB внизу-справа экрана + поисковая панель по глоссарию.
// Доступен с любой страницы: нашёл незнакомый термин — кликнул иконку,
// набрал слово, прочитал определение. Можно открыть клавишей «?» (Shift+/).
//
// Источник терминов — GLOSSARY_TERMS из info/content.js (парсится из секции
// «Как всё связано» Справки). Поэтому контент в одном месте, обновления
// автоматически попадают сюда.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Search, X, BookOpen, ArrowUpRight } from "lucide-react";
import { GLOSSARY_TERMS } from "../pages/info/content.js";

function matchScore(term, q) {
  const t = term.primary.toLowerCase();
  const aliases = term.aliases.map((a) => a.toLowerCase());
  const def = term.definition.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (aliases.some((a) => a.startsWith(q))) return 3;
  if (t.includes(q)) return 2;
  if (aliases.some((a) => a.includes(q))) return 2;
  if (def.includes(q)) return 1;
  return 0;
}

function Highlight({ text, query }) {
  if (!query || !text) return text;
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-100 text-amber-900 rounded-[3px] px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function GlossaryFab({ onOpenInfo = null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  // Hotkey «?» (Shift+/) — открыть глоссарий. Esc — закрыть.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (e.key === "?" && !inField) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GLOSSARY_TERMS;
    return GLOSSARY_TERMS
      .map((t) => ({ t, score: matchScore(t, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ t }) => t);
  }, [query]);

  const fab = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      title="Глоссарий — поиск по терминам (горячая клавиша ?)"
      className="fixed bottom-4 right-4 z-[900] w-11 h-11 rounded-full bg-slate-900 text-white hover:bg-slate-800 shadow-[0_8px_24px_-6px_rgba(15,23,42,0.4),0_2px_4px_rgba(15,23,42,0.1)] flex items-center justify-center transition-all hover:scale-105 active:scale-95 print:hidden"
    >
      <HelpCircle className="w-5 h-5" strokeWidth={2.5} />
    </button>
  );

  if (typeof document === "undefined") return null;

  return (
    <>
      {createPortal(fab, document.body)}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-end sm:justify-end p-3 sm:p-6 bg-slate-900/30 backdrop-blur-[1px]"
          onClick={() => { setOpen(false); setQuery(""); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-[16px] w-full sm:w-[420px] max-h-[80vh] flex flex-col shadow-[0_20px_60px_-10px_rgba(15,23,42,0.4)] border border-slate-200"
          >
            <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-slate-500 shrink-0" />
              <h3 className="text-[14px] font-bold text-slate-900 flex-1">Глоссарий</h3>
              <span className="hidden sm:inline-flex items-center text-[10px] font-medium text-slate-400">
                <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 mr-1">?</kbd>
                открыть
              </span>
              <button
                type="button"
                onClick={() => { setOpen(false); setQuery(""); }}
                className="p-1 rounded-[6px] text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Двойная запись, ledger, субконто…"
                  className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-100 rounded-[10px] pl-8 pr-3 py-2 text-[13px] outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3 pt-1 space-y-1.5">
              {results.length === 0 ? (
                <div className="text-center py-10 text-[12.5px] text-slate-400">
                  По запросу «{query}» ничего не нашлось
                </div>
              ) : (
                results.map((t, i) => (
                  <div
                    key={`${t.primary}_${i}`}
                    className="rounded-[10px] border border-slate-100 bg-slate-50/60 px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[12.5px] font-bold text-slate-900">
                        <Highlight text={t.primary} query={query} />
                      </span>
                      {t.aliases.length > 0 && (
                        <span className="text-[10.5px] text-slate-400 font-medium">
                          (
                          {t.aliases.map((a, k) => (
                            <React.Fragment key={k}>
                              {k > 0 ? ", " : ""}
                              <Highlight text={a} query={query} />
                            </React.Fragment>
                          ))}
                          )
                        </span>
                      )}
                    </div>
                    {t.definition && (
                      <div className="text-[11.5px] text-slate-600 mt-1 leading-snug">
                        <Highlight text={t.definition} query={query} />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <footer className="px-3 py-2 border-t border-slate-100 flex items-center gap-2 bg-slate-50/40">
              <span className="text-[11px] text-slate-500">
                {GLOSSARY_TERMS.length} {GLOSSARY_TERMS.length === 1 ? "термин" : GLOSSARY_TERMS.length < 5 ? "термина" : "терминов"}
              </span>
              {onOpenInfo && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); setQuery(""); onOpenInfo(); }}
                  className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  Полная справка
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </footer>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
