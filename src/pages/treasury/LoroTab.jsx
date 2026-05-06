// src/pages/treasury/LoroTab.jsx
//
// Лоро — счета других в нашей системе. Placeholder.

import React from "react";
import { Building2 } from "lucide-react";

export default function LoroTab() {
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 p-10 text-center">
      <Building2 className="w-8 h-8 mx-auto text-slate-300 mb-3" />
      <h2 className="text-[15px] font-bold text-slate-900 mb-1">Лоро</h2>
      <p className="text-[12.5px] text-slate-500 max-w-md mx-auto">
        Счета контрагентов и партнёров у нас. Раздел в разработке.
      </p>
    </section>
  );
}
