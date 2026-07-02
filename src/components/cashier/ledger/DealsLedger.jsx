// src/components/cashier/ledger/DealsLedger.jsx
// Зона C — «Сделки за день», компактный блоттер (по эталону deals-ledger.html).
// Колонки: № | Дата·время | Контрагент | Приход (сумма+валюта) | Курс |
//          Расход (сумма+валюта) | Статус.
// Заявки (manager_orders, pending) — амбер-строки в секции «Заявки · N ожидают»
// над секцией «Сделки»; «Принять» = onOrderToDeal (форма «Новая сделка»).
// Клиентские сортировка (по заголовкам + по коду валюты) и поиск — по
// загруженным строкам (день грузится целиком, пагинации нет).
//
// СОЗДАНИЕ сделок больше НЕ здесь — через кнопку «Новая сделка» (takeover-форма).
// Данные/поля/расчёты/приём заявок не менялись — только презентация + сорт/поиск.
//
// ПРОБЕЛЫ (данных в ридере нет — по ТЗ не фабрикуем):
//   • Профит на сделку не считается (аудит: заглушка 0.01) → колонка «Профит» и
//     P&L в подвале СКРЫТЫ. Бэклог: расчёт профита на бэке.
//   • Человекочитаемого № сделки нет (только uuid) → показываем порядковый (по
//     хронологии загрузки, стабилен в рамках дня). Бэклог: настоящий № на бэке.
//   • Мульти-OUT (outs[] с несколькими валютами) → показываем крупнейшую ногу +
//     бейдж «＋N» (полный сплит виден по наведению).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase.js";
import { loadCashierDeals } from "../../../lib/cashierDealsReader.js";
import { useAccounts } from "../../../store/accounts.jsx";
import {
  rpcReverseTransactionV2,
  rpcCompleteDealLegV2,
  rpcCreateTopupV2,
  rpcCreateWithdrawalV2,
  rpcVoidDeal,
} from "../../../lib/newLedger.js";
import { resolveAccountCode } from "../../../lib/newLedgerAdapter.js";
import { ccyMeta, fmtRu } from "../../balances/currencyMeta.js";
import {
  MANAGER_ORDERS_ENABLED,
  loadPendingOrders,
  setArrived,
  cancelOrder,
  subscribeOrders,
} from "../../../lib/managerOrders.js";
import OrderDetailsModal from "./OrderDetailsModal.jsx";
import { CheckCircle2, CircleDashed, Eye, Trash2, PlayCircle, Search } from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────
function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtDue(s) {
  if (!s) return "";
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Число с приглушёнными хвостовыми нулями после запятой (как в эталоне).
function Money({ amount, ccy }) {
  const dp = ccyMeta(ccy)?.dp ?? 2;
  const s = fmtRu(amount, dp);
  const m = s.match(/^(.*?)(,\d*?)(0+)$/);
  if (m) {
    return (
      <>
        {m[1] + m[2]}
        <span className="text-[color:var(--faint2)]">{m[3]}</span>
      </>
    );
  }
  return <>{s}</>;
}

// Статус-мета сделки: текст + вес для сортировки.
function dealStatus(d) {
  if (d.deferred) {
    if (d.deferred.open) {
      return {
        rank: 0,
        text: `${d.deferred.side === "in" ? "клиент должен" : "мы должны"} ${fmtRu(d.deferred.amount)} ${d.deferred.currency}`,
        cls: "text-[color:var(--amber)] font-semibold",
      };
    }
    return { rank: 3, text: "долг закрыт", cls: "text-[color:var(--pos)] font-semibold" };
  }
  if (!d.confirmed) return { rank: 1, text: "не подтв.", cls: "text-[color:var(--faint)]" };
  return { rank: 2, text: "проведена", cls: "text-[color:var(--faint)]" };
}

// primary OUT = крупнейшая нога; total — для сортировки; extra — сколько ещё ног.
function outSummary(d) {
  const outs = d.outs || [];
  if (!outs.length) return { amount: null, ccy: "", total: 0, extra: 0, tip: "" };
  const sorted = [...outs].sort((a, b) => b.amount - a.amount);
  const total = outs.reduce((s, o) => s + o.amount, 0);
  const tip = outs.map((o) => `${fmtRu(o.amount, ccyMeta(o.ccy)?.dp ?? 2)} ${o.ccy}`).join(" + ");
  return { amount: sorted[0].amount, ccy: sorted[0].ccy, total, extra: outs.length - 1, tip };
}

const G = "border-[color:var(--grid)]"; // вертикальные/горизонтальные линии — один тон

export default function DealsLedger({ officeId, onOrderToDeal }) {
  const { accounts } = useAccounts();
  const fromIso = useMemo(() => todayStartIso(), []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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

  const [detailOrder, setDetailOrder] = useState(null); // заявка для модалки деталей

  const acctFor = useCallback(
    (ccy) => accounts.find((a) => a.active && a.officeId === officeId && a.currency === ccy),
    [accounts, officeId]
  );

  // ── Действия заявок ──
  const toggleArrived = async (order) => {
    try {
      await setArrived(order.id, !order.arrivedAt);
      await refetchOrders();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] arrived toggle failed", e);
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

  // Удаление сделки = сторно (обратная проводка). Если уже подтверждена —
  // предупреждаем отдельно; одноногая — сторно; непроведённая — физ. void.
  const deleteDeal = async (d) => {
    setErr("");
    const oneLeg = !!d.deferred?.oneLeg;
    try {
      if (d.confirmed) {
        if (
          !window.confirm(
            "Сделку уже подтвердил бухгалтер — при удалении будет создано СТОРНО (обратная проводка). Продолжить?"
          )
        )
          return;
        await rpcReverseTransactionV2({ targetTxId: d.id, reason: "Отмена сделки из кассы", cascade: true });
      } else if (oneLeg) {
        if (!window.confirm("Удалить долг? Будет создано сторно (обратная проводка).")) return;
        await rpcReverseTransactionV2({ targetTxId: d.id, reason: "Отмена из кассы", cascade: true });
      } else {
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

  // Закрытие долга: «мы должны» (out) → complete_deal_leg; «клиент должен» (in) →
  // topup. Одноногая → противоположный примитив (гасит баланс клиента).
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
        if (!d.clientId) return window.alert("Нет контрагента для закрытия (client_id)");
        if (def.side === "out") {
          await rpcCreateWithdrawalV2({
            clientId: d.clientId,
            currencyCode: def.currency,
            amount: def.amount,
            destinationAccount: accountCode,
            description: "Закрытие долга: выдали клиенту",
          });
        } else {
          await rpcCreateTopupV2({
            clientId: d.clientId,
            accountCode,
            amount: def.amount,
            currencyCode: def.currency,
            description: "Закрытие долга: клиент донёс",
          });
        }
      } else if (def.side === "out") {
        await rpcCompleteDealLegV2({ dealId: d.id, currencyCode: def.currency, amount: def.amount, accountCode });
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

  // ── Клиентские сортировка + поиск ──
  // seq — стабильный порядковый по хронологии загрузки (ридер отдаёт ASC по дате).
  const indexed = useMemo(() => rows.map((d, i) => ({ ...d, seq: i + 1, _out: outSummary(d) })), [rows]);

  const [sortKey, setSortKey] = useState("tm"); // по умолчанию — Дата ↓
  const [sortDir, setSortDir] = useState("desc");
  const [query, setQuery] = useState("");

  const NUMERIC = useMemo(() => new Set(["seq", "tm", "inAmt", "rate", "outAmt", "status"]), []);
  const setSort = (k) => {
    if (sortKey === k) setSortDir((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(NUMERIC.has(k) ? "desc" : "asc");
    }
  };
  const sortVal = useCallback((d, k) => {
    switch (k) {
      case "seq": return d.seq;
      case "tm": return new Date(d.createdAt).getTime() || 0;
      case "party": return String(d.party || "").toLowerCase();
      case "inAmt": return d.inAmount || 0;
      case "rate": return d.rate || 0;
      case "outAmt": return d._out.total || 0;
      case "inC": return d.inCcy || "";
      case "outC": return d._out.ccy || "";
      case "status": return dealStatus(d).rank;
      default: return 0;
    }
  }, []);

  const matchDeal = useCallback(
    (d) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const st = dealStatus(d).text.toLowerCase();
      return (
        String(d.party || "").toLowerCase().includes(q) ||
        String(d.seq).includes(q) ||
        st.includes(q)
      );
    },
    [query]
  );
  const matchOrder = useCallback(
    (o) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        String(o.contact || "").toLowerCase().includes(q) ||
        String(o.meetingCode || "").toLowerCase().includes(q)
      );
    },
    [query]
  );

  const dealsView = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return indexed
      .filter(matchDeal)
      .sort((a, b) => {
        const p = sortVal(a, sortKey);
        const q = sortVal(b, sortKey);
        if (p < q) return -1 * dir;
        if (p > q) return 1 * dir;
        return 0;
      });
  }, [indexed, matchDeal, sortDir, sortKey, sortVal]);

  const ordersView = useMemo(() => orders.filter(matchOrder), [orders, matchOrder]);

  // ── стили ячеек ──
  const th =
    "px-4 pb-4 pt-0 text-[12.5px] font-medium text-[color:var(--faint)] whitespace-nowrap select-none align-bottom border-b border-[color:var(--gridh)]";
  const thBtn = "cursor-pointer hover:text-[color:var(--muted)]";
  const td = "px-4 py-[23px] text-[15px] align-middle whitespace-nowrap border-b " + G;
  const amtCls = "text-right font-mono tabular-nums font-semibold text-[17px] tracking-[-0.3px] pr-1";
  const curCls =
    "text-[11.5px] font-semibold text-[color:var(--faint)] pl-0 cursor-pointer hover:text-[color:var(--muted)] hover:underline underline-offset-2";

  const Arrow = ({ k }) =>
    sortKey === k ? (
      <span className="inline-block align-middle ml-1 text-[color:var(--muted)] text-[9px]">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    ) : null;

  const Header = () => (
    <thead>
      <tr>
        <th className={`${th} text-left ${thBtn}`} onClick={() => setSort("seq")} aria-sort={sortKey === "seq" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
          №<Arrow k="seq" />
        </th>
        <th className={`${th} text-left ${thBtn}`} onClick={() => setSort("tm")} aria-sort={sortKey === "tm" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
          Дата<Arrow k="tm" />
        </th>
        <th className={`${th} text-left ${thBtn}`} onClick={() => setSort("party")}>
          Контрагент<Arrow k="party" />
        </th>
        <th className={`${th} text-right ${thBtn}`} onClick={() => setSort("inAmt")}>
          Приход<Arrow k="inAmt" />
        </th>
        <th className={th}></th>
        <th className={`${th} text-right ${thBtn}`} onClick={() => setSort("rate")}>
          Курс<Arrow k="rate" />
        </th>
        <th className={`${th} text-right ${thBtn}`} onClick={() => setSort("outAmt")}>
          Расход<Arrow k="outAmt" />
        </th>
        <th className={th}></th>
        <th className={`${th} text-left ${thBtn}`} onClick={() => setSort("status")}>
          Статус<Arrow k="status" />
        </th>
      </tr>
    </thead>
  );

  const SecRow = ({ label, tone }) => (
    <tr>
      <td
        colSpan={9}
        className={`px-3.5 pt-6 pb-2.5 text-[12px] font-bold tracking-[0.5px] uppercase ${
          tone === "z" ? "text-[color:var(--amber)]" : "text-[color:var(--faint)]"
        }`}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full mr-2.5 align-middle ${
            tone === "z" ? "bg-[color:var(--amber)]" : "bg-[color:var(--accent)]"
          }`}
        />
        {label}
      </td>
    </tr>
  );

  const gridR = `border-r ${G}`;

  return (
    <div
      className="bg-white border border-[color:var(--grid)] rounded-[16px] overflow-hidden"
      style={{
        // Единые тона сетки — правятся одним значением.
        "--grid": "rgba(18,22,26,.07)",
        "--gridh": "rgba(18,22,26,.14)",
        "--muted": "#616873",
        "--faint": "#9aa0a8",
        "--faint2": "#c6cbd0",
        "--accent": "#0c9c6b",
        "--pos": "#0a8f5f",
        "--amber": "#a9781a",
        "--amber-bd": "#e0b04a",
      }}
    >
      {/* Шапка: заголовок · офис/дата · поиск */}
      <div className="px-5 py-4 flex items-center gap-3 border-b border-[color:var(--grid)]">
        <span className="text-[19px] font-bold tracking-[-0.3px] text-ink">Сделки</span>
        <span className="text-[13.5px] text-[color:var(--faint)]">за день</span>
        <span className="flex-1" />
        <label className="flex items-center gap-2 border border-[color:var(--grid)] rounded-[10px] px-3 h-[40px] w-[260px]">
          <Search className="w-4 h-4 text-[color:var(--faint)] shrink-0" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: контрагент, №…"
            className="w-full bg-transparent outline-none text-[13.5px] text-ink placeholder:text-[color:var(--faint)]"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: "auto" }}>
          <Header />
          <tbody>
            {/* ── Заявки (pending) ── */}
            {ordersView.length > 0 && <SecRow label={`Заявки · ${ordersView.length} ожидают`} tone="z" />}
            {ordersView.map((o) => {
              const zbg = "bg-[rgba(224,176,74,.07)] group-hover:bg-[rgba(224,176,74,.11)]";
              return (
                <tr key={`ord_${o.id}`} className="group">
                  <td
                    className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-left font-mono tabular-nums text-[12px] text-[color:var(--faint)]`}
                    style={{ boxShadow: "inset 3px 0 0 var(--amber-bd)" }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleArrived(o)}
                      title={o.arrivedAt ? "Пришёл — снять отметку" : "Отметить: клиент пришёл"}
                      className="align-middle"
                    >
                      {o.arrivedAt ? (
                        <CheckCircle2 className="w-[15px] h-[15px] text-[color:var(--pos)]" strokeWidth={2.2} />
                      ) : (
                        <CircleDashed className="w-[15px] h-[15px] text-[color:var(--amber-bd)] hover:text-[color:var(--pos)]" strokeWidth={2.2} />
                      )}
                    </button>
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-left font-mono tabular-nums leading-[1.35]`}>
                    <span className="block text-[color:var(--muted)] text-[14.5px]">{fmtDate(o.createdAt)}</span>
                    <span className="block text-[color:var(--faint2)] text-[12px]">{fmtTime(o.createdAt)}</span>
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-left`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-bold tracking-[0.6px] uppercase text-[#8a5e10] bg-[rgba(224,176,74,.2)] rounded-[4px] px-1.5 py-px shrink-0">
                        Заявка
                      </span>
                      <span className="font-semibold text-ink truncate" title={o.contact}>
                        {o.contact || "—"}
                      </span>
                      {o.meetingCode && (
                        <span className="text-[10.5px] font-mono text-[color:var(--faint)] shrink-0">№ {o.meetingCode}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setDetailOrder(o)}
                        title="Открыть и править заявку"
                        className="ml-auto shrink-0 text-[color:var(--amber)] hover:text-[#8a5e10] p-0.5"
                      >
                        <Eye className="w-[14px] h-[14px]" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteOrder(o)}
                        title="Удалить заявку"
                        className="shrink-0 p-0.5 text-[#ce463d]/50 hover:text-[#ce463d] hidden group-hover:inline-flex"
                      >
                        <Trash2 className="w-[13px] h-[13px]" strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${amtCls} text-[color:var(--amber)]`}>
                    {o.fromAmount ? <Money amount={o.fromAmount} ccy={o.fromCurrency} /> : ""}
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} ${curCls}`}>{o.fromCurrency || ""}</td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-right font-mono tabular-nums text-[color:var(--muted)] text-[14.5px]`}>
                    {o.rate || ""}
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${amtCls} text-[color:var(--amber)]`}>
                    {o.toAmount ? <Money amount={o.toAmount} ccy={o.toCurrency} /> : ""}
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} ${curCls}`}>{o.toCurrency || ""}</td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} text-left`}>
                    {onOrderToDeal && (
                      <button
                        type="button"
                        onClick={() => onOrderToDeal(o)}
                        title="Принять заявку → форма «Новая сделка» с её данными"
                        className="inline-flex items-center gap-1 text-[11.5px] font-bold text-white bg-[color:var(--accent)] border border-[color:var(--accent)] rounded-[7px] px-3 py-[5px] hover:bg-[#0a865c]"
                      >
                        <PlayCircle className="w-[13px] h-[13px]" strokeWidth={2.4} />
                        Принять
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* ── Сделки ── */}
            <SecRow label="Сделки" tone="d" />
            {dealsView.map((d) => {
              const st = dealStatus(d);
              const out = d._out;
              return (
                <tr key={d.id} className="group hover:bg-[rgba(18,22,26,.016)]">
                  <td className={`${td} ${gridR} text-left font-mono tabular-nums text-[12px] text-[color:var(--faint)]`}>
                    {d.seq}
                  </td>
                  <td className={`${td} ${gridR} text-left font-mono tabular-nums leading-[1.35]`}>
                    <span className="block text-[color:var(--muted)] text-[14.5px]">{fmtDate(d.createdAt)}</span>
                    <span className="block text-[color:var(--faint2)] text-[12px]">{fmtTime(d.createdAt)}</span>
                  </td>
                  <td className={`${td} ${gridR} text-left`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-ink truncate tracking-[-0.1px] text-[15.5px]" title={d.party}>
                        {d.party}
                      </span>
                      {d.deferred?.open && (
                        <button
                          type="button"
                          onClick={() => settleDeferred(d)}
                          title="Закрыть долг (рассчитались)"
                          className="shrink-0 inline-flex items-center text-[10px] font-bold text-[color:var(--pos)] bg-[rgba(12,156,107,.1)] rounded-[5px] px-1.5 py-0.5 hover:bg-[rgba(12,156,107,.16)]"
                        >
                          закрыть
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteDeal(d)}
                        title="Удалить сделку (сторно)"
                        className="ml-auto shrink-0 p-0.5 text-[#ce463d]/45 hover:text-[#ce463d] hidden group-hover:inline-flex"
                      >
                        <Trash2 className="w-[13px] h-[13px]" strokeWidth={2} />
                      </button>
                    </div>
                    {d.deferred?.open && d.deferred.dueDate && (
                      <div className="text-[10px] text-[color:var(--faint)] mt-0.5">до {fmtDue(d.deferred.dueDate)}</div>
                    )}
                  </td>
                  <td className={`${td} ${amtCls} text-ink`}>
                    {d.inAmount ? <Money amount={d.inAmount} ccy={d.inCcy} /> : <span className="text-[color:var(--faint2)]">·</span>}
                  </td>
                  <td className={`${td} ${gridR} ${curCls}`} onClick={() => setSort("inC")} title="Группировать по валюте прихода">
                    {d.inCcy || ""}
                  </td>
                  <td className={`${td} ${gridR} text-right font-mono tabular-nums text-[color:var(--muted)] text-[14.5px]`}>
                    {d.rate != null ? fmtRu(d.rate) : "—"}
                  </td>
                  <td className={`${td} ${amtCls} text-ink`}>
                    {out.amount != null ? (
                      <span title={out.tip}>
                        <Money amount={out.amount} ccy={out.ccy} />
                        {out.extra > 0 && <span className="text-[color:var(--faint)] font-normal text-[11px] ml-1">＋{out.extra}</span>}
                      </span>
                    ) : (
                      <span className="text-[color:var(--faint2)]">·</span>
                    )}
                  </td>
                  <td className={`${td} ${gridR} ${curCls}`} onClick={() => setSort("outC")} title="Группировать по валюте расхода">
                    {out.ccy || ""}
                  </td>
                  <td className={`${td} text-left text-[13.5px] ${st.cls}`}>{st.text}</td>
                </tr>
              );
            })}

            {!loading && dealsView.length === 0 && ordersView.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2.5 py-8 text-center text-[13px] text-[color:var(--faint)]">
                  {query ? "Ничего не найдено" : "Сделок за день пока нет"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Подвал: счётчик. P&L скрыт — профит на сделку не считается (бэклог). */}
      <div className="px-5 py-4 flex items-center text-[12.5px] text-[color:var(--faint)] border-t border-[color:var(--grid)]">
        <span>
          {rows.length} сделок
          {orders.length > 0 ? ` · ${orders.length} заявок в ожидании` : ""}
        </span>
        {err && <span className="ml-3 text-[#ce463d] font-semibold">⚠ {err}</span>}
        <span className="ml-auto text-[color:var(--faint2)]">профит на сделку не считается — в бэклоге</span>
      </div>

      {detailOrder && (
        <OrderDetailsModal order={detailOrder} onClose={() => setDetailOrder(null)} onRefetch={refetchOrders} />
      )}
    </div>
  );
}
