// src/components/balances/BalancesPanel.jsx
// «ОСТАТКИ В КАССЕ» — валюты в строку (колонки), две строки значений: Утро
// (баланс на начало дня) / Текущий. USDT — агрегат по ВСЕМ офисам; наличные —
// по выбранному офису (scope). Клик по валюте → поповер «по офисам». Read-only.
// Числа из movements (balanceOf/deltaOf); «Утро» = текущий − движения с 00:00.

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { convert } from "../../utils/convert.js";
import { BAL_COLUMNS, ccyMeta, fmtRu, splitParts } from "./currencyMeta.js";
import CurrencyByOfficePopover from "./CurrencyByOfficePopover.jsx";
import { MANAGER_ORDERS_ENABLED, loadPendingOrders, subscribeOrders } from "../../lib/managerOrders.js";
import { HeroNumber } from "../ui/redesign.jsx";

function Num({ value, dp, className = "" }) {
  const { int, dec } = splitParts(fmtRu(value, dp));
  return (
    <span className={className}>
      {int}
      {dec && <span className="opacity-[0.42]">{dec}</span>}
    </span>
  );
}

const POP_W = 300;

export default function BalancesPanel({ currentOffice, scope }) {
  const { accounts, balanceOf, deltaOf } = useAccounts();
  const { activeOffices } = useOffices();
  const { dict: currencyDict } = useCurrencies();
  const { getRateFx } = useBaseCurrency();

  const cardRef = useRef(null);
  const wrapRef = useRef(null);
  const [sel, setSel] = useState(null); // выбранная валюта (поповер)
  const [pos, setPos] = useState({ left: 14, top: 0, arrow: 40 });

  const dayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const toUsd = useCallback(
    (amount, from) => (from ? convert(amount, from, "USD", getRateFx) : amount || 0),
    [getRateFx]
  );

  // Сумма валюты по фильтру офиса (null = все офисы). {tek, utro}.
  const sumFor = useCallback(
    (ccy, officeId) => {
      let tek = 0;
      let deltaToday = 0;
      accounts.forEach((a) => {
        if (!a.active || a.currency !== ccy) return;
        if (officeId && a.officeId !== officeId) return;
        tek += balanceOf(a.id);
        deltaToday += deltaOf(a.id, dayStartMs);
      });
      return { tek, utro: tek - deltaToday };
    },
    [accounts, balanceOf, deltaOf, dayStartMs]
  );

  const scopeAll = scope === "all";

  // Колонки: USDT — всегда все офисы; наличные — по scope (выбранный офис / все).
  const columns = useMemo(
    () =>
      BAL_COLUMNS.map((ccy) => {
        const crypto = currencyDict[ccy]?.type === "crypto" || ccy === "USDT";
        const data = crypto
          ? sumFor(ccy, null)
          : scopeAll
            ? sumFor(ccy, null)
            : sumFor(ccy, currentOffice);
        return { ccy, ...data, allOffices: crypto };
      }),
    [sumFor, scopeAll, currentOffice, currencyDict]
  );

  // Итог в USD-эквиваленте + дельта за день.
  const { gT, dG } = useMemo(() => {
    let t = 0;
    let u = 0;
    columns.forEach((c) => {
      t += toUsd(c.tek, c.ccy);
      u += toUsd(c.utro, c.ccy);
    });
    return { gT: t, dG: t - u };
  }, [columns, toUsd]);

  // «Под заявки» — сумма расхода (to_amount) по незакрытым заявкам офиса, по
  // валютам. За фиче-флагом (manager_orders). Realtime.
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (!MANAGER_ORDERS_ENABLED) return undefined;
    let alive = true;
    const load = () =>
      loadPendingOrders(scopeAll ? null : currentOffice)
        .then((o) => alive && setOrders(o))
        .catch(() => {});
    load();
    const unsub = subscribeOrders(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [currentOffice, scopeAll]);
  const orderByCcy = useMemo(() => {
    const m = {};
    orders.forEach((o) => {
      if (o.toCurrency && o.toAmount) m[o.toCurrency] = (m[o.toCurrency] || 0) + o.toAmount;
    });
    return m;
  }, [orders]);
  const hasOrders = orders.length > 0;

  // Разбивка выбранной валюты по офисам — для поповера.
  const popView = useMemo(() => {
    if (!sel) return null;
    const offices = (activeOffices || []).map((o) => ({
      name: o.name || o.city || "Office",
      ...sumFor(sel, o.id),
    }));
    const total = offices.reduce((s, o) => s + o.tek, 0);
    return { ccy: sel, dp: ccyMeta(sel).dp, total, offices };
  }, [sel, activeOffices, sumFor]);

  const computePos = useCallback((cellEl) => {
    const card = cardRef.current?.getBoundingClientRect();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!card || !wrap || !cellEl) return { left: 14, top: 0, arrow: 40 };
    const a = cellEl.getBoundingClientRect();
    const pad = 14;
    let left = a.left - card.left;
    left = Math.max(pad, Math.min(left, card.width - POP_W - pad));
    const top = wrap.bottom - card.top + 8;
    const center = a.left + a.width / 2 - card.left;
    const arrow = Math.max(16, Math.min(center - left, POP_W - 16));
    return { left, top, arrow };
  }, []);

  const onCellClick = useCallback(
    (ccy, e) => {
      if (sel === ccy) {
        setSel(null);
        return;
      }
      setPos(computePos(e.currentTarget));
      setSel(ccy);
    },
    [sel, computePos]
  );

  // Закрытие: клик вне / Esc.
  useEffect(() => {
    if (!sel) return undefined;
    const onDoc = (e) => {
      if (e.target.closest?.("[data-bal-pop]")) return;
      if (e.target.closest?.("[data-bal-ccy]")) return;
      setSel(null);
    };
    const onEsc = (e) => e.key === "Escape" && setSel(null);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [sel]);

  const dCls = dG > 0 ? "text-[#0b8a54]" : dG < 0 ? "text-[#cf3b40]" : "text-muted";
  const dTxt = `${dG >= 0 ? "+$" : "−$"}${fmtRu(Math.abs(Math.round(dG)), 0)}`;


  return (
    <section
      ref={cardRef}
      className="relative lg:sticky lg:top-[72px] z-20 bg-card border border-line rounded-card-2"
    >
      {/* Шапка */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
        <span className="text-[12px] font-extrabold tracking-[1.3px] uppercase text-[#454a66]">
          Остатки в кассе
        </span>
        <span className="font-mono text-[15px] font-bold text-ink tracking-tight whitespace-nowrap">
          ≈ ${fmtRu(Math.round(gT), 0)}
          <span className="font-sans not-italic text-[11.5px] font-semibold text-muted ml-1">
            · за день <span className={dCls}>{dTxt}</span>
          </span>
        </span>
      </div>

      {/* Карточки-герои по валютам (клик → разбивка по офисам) */}
      <div ref={wrapRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 p-4">
        {columns.map((c) => {
          const m = ccyMeta(c.ccy);
          const dp = m_dp(c.ccy);
          const need = orderByCcy[c.ccy] || 0;
          const delta = c.tek - c.utro;
          let sub = "без движений сегодня";
          let subCls = "text-faint";
          if (MANAGER_ORDERS_ENABLED && need > 0) {
            sub = `под заявки ${fmtRu(need, dp)}`;
            subCls = need > c.tek ? "text-danger" : "text-[#9a6b00]";
          } else if (c.tek === 0) {
            sub = "нет движений";
          } else if (Math.abs(delta) > 0.005) {
            sub = `${delta > 0 ? "+" : "−"}${fmtRu(Math.abs(delta), dp)} сегодня`;
            subCls = delta > 0 ? "text-success" : "text-danger";
          }
          const active = sel === c.ccy;
          return (
            <button
              key={c.ccy}
              type="button"
              data-bal-ccy={c.ccy}
              onClick={(e) => onCellClick(c.ccy, e)}
              className={`text-left bg-cream rounded-card-sm px-4 py-3 transition-colors hover:bg-cream-2 ${
                active ? "ring-2 ring-ink/15" : ""
              }`}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="w-[22px] h-[22px] rounded-[7px] grid place-items-center font-bold text-[11px] leading-none shrink-0"
                  style={{ background: m.bg, color: m.fg }}
                >
                  {m.sym}
                </span>
                <span className="text-[12px] font-semibold text-ink">{c.ccy}</span>
                {c.allOffices && (
                  <span className="ml-auto text-[8px] font-extrabold uppercase tracking-wide text-muted-soft">
                    все офисы
                  </span>
                )}
              </div>
              <HeroNumber
                value={fmtRu(c.tek, dp)}
                size="row"
                className={c.tek === 0 ? "text-faint" : "text-ink"}
              />
              <div className={`text-[11px] mt-1 ${subCls}`}>{sub}</div>
            </button>
          );
        })}
      </div>

      <div className="px-5 pt-0 pb-3.5 text-[11px] font-semibold text-muted">
        Нажмите на валюту — <b className="text-success font-bold">разбивка по всем офисам</b>
      </div>

      {sel && popView && (
        <div data-bal-pop>
          <CurrencyByOfficePopover view={popView} pos={pos} onClose={() => setSel(null)} />
        </div>
      )}
    </section>
  );
}

function m_dp(ccy) {
  return ccyMeta(ccy).dp;
}
