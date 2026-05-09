// src/pages/treasury/components/EmptyState.jsx
import React from "react";
import { Wallet } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function EmptyState({ officeName }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 p-10 text-center">
      <Wallet className="w-8 h-8 mx-auto text-slate-300 mb-3" />
      <h2 className="text-[15px] font-bold text-slate-900 mb-1">
        {t("tr_empty_state_title")}
      </h2>
      {officeName && (
        <p className="text-[12.5px] text-slate-500">
          {t("tr_dashboard_subtitle_office")}: {officeName}
        </p>
      )}
    </section>
  );
}
