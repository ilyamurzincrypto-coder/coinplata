// src/components/ui/Modal.jsx
import React, { useEffect } from "react";
import { X } from "lucide-react";

export default function Modal({ open, onClose, title, subtitle, children, width = "xl" }) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const widthCls = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }[width] || "max-w-xl";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6 overflow-y-auto"
      onMouseDown={(e) => {
        // Overlay click closes
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {/* backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
        aria-hidden="true"
      />
      {/* panel */}
      <div
        className={`relative w-full ${widthCls} bg-white rounded-[18px] shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] border border-slate-200 mt-8 mb-8 animate-[slideUp_160ms_ease-out]`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
            <div>
              {title && (
                <h3 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h3>
              )}
              {subtitle && (
                <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[8px] hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div>{children}</div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
