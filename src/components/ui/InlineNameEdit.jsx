// src/components/ui/InlineNameEdit.jsx
//
// Inline-редактирование строкового поля (имя клиента/партнёра).
//   • read-mode: текст + carandash-иконка на hover родителя
//   • edit-mode: <input> с Enter (save) / Esc (cancel)
//   • async onSave; во время сохранения disabled + opacity
//
// Использование:
//   <InlineNameEdit value={cp.name} onSave={(v) => api.update(...)} />
//
// Дизайн-нота: компонент молчит про права (вверх передаётся `editable={false}` или
// просто не рендерится через гард). Минимальная поверхность API.

import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

export default function InlineNameEdit({
  value,
  onSave,
  editable = true,
  className = "",
  inputClassName = "",
  placeholder = "имя",
  validate,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Если родительское значение изменилось извне — обновляем draft (когда не редактируем).
  useEffect(() => {
    if (!editing) setDraft(value || "");
  }, [value, editing]);

  const cancel = () => {
    setDraft(value || "");
    setEditing(false);
  };

  const commit = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const next = draft.trim();
    if (!next || next === (value || "").trim()) {
      cancel();
      return;
    }
    if (validate) {
      const err = validate(next);
      if (err) return;
    }
    try {
      setSaving(true);
      await onSave(next);
      setEditing(false);
    } catch {
      // Ошибки обрабатывает onSave (toast); не схлопываем поле, чтобы юзер мог переввести.
    } finally {
      setSaving(false);
    }
  };

  if (!editable) {
    return <span className={className}>{value}</span>;
  }

  if (!editing) {
    return (
      <span
        className={`${className} group/inline inline-flex items-center gap-1 cursor-text rounded-badge -mx-1 px-1 hover:bg-surface-soft transition-colors`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        title="Редактировать"
      >
        <span className="truncate">{value || <span className="text-muted-soft italic">{placeholder}</span>}</span>
        <Pencil
          className="w-3 h-3 text-muted-soft opacity-0 group-hover/inline:opacity-100 transition-opacity shrink-0"
          strokeWidth={2.2}
        />
      </span>
    );
  }

  return (
    <span
      className={`${className} inline-flex items-center gap-1`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e);
          else if (e.key === "Escape") cancel();
        }}
        onBlur={(e) => {
          // Если клик ушёл на наши же кнопки — не отменяем; даём кнопкам сработать.
          const next = e.relatedTarget;
          if (next && next.dataset?.inlineEditAction) return;
          commit();
        }}
        disabled={saving}
        placeholder={placeholder}
        className={`${inputClassName} h-6 px-1.5 rounded-input bg-surface-sunk text-ink border-0 ring-1 ring-inset ring-accent/40 focus:ring-accent focus:bg-surface focus:outline-none transition-all min-w-0 ${saving ? "opacity-60" : ""}`}
      />
      <button
        type="button"
        data-inline-edit-action="save"
        onClick={commit}
        disabled={saving}
        className="p-0.5 rounded-badge text-success hover:bg-success-soft transition-colors disabled:opacity-40"
        title="Сохранить (Enter)"
      >
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        data-inline-edit-action="cancel"
        onClick={cancel}
        disabled={saving}
        className="p-0.5 rounded-badge text-muted hover:text-ink hover:bg-surface-soft transition-colors disabled:opacity-40"
        title="Отмена (Esc)"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    </span>
  );
}
