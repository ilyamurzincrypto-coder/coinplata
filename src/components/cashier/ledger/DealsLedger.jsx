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
import { useAuth } from "../../../store/auth.jsx";
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
  setSeen,
  setChecked,
  cancelOrder,
  subscribeOrders,
} from "../../../lib/managerOrders.js";
import OrderDetailsModal from "./OrderDetailsModal.jsx";
import { PlayCircle, Search, RefreshCw } from "lucide-react";

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

// Стадия жизненного цикла заявки: Новая → Принята → Пришёл → Проверено → (Провести).
// Выводится из локальных меток времени; каждый переход подтверждается поп-апом.
function orderStage(o) {
  if (o.checkedAt) return { key: "checked", label: "Проверено", dot: "#0a8f5f", pill: "text-[#0a8f5f] bg-[rgba(10,143,95,.12)]" };
  if (o.arrivedAt) return { key: "arrived", label: "Пришёл", dot: "#7c3aed", pill: "text-[#6d28d9] bg-[rgba(124,58,237,.12)]" };
  if (o.seenAt) return { key: "seen", label: "Принята", dot: "#2563eb", pill: "text-[#1d4ed8] bg-[rgba(37,99,235,.12)]" };
  return { key: "new", label: "Новая", dot: "#e0b04a", pill: "text-[#a9781a] bg-[rgba(224,176,74,.18)]" };
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

// Денежная ячейка: сумма прижата вправо, код валюты — в фиксированном слоте
// слева от правого края. Так и суммы, и коды валют выравниваются по вертикали
// (раньше сумма и валюта были в разных колонках и «плыли»).
function AmtCcy({ amount, ccy, extra = 0, onCcy, tip }) {
  return (
    <div className="flex items-baseline justify-end gap-1.5" title={tip}>
      {amount != null ? (
        <span className="font-mono tabular-nums font-semibold text-[13px] tracking-[-0.3px] truncate">
          <Money amount={amount} ccy={ccy} />
          {extra > 0 && (
            <span className="text-[color:var(--faint)] font-normal text-[11px] ml-1">＋{extra}</span>
          )}
        </span>
      ) : (
        <span className="text-[color:var(--faint2)]">·</span>
      )}
      <span
        className="inline-block w-[38px] shrink-0 text-left text-[11.5px] font-semibold text-[color:var(--faint)] cursor-pointer hover:text-[color:var(--muted)] hover:underline underline-offset-2"
        onClick={onCcy}
        title={onCcy ? "Группировать по валюте" : undefined}
      >
        {ccy || ""}
      </span>
    </div>
  );
}

const G = "border-[color:var(--grid)]"; // вертикальные/горизонтальные линии — один тон

export default function DealsLedger({ officeId, onOrderToDeal }) {
  const { accounts } = useAccounts();
  const { users } = useAuth();
  const usersById = useMemo(() => {
    const m = {};
    (users || []).forEach((u) => {
      if (u?.id) m[u.id] = u.name || u.full_name || u.email || null;
    });
    return m;
  }, [users]);
  const fromIso = useMemo(() => todayStartIso(), []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const refetch = useCallback(async () => {
    try {
      const r = await loadCashierDeals({ officeId, fromIso });
      setRows(r);
      setErr("");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] load failed", e);
      // Не маскируем ошибку под «пустой день» — показываем её в подвале.
      setErr(e?.message || "Не удалось загрузить сделки");
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
      .channel(`cashier-deals-ledger-${officeId || "all"}`)
      .on("postgres_changes", { event: "*", schema: "ledger", table: "transactions" }, refetch)
      .on("postgres_changes", { event: "*", schema: "ledger", table: "journal_entries" }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refetch, officeId]);

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

  // Ручной синк заявок из бота (не ждём крон Vercel). Авторизация — JWT кассира.
  const [syncing, setSyncing] = useState(false);
  const syncOrders = useCallback(async () => {
    setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const r = await fetch("/api/cashdesk/sync", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`sync ${r.status}`);
      await refetchOrders();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] manual sync failed", e);
      window.alert(`Не удалось обновить заявки:\n${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  }, [refetchOrders]);

  const [detailOrder, setDetailOrder] = useState(null); // заявка для модалки деталей
  const [confirmDlg, setConfirmDlg] = useState(null); // поп-ап подтверждения стадии

  const acctFor = useCallback(
    (ccy) => accounts.find((a) => a.active && a.officeId === officeId && a.currency === ccy),
    [accounts, officeId]
  );

  // ── Стадии заявки (каждый переход — через поп-ап подтверждения) ──
  const runStage = (fn) => async () => {
    try {
      await fn();
      await refetchOrders();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] stage change failed", e);
      window.alert(`Не удалось обновить статус заявки:\n${e?.message || e}`);
    }
  };
  const askAccept = (o) =>
    setConfirmDlg({
      title: "Принять заявку в работу",
      message: `Вы увидели заявку${o.contact ? ` «${o.contact}»` : ""} и берёте её в работу?`,
      confirmLabel: "Да, принял",
      onConfirm: runStage(() => setSeen(o.id, true)),
    });
  const askArrive = (o) =>
    setConfirmDlg({
      title: "Клиент пришёл",
      message: "Клиент точно пришёл в офис?",
      confirmLabel: "Да, пришёл",
      onConfirm: runStage(() => setArrived(o.id, true)),
    });
  const askCheck = (o) =>
    setConfirmDlg({
      title: "Проверка перед проведением",
      message: "Вы проверили сумму, реквизиты и клиента? После этого можно проводить сделку.",
      confirmLabel: "Да, проверил",
      onConfirm: runStage(() => setChecked(o.id, true)),
    });
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
    "px-2.5 pb-2.5 pt-3 text-[10.5px] font-medium text-[color:var(--faint)] whitespace-nowrap select-none align-bottom border-b border-[color:var(--gridh)]";
  const thBtn = "cursor-pointer hover:text-[color:var(--muted)]";
  const thGrid = "border-r border-[color:var(--grid)]"; // верт. линии в шапке — как в теле
  const td = "px-2.5 py-2 text-[12.5px] align-middle whitespace-nowrap overflow-hidden border-b " + G;
  const amtCls = "text-right font-mono tabular-nums font-semibold text-[13px] tracking-[-0.3px]";
  const curCls =
    "text-[10.5px] font-semibold text-[color:var(--faint)] pl-0 cursor-pointer hover:text-[color:var(--muted)] hover:underline underline-offset-2";

  const Arrow = ({ k }) =>
    sortKey === k ? (
      <span className="inline-block align-middle ml-1 text-[color:var(--muted)] text-[9px]">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    ) : null;

  const Header = () => (
    <thead>
      <tr>
        <th className={`${th} ${thGrid} text-left ${thBtn}`} onClick={() => setSort("seq")} aria-sort={sortKey === "seq" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
          №<Arrow k="seq" />
        </th>
        <th className={`${th} ${thGrid} text-left ${thBtn}`} onClick={() => setSort("tm")} aria-sort={sortKey === "tm" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
          Дата<Arrow k="tm" />
        </th>
        <th className={`${th} ${thGrid} text-left ${thBtn}`} onClick={() => setSort("party")}>
          Контрагент<Arrow k="party" />
        </th>
        <th className={`${th} ${thGrid} text-right ${thBtn} pr-[46px]`} onClick={() => setSort("inAmt")}>
          Приход<Arrow k="inAmt" />
        </th>
        <th className={`${th} ${thGrid} text-right ${thBtn}`} onClick={() => setSort("rate")}>
          Курс<Arrow k="rate" />
        </th>
        <th className={`${th} ${thGrid} text-right ${thBtn} pr-[46px]`} onClick={() => setSort("outAmt")}>
          Расход<Arrow k="outAmt" />
        </th>
        <th className={`${th} text-left ${thBtn}`} onClick={() => setSort("status")}>
          Статус<Arrow k="status" />
        </th>
      </tr>
    </thead>
  );

  const SecRow = ({ label, tone }) => (
    <tr>
      <td
        colSpan={7}
        className={`px-2.5 pt-[18px] pb-2 text-[10.5px] font-bold tracking-[0.5px] uppercase ${
          tone === "z" ? "text-[color:var(--amber)]" : "text-[color:var(--faint)]"
        }`}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${
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
      <div className="px-[18px] py-2.5 flex items-center gap-3 border-b border-[color:var(--grid)]">
        <span className="text-[14.5px] font-bold tracking-[-0.3px] text-ink">Сделки</span>
        <span className="text-[12px] text-[color:var(--faint)]">за день</span>
        <span className="flex-1" />
        {MANAGER_ORDERS_ENABLED && (
          <button
            type="button"
            onClick={syncOrders}
            disabled={syncing}
            title="Обновить заявки из бота (подтянуть новые + коды встречи)"
            className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[9px] border border-[color:var(--grid)] text-[12.5px] font-semibold text-[color:var(--muted)] hover:text-ink hover:bg-[rgba(18,22,26,.03)] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} strokeWidth={2} />
            {syncing ? "Обновляю…" : "Обновить"}
          </button>
        )}
        <label className="flex items-center gap-2 border border-[color:var(--grid)] rounded-[9px] px-2.5 h-[34px] w-[230px]">
          <Search className="w-3.5 h-3.5 text-[color:var(--faint)] shrink-0" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: контрагент, №…"
            className="w-full bg-transparent outline-none text-[13px] text-ink placeholder:text-[color:var(--faint)]"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        {/* Фиксированная сетка: ширины колонок не пересчитываются от контента,
            поэтому таблица не «прыгает» при наведении/появлении hover-кнопок.
            Контрагент (3-я, без width) забирает остаток. */}
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "46px" }} />{/* № */}
            <col style={{ width: "64px" }} />{/* Дата */}
            <col />{/* Контрагент */}
            <col style={{ width: "162px" }} />{/* Приход (сумма+валюта) */}
            <col style={{ width: "78px" }} />{/* Курс */}
            <col style={{ width: "162px" }} />{/* Расход (сумма+валюта) */}
            <col style={{ width: "238px" }} />{/* Статус */}
          </colgroup>
          <Header />
          <tbody>
            {/* ── Заявки (pending) ── */}
            {ordersView.map((o, oi) => {
              const zbg = "bg-[rgba(224,176,74,.07)] group-hover:bg-[rgba(224,176,74,.11)]";
              const stage = orderStage(o);
              return (
                <tr key={`ord_${o.id}`} className="group">
                  <td
                    className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-left font-mono tabular-nums text-[12px] text-[color:var(--faint)]`}
                    style={{ boxShadow: "inset 3px 0 0 var(--amber-bd)" }}
                    title={`Статус: ${stage.label}`}
                  >
                    {oi + 1}
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-left font-mono tabular-nums leading-[1.35]`}>
                    <span className="block text-[color:var(--muted)] text-[12.5px]">{fmtDate(o.createdAt)}</span>
                    <span className="block text-[color:var(--faint2)] text-[11px]">{fmtTime(o.createdAt)}</span>
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-left`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-ink truncate" title={o.contact}>
                        {o.contact || "—"}
                      </span>
                      {o.meetingCode && (
                        <span
                          className="shrink-0 font-mono font-semibold text-[12.5px] text-[#8a5e10]"
                          title="Код встречи"
                        >
                          {o.meetingCode}
                        </span>
                      )}
                      {(() => {
                        // Всё в одну строку (без подстроки) — иначе строки разной
                        // высоты и контакт «плавает». Автора для ботовых нет.
                        const creator = o.sourceOrderId ? null : usersById[o.createdBy] || null;
                        const bits = [];
                        if (creator) bits.push(`создал ${creator}`);
                        if (o.meetingAt) {
                        const md = new Date(o.meetingAt);
                        const t = new Date();
                        const sameDay =
                          md.getFullYear() === t.getFullYear() &&
                          md.getMonth() === t.getMonth() &&
                          md.getDate() === t.getDate();
                        bits.push(`встреча ${sameDay ? "" : fmtDate(o.meetingAt) + " "}${fmtTime(o.meetingAt)}`);
                      }
                        return bits.length ? (
                          <span className="min-w-0 truncate text-[10.5px] text-[color:var(--faint)]">
                            · {bits.join(" · ")}
                          </span>
                        ) : null;
                      })()}
                      <div className="ml-auto flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDetailOrder(o)}
                          title="Открыть и править заявку"
                          className="text-[11px] font-semibold rounded-md px-2 py-1 text-[color:var(--amber)] hover:text-[#8a5e10] bg-[rgba(224,176,74,0.16)] hover:bg-[rgba(224,176,74,0.26)]"
                        >
                          Открыть
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOrder(o)}
                          title="Удалить заявку"
                          className="text-[11px] font-semibold rounded-md px-2 py-1 text-[#ce463d]/85 hover:text-[#ce463d] bg-[#ce463d]/[0.08] hover:bg-[#ce463d]/[0.16]"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-[color:var(--amber)]`}>
                    <AmtCcy amount={o.fromAmount || null} ccy={o.fromCurrency} />
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-right font-mono tabular-nums text-[color:var(--muted)] text-[12.5px]`}>
                    {o.rate || ""}
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} ${gridR} text-[color:var(--amber)]`}>
                    <AmtCcy amount={o.toAmount || null} ccy={o.toCurrency} />
                  </td>
                  <td className={`${td} border-b-[rgba(224,176,74,.3)] ${zbg} text-left`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wide rounded-md px-1.5 py-0.5 shrink-0 ${stage.pill}`}>
                        {stage.label}
                      </span>
                      {(() => {
                        const act = {
                          new: { label: "Принять", onClick: () => askAccept(o) },
                          seen: { label: "Пришёл", onClick: () => askArrive(o) },
                          arrived: { label: "Проверил", onClick: () => askCheck(o) },
                          checked: onOrderToDeal ? { label: "Провести", onClick: () => onOrderToDeal(o) } : null,
                        }[stage.key];
                        return act ? (
                          <button
                            type="button"
                            onClick={act.onClick}
                            title={act.label}
                            className="inline-flex items-center gap-1 text-[11.5px] font-bold text-white bg-[#0c9c6b] rounded-[7px] px-2.5 py-[5px] hover:bg-[#0a865c] shrink-0"
                          >
                            <PlayCircle className="w-[15px] h-[15px]" strokeWidth={2.4} />
                            {act.label}
                          </button>
                        ) : null;
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}

            {dealsView.map((d) => {
              const st = dealStatus(d);
              const out = d._out;
              return (
                <tr key={d.id} className="group hover:bg-[rgba(18,22,26,.016)]">
                  <td className={`${td} ${gridR} text-left font-mono tabular-nums text-[12px] text-[color:var(--faint)]`}>
                    {d.seq}
                  </td>
                  <td className={`${td} ${gridR} text-left font-mono tabular-nums leading-[1.35]`}>
                    <span className="block text-[color:var(--muted)] text-[12.5px]">{fmtDate(d.createdAt)}</span>
                    <span className="block text-[color:var(--faint2)] text-[11px]">{fmtTime(d.createdAt)}</span>
                  </td>
                  <td className={`${td} ${gridR} text-left`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-ink truncate tracking-[-0.1px]" title={d.party}>
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
                        className="ml-auto shrink-0 text-[11px] font-semibold rounded-md px-2 py-1 text-[#ce463d]/85 hover:text-[#ce463d] bg-[#ce463d]/[0.08] hover:bg-[#ce463d]/[0.16] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Удалить
                      </button>
                    </div>
                    {d.deferred?.open && d.deferred.dueDate && (
                      <div className="text-[10px] text-[color:var(--faint)] mt-0.5">до {fmtDue(d.deferred.dueDate)}</div>
                    )}
                  </td>
                  <td className={`${td} ${gridR} text-ink`}>
                    <AmtCcy amount={d.inAmount || null} ccy={d.inCcy} onCcy={() => setSort("inC")} />
                  </td>
                  <td className={`${td} ${gridR} text-right font-mono tabular-nums text-[color:var(--muted)] text-[12.5px]`}>
                    {d.rate != null ? fmtRu(d.rate, Math.abs(d.rate) > 0 && Math.abs(d.rate) < 1 ? 4 : 2) : "—"}
                  </td>
                  <td className={`${td} ${gridR} text-ink`}>
                    <AmtCcy amount={out.amount} ccy={out.ccy} extra={out.extra} onCcy={() => setSort("outC")} tip={out.tip} />
                  </td>
                  <td className={`${td} text-left text-[12px] ${st.cls}`}>{st.text}</td>
                </tr>
              );
            })}

            {!loading && dealsView.length === 0 && ordersView.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2.5 py-8 text-center text-[13px] text-[color:var(--faint)]">
                  {query ? "Ничего не найдено" : "Сделок за день пока нет"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Подвал: счётчик. P&L скрыт — профит на сделку не считается (бэклог). */}
      <div className="px-[18px] py-3.5 flex items-center text-[12px] text-[color:var(--faint)] border-t border-[color:var(--grid)]">
        <span>
          {dealsView.length} сделок
          {ordersView.length > 0 ? ` · ${ordersView.length} заявок в ожидании` : ""}
        </span>
        {err && <span className="ml-3 text-[#ce463d] font-semibold">⚠ {err}</span>}
        <span className="ml-auto text-[color:var(--faint2)]">профит на сделку не считается — в бэклоге</span>
      </div>

      {detailOrder && (
        <OrderDetailsModal order={detailOrder} onClose={() => setDetailOrder(null)} onRefetch={refetchOrders} />
      )}

      {/* Поп-ап подтверждения перехода стадии заявки */}
      {confirmDlg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setConfirmDlg(null)}
        >
          <div
            className="w-full max-w-sm rounded-[18px] bg-white p-5 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[16px] font-bold text-ink mb-1.5">{confirmDlg.title}</div>
            <div className="text-[13.5px] text-muted leading-relaxed mb-4">{confirmDlg.message}</div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDlg(null)}
                className="px-3.5 py-2 rounded-[10px] text-[13px] font-semibold text-ink bg-[#f2f1ec] hover:bg-[#e9e8e2]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = confirmDlg.onConfirm;
                  setConfirmDlg(null);
                  await fn?.();
                }}
                className="px-3.5 py-2 rounded-[10px] text-[13px] font-bold text-white bg-[#0c9c6b] hover:bg-[#0a865c]"
              >
                {confirmDlg.confirmLabel || "Подтвердить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
