// src/components/cashier/StickyTitle.jsx
// 56px sticky title bar для новой DealForm.
// Содержит: заголовок, Office picker, Manager picker (с avatar+initials),
// Close X с confirm если есть unsaved changes.
//
// ⌘K hint НЕ показываем (он глобальный, дублирование не нужно).
// UUID сделки — только в title-attr (не визуально).

import React from "react";
import { X, ChevronDown } from "lucide-react";
import Select from "../ui/Select.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useOffices } from "../../store/offices.jsx";
import Avatar from "./Avatar.jsx";

export default function StickyTitle({
  mode = "create",                  // 'create' | 'edit'
  dealId,                            // string uuid, показывается в title-attr
  selectedOfficeId,
  onChangeOffice,
  selectedManagerId,
  onChangeManager,
  hasUnsavedChanges = false,
  onClose,
}) {
  const { t } = useTranslation();
  const { currentUser, users } = useAuth();
  const { activeOffices } = useOffices();

  const title =
    mode === "edit" ? t("cashier_title_edit") : t("cashier_title_new");

  const officeOptions = activeOffices.map((o) => ({
    value: o.id,
    label: o.name,
  }));

  // Manager список — только активные пользователи. UI ограничит дальше,
  // но для прав на «from-name-of» уже фильтруем active.
  const managerCandidates = (users || []).filter((u) => u.active !== false);
  const selectedManager =
    managerCandidates.find((m) => m.id === selectedManagerId) ||
    currentUser;

  const handleClose = () => {
    if (hasUnsavedChanges) {
      const ok = window.confirm(t("cashier_close_confirm"));
      if (!ok) return;
    }
    onClose?.();
  };

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-3 px-4 bg-white border-b border-border-soft"
      style={{ height: "var(--title-bar-height)" }}
    >
      {/* Title */}
      <h2
        className="text-heading"
        title={dealId ? `Deal id: ${dealId}` : undefined}
      >
        {title}
      </h2>

      {/* Office picker */}
      <div className="ml-auto flex items-center gap-2">
        <Select
          value={selectedOfficeId}
          onChange={onChangeOffice}
          options={officeOptions}
          compact
          icon={
            <span className="text-label tracking-[0.08em] text-muted">
              OFFICE
            </span>
          }
        />

        {/* Manager picker */}
        <button
          type="button"
          onClick={() => {
            // Open manager dropdown — для v1 используем тот же Select
            // c trigger по клику. Здесь вместо отдельного state делаем
            // компонентный обёртку.
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-cell)] border border-border-soft hover:border-border bg-white text-value transition-colors"
          title={selectedManager?.name || ""}
        >
          <Avatar
            initials={selectedManager?.initials}
            name={selectedManager?.name}
            size={20}
          />
          <span className="hidden sm:inline truncate max-w-[140px]">
            {selectedManager?.name || t("loading")}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-soft" />
        </button>

        {/* Close X */}
        <button
          type="button"
          onClick={handleClose}
          className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-cell)] text-muted hover:text-ink hover:bg-surface-sunk transition-colors"
          aria-label={t("close")}
          title={t("close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
