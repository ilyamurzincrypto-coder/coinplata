// src/pages/CounterpartiesPage.jsx
//
// Top-level раздел «Контрагенты» — управление OTC-партнёрами.
// Раньше был внутри Settings → Партнёры. Теперь — отдельный пункт навбара,
// чтобы не путать с обычными клиентами и быть доступным для менеджеров
// без захода в Settings.
//
// Контент: re-use PartnersTab (поиск, добавление, раскрытие, счета,
// история движений). UI идентичен, контейнер обёрнут стандартным
// max-w-страничным layout'ом.

import React from "react";
import { Handshake } from "lucide-react";
import PartnersTab from "./settings/PartnersTab.jsx";

export default function CounterpartiesPage() {
  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-indigo-50 border border-indigo-200 flex items-center justify-center">
          <Handshake className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Контрагенты</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            OTC партнёры — для сделок с участием контрагента
          </p>
        </div>
      </div>

      <PartnersTab />
    </main>
  );
}
