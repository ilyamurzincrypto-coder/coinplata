// src/pages/treasury/NostroTab.jsx
//
// Ностро — наши счета у других. Placeholder, контент добавится в следующих
// итерациях (структура по аналогии с CounterpartiesPage > ListTab).

import React from "react";
import { Landmark } from "lucide-react";

export default function NostroTab() {
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 p-10 text-center">
      <Landmark className="w-8 h-8 mx-auto text-slate-300 mb-3" />
      <h2 className="text-[15px] font-bold text-slate-900 mb-1">Ностро</h2>
      <p className="text-[12.5px] text-slate-500 max-w-md mx-auto">
        Наши счета у других банков и контрагентов. Раздел в разработке.
      </p>
    </section>
  );
}
