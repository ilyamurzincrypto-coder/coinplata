// src/components/ui/CounterpartyActionsMenu.jsx
//
// «⋯»-меню рядом с именем контрагента: Архив / Удалить.
// Destructive операции — двухшаговое подтверждение (inline confirm).
//
// Props:
//   kind: "client" | "partner"
//   onArchive() — async
//   onDelete()  — async; должен мягко падать если в RPC trail check сработал

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Archive, Trash2 } from "lucide-react";

export default function CounterpartyActionsMenu({ kind, onArchive, onDelete, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // null | "archive" | "delete"
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setConfirm(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const run = async (action) => {
    setBusy(true);
    try {
      if (action === "archive") await onArchive?.();
      else if (action === "delete") await onDelete?.();
      setOpen(false);
      setConfirm(null);
    } catch {
      // ошибки наверху обрабатываются (toast); меню оставляем открытым
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="p-1 rounded-badge text-muted-soft hover:text-ink hover:bg-surface-soft transition-colors disabled:opacity-40"
        title="Действия"
      >
        <MoreHorizontal className="w-4 h-4" strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-surface rounded-card border border-border shadow-modal py-1">
          {confirm === null && (
            <>
              <button
                type="button"
                onClick={() => setConfirm("archive")}
                className="w-full px-3 py-1.5 text-left text-caption text-ink-soft hover:bg-surface-soft inline-flex items-center gap-2 transition-colors"
              >
                <Archive className="w-3.5 h-3.5" strokeWidth={2} />
                {kind === "client" ? "Архив клиента" : "Архив партнёра"}
              </button>
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                className="w-full px-3 py-1.5 text-left text-caption text-danger hover:bg-danger-soft inline-flex items-center gap-2 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                Удалить
              </button>
            </>
          )}
          {confirm === "archive" && (
            <ConfirmPane
              text="Уверены, что нужно архивировать?"
              hint="контрагент исчезнет из списков, но история останется"
              actionLabel="Архивировать"
              actionTone="warning"
              busy={busy}
              onConfirm={() => run("archive")}
              onCancel={() => setConfirm(null)}
            />
          )}
          {confirm === "delete" && (
            <ConfirmPane
              text="Удалить безвозвратно?"
              hint="нельзя если есть проводки; иначе → архив"
              actionLabel="Удалить"
              actionTone="danger"
              busy={busy}
              onConfirm={() => run("delete")}
              onCancel={() => setConfirm(null)}
            />
          )}
        </div>
      )}
    </span>
  );
}

function ConfirmPane({ text, hint, actionLabel, actionTone, busy, onConfirm, onCancel }) {
  const toneCls = actionTone === "danger"
    ? "bg-danger text-white hover:bg-danger/90"
    : "bg-warning text-white hover:bg-warning/90";
  return (
    <div className="px-3 py-2 min-w-[200px]">
      <div className="text-caption font-semibold text-ink mb-0.5">{text}</div>
      {hint && <div className="text-tiny text-muted mb-2">{hint}</div>}
      <div className="flex gap-1.5 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-6 px-2 rounded-badge text-tiny font-semibold text-ink-soft hover:bg-surface-soft transition-colors"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`h-6 px-2 rounded-badge text-tiny font-semibold transition-colors disabled:opacity-50 ${toneCls}`}
        >
          {busy ? "…" : actionLabel}
        </button>
      </div>
    </div>
  );
}
