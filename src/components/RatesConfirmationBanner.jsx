// src/components/RatesConfirmationBanner.jsx
// Sticky-баннер под Header'ом. Зависит от currentOffice + working hours + роли.
//
// Показывается если:
//   — текущий офис рабочий день сегодня
//   — текущее время офиса >= workingHours.start
//   — курсы на сегодня НЕ подтверждены
//
// admin/accountant → кнопка "Confirm today's rates"
// manager → только текст "Coordinate with management"

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Building2 } from "lucide-react";
import { useRates } from "../store/rates.jsx";
import { useRateHistory } from "../store/rateHistory.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { shouldOfficeHaveRatesConfirmed } from "../utils/officeTime.js";

export default function RatesConfirmationBanner({ currentOffice }) {
  const { t } = useTranslation();
  const {
    isConfirmedToday,
    modifiedAfterConfirmation,
    confirmRates,
    rates,
  } = useRates();
  const { addSnapshot } = useRateHistory();
  const { currentUser, isAdmin, isAccountant } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { findOffice } = useOffices();

  const office = currentOffice ? findOffice(currentOffice) : null;

  // Тикаем каждую минуту, чтобы шапка переходила из before_start → open автоматически.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const now = new Date(nowTick);
  const officeNeedsRates = office ? shouldOfficeHaveRatesConfirmed(office, now) : false;

  const canConfirm = isAdmin || isAccountant;

  // Кейс 1: подтверждено и не модифицировано — ничего не показываем.
  if (!office) return null;
  if (!officeNeedsRates) return null; // офис ещё/уже не работает → не требуем
  if (isConfirmedToday && !modifiedAfterConfirmation) return null;

  const handleConfirm = () => {
    confirmRates(currentUser.id);
    // Snapshot текущих курсов — для аудита и привязки к будущим транзакциям.
    const snap = addSnapshot({
      rates,
      officeId: office.id,
      createdBy: currentUser.id,
      reason: "confirm",
    });
    logAudit({
      action: "update",
      entity: "rates",
      entityId: "confirmation",
      summary: `Confirmed today's rates (from ${office.name}) · snapshot ${snap?.snapshot?.id?.slice(0, 14) || "—"}`,
    });
  };

  // Случай: курсы были подтверждены, но потом изменены
  if (modifiedAfterConfirmation && isConfirmedToday) {
    return (
      <BannerShell tone="amber" icon={AlertTriangle}>
        <span>{t("rates_modified_after")}</span>
        <OfficeChip office={office} tone="amber" />
        {canConfirm ? (
          <ConfirmButton tone="amber" onClick={handleConfirm} label={t("rates_confirm_btn")} />
        ) : (
          <ManagerHint tone="amber" />
        )}
      </BannerShell>
    );
  }

  // Случай: курсы на сегодня НЕ подтверждены
  return (
    <BannerShell tone="rose" icon={AlertTriangle}>
      <span>{t("rates_not_confirmed_banner")}</span>
      <OfficeChip office={office} tone="rose" />
      {canConfirm ? (
        <ConfirmButton tone="rose" onClick={handleConfirm} label={t("rates_confirm_btn")} />
      ) : (
        <ManagerHint tone="rose" />
      )}
    </BannerShell>
  );
}

// -------- Helpers --------
function BannerShell({ tone, icon: Icon, children }) {
  const toneClass =
    tone === "rose"
      ? "bg-rose-50 border-rose-200 text-rose-800"
      : "bg-amber-50 border-amber-200 text-amber-800";
  return (
    <div className={`border-b ${toneClass} sticky top-0 z-20`}>
      <div className="max-w-[1400px] mx-auto px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[12px] font-medium">
          <Icon className="w-3.5 h-3.5 shrink-0" />
          {children}
        </div>
      </div>
    </div>
  );
}

function OfficeChip({ office, tone }) {
  const cls =
    tone === "rose"
      ? "bg-rose-100 text-rose-800 border-rose-200"
      : "bg-amber-100 text-amber-800 border-amber-200";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold border ${cls}`}
    >
      <Building2 className="w-2.5 h-2.5" />
      {office.name}
    </span>
  );
}

function ConfirmButton({ tone, onClick, label }) {
  const cls =
    tone === "rose"
      ? "bg-rose-600 hover:bg-rose-700"
      : "bg-amber-600 hover:bg-amber-700";
  return (
    <button
      onClick={onClick}
      className={`ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold text-white transition-colors ${cls}`}
    >
      <CheckCircle2 className="w-3 h-3" />
      {label}
    </button>
  );
}

function ManagerHint({ tone }) {
  const cls = tone === "rose" ? "text-rose-700" : "text-amber-700";
  return (
    <span className={`ml-auto text-[11px] font-medium italic ${cls}`}>
      Coordinate with management
    </span>
  );
}
