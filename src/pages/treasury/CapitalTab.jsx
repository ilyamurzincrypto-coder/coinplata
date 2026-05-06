// src/pages/treasury/CapitalTab.jsx
//
// Капитал — собственный капитал компании, фонды, резервы. Placeholder.

import React from "react";
import { Wallet } from "lucide-react";

export default function CapitalTab() {
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 p-10 text-center">
      <Wallet className="w-8 h-8 mx-auto text-slate-300 mb-3" />
      <h2 className="text-[15px] font-bold text-slate-900 mb-1">Капитал</h2>
      <p className="text-[12.5px] text-slate-500 max-w-md mx-auto">
        Собственный капитал, фонды, резервы. Раздел в разработке.
      </p>
    </section>
  );
}
