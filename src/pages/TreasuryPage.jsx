// src/pages/TreasuryPage.jsx
//
// Раздел «Казначейство» (Spec B) — реальный accountant tool на ledger.journal_entries.
// 5 табов: Активы / Пассивы / Капитал / P&L / Журнал. См.
// docs/superpowers/specs/2026-05-10-treasury-pnl-on-journal-entries-design.md
//
// (Старый MVP на legacy account_movements удалён.)

import React from "react";
import TreasuryShell from "./treasury_v2/TreasuryShell.jsx";

export default function TreasuryPage() {
  return <TreasuryShell />;
}
