// src/components/OfficeGate.jsx
// Экран «выберите офис» — вариант (в) решения по дефолтному офису.
//
// ЧТО БЫЛО: если сохранённого выбора нет, приложение подставляло сидовый
// "mark". В проде у офисов UUID, поэтому каждый запрос с фильтром по офису
// возвращал 400, ошибка глоталась, и заявки (16 штук) и закрытия кассы молча
// показывали пусто. Накрывало любого, кому браузер чистил хранилище.
//
// ПОЧЕМУ НЕ «первый активный»: кассир Стамбула после чистки Safari молча
// увидел бы заявки Антальи и мог принять чужую. Угадывать офис в системе,
// где офис определяет деньги, нельзя — можно только спросить.

import React from "react";
import { Building2 } from "lucide-react";

export default function OfficeGate({ offices, onPick }) {
  const list = offices || [];

  return (
    <div className="px-4 py-10 flex justify-center">
      <div className="bg-card rounded-card-2 px-7 py-7 w-full max-w-[520px]">
        <span className="w-[38px] h-[38px] rounded-full border border-line-2 text-[#6B675C] flex items-center justify-center mb-5">
          <Building2 className="w-4 h-4" strokeWidth={1.6} />
        </span>

        <div className="text-[19px] mb-1.5">Выберите офис</div>
        <div className="text-[13px] text-muted leading-relaxed mb-5">
          Остатки, заявки и закрытие кассы считаются по офису, поэтому он не
          подставляется сам. Выбор запомнится в этом браузере.
        </div>

        {list.length === 0 ? (
          <div className="text-[13px] text-orange-ink bg-orange-bg rounded-[16px] px-4 py-3">
            Список офисов ещё не загрузился. Если это надолго — обновите страницу.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {list.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onPick(o.id)}
                className="w-full text-left rounded-[16px] border border-line-2 hover:border-ink px-4 py-3 transition-colors"
              >
                <span className="text-[14px]">{o.name}</span>
                {o.city && <span className="text-[12px] text-faint ml-2">{o.city}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
