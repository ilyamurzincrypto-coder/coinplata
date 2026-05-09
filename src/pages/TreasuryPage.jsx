// src/pages/TreasuryPage.jsx
//
// Раздел «Казначейство». MVP — единый Dashboard, scoped to currentOffice.
// Раньше тут было 3 заглушки-таба (Nostro/Loro/Capital) — заменены на Dashboard
// (см. docs/superpowers/specs/2026-05-09-treasury-mvp-design.md).

import React from "react";
import Dashboard from "./treasury/Dashboard.jsx";

export default function TreasuryPage({ currentOffice }) {
  return <Dashboard officeId={currentOffice} />;
}
