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
import { useOffices } from "../../../store/offices.jsx";
import { useRates } from "../../../store/rates.jsx";
import { convert } from "../../../utils/convert.js";
import { createDeal } from "../../../lib/dealOperations.js";
import { BAL_COLUMNS, ccyMeta, fmtRu, splitParts } from "../../balances/currencyMeta.js";
import CounterpartyPicker from "./CounterpartyPicker.jsx";
import DealTimeField from "./DealTimeField.jsx";
import {
  rpcReverseTransactionV2,
  rpcCompleteDealLegV2,
  rpcCreateTopupV2,
  rpcCreateWithdrawalV2,
  rpcVoidDeal,
} from "../../../lib/newLedger.js";
import { resolveAccountCode } from "../../../lib/newLedgerAdapter.js";
import {
  MANAGER_ORDERS_ENABLED,
  loadPendingOrders,
  createOrder,
  setArrived,
  cancelOrder,
  subscribeOrders,
} from "../../../lib/managerOrders.js";
import { Hourglass, CircleDashed, CheckCircle2, Eye, Trash2, CalendarClock } from "lucide-react";
import OrderDetailsModal from "./OrderDetailsModal.jsx";
import DeferredDealModal from "./DeferredDealModal.jsx";

function fmtDealTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function fmtDue(s) {
  if (!s) return "";
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  const v = Number(value) || 0;
  const abs = Math.abs(v);
  const full = fmtRu(value, ccyMeta(ccy).dp);
  // От миллиона — сокращаем (млн/млрд), чтобы влезало ОДНИМ шрифтом. Точное — в тултипе.
  if (abs >= 1e6) {
    const div = abs >= 1e9 ? 1e9 : 1e6;
    const suf = abs >= 1e9 ? "млрд" : "млн";
    const n = v / div;
    const dp = abs / div < 10 ? 2 : abs / div < 100 ? 1 : 0;
    const num = n.toLocaleString("ru-RU", { maximumFractionDigits: dp });
    return (
      <span title={`${full} ${ccy}`}>
        {num}
        <span className="opacity-60 ml-[2px] text-[0.8em]">{suf}</span>
      </span>
    );
  }
  const { int, dec } = splitParts(full);
  // Прячем нулевые десятичные («12 000,00» → «12 000»), значащие оставляем («,50»).
  const showDec = dec && !/^,0*$/.test(dec);
  return (
    <span title={`${full} ${ccy}`}>
      {int}
      {showDec && <span className="opacity-[0.42]">{dec}</span>}
    </span>
  );
}

function fmtAmt(n, ccy) {
  const dp = ccyMeta(ccy)?.dp ?? 2;
  return Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function fmtRate(r) {
  const a = Math.abs(Number(r) || 0);
  const dp = a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return Number(r).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export default function DealsLedger({ officeId }) {
  const { accounts } = useAccounts();
  const { getRate } = useRates();
  const { activeOffices } = useOffices();

  // Наличные → cash-клиент офиса (v2-сделка требует client_id). Совпадение по
  // первому слову названия офиса: «Mark Antalya» → «Mark Cash».
  const resolveCashClient = useCallback(async () => {
    const off = activeOffices.find((o) => o.id === officeId);
    const token = String(off?.name || "").split(/\s+/)[0];
    if (!token) return null;
    const { data } = await supabase
      .from("clients")
      .select("id")
      .ilike("nickname", `${token}%Cash%`)
      .limit(1);
    return data?.[0]?.id || null;
  }, [activeOffices, officeId]);
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

  // Realtime: сделки v2 в ledger.transactions/journal_entries → перезагрузка.
  useEffect(() => {
    if (!supabase) return undefined;
    const ch = supabase
      .channel("cashier-deals-ledger")
      .on("postgres_changes", { event: "*", schema: "ledger", table: "transactions" }, refetch)
      .on("postgres_changes", { event: "*", schema: "ledger", table: "journal_entries" }, refetch)
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
  const [detailOrder, setDetailOrder] = useState(null); // заявка для модалки деталей
  const [deferredOpen, setDeferredOpen] = useState(false); // модалка отложенной сделки
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const acctFor = useCallback(
    (ccy) => accounts.find((a) => a.active && a.officeId === officeId && a.currency === ccy),
    [accounts, officeId]
  );

  const resetDraft = () => {
    setDraft({ party: null, at: new Date(), rate: "", in: {}, out: {}, isReq: false });
  };
  const partyContact = (p) => p?.contact || p?.name || p?.label || null;

  const commit = useCallback(async (allowOneLeg = false) => {
    if (saving) return;
    const inCcy = cols.find((c) => parseRu(draft.in[c]) > 0);
    const outCcys = cols.filter((c) => parseRu(draft.out[c]) > 0); // мульти-расход
    const outCcy = outCcys[0];
    if (!inCcy || outCcys.length === 0) {
      // Одна нога (не заявка) + Enter → одноногая сделка-долг: сначала контрагент,
      // потом направление/дата/коммент в модалке. Пустая строка — просто выходим.
      if (allowOneLeg && !draft.isReq && (inCcy || outCcys.length > 0)) {
        if (!draft.party?.clientId) {
          setErr("Одна нога — это сделка в долг. Выберите контрагента (не «Наличные»).");
          setPickerOpen(true);
        } else {
          setErr("");
          setDeferredOpen(true);
        }
      }
      return;
    }
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

    // Сделка проводится сразу (create_deal_v2). Подтверждает бухгалтер у себя
    // (Казначейство → «Подтвердить»), касса отражает зелёным. Наличные → cash-клиент офиса.
    const inAcc = acctFor(inCcy);
    if (!inAcc) return setErr(`Нет счёта ${inCcy} в этом офисе`);
    // Несколько ног расхода (сплит). Курс берём из поля только при ОДНОЙ ноге,
    // иначе — рыночный по каждой паре.
    const single = outCcys.length === 1;
    const outputs = [];
    for (const oc of outCcys) {
      const oa = acctFor(oc);
      if (!oa) return setErr(`Нет счёта ${oc} в этом офисе`);
      outputs.push({
        currency: oc,
        amount: parseRu(draft.out[oc]),
        accountId: oa.id,
        rate: single ? parseRu(draft.rate) || undefined : convert(1, inCcy, oc, getRate) || undefined,
      });
    }
    let clientId = draft.party?.clientId || null;
    if (!clientId) {
      clientId = await resolveCashClient();
      if (!clientId) return setErr("Нет cash-клиента офиса (напр. «Mark Cash») — выберите контрагента");
    }
    setSaving(true);
    try {
      await createDeal({
        officeId,
        clientId,
        clientNickname: draft.party?.label || draft.party?.name || "cash",
        currencyIn: inCcy,
        amountIn: parseRu(draft.in[inCcy]),
        inAccountId: inAcc.id,
        effectiveDate: draft.at instanceof Date ? draft.at.toISOString() : undefined,
        outputs,
      });
      resetDraft();
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] create failed", e);
      setErr(e?.message || "Не удалось сохранить сделку");
    } finally {
      setSaving(false);
    }
  }, [saving, cols, draft, acctFor, officeId, refetch, refetchOrders, resolveCashClient, getRate]);

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
      commit(true); // Enter разрешает одноногую сделку-долг
    }
  };

  // ── Авто-калькуляция прихода/курса/расхода ──
  // Приход (in) — якорь. Клик по ячейке расхода → авто-курс (рыночный) + сумма.
  // Правка курса → пересчёт расхода. Правка расхода → пересчёт курса (курс менеджера).
  const inLeg = (d) => {
    const c = cols.find((x) => parseRu(d.in[x]) > 0);
    return c ? { ccy: c, amt: parseRu(d.in[c]) } : null;
  };
  const outCcysOf = (d) => cols.filter((x) => parseRu(d.out[x]) > 0);
  // Сумма уже заполненных расходов, переведённая в валюту прихода (кроме exceptCcy).
  const filledOutInIn = (d, inCcy, exceptCcy) =>
    cols.reduce((sum, c) => {
      if (c === exceptCcy) return sum;
      const amt = parseRu(d.out[c]);
      return amt > 0 ? sum + (convert(amt, c, inCcy, getRate) || 0) : sum;
    }, 0);
  // Остаток прихода, ещё не распределённый по расходам (для авто-«досыпки» и индикатора).
  const remainingIn = (d) => {
    const leg = inLeg(d);
    if (!leg) return 0;
    return leg.amt - filledOutInIn(d, leg.ccy, null);
  };

  const setIn = (c, v) =>
    setDraft((d) => {
      const next = { ...d, in: { [c]: v } }; // приход — единственная нога (якорь)
      // курс осмыслен только при ОДНОЙ ноге расхода → пересчитать её
      const inAmt = parseRu(v);
      const outCs = outCcysOf(next);
      const rateN = parseRu(next.rate);
      if (inAmt > 0 && outCs.length === 1 && rateN > 0) {
        next.out = { ...next.out, [outCs[0]]: fmtAmt(inAmt * rateN, outCs[0]) };
      }
      return next;
    });

  // Клик по ячейке расхода: досыпать ОСТАТОК прихода в эту валюту (рыночный курс).
  // Так работает сплит: задал конкретную сумму в одной валюте → клик по другой
  // досыпает остаток. Ячейку с уже введённой суммой не трогаем.
  const focusOut = (c) =>
    setDraft((d) => {
      const leg = inLeg(d);
      if (!leg || leg.amt <= 0) return d;
      if (parseRu(d.out[c]) > 0) return d;
      const remaining = leg.amt - filledOutInIn(d, leg.ccy, c);
      if (remaining <= 1e-9) return d; // распределять нечего
      const outAmt = convert(remaining, leg.ccy, c, getRate);
      if (!outAmt || !Number.isFinite(outAmt)) return d;
      const next = { ...d, out: { ...d.out, [c]: fmtAmt(outAmt, c) } }; // ДОБАВЛЯЕМ ногу
      // курс показываем только если расход в одной валюте
      if (outCcysOf(next).length === 1) next.rate = fmtRate(outAmt / leg.amt);
      return next;
    });

  const setRate = (v) =>
    setDraft((d) => {
      const next = { ...d, rate: v };
      const leg = inLeg(d);
      const outCs = outCcysOf(d);
      const rateN = parseRu(v);
      // курс правит сумму расхода только когда расход в ОДНОЙ валюте
      if (leg && leg.amt > 0 && outCs.length === 1 && rateN > 0) {
        next.out = { ...next.out, [outCs[0]]: fmtAmt(leg.amt * rateN, outCs[0]) };
      }
      return next;
    });

  const setOut = (c, v) =>
    setDraft((d) => {
      const next = { ...d, out: { ...d.out, [c]: v } }; // мульти-расход: правим/добавляем ногу
      // курс пересчитываем из приход/расход только при ОДНОЙ ноге расхода
      const leg = inLeg(d);
      const outCs = outCcysOf(next);
      const outAmt = parseRu(v);
      if (leg && leg.amt > 0 && outCs.length === 1 && outAmt > 0) {
        next.rate = fmtRate(outAmt / leg.amt);
      }
      return next;
    });

  const onSelectParty = (party) => {
    setDraft((d) => ({ ...d, party }));
    closePicker();
    // Если уже введена ОДНА нога и выбрали контрагента — сразу к оформлению долга.
    const inCcy = cols.find((c) => parseRu(draft.in[c]) > 0);
    const outCcy = cols.find((c) => parseRu(draft.out[c]) > 0);
    if (!!inCcy !== !!outCcy && party?.clientId && !draft.isReq) {
      setErr("");
      setDeferredOpen(true);
    }
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

  // «Клиент пришёл» — переключаемая отметка (вкл/выкл). Менеджер сам проставил
  // суммы в строке заявки → этого достаточно; «провести» не нужно (бухгалтер
  // увидит незаполненное).
  const toggleArrived = async (order) => {
    try {
      await setArrived(order.id, !order.arrivedAt);
      await refetchOrders();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] arrived toggle failed", e);
    }
  };

  // Удаление сделки = сторно (обратная проводка). Если уже подтверждена бухгалтером
  // — предупреждаем об этом отдельно.
  const deleteDeal = async (d) => {
    setErr("");
    const oneLeg = !!d.deferred?.oneLeg;
    try {
      if (d.confirmed) {
        // Подтверждена бухгалтером → проводки сверены → только СТОРНО.
        if (
          !window.confirm(
            "Сделку уже подтвердил бухгалтер — при удалении будет создано СТОРНО (обратная проводка). Продолжить?"
          )
        )
          return;
        await rpcReverseTransactionV2({ targetTxId: d.id, reason: "Отмена сделки из кассы", cascade: true });
      } else if (oneLeg) {
        // Одноногая (topup/withdrawal) — физического void пока нет → сторно.
        if (!window.confirm("Удалить долг? Будет создано сторно (обратная проводка).")) return;
        await rpcReverseTransactionV2({ targetTxId: d.id, reason: "Отмена из кассы", cascade: true });
      } else {
        // Непроведённая сделка → физическое удаление БЕЗ сторно.
        if (!window.confirm("Удалить сделку? Бухгалтер ещё не провёл — удалится без сторно.")) return;
        await rpcVoidDeal(d.id);
      }
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] delete failed", e);
      window.alert(`Не удалось удалить сделку:\n${e?.message || e}`);
    }
  };

  // Закрытие долга: «мы должны» (out) → complete_deal_leg (выдаём ногу расхода);
  // «клиент должен» (in) → create_topup (клиент доносит приход на наш счёт).
  const settleDeferred = async (d) => {
    const def = d.deferred;
    if (!def) return;
    const acc = acctFor(def.currency);
    if (!acc) return window.alert(`Нет счёта ${def.currency} в этом офисе для закрытия`);
    const human =
      def.side === "in"
        ? `Закрыть долг: клиент донёс ${fmtRu(def.amount)} ${def.currency}?`
        : `Закрыть долг: мы выдаём ${fmtRu(def.amount)} ${def.currency}?`;
    if (!window.confirm(human)) return;
    try {
      const accountCode = await resolveAccountCode(acc.id);
      if (def.oneLeg) {
        // Одноногая: закрытие = ПРОТИВОПОЛОЖНЫЙ примитив, гасит баланс клиента.
        if (!d.clientId) return window.alert("Нет контрагента для закрытия (client_id)");
        if (def.side === "out") {
          // мы должны (был topup) → выдаём (withdrawal)
          await rpcCreateWithdrawalV2({
            clientId: d.clientId,
            currencyCode: def.currency,
            amount: def.amount,
            destinationAccount: accountCode,
            description: "Закрытие долга: выдали клиенту",
          });
        } else {
          // клиент должен (был withdrawal) → клиент доносит (topup)
          await rpcCreateTopupV2({
            clientId: d.clientId,
            accountCode,
            amount: def.amount,
            currencyCode: def.currency,
            description: "Закрытие долга: клиент донёс",
          });
        }
      } else if (def.side === "out") {
        await rpcCompleteDealLegV2({
          dealId: d.id,
          currencyCode: def.currency,
          amount: def.amount,
          accountCode,
        });
      } else {
        if (!d.clientId) return window.alert("Нет контрагента для закрытия (client_id)");
        await rpcCreateTopupV2({
          clientId: d.clientId,
          accountCode,
          amount: def.amount,
          currencyCode: def.currency,
          description: "Закрытие долга: клиент донёс приход",
        });
      }
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] settle failed", e);
      window.alert(`Не удалось закрыть долг:\n${e?.message || e}`);
    }
  };

  // ── Отложенная сделка (долг) ──
  const deferredSummary = () => {
    const inCcy = cols.find((c) => parseRu(draft.in[c]) > 0);
    const outCcy = cols.find((c) => parseRu(draft.out[c]) > 0);
    return {
      inCcy,
      outCcy,
      inAmount: inCcy ? parseRu(draft.in[inCcy]) : 0,
      outAmount: outCcy ? parseRu(draft.out[outCcy]) : 0,
      party: draft.party?.label || draft.party?.name || null,
    };
  };
  const openDeferred = () => {
    setErr("");
    const s = deferredSummary();
    if (!s.inCcy && !s.outCcy) return setErr("Впишите сумму прихода или расхода");
    if (!draft.party?.clientId) return setErr("Долг — только с контрагентом (не «Наличные»)");
    setDeferredOpen(true);
  };
  const commitDeferred = async ({ side, dueDate, comment }) => {
    const s = deferredSummary();
    const clientId = draft.party?.clientId;
    const oneLegged = !(s.inCcy && s.outCcy);

    // ── ОДНОНОГАЯ: только приход (клиент занёс → мы должны, topup) ИЛИ только
    //    расход (мы выдали → клиент должен, withdrawal). ──
    if (oneLegged) {
      const isIn = !!s.inCcy;
      const ccy = isIn ? s.inCcy : s.outCcy;
      const amt = isIn ? s.inAmount : s.outAmount;
      const acc = acctFor(ccy);
      setSaving(true);
      try {
        if (!acc) throw new Error(`Нет счёта ${ccy} в этом офисе`);
        const accountCode = await resolveAccountCode(acc.id);
        const meta = {
          cashier_one_leg: true,
          deferred_side: isIn ? "out" : "in", // out = мы должны, in = клиент должен
          deferred_currency: ccy,
          deferred_amount: amt,
          phys_side: isIn ? "in" : "out",
          due_date: dueDate,
          obligation_comment: comment,
          client_id: clientId,
          client_nickname: draft.party?.label || draft.party?.name || "—",
          office_id: officeId,
        };
        if (isIn) {
          await rpcCreateTopupV2({ clientId, accountCode, amount: amt, currencyCode: ccy, description: comment, metadata: meta });
        } else {
          await rpcCreateWithdrawalV2({ clientId, currencyCode: ccy, amount: amt, destinationAccount: accountCode, description: comment, metadata: meta });
        }
        setDeferredOpen(false);
        resetDraft();
        await refetch();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[deals] one-leg create failed", e);
        window.alert(`Не удалось сохранить долг:\n${e?.message || e}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    const inAcc = acctFor(s.inCcy);
    const outAcc = acctFor(s.outCcy);
    const base = {
      officeId,
      clientId,
      clientNickname: draft.party?.label || draft.party?.name || "—",
      currencyIn: s.inCcy,
      amountIn: s.inAmount,
      effectiveDate: draft.at instanceof Date ? draft.at.toISOString() : undefined,
      comment,
      obligationComment: comment,
      plannedAt: dueDate,
      dueDate,
      deferredSide: side,
      deferredCurrency: side === "in" ? s.inCcy : s.outCcy,
      deferredAmount: side === "in" ? s.inAmount : s.outAmount,
    };
    setSaving(true);
    try {
      if (side === "in") {
        // Клиент должен нам: приход отложен (со счёта клиента), расход выдаём сейчас.
        if (!outAcc) throw new Error(`Нет счёта ${s.outCcy} в этом офисе`);
        await createDeal({
          ...base,
          deferredIn: true,
          outputs: [{ currency: s.outCcy, amount: s.outAmount, accountId: outAcc.id, rate: parseRu(draft.rate) || undefined }],
        });
      } else {
        // Мы должны клиенту: приход получаем сейчас, расход отложен (payNow:0).
        if (!inAcc) throw new Error(`Нет счёта ${s.inCcy} в этом офисе`);
        if (!outAcc) throw new Error(`Нет счёта ${s.outCcy} в этом офисе`);
        await createDeal({
          ...base,
          inAccountId: inAcc.id,
          outputs: [{ currency: s.outCcy, amount: s.outAmount, accountId: outAcc.id, rate: parseRu(draft.rate) || undefined, payNow: 0 }],
        });
      }
      setDeferredOpen(false);
      resetDraft();
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] deferred create failed", e);
      window.alert(`Не удалось сохранить долг:\n${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteOrder = async (o) => {
    if (!window.confirm("Удалить заявку?")) return;
    try {
      await cancelOrder(o.id);
      await refetchOrders();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] delete failed", e);
    }
  };

  // Всё содержимое валютных ячеек — ПО ЦЕНТРУ (и числа, и точки, и ввод), чтобы
  // позиция не «прыгала» между заполненными и пустыми ячейками/строками.
  const cell =
    "text-center whitespace-nowrap border-l border-[#e7e9f1] px-1.5 py-1.5 font-mono tabular-nums text-[13px]";
  const cellHas = "bg-[#e7f6ee] text-[#0b8a54] font-semibold";
  const cellEmpty = "text-[#b6bacb]";
  const dot = <span className="text-[#cbd0dd]">·</span>;
  const inputCls =
    "w-full bg-transparent text-center font-mono tabular-nums text-[13px] outline-none placeholder:text-[#cbd0dd] select-text";
  const inAlign = (v) => (parseRu(v) > 0 ? "text-[#0b8a54] font-semibold" : "");

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
        <table className="border-collapse w-full table-fixed min-w-[1090px] select-none">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="w-[32px] text-center align-middle bg-[#f6f7fb] text-[#8d92a8] font-bold text-[10px] px-1 py-2 border-b border-[#e7e9f1]"
              >
                №
              </th>
              <th
                rowSpan={2}
                className="w-[150px] text-left align-middle bg-[#f6f7fb] text-[#454a66] font-bold text-[11.5px] px-3 py-2 border-b border-[#e7e9f1]"
              >
                Контрагент
              </th>
              <th
                rowSpan={2}
                className="w-[58px] text-center align-middle bg-[#f6f7fb] text-[#454a66] font-bold text-[10.5px] px-1.5 py-2 border-b border-l border-[#e7e9f1] leading-tight"
              >
                Время
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
            {orders.map((o, oi) => (
              <tr key={`ord_${o.id}`} className="group bg-[#fff8e6] hover:bg-[#fff3cf]">
                <td className="bg-[#fff8e6] text-center border-t border-[#f0e2b8] font-mono text-[11px] font-bold text-[#b8923a] px-1 py-1.5">
                  {oi + 1}
                </td>
                <td className="bg-[#fff8e6] text-left border-t border-[#f0e2b8] px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-h-[31px]">
                    <button
                      type="button"
                      onClick={() => toggleArrived(o)}
                      title={o.arrivedAt ? "Пришёл — снять отметку" : "Отметить: клиент пришёл"}
                      className="shrink-0"
                    >
                      {o.arrivedAt ? (
                        <CheckCircle2 className="w-[18px] h-[18px] text-[#0b8a54]" strokeWidth={2.2} />
                      ) : (
                        <CircleDashed className="w-[18px] h-[18px] text-[#c9a14a] hover:text-[#0b8a54]" strokeWidth={2.2} />
                      )}
                    </button>
                    <Hourglass className="w-3 h-3 text-[#c9a14a] shrink-0" strokeWidth={2.2} />
                    <span className="flex flex-col min-w-0 flex-1 leading-tight">
                      <span className="text-[12px] font-bold text-ink truncate" title={o.contact}>
                        {o.contact || "—"}
                      </span>
                      <span className="text-[9.5px] font-mono text-[#b8923a] truncate">
                        {o.meetingCode ? `№ ${o.meetingCode}` : "заявка"}
                        {o.meetingAt ? ` · к ${fmtDealTime(o.meetingAt)}` : ""}
                        {o.note ? ` · ${o.note}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetailOrder(o)}
                      title="Открыть и править заявку"
                      className="shrink-0 text-[#b8923a] hover:text-[#9a6b00] p-0.5"
                    >
                      <Eye className="w-[15px] h-[15px]" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteOrder(o)}
                      title="Удалить заявку"
                      className="shrink-0 p-0.5 text-[#cf3b40]/55 hover:text-[#cf3b40] hidden group-hover:inline-flex"
                    >
                      <Trash2 className="w-[14px] h-[14px]" strokeWidth={2} />
                    </button>
                  </div>
                </td>
                <td className="bg-[#fff8e6] text-center px-1.5 py-1.5 border-t border-l border-[#f0e2b8] font-mono text-[11.5px] text-[#9a6b00] whitespace-nowrap">
                  {fmtDealTime(o.createdAt)}
                </td>
                {cols.map((c) => (
                  <td
                    key={`oi_${o.id}_${c}`}
                    className={`${cell} border-t border-[#f0e2b8] ${
                      o.fromCurrency === c ? "bg-[#fde9b8] text-[#9a6b00] font-semibold" : "text-[#d9c187]"
                    }`}
                  >
                    {o.fromCurrency === c ? <Amt value={o.fromAmount} ccy={c} /> : dot}
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
                    {o.toCurrency === c ? <Amt value={o.toAmount} ccy={c} /> : dot}
                  </td>
                ))}
              </tr>
            ))}

            {rows.map((d, di) => {
              const outByCcy = {};
              d.outs.forEach((o) => {
                outByCcy[o.ccy] = (outByCcy[o.ccy] || 0) + o.amount;
              });
              const filled = d.confirmed ? cellHas : "bg-[#eef1f7] text-[#3a4a6b] font-semibold";
              return (
                <tr key={d.id} className="group hover:bg-[#fafbff]">
                  <td className="bg-[#f6f7fb] text-center border-t border-[#e7e9f1] font-mono text-[11px] font-bold text-[#b6bacb] px-1 py-1.5">
                    {orders.length + di + 1}
                  </td>
                  <td className="bg-[#f6f7fb] text-left px-3 py-1.5 border-t border-[#e7e9f1]">
                    <div className="flex items-center gap-1.5">
                      <span className="flex flex-col min-w-0 flex-1 leading-tight">
                        <span className="text-[12.5px] font-bold text-ink truncate" title={d.party}>
                          {d.party}
                        </span>
                        {d.deferred ? (
                          d.deferred.open ? (
                            <span className="text-[9.5px] font-bold text-[#b8923a] truncate" title={d.deferred.comment || ""}>
                              ⏳ {d.deferred.side === "in" ? "клиент должен" : "мы должны"} {fmtRu(d.deferred.amount)}{" "}
                              {d.deferred.currency}
                              {d.deferred.dueDate ? ` · до ${fmtDue(d.deferred.dueDate)}` : ""}
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-[#0b8a54]">
                              ✓ долг закрыт
                            </span>
                          )
                        ) : !d.confirmed ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-[#8d92a8]">
                            не подтв.
                          </span>
                        ) : null}
                      </span>
                      {d.deferred?.open && (
                        <button
                          type="button"
                          onClick={() => settleDeferred(d)}
                          title="Закрыть долг (рассчитались)"
                          className="shrink-0 inline-flex items-center text-[10px] font-bold text-[#0b8a54] bg-[#e7f6ee] rounded-[5px] px-1.5 py-0.5 hover:bg-[#d6f0e0]"
                        >
                          закрыть
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteDeal(d)}
                        title="Удалить сделку (сторно)"
                        className="shrink-0 p-0.5 text-[#cf3b40]/55 hover:text-[#cf3b40] hidden group-hover:inline-flex"
                      >
                        <Trash2 className="w-[14px] h-[14px]" strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                  <td className="bg-[#f6f7fb] text-center px-1.5 py-1.5 border-t border-l border-[#e7e9f1] font-mono text-[11.5px] text-[#454a66] whitespace-nowrap">
                    {fmtDealTime(d.createdAt)}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={`i_${d.id}_${c}`}
                      className={`${cell} border-t border-[#e7e9f1] ${
                        d.inCcy === c ? filled : cellEmpty
                      }`}
                    >
                      {d.inCcy === c ? <Amt value={d.inAmount} ccy={c} /> : dot}
                    </td>
                  ))}
                  <td className="text-center border-l border-t border-[#e7e9f1] bg-[#f7f8fb] text-[#454a66] font-semibold font-mono text-[12.5px] px-2 py-1.5">
                    {d.rate != null ? fmtRu(d.rate) : ""}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={`o_${d.id}_${c}`}
                      className={`${cell} border-t border-[#e7e9f1] ${
                        outByCcy[c] ? filled : cellEmpty
                      }`}
                    >
                      {outByCcy[c] ? <Amt value={outByCcy[c]} ccy={c} /> : dot}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Инлайн-ввод новой сделки */}
            <tr ref={rowRef} onBlur={onRowBlur} className={draft.isReq ? "bg-[#fff8e6]" : "bg-white"}>
              <td className={`text-center border-t border-[#e7e9f1] text-[#cdd1de] text-[13px] ${draft.isReq ? "bg-[#fff8e6]" : "bg-[#f6f7fb]"}`}>
                +
              </td>
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
                  <button
                    type="button"
                    title="Отложенная сделка (долг) — клиент/мы отдаём позже с датой"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      openDeferred();
                    }}
                    className="shrink-0 w-7 grid place-items-center border-r border-[#e7e9f1] text-muted-soft hover:bg-[#f3f5ff] hover:text-[#c9a14a] transition-colors"
                  >
                    <CalendarClock className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
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
                        <span className="font-bold text-[12px] text-[#0b8a54]">Наличные</span>
                      ) : draft.party.kind === "contact" ? (
                        <span className="font-semibold text-[12px] text-[#2f6fd0] truncate min-w-0">
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
                      className={`${inputCls} ${inAlign(v)}`}
                    />
                  </td>
                );
              })}
              <td className="text-center border-l border-t border-[#e7e9f1] bg-[#f7f8fb] px-2 py-1.5">
                <input
                  value={draft.rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ""))}
                  onKeyDown={onKeyDown}
                  inputMode="decimal"
                  placeholder="курс"
                  className="w-full bg-transparent text-center font-mono text-[12.5px] text-[#454a66] outline-none placeholder:text-[#cdd1de] select-text"
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
                      onFocus={() => focusOut(c)}
                      onKeyDown={onKeyDown}
                      inputMode="decimal"
                      placeholder="·"
                      className={`${inputCls} ${inAlign(v)}`}
                    />
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-[18px] py-2 flex items-center gap-3 min-h-[34px]">
        {(() => {
          const inC = cols.find((c) => parseRu(draft.in[c]) > 0);
          const rem = inC ? remainingIn(draft) : 0;
          const hasOut = outCcysOf(draft).length > 0;
          if (inC && hasOut && Math.abs(rem) > 0.5) {
            return (
              <span className="text-[11.5px] font-bold text-[#b8923a]">
                Остаток к распределению: {fmtRu(rem)} {inC} — кликни по валюте расхода, чтобы досыпать
              </span>
            );
          }
          return null;
        })()}
        {err ? (
          <span className="text-[11.5px] font-semibold text-[#cf3b40]">⚠ {err}</span>
        ) : saving ? (
          <span className="text-[11.5px] font-semibold text-muted">Сохранение…</span>
        ) : (
          <span className="text-[11px] text-muted">
            {draft.isReq
              ? "Режим заявки (⧖): впишите суммы + контрагента, затем Enter — заявка сохранится (потом можно править)"
              : "Приход → задай суммы расхода (можно НЕСКОЛЬКО валют — клик по валюте досыпает остаток) → Enter. Одна нога = долг"}
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

      {detailOrder && (
        <OrderDetailsModal
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onRefetch={refetchOrders}
        />
      )}

      {deferredOpen && (
        <DeferredDealModal
          summary={deferredSummary()}
          onClose={() => {
            setDeferredOpen(false);
            resetDraft(); // чистый выход — не оставляем долг-черновик в строке
          }}
          onConfirm={commitDeferred}
        />
      )}
    </div>
  );
}
