// src/components/RatesConfirmationBanner.jsx
// Глобальный баннер под Header'ом: показывается если курсы на сегодня не подтверждены.
// Admin/accountant видит кнопку "Confirm today's rates".
// Manager видит только текст-предупреждение.

import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";

export default function RatesConfirmationBanner() {
  const { t } = useTranslation();
  const {
    isConfirmedToday,
    modifiedAfterConfirmation,
    confirmRates,
    confirmationStatus,
  } = useRates();
  const { currentUser, isAdmin, isAccountant } = useAuth();
  const { addEntry: logAudit } = useAudit();

  const canConfirm = isAdmin || isAccountant;

  // Не показываем вообще если подтверждено и ничего не модифицировано
  if (isConfirmedToday && !modifiedAfterConfirmation) return null;

  const handleConfirm = () => {
    confirmRates(currentUser.id);
    logAudit({
      action: "update",
      entity: "rates",
      entityId: "confirmation",
      summary: `Confirmed today's rates`,
    });
  };

  // Случай: курсы были подтверждены, но изменены после
  if (modifiedAfterConfirmation && isConfirmedToday) {
    return (
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-[1400px] mx-auto px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[12px] font-medium text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t("rates_modified_after")}
          </div>
          {canConfirm && (
            <button
              onClick={handleConfirm}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              <CheckCircle2 className="w-3 h-3" />
              {t("rates_confirm_btn")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Случай: draft / not-confirmed-today
  return (
    <div className="bg-rose-50 border-b border-rose-200">
      <div className="max-w-[1400px] mx-auto px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[12px] font-medium text-rose-800">
          <AlertTriangle className="w-3.5 h-3.5" />
          {t("rates_not_confirmed_banner")}
        </div>
        {canConfirm && (
          <button
            onClick={handleConfirm}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" />
            {t("rates_confirm_btn")}
          </button>
        )}
      </div>
    </div>
  );
}
