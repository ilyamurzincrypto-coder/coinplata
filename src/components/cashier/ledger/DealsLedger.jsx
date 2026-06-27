// src/components/cashier/ledger/DealsLedger.jsx
// Зона C — «Сделки за день». Широкая таблица: Контрагент | ПРИХОД [валюты] |
// Курс | РАСХОД [валюты]. Заполненная валютная ячейка — зелёная (как в их Excel).
// Снизу инлайн-строка: печатаешь сумму прямо в валютную ячейку → Enter/blur →
// create_deal (no-false-green: зелёнка только после подтверждения БД). Валютные
// колонки — динамически из справочника валют. Без колонки прибыли и без строки
// оборотов (убрано намеренно). Realtime на deals/deal_legs.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase.js";
import { loadCashierDeals } from "../../../lib/cashierDealsReader.js";
import { useAccounts } from "../../../store/accounts.jsx";
import { createDeal } from "../../../lib/dealOperations.js";
import { BAL_COLUMNS, ccyMeta, fmtRu, splitParts } from "../../balances/currencyMeta.js";
import CounterpartyPicker from "./CounterpartyPicker.jsx";
import DealTimeField from "./DealTimeField.jsx";
import { rpcSetDealCreatedAt } from "../../../lib/supabaseWrite.js";
import {
  MANAGER_ORDERS_ENABLED,
  loadPendingOrders,
  createOrder,
  markArrived,
  markDone,
  subscribeOrders,
} from "../../../lib/managerOrders.js";
import { Hourglass, CircleDashed, CheckCircle2, ArrowRight } from "lucide-react";

const MONTHS_S = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function fmtDealTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p2 = (n) => String(n).padStart(2, "0");
  const t = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const today = d.toDateString() === new Date().toDateString();
  return today ? t : `${p2(d.getDate())} ${MONTHS_S[d.getMonth()]} · ${t}`;
}

function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function parseRu(v) {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function Amt({ value, ccy }) {
  const { int, dec } = splitParts(fmtRu(value, ccyMeta(ccy).dp));
  return (
    <>
      {int}
      {dec && <span className="opacity-[0.42]">{dec}</span>}
    </>
  );
}

export default function DealsLedger({ officeId }) {
  const { accounts } = useAccounts();
  // Тот же набор валют, что и в «Остатках» (а не все активные из справочника).
  const cols = BAL_COLUMNS;
  const fromIso = useMemo(() => todayStartIso(), []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const r = await loadCashierDeals({ officeId, fromIso });
      setRows(r);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [officeId, fromIso]);

  useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  // Realtime: любое изменение deals/deal_legs → перезагрузка.
  useEffect(() => {
    if (!supabase) return undefined;
    const ch = supabase
      .channel("cashier-deals-ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "deal_legs" }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refetch]);

  // ── Заявки менеджера (за фиче-флагом) ──
  const [orders, setOrders] = useState([]);
  const refetchOrders = useCallback(async () => {
    if (!MANAGER_ORDERS_ENABLED) return;
    try {
      setOrders(await loadPendingOrders(officeId));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] load failed", e);
    }
  }, [officeId]);
  useEffect(() => {
    refetchOrders();
  }, [refetchOrders]);
  useEffect(() => subscribeOrders(refetchOrders), [refetchOrders]);

  // ── Инлайн-ввод ──
  const rowRef = useRef(null);
  // party — объект контрагента из пикера: { kind, clientId?, accountingCode?, name?, contact?, label } | null
  const [draft, setDraft] = useState({ party: null, at: new Date(), rate: "", in: {}, out: {}, isReq: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const partyCellRef = useRef(null);
  const provestiRef = useRef(null); // id заявки, которую «проводим» текущей строкой
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const acctFor = useCallback(
    (ccy) => accounts.find((a) => a.active && a.officeId === officeId && a.currency === ccy),
    [accounts, officeId]
  );

  const resetDraft = () => {
    provestiRef.current = null;
    setDraft({ party: null, at: new Date(), rate: "", in: {}, out: {}, isReq: false });
  };
  const partyContact = (p) => p?.contact || p?.name || p?.label || null;

  const commit = useCallback(async () => {
    if (saving) return;
    const inCcy = cols.find((c) => parseRu(draft.in[c]) > 0);
    const outCcy = cols.find((c) => parseRu(draft.out[c]) > 0);
    if (!inCcy || !outCcy) return; // нечего коммитить
    setErr("");

    // ── Сохранение как ЗАЯВКА (тоггл «⧖ заявка») — без счетов, без create_deal ──
    if (draft.isReq) {
      setSaving(true);
      try {
        await createOrder({
          officeId,
          kind: "exchange",
          contact: partyContact(draft.party),
          clientId: draft.party?.clientId || null,
          fromCurrency: inCcy,
          fromAmount: parseRu(draft.in[inCcy]),
          rate: draft.rate || null,
          toCurrency: outCcy,
          toAmount: parseRu(draft.out[outCcy]),
        });
        resetDraft();
        await refetchOrders();
      } catch (e2) {
        // eslint-disable-next-line no-console
        console.warn("[orders] create failed", e2);
        setErr(e2?.message || "Не удалось сохранить заявку");
      } finally {
        setSaving(false);
      }
      return;
    }

    const inAcc = acctFor(inCcy);
    const outAcc = acctFor(outCcy);
    if (!inAcc) return setErr(`Нет счёта ${inCcy} в этом офисе`);
    if (!outAcc) return setErr(`Нет счёта ${outCcy} в этом офисе`);

    setSaving(true);
    try {
      await createDeal({
        officeId,
        clientId: draft.party?.clientId || undefined,
        clientNickname: draft.party?.label || draft.party?.name || "cash",
        currencyIn: inCcy,
        amountIn: parseRu(draft.in[inCcy]),
        inAccountId: inAcc.id,
        outputs: [
          {
            currency: outCcy,
            amount: parseRu(draft.out[outCcy]),
            accountId: outAcc.id,
            rate: parseRu(draft.rate) || undefined,
          },
        ],
      });
      // Успех подтверждён БД. Если время изменили с «сейчас» — применяем его к
      // только что созданной сделке (она последняя в today-списке). Best-effort.
      const at = draft.at;
      if (at instanceof Date && Math.abs(at.getTime() - Date.now()) > 60000) {
        try {
          const fresh = await loadCashierDeals({ officeId, fromIso });
          const last = fresh[fresh.length - 1];
          if (last?.id != null) {
            await rpcSetDealCreatedAt({ dealId: last.id, createdAt: at.toISOString() });
          }
        } catch (e2) {
          // eslint-disable-next-line no-console
          console.warn("[deals] set created_at failed", e2);
        }
      }
      // Если этой строкой «проводили» заявку — закрываем её (идемпотентно).
      if (provestiRef.current) {
        try {
          await markDone(provestiRef.current);
        } catch (e3) {
          // eslint-disable-next-line no-console
          console.warn("[orders] markDone failed", e3);
        }
        await refetchOrders();
      }
      resetDraft();
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] create failed", e);
      setErr(e?.message || "Не удалось сохранить сделку");
    } finally {
      setSaving(false);
    }
  }, [saving, cols, draft, acctFor, officeId, fromIso, refetch, refetchOrders]);

  // Пикер контрагента: ref-флаг, чтобы blur строки не коммитил при открытии пикера.
  const pickerOpenRef = useRef(false);
  const openPicker = () => {
    pickerOpenRef.current = true;
    setPickerOpen(true);
  };
  const closePicker = () => {
    pickerOpenRef.current = false;
    setPickerOpen(false);
  };

  const onRowBlur = (e) => {
    // НЕ коммитим, если фокус ушёл в пикер (портал, role=dialog) или пикер открыт.
    if (pickerOpenRef.current) return;
    if (e.relatedTarget?.closest?.('[role="dialog"]')) return;
    if (rowRef.current && !rowRef.current.contains(e.relatedTarget)) commit();
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  const setIn = (c, v) => setDraft((d) => ({ ...d, in: { ...d.in, [c]: v } }));
  const setOut = (c, v) => setDraft((d) => ({ ...d, out: { ...d.out, [c]: v } }));

  const onSelectParty = (party) => {
    setDraft((d) => ({ ...d, party }));
    closePicker();
  };
  const onFillFromDeal = (deal) => {
    setDraft((d) => {
      const nd = { ...d, in: { ...d.in }, out: { ...d.out } };
      if (deal.fromCurrency) nd.in[deal.fromCurrency] = fmtRu(deal.fromAmount, ccyMeta(deal.fromCurrency).dp);
      if (deal.toCurrency) nd.out[deal.toCurrency] = fmtRu(deal.toAmount, ccyMeta(deal.toCurrency).dp);
      if (deal.rate != null) nd.rate = String(deal.rate);
      if (deal.party) nd.party = deal.party;
      return nd;
    });
    closePicker();
  };

  // «Клиент пришёл» — отметка времени на заявке.
  const arrived = async (order) => {
    try {
      await markArrived(order.id);
      await refetchOrders();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] arrived failed", e);
    }
  };
  // «Провести» — заполнить строку ввода из заявки; Enter → создаст сделку и
  // закроет заявку (provestiRef). Визит — без сумм, только контакт.
  const provesti = (order) => {
    provestiRef.current = order.id;
    const nd = {
      party: order.contact
        ? { kind: "contact", contact: order.contact, label: order.contact, clientId: order.clientId || undefined }
        : null,
      at: new Date(),
      rate: order.rate || "",
      in: {},
      out: {},
      isReq: false,
    };
    if (order.kind !== "visit") {
      if (order.fromCurrency) nd.in[order.fromCurrency] = fmtRu(order.fromAmount, ccyMeta(order.fromCurrency).dp);
      if (order.toCurrency) nd.out[order.toCurrency] = fmtRu(order.toAmount, ccyMeta(order.toCurrency).dp);
    }
    setDraft(nd);
  };

  const cell =
    "text-right whitespace-nowrap border-l border-[#e7e9f1] px-2.5 py-1.5 font-mono tabular-nums text-[13px]";
  const cellHas = "bg-[#e7f6ee] text-[#0b8a54] font-semibold";
  const cellEmpty = "text-[#b6bacb]";
  const inputCls =
    "w-full bg-transparent text-right font-mono tabular-nums text-[13px] outline-none placeholder:text-[#cdd1de]";

  return (
    <div className="bg-surface border border-[#e7e9f1] rounded-[16px] overflow-hidden">
      <div className="px-[18px] py-[11px] border-b border-[#e7e9f1] flex items-center justify-between gap-3">
        <span className="text-[12px] font-extrabold tracking-[1.3px] uppercase text-[#454a66]">
          Сделки за день
        </span>
        <span className="text-[11.5px] font-semibold text-muted">
          {rows.length} сделок · приход слева, расход справа
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse w-full table-fixed min-w-[1140px] select-none">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="w-[150px] text-left align-middle bg-[#f6f7fb] text-[#454a66] font-bold text-[11.5px] px-3 py-2 border-b border-[#e7e9f1]"
              >
                Контрагент
              </th>
              <th
                rowSpan={2}
                className="w-[118px] text-left align-middle bg-[#f6f7fb] text-[#454a66] font-bold text-[11.5px] px-2.5 py-2 border-b border-l border-[#e7e9f1] leading-tight"
              >
                Дата / время
              </th>
              <th
                colSpan={cols.length}
                className="text-center bg-[#159a5d] text-white font-extrabold text-[11.5px] tracking-wide px-2 py-1.5"
              >
                ПРИХОД
              </th>
              <th
                rowSpan={2}
                className="text-center align-middle bg-[#eef0f4] text-[#454a66] font-extrabold text-[11px] px-2 py-1.5 border-b border-[#e7e9f1] leading-tight"
              >
                Курс /<br />цена
              </th>
              <th
                colSpan={cols.length}
                className="text-center bg-[#e24a4f] text-white font-extrabold text-[11.5px] tracking-wide px-2 py-1.5"
              >
                РАСХОД
              </th>
            </tr>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={`in_${c}`}
                  className={`text-right text-[10.5px] font-bold text-muted tracking-wide bg-[#fbfcfe] px-2.5 py-1.5 border-b border-[#e7e9f1] ${
                    i === 0 ? "shadow-[inset_3px_0_0_#daf0e4]" : ""
                  }`}
                >
                  {c}
                </th>
              ))}
              {cols.map((c) => (
                <th
                  key={`out_${c}`}
                  className="text-right text-[10.5px] font-bold text-muted tracking-wide bg-[#fbfcfe] px-2.5 py-1.5 border-b border-[#e7e9f1] border-l"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Заявки (pending) — жёлтые строки сверху */}
            {orders.map((o) => (
              <tr key={`ord_${o.id}`} className="group bg-[#fff8e6] hover:bg-[#fff3cf]">
                <td className="bg-[#fff8e6] text-left border-t border-[#f0e2b8] px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-h-[31px]">
                    <button
                      type="button"
                      onClick={() => arrived(o)}
                      title={o.arrivedAt ? "Клиент пришёл" : "Отметить: клиент пришёл"}
                      className="shrink-0"
                    >
                      {o.arrivedAt ? (
                        <CheckCircle2 className="w-4 h-4 text-[#0b8a54]" strokeWidth={2.2} />
                      ) : (
                        <CircleDashed className="w-4 h-4 text-[#c9a14a]" strokeWidth={2.2} />
                      )}
                    </button>
                    <span className="font-mono text-[9px] font-bold text-[#9a6b00] bg-[#fde9b8] rounded-[4px] px-1 py-px shrink-0" title="заявка">
                      ⧖
                    </span>
                    <span className="text-[12px] font-bold text-ink truncate flex-1 min-w-0" title={o.contact}>
                      {o.contact || "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => provesti(o)}
                      title="Провести заявку в сделку"
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 text-[10px] font-bold text-[#0b8a54] bg-[#e7f6ee] rounded-[5px] px-1.5 py-0.5 shrink-0 transition-opacity"
                    >
                      провести
                      <ArrowRight className="w-3 h-3" strokeWidth={2.4} />
                    </button>
                  </div>
                </td>
                <td className="bg-[#fff8e6] text-left px-2.5 py-1.5 border-t border-l border-[#f0e2b8] font-mono text-[11.5px] text-[#9a6b00] whitespace-nowrap">
                  {fmtDealTime(o.createdAt)}
                </td>
                {cols.map((c) => (
                  <td
                    key={`oi_${o.id}_${c}`}
                    className={`${cell} border-t border-[#f0e2b8] ${
                      o.fromCurrency === c ? "bg-[#fde9b8] text-[#9a6b00] font-semibold" : "text-[#d9c187]"
                    }`}
                  >
                    {o.fromCurrency === c ? <Amt value={o.fromAmount} ccy={c} /> : "·"}
                  </td>
                ))}
                <td className="text-center border-l border-t border-[#f0e2b8] bg-[#fdf3d6] text-[#9a6b00] font-semibold font-mono text-[12.5px] px-2 py-1.5">
                  {o.rate || ""}
                </td>
                {cols.map((c) => (
                  <td
                    key={`oo_${o.id}_${c}`}
                    className={`${cell} border-t border-[#f0e2b8] ${
                      o.toCurrency === c ? "bg-[#fde9b8] text-[#9a6b00] font-semibold" : "text-[#d9c187]"
                    }`}
                  >
                    {o.toCurrency === c ? <Amt value={o.toAmount} ccy={c} /> : "·"}
                  </td>
                ))}
              </tr>
            ))}

            {rows.map((d) => {
              const outByCcy = {};
              d.outs.forEach((o) => {
                outByCcy[o.ccy] = (outByCcy[o.ccy] || 0) + o.amount;
              });
              return (
                <tr key={d.id} className="hover:bg-[#fafbff]">
                  <td className="bg-[#f6f7fb] text-left px-3 py-1.5 border-t border-[#e7e9f1]">
                    <span className="block text-[12.5px] font-bold text-ink truncate" title={d.party}>
                      {d.party}
                    </span>
                  </td>
                  <td className="bg-[#f6f7fb] text-left px-2.5 py-1.5 border-t border-l border-[#e7e9f1] font-mono text-[11.5px] text-[#454a66] whitespace-nowrap">
                    {fmtDealTime(d.createdAt)}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={`i_${d.id}_${c}`}
                      className={`${cell} border-t border-[#e7e9f1] ${
                        d.inCcy === c ? cellHas : cellEmpty
                      }`}
                    >
                      {d.inCcy === c ? <Amt value={d.inAmount} ccy={c} /> : ""}
                    </td>
                  ))}
                  <td className="text-center border-l border-t border-[#e7e9f1] bg-[#f7f8fb] text-[#454a66] font-semibold font-mono text-[12.5px] px-2 py-1.5">
                    {d.rate != null ? fmtRu(d.rate) : ""}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={`o_${d.id}_${c}`}
                      className={`${cell} border-t border-[#e7e9f1] ${
                        outByCcy[c] ? cellHas : cellEmpty
                      }`}
                    >
                      {outByCcy[c] ? <Amt value={outByCcy[c]} ccy={c} /> : ""}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Инлайн-ввод новой сделки */}
            <tr ref={rowRef} onBlur={onRowBlur} className={draft.isReq ? "bg-[#fff8e6]" : "bg-white"}>
              <td
                ref={partyCellRef}
                className="bg-[#f6f7fb] text-left border-t border-[#e7e9f1] p-0 align-middle"
              >
                <div className="flex items-stretch min-h-[31px]">
                  {MANAGER_ORDERS_ENABLED && (
                    <button
                      type="button"
                      title={draft.isReq ? "Заявка — снять" : "Заявка: клиент придёт позже"}
                      onClick={() => setDraft((d) => ({ ...d, isReq: !d.isReq }))}
                      className={`shrink-0 w-7 grid place-items-center border-r border-[#e7e9f1] transition-colors ${
                        draft.isReq ? "bg-[#fde9b8] text-[#9a6b00]" : "text-muted-soft hover:bg-[#f3f5ff]"
                      }`}
                    >
                      <Hourglass className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                {draft.party ? (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      openPicker();
                    }}
                    className="flex items-center gap-1.5 min-h-[31px] px-2.5 py-1 cursor-pointer hover:bg-[#f3f5ff]"
                  >
                    <span className="inline-flex items-center gap-1.5 text-[12px] min-w-0 flex-1">
                      {draft.party.kind === "cash" ? (
                        <span className="font-mono text-[10.5px] font-bold text-[#0b8a54] bg-[#e7f6ee] border border-[#daf0e4] rounded-[5px] px-1.5 py-px">
                          cash
                        </span>
                      ) : draft.party.kind === "contact" ? (
                        <span className="font-mono text-[10.5px] font-bold text-[#2f6fd0] bg-[#e8f0fd] border border-[#d6e4fb] rounded-[5px] px-1.5 py-px whitespace-nowrap">
                          {draft.party.label}
                        </span>
                      ) : draft.party.accountingCode ? (
                        <span className="font-mono text-[10.5px] font-bold text-[#586079] bg-[#ebedf4] border border-[#e0e3ee] rounded-[5px] px-1.5 py-px whitespace-nowrap">
                          {draft.party.accountingCode}
                        </span>
                      ) : null}
                      {draft.party.name && (
                        <span className="font-bold text-ink truncate">{draft.party.name}</span>
                      )}
                      {draft.party.kind === "cash" && (
                        <span className="font-bold text-ink">Наличные</span>
                      )}
                    </span>
                    <span
                      role="button"
                      title="Очистить"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDraft((d) => ({ ...d, party: null }));
                      }}
                      className="ml-auto text-[#b6bacb] hover:text-[#cf3b40] text-[12px] px-0.5 shrink-0"
                    >
                      ✕
                    </span>
                  </div>
                ) : (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      openPicker();
                    }}
                    className="flex items-center min-h-[31px] px-2.5 py-1 cursor-pointer hover:bg-[#f3f5ff]"
                  >
                    <span className="text-[#b6bacb] text-[12px]">контрагент</span>
                  </div>
                )}
                  </div>
                </div>
              </td>
              <td className="bg-[#f6f7fb] text-left border-t border-l border-[#e7e9f1] p-0 align-middle">
                <DealTimeField
                  value={draft.at}
                  onChange={(at) => setDraft((d) => ({ ...d, at }))}
                />
              </td>
              {cols.map((c) => {
                const v = draft.in[c] || "";
                return (
                  <td
                    key={`ein_${c}`}
                    className={`${cell.replace("font-mono", "")} border-t border-[#e7e9f1] ${
                      parseRu(v) > 0 ? "bg-[#e7f6ee]" : ""
                    }`}
                  >
                    <input
                      value={v}
                      onChange={(e) => setIn(c, e.target.value.replace(/[^\d\s.,]/g, ""))}
                      onKeyDown={onKeyDown}
                      inputMode="decimal"
                      placeholder="·"
                      className={`${inputCls} ${parseRu(v) > 0 ? "text-[#0b8a54] font-semibold" : ""}`}
                    />
                  </td>
                );
              })}
              <td className="text-center border-l border-t border-[#e7e9f1] bg-[#f7f8fb] px-2 py-1.5">
                <input
                  value={draft.rate}
                  onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value.replace(/[^\d.,]/g, "") }))}
                  onKeyDown={onKeyDown}
                  inputMode="decimal"
                  placeholder="курс"
                  className="w-full bg-transparent text-center font-mono text-[12.5px] text-[#454a66] outline-none placeholder:text-[#cdd1de]"
                />
              </td>
              {cols.map((c) => {
                const v = draft.out[c] || "";
                return (
                  <td
                    key={`eout_${c}`}
                    className={`${cell.replace("font-mono", "")} border-t border-[#e7e9f1] ${
                      parseRu(v) > 0 ? "bg-[#e7f6ee]" : ""
                    }`}
                  >
                    <input
                      value={v}
                      onChange={(e) => setOut(c, e.target.value.replace(/[^\d\s.,]/g, ""))}
                      onKeyDown={onKeyDown}
                      inputMode="decimal"
                      placeholder="·"
                      className={`${inputCls} ${parseRu(v) > 0 ? "text-[#0b8a54] font-semibold" : ""}`}
                    />
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-[18px] py-2 flex items-center gap-3 min-h-[34px]">
        {err ? (
          <span className="text-[11.5px] font-semibold text-[#cf3b40]">⚠ {err}</span>
        ) : saving ? (
          <span className="text-[11.5px] font-semibold text-muted">Сохранение…</span>
        ) : (
          <span className="text-[11px] text-muted">
            Впишите суммы в ячейки прихода и расхода + курс, затем Enter — сделка сохранится
          </span>
        )}
      </div>

      {pickerOpen && (
        <CounterpartyPicker
          anchorEl={partyCellRef.current}
          onClose={closePicker}
          onSelect={onSelectParty}
          onFillFromDeal={onFillFromDeal}
        />
      )}
    </div>
  );
}
