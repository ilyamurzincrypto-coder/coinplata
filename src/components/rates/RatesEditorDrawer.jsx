// src/components/rates/RatesEditorDrawer.jsx
// Выезжающий вправо редактор курсов (white terminal). Накрывает основную колонку
// (Остатки+Сделки), strip курсов слева остаётся. Внутри — существующий RatesPage
// (логика/поля/save без изменений), в drawer-режиме своя страничная шапка скрыта.
// Закрытие: «Готово» / Esc / клик вне. Анимация slide; motion-reduce — без неё.

import React, { useEffect, useRef } from "react";
import RatesPage from "../../pages/RatesPage.jsx";

export default function RatesEditorDrawer({ open, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return; // внутри панели
      // Модалки/тосты редактора портятся в body (overlay .fixed / role=dialog) —
      // клики по ним не должны закрывать drawer.
      if (e.target?.closest?.('[role="dialog"], .fixed')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    // фокус внутрь панели при открытии
    const id = requestAnimationFrame(() => panelRef.current?.focus?.());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      cancelAnimationFrame(id);
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed left-0 right-0 top-[56px] bottom-0 z-40 overflow-hidden ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Редактирование курсов"
        tabIndex={-1}
        className={`absolute inset-0 flex flex-col bg-white border-l border-[rgba(18,22,26,0.08)] shadow-[-18px_0_40px_rgba(18,22,26,0.06)] outline-none transition-transform duration-[260ms] ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Терминальная шапка drawer */}
        <div className="flex items-center gap-3.5 px-5 py-3 border-b border-[rgba(18,22,26,0.08)] flex-none">
          <span className="text-[12px] font-extrabold tracking-[1.2px] uppercase text-[#15191d]">
            Редактирование курсов
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[12.5px] font-bold text-white bg-[#0c9c6b] rounded-[9px] px-4 py-2 hover:bg-[#0b8c60] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c9c6b]/40"
          >
            Готово
          </button>
        </div>
        {/* Тело — существующий редактор (его табы офисов/секции/поля/save) */}
        <div className="flex-1 overflow-auto">
          {open && <RatesPage onBack={onClose} drawer />}
        </div>
      </div>
    </div>
  );
}
