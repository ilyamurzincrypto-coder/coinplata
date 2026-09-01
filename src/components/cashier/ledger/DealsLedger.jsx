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
import { useNow } from "../../../hooks/useNow.js";
import OrderDetailsModal from "./OrderDetailsModal.jsx";
import { PlayCircle, Search, RefreshCw } from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────
function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
/**
 * Колонка «Встреча» (эталон, ревизия 2). Заявка живёт временем встречи, а не
 * временем создания: кассиру важно «сегодня в 12:00», «завтра», «прошла 13 дней
 * назад». Просроченные не прячем — они гасятся (stale) и остаются в списке,
 * иначе забытая заявка исчезает молча.
 *   kind: today | future | past | none
 */
export function meetingView(iso, now = new Date()) {
  if (!iso) return { kind: "none", label: "—", sub: "", stale: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { kind: "none", label: "—", sub: "", stale: false };

  const startOf = (x) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const days = Math.round((startOf(d) - startOf(now)) / 86400000);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  if (days === 0) return { kind: "today", label: `сегодня · ${hhmm}`, sub: "", stale: false };
  if (days === 1) return { kind: "future", label: `завтра · ${hhmm}`, sub: "встреча", stale: false };
  if (days > 1) {
    return { kind: "future", label: `${fmtDate(iso)} · ${hhmm}`, sub: "встреча", stale: false };
  }
  const ago = Math.abs(days);
  return {
    kind: "past",
    label: `${fmtDate(iso)} · ${hhmm}`,
    sub: `прошла · ${ago} ${ago === 1 ? "день" : ago < 5 ? "дня" : "дней"}`,
    stale: true,
  };
}
/**
 * Попадает ли заявка во вкладку периода.
 *
 * РЕШЕНИЕ (а не случайность): «Сегодня» = встречи сегодня + ВСЕ просроченные.
 * Просрочка НЕ прячется во вкладку «Все» — забытая заявка морозит резерв в
 * «Остатках», и если она исчезнет из дефолтной вкладки, кассир её не увидит
 * никогда. Прячем из «Сегодня» только будущее (завтра и дальше) — оно ещё
 * успеет всплыть само.
 *
 * Заявки без времени встречи показываем всегда: иначе они пропадут из обеих
 * вкладок и потеряются молча.
 */
export function orderInPeriod(order, period, now = new Date()) {
  if (period !== "today") return true; // «Все» — без ограничений
  const kind = meetingView(order?.meetingAt, now).kind;
  return kind !== "future"; // today | past | none
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
// Пилюли — светлый текст на тёмной подложке: секция «Сделки» тёмная, прежние
// тёмные буквы на светлой заливке в ней не читались.
function orderStage(o) {
  if (o.checkedAt) return { key: "checked", label: "Проверено", dot: "#0a8f5f", pill: "text-[#8fd6b0] bg-[rgba(10,143,95,.22)]" };
  if (o.arrivedAt) return { key: "arrived", label: "Пришёл", dot: "#7c3aed", pill: "text-[#c4b5fd] bg-[rgba(124,58,237,.26)]" };
  if (o.seenAt) return { key: "seen", label: "Принята", dot: "#2563eb", pill: "text-[#a8c7fa] bg-[rgba(37,99,235,.26)]" };
  return { key: "new", label: "Новая", dot: "#e0b04a", pill: "text-[#E0B04A] bg-[rgba(224,176,74,.18)]" };
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

// Сумма и валюта — ОТДЕЛЬНЫМИ ячейками (столбик суммы | столбик валюты), чтобы
// между ними была вертикальная линия сетки. tdBase — классы ячейки строки
// (фон/бордер), tone — цвет суммы (амбер у заявок, ink у сделок).
function AmtCells({ amount, ccy, extra = 0, tip, onCcy, tdBase, gridR, tone = "" }) {
  return (
    <>
      <td className={`${tdBase} ${gridR} text-right ${tone}`} title={tip}>
        {amount != null ? (
          <span className="font-mono tabular-nums font-light text-[17px] tracking-[-0.01em]">
            <Money amount={amount} ccy={ccy} />
            {extra > 0 && <span className="text-[color:var(--faint)] font-normal text-[11px] ml-1">＋{extra}</span>}
          </span>
        ) : (
          <span className="text-[color:var(--faint2)]">·</span>
        )}
      </td>
      <td
        className={`${tdBase} ${gridR} text-left text-[11.5px] font-semibold text-[color:var(--faint)] ${onCcy ? "cursor-pointer hover:text-[color:var(--muted)] hover:underline underline-offset-2" : ""}`}
        onClick={onCcy}
        title={onCcy ? "Группировать по валюте" : undefined}
      >
        {ccy || ""}
      </td>
    </>
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
  // Период — вкладки «Сегодня / Все» (эталон, ревизия 2). Ридер умеет fromIso,
  // поэтому вкладка реально меняет запрос: «Все» = без нижней границы по дате.
  // Это безопасно — заявок 167 за всё время, сделок в v2-леджере пока ноль.
  const [period, setPeriod] = useState("today");
  // Тикаем раз в минуту: «прошла · N дней» и тег «сегодня» не должны залипать
  // на открытой вкладке через полночь.
  const nowTick = useNow(60_000);
  const fromIso = useMemo(() => (period === "all" ? null : todayStartIso()), [period]);

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
  // Ошибка загрузки заявок ВИДНА. Раньше она уходила в console.warn, и
  // список молча показывал «0 в ожидании» при 16 заявках в базе — ровно так
  // прятался битый id офиса.
  const [ordersErr, setOrdersErr] = useState("");
  const refetchOrders = useCallback(async () => {
    if (!MANAGER_ORDERS_ENABLED) return;
    try {
      setOrders(await loadPendingOrders(officeId));
      setOrdersErr("");
    } catch (e) {
      setOrders([]);
      setOrdersErr(e?.message || String(e));
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

  const ordersView = useMemo(
    () => orders.filter((o) => matchOrder(o) && orderInPeriod(o, period, new Date(nowTick))),
    [orders, matchOrder, period, nowTick]
  );

  // ── стили ячеек ──
  const th =
    "px-2.5 pb-2.5 pt-1 text-[10.5px] font-medium text-[color:var(--faint)] whitespace-nowrap select-none align-bottom";
  const thBtn = "cursor-pointer hover:text-cream";
  const thGrid = ""; // внутри карточки вертикальных линий нет (эталон .deal)
  // Строка = карточка: фон через --row, чтобы заявки могли переопределить его на
  // своём <tr> без конфликта двух bg-* классов (в Tailwind побеждает порядок в
  // сгенерированном CSS, а не в атрибуте class).
  const td =
    "px-2.5 py-3 text-[12.5px] align-middle whitespace-nowrap overflow-hidden bg-[color:var(--row)] transition-[filter] group-hover:brightness-[1.14]";
  const amtCls = "text-right font-mono tabular-nums font-light text-[17px] tracking-[-0.01em] text-cream";
  const curCls =
    "text-[10.5px] font-semibold text-[color:var(--faint)] pl-0 cursor-pointer hover:text-cream hover:underline underline-offset-2";

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
        <th className={`${th} ${thGrid} text-left`}>
          <span className="flex items-center">
            {/* Слот ника (150) + gap + разделитель + gap = старт кода → «Код» ровно над ним. */}
            <span className={`w-[167px] shrink-0 inline-flex items-center ${thBtn}`} onClick={() => setSort("party")}>
              Контрагент<Arrow k="party" />
            </span>
            <span>Код&nbsp;сделки</span>
          </span>
        </th>
        <th className={`${th} ${thGrid} text-right ${thBtn}`} onClick={() => setSort("inAmt")}>
          Приход<Arrow k="inAmt" />
        </th>
        <th className={`${th} ${thGrid} text-left ${thBtn}`} onClick={() => setSort("inC")}>
          Вал<Arrow k="inC" />
        </th>
        <th className={`${th} ${thGrid} text-right ${thBtn}`} onClick={() => setSort("rate")}>
          Курс<Arrow k="rate" />
        </th>
        <th className={`${th} ${thGrid} text-right ${thBtn}`} onClick={() => setSort("outAmt")}>
          Расход<Arrow k="outAmt" />
        </th>
        <th className={`${th} ${thGrid} text-left ${thBtn}`} onClick={() => setSort("outC")}>
          Вал<Arrow k="outC" />
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
        colSpan={9}
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
      className="rounded-[24px] bg-surface-apps px-[22px] py-5"
      style={{
        // Светлая секция «Заявки» (эталон ревизии 2 → .deals: #F7F1E1).
        // Прежняя тёмная #17150F отменена этой ревизией.
        "--grid": "#E8DFC8", // горизонтальные линии строк
        "--gridh": "#D9CFB2", // линия под шапкой таблицы
        "--vline": "#EFE7D3", // вертикальные разделители колонок
        "--muted": "#99916F",
        "--faint": "#A39D8C",
        "--faint2": "#B4AB8D",
        "--stale": "#B4AB8D", // просроченная встреча — гасим строку целиком
        "--late": "#B07A3C",
        "--accent": "#0c9c6b",
        "--pos": "#0a8f5f",
        "--amber": "#a9781a",
      }}
    >
      {/* Шапка (эталон → .deals-head): «Заявки» + счётчики, справа вкладки.
          Поиск и «Обновить» в эталоне не нарисованы, но убирать их нельзя —
          это рабочие инструменты кассира; оставлены в светлом исполнении. */}
      <div className="flex items-center gap-3 mb-3.5">
        <span className="text-[15px]">Заявки</span>
        <span className="text-[12px] text-[color:var(--muted)]">
          {ordersView.length} в ожидании · сделок сегодня {dealsView.length}
        </span>
        <span className="flex-1" />

        <div className="flex gap-1.5">
          {[
            ["today", "Сегодня"],
            ["all", "Все"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              aria-pressed={period === key}
              className={`rounded-full text-[11px] px-[13px] py-1.5 transition-colors ${
                period === key
                  ? "bg-ink text-cream"
                  : "border border-[#D9CFB2] text-[#8A8168] hover:text-ink hover:border-[#C0B594]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {MANAGER_ORDERS_ENABLED && (
          <button
            type="button"
            onClick={syncOrders}
            disabled={syncing}
            title="Обновить заявки из бота (подтянуть новые + коды встречи)"
            className="inline-flex items-center gap-1.5 h-[32px] px-3 rounded-full border border-[#D9CFB2] text-[12px] text-[#8A8168] hover:text-ink hover:border-[#C0B594] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} strokeWidth={2} />
            {syncing ? "Обновляю…" : "Обновить"}
          </button>
        )}
        <label className="flex items-center gap-2 rounded-full bg-[#F0E8D3] px-3.5 h-[32px] w-[210px]">
          <Search className="w-3.5 h-3.5 text-[color:var(--muted)] shrink-0" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: контрагент, №…"
            className="w-full bg-transparent outline-none text-[13px] text-ink placeholder:text-[color:var(--muted)]"
          />
        </label>
      </div>

      {/* ── ЗАЯВКИ (эталон → table.apps) ────────────────────────────────
          Строка целиком открывает заявку; удаление — внутри неё, не из
          списка (так в эталоне, и это заодно снимает старую беду с
          обрезанной кнопкой «Удалить» в узкой колонке). */}
      <div className="overflow-x-auto">
        <table
          // min-w: сумма фиксированных колонок (924) плюс место коду сделки.
          // Без неё table-layout:fixed сжимал колонки внутрь контейнера, и на
          // 1280 шапка начинала клипать текст — обёртка overflow-x-auto при
          // w-full не срабатывала никогда. Теперь узкий экран прокручивает
          // таблицу внутри её собственного контейнера, а страница — нет.
          className={
            "w-full min-w-[1020px] border-collapse " +
            "[&_th+th]:border-l [&_td+td]:border-l " +
            "[&_th+th]:border-[color:var(--vline)] [&_td+td]:border-[color:var(--vline)] " +
            "[&_th:first-child]:pl-0.5 [&_td:first-child]:pl-0.5 " +
            "[&_th:last-child]:pr-0.5 [&_td:last-child]:pr-0.5"
          }
          style={{ tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: "128px" }} />{/* Встреча */}
            <col style={{ width: "220px" }} />{/* Контрагент */}
            <col />{/* Код сделки — тянется, забирая пустоту, что была у контрагента */}
            <col style={{ width: "168px" }} />{/* Клиент отдаёт */}
            <col style={{ width: "176px" }} />{/* Клиент получает */}
            <col style={{ width: "104px" }} />{/* Курс — 82px обрезали «0.0210…»; место взято у кода сделки */}
            <col style={{ width: "128px" }} />{/* Действие */}
          </colgroup>
          <thead>
            <tr>
              {["Встреча", "Контрагент", "Код сделки", "Клиент отдаёт", "Клиент получает", "Курс", ""].map((h, i) => (
                <th
                  key={h || i}
                  className={`text-[11px] font-normal text-[color:var(--muted)] px-3 pb-[9px] whitespace-nowrap border-b border-[color:var(--gridh)] ${
                    // индексы сдвинулись на единицу вместе с новой колонкой:
                    // право-выравнивание держится за суммы и курс, а не за номер
                    i >= 3 && i <= 5 ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordersView.map((o) => {
              const mv = meetingView(o.meetingAt, new Date(nowTick));
              const stage = orderStage(o);
              const act = {
                new: { label: "Принять", onClick: () => askAccept(o) },
                seen: { label: "Пришёл", onClick: () => askArrive(o) },
                arrived: { label: "Проверил", onClick: () => askCheck(o) },
                checked: onOrderToDeal ? { label: "Провести", onClick: () => onOrderToDeal(o) } : null,
              }[stage.key];
              // Просроченная встреча гасит всю строку (эталон tr.stale).
              const tone = mv.stale ? "text-[color:var(--stale)]" : "text-ink";
              const sub = mv.stale ? "text-[color:var(--stale)]" : "text-[color:var(--muted)]";
              const tdA = "px-3 py-3 border-t border-[color:var(--grid)] overflow-hidden text-ellipsis whitespace-nowrap align-middle";

              return (
                <tr
                  key={`ord_${o.id}`}
                  onClick={() => setDetailOrder(o)}
                  className="cursor-pointer hover:bg-[rgba(26,25,21,.03)]"
                  title="Открыть заявку"
                >
                  <td className={`${tdA} ${tone}`}>
                    {mv.kind === "today" ? (
                      <span className="inline-block bg-lime text-lime-ink text-[11.5px] font-medium px-2.5 py-1 rounded-full">
                        {mv.label}
                      </span>
                    ) : (
                      <>
                        <span className="block text-[13px]">{mv.label}</span>
                        {mv.sub && (
                          <small className={`block text-[10.5px] mt-0.5 ${mv.stale ? "text-[color:var(--late)]" : sub}`}>
                            {mv.sub}
                          </small>
                        )}
                      </>
                    )}
                  </td>

                  <td className={`${tdA} ${tone}`}>
                    <span className="block text-[13px] truncate" title={o.contact}>
                      {o.contact || "—"}
                    </span>
                  </td>

                  <td className={`${tdA} ${sub}`}>
                    <span className="text-[13px] tabular-nums">{o.meetingCode || "—"}</span>
                  </td>

                  <td className={`${tdA} text-right ${tone}`}>
                    <span className="font-light text-[16.5px] tabular-nums">
                      {o.fromAmount ? fmtRu(o.fromAmount, ccyMeta(o.fromCurrency)?.dp ?? 2) : "—"}
                    </span>
                    <em className={`not-italic text-[11.5px] ml-1.5 ${sub}`}>{o.fromCurrency || ""}</em>
                  </td>

                  <td className={`${tdA} text-right ${tone}`}>
                    <span className="font-light text-[16.5px] tabular-nums">
                      {o.toAmount ? fmtRu(o.toAmount, ccyMeta(o.toCurrency)?.dp ?? 2) : "—"}
                    </span>
                    <em className={`not-italic text-[11.5px] ml-1.5 ${sub}`}>{o.toCurrency || ""}</em>
                  </td>

                  <td className={`${tdA} text-right text-[12.5px] tabular-nums ${mv.stale ? "text-[color:var(--stale)]" : "text-[#6B675C]"}`}>
                    {o.rate || "—"}
                  </td>

                  <td className={`${tdA} text-right`}>
                    {act && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation(); // строка открывает заявку — кнопка не должна её открывать
                          act.onClick();
                        }}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-lime-ink bg-lime rounded-full px-4 py-2 hover:brightness-[1.04]"
                      >
                        {act.label}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {!loading && ordersView.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[13px] border-t border-[color:var(--grid)]">
                  {ordersErr ? (
                    // «Пусто» и «не смогли загрузить» — разные вещи, и путать
                    // их нельзя: первое успокаивает, второе требует действий.
                    <span className="text-[color:var(--late)]">
                      Заявки не загрузились: {ordersErr}
                    </span>
                  ) : (
                    <span className="text-[color:var(--muted)]">
                      {query ? "Ничего не найдено" : "Заявок в ожидании нет"}
                    </span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-[11px] text-[11px] text-[color:var(--muted)]">
        <span>строка открывает заявку · удаление — внутри заявки, не из списка</span>
        <span>курс зафиксирован в заявке · резерв виден в «Остатках»</span>
      </div>
      {err && <div className="mt-2 text-[12px] text-[#ce463d] font-semibold">⚠ {err}</div>}

      {/* ── СДЕЛКИ ───────────────────────────────────────────────────────
          Эталон рисует только заявки — потому что сделок в v2-леджере сейчас
          ноль. Таблицу не выбрасываем (на ней сортировка по 9 колонкам и
          мульти-OUT): показываем ниже, когда сделки появятся. При нуле экран
          совпадает с эталоном. */}
      {dealsView.length > 0 && (
      <div className="overflow-x-auto mt-6">
        <div className="text-[13px] mb-2.5">
          Сделки <span className="text-[12px] text-[color:var(--muted)]">{dealsView.length} за {period === "all" ? "всё время" : "день"}</span>
        </div>
        <table
          className="w-full border-collapse"
          style={{ tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: "46px" }} />{/* № */}
            <col style={{ width: "64px" }} />{/* Дата */}
            <col />{/* Контрагент (+ код встречи внутри, отделён линией) */}
            <col style={{ width: "116px" }} />{/* Приход — сумма */}
            <col style={{ width: "48px" }} />{/* Приход — валюта */}
            <col style={{ width: "78px" }} />{/* Курс */}
            <col style={{ width: "116px" }} />{/* Расход — сумма */}
            <col style={{ width: "48px" }} />{/* Расход — валюта */}
            <col style={{ width: "238px" }} />{/* Статус */}
          </colgroup>
          <Header />
          <tbody>

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
                      <span className="w-[150px] shrink-0 truncate font-semibold text-cream tracking-[-0.1px]" title={d.party}>
                        {d.party}
                      </span>
                      {d.deferred?.open && (
                        <button
                          type="button"
                          onClick={() => settleDeferred(d)}
                          title="Закрыть долг (рассчитались)"
                          className="shrink-0 inline-flex items-center text-[10.5px] font-semibold text-[#2E3312] bg-[#C8D96F] rounded-full px-2.5 py-1 hover:bg-[#d3e084]"
                        >
                          закрыть
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteDeal(d)}
                        title="Удалить сделку (сторно)"
                        className="ml-auto shrink-0 text-[11px] rounded-full px-2.5 py-1 border border-[#4a2f2c] text-[#d98078] hover:text-[#f0a49c] hover:border-[#63403c] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Удалить
                      </button>
                    </div>
                    {d.deferred?.open && d.deferred.dueDate && (
                      <div className="text-[10px] text-[color:var(--faint)] mt-0.5">до {fmtDue(d.deferred.dueDate)}</div>
                    )}
                  </td>
                  <AmtCells amount={d.inAmount || null} ccy={d.inCcy} onCcy={() => setSort("inC")} tdBase={td} gridR={gridR} tone="text-cream" />
                  <td className={`${td} ${gridR} text-right font-mono tabular-nums text-[color:var(--muted)] text-[12.5px]`}>
                    {d.rate != null ? fmtRu(d.rate, Math.abs(d.rate) > 0 && Math.abs(d.rate) < 1 ? 4 : 2) : "—"}
                  </td>
                  <AmtCells amount={out.amount} ccy={out.ccy} extra={out.extra} onCcy={() => setSort("outC")} tip={out.tip} tdBase={td} gridR={gridR} tone="text-cream" />
                  <td className={`${td} text-left text-[12px] ${st.cls}`}>{st.text}</td>
                </tr>
              );
            })}

            {!loading && dealsView.length === 0 && ordersView.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2.5 py-8 text-center text-[13px] text-[color:var(--faint)]">
                  {query ? "Ничего не найдено" : `Сделок за ${period === "week" ? "неделю" : "день"} пока нет`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center mt-2 text-[11px] text-[color:var(--muted)]">
          <span>{dealsView.length} сделок</span>
          <span className="ml-auto">профит на сделку не считается — в бэклоге</span>
        </div>
      </div>
      )}

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
