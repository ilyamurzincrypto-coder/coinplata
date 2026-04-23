// src/components/ExchangeDrawer.jsx
// Правая выдвижная панель для создания сделки.
//
// Важно: drawer остаётся mounted когда свёрнут (minimized=true).
// При minimize он только прячется translate-x-full, ExchangeForm внутри
// сохраняет весь свой state (amounts, rates, counterparty, outputs). Когда
// кассир возвращается — всё на местах.
//
// Три состояния:
//   open=false          → drawer скрыт (translate-x-full), полностью не виден
//   open=true, min=false → drawer виден, translate-x-0
//   open=true, min=true → drawer скрыт за экраном, чип "Resume exchange" в углу
//
// Размер: 520px на desktop, full width ниже breakpoint.

import React from "react";
import { X, Minus, ChevronRight } from "lucide-react";
import ExchangeForm from "./ExchangeForm.jsx";

export default function ExchangeDrawer({
  open,
  minimized,
  currentOffice,
  onSubmit,
  onMinimize,
  onRestore,
  onClose,
  submitting,
}) {
  // Drawer всегда рендерится когда open=true, меняется только transform.
  // Когда open=false — мы можем полностью убрать с DOM (no form state
  // expected to survive между сессиями create mode → view mode → create).
  // Если хочешь "restore" после закрытия — нужно пользоваться minimize.
  return (
    <>
      {/* Полупрозрачный overlay на маленьких экранах — чтобы drawer не терялся */}
      {open && !minimized && (
        <div
          className="fixed inset-0 bg-slate-900/10 z-30 lg:hidden transition-opacity duration-200"
          onClick={onMinimize || onClose}
        />
      )}

      {/* Сам drawer */}
      <aside
        aria-hidden={!open || minimized}
        className={`fixed top-0 right-0 h-full z-40 w-full sm:w-[520px] bg-white border-l border-slate-200 shadow-[-8px_0_32px_-12px_rgba(15,23,42,0.15)] flex flex-col transition-transform duration-300 ease-out ${
          open && !minimized ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-slate-900 tracking-tight">
              New exchange
            </div>
            <div className="text-[11px] text-slate-500">
              Fill the form — minimize anytime without losing data
            </div>
          </div>
          <button
            onClick={onMinimize}
            title="Minimize (data preserved)"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            title="Close & discard"
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — скроллится внутри */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {open && (
            <div className="p-4">
              <ExchangeForm
                mode="create"
                currentOffice={currentOffice}
                onSubmit={onSubmit}
                submitting={submitting}
              />
            </div>
          )}
        </div>
      </aside>

      {/* Minimized chip — возврат к drawer'у */}
      {open && minimized && (
        <button
          onClick={onRestore}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 pl-4 pr-3 py-3 rounded-[14px] bg-slate-900 text-white text-[13px] font-semibold shadow-[0_8px_24px_-8px_rgba(15,23,42,0.5)] hover:bg-slate-800 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          title="Resume exchange"
        >
          <span className="relative flex items-center">
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse" />
            <span>Resume exchange</span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 opacity-80" />
        </button>
      )}
    </>
  );
}
