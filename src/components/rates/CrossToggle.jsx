// src/components/rates/CrossToggle.jsx
// Сворачиваемая секция кросса в карточке блока (эталон r14).
//
// ГЛАВНОЕ ПРАВИЛО: свернуть можно ПАРЫ, но не информацию. В свёрнутом виде
// в самой строке-кнопке проступает мини-сводка — первое направление каждой
// пары, два знака. Кассир, спрятавший кросс, продолжает видеть цифры краем
// глаза и раскрывает секцию только за точными знаками и вторым направлением.
// Просто спрятать значения было бы обменом информации на пустое место.
//
// СОСТОЯНИЕ — в localStorage, per кассир per блок. Здесь это допустимо:
// хранится ОТОБРАЖЕНИЕ, а не цена. Спред QR лежал там же и стоил денег —
// разница в том, что потеря этого ключа means «секция снова раскрыта», а не
// «курс уехал на 7%».
//
// В эталоне механика собрана на чекбоксе и :has(); здесь — состоянием React.

import React, { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";

const key = (blockCode) => `coinplata.cross.${blockCode}`;

/** Развёрнуто по умолчанию; свернувший остаётся со свёрнутым. */
function readPref(blockCode) {
  try {
    return localStorage.getItem(key(blockCode)) !== "0";
  } catch {
    return true;
  }
}

function writePref(blockCode, open) {
  try {
    localStorage.setItem(key(blockCode), open ? "1" : "0");
  } catch {
    /* приватное окно — префа не переживёт вкладку, и это не страшно */
  }
}

export default function CrossToggle({ blockCode, count, summary, children }) {
  const [open, setOpen] = useState(() => readPref(blockCode));

  const toggle = useCallback(() => {
    setOpen((v) => {
      writePref(blockCode, !v);
      return !v;
    });
  }, [blockCode]);

  const items = React.Children.toArray(children);

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full h-[38px] flex items-center gap-2 rounded-[10px] px-1.5 -mx-1.5 hover:bg-[#F5F0E3] transition-colors duration-200"
      >
        <span className="text-[12.5px] font-medium shrink-0">Кросс</span>
        <span className="text-[12.5px] text-faint shrink-0">· {count}</span>

        {/* Сводка занимает место всегда — иначе «Кросс» прыгал бы к центру
            при сворачивании. Меняется только её видимость. */}
        <span
          className={`flex-1 min-w-0 text-right text-[11px] text-faint tabular-nums truncate transition-opacity duration-[250ms] ${
            open ? "opacity-0" : "opacity-100"
          }`}
          style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
          aria-hidden={open}
        >
          {summary}
        </span>

        <span className="w-[26px] h-[26px] rounded-full border border-line-2 text-[#6B675C] flex items-center justify-center shrink-0">
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
            strokeWidth={1.8}
          />
        </span>
      </button>

      {/* 0fr→1fr — единственный способ анимировать высоту неизвестного
          содержимого без замера в JS; overflow скрывает контент на полпути. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {items.map((child, i) => (
            <div
              key={child.key ?? i}
              className={`transition-[opacity,transform] duration-[220ms] ease-out ${
                open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-[5px]"
              }`}
              // Каскад только на открытии: при закрытии строки должны уйти
              // разом, иначе секция схлопывается быстрее, чем гаснет её низ.
              style={{ transitionDelay: open ? `${Math.min(i + 1, 5) * 60}ms` : "0ms" }}
            >
              {child}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Мини-сводка: первое направление каждой пары, два знака.
 *
 * Два знака — требование эталона, но у значений меньше 0,1 они превращают
 * курс в «0,01» или «0,00». Для таких берём обычный форматтер кросса: сводка
 * может быть грубой, но не может быть неверной.
 */
export function crossSummary(rows, formatFallback) {
  return (rows || [])
    .filter((r) => Number.isFinite(r.fwd) && r.fwd > 0)
    .map((r) => {
      const v = r.fwd >= 0.1 ? r.fwd.toFixed(2).replace(".", ",") : formatFallback(r.fwd);
      return `${r.a}/${r.b} ${v}`;
    })
    .join(" · ");
}
