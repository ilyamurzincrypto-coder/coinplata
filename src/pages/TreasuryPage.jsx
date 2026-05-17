// src/pages/TreasuryPage.jsx
//
// Раздел «Казначейство» (Spec B) — реальный accountant tool на ledger.journal_entries.
// 10 табов: Дашборд / Сделки / Активы / Пассивы / Капитал / P&L / Обороты /
// Движение средств / Журнал / Платёжный календарь.

import React from "react";
import TreasuryShell from "./treasury_v2/TreasuryShell.jsx";

export default function TreasuryPage({ onOpenHelp = null }) {
  return <TreasuryShell onOpenHelp={onOpenHelp} />;
}
