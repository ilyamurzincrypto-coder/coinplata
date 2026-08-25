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
// Начало недели = 7 суток назад от начала сегодняшнего дня (не календарный пн —
// кассиру нужен скользящий хвост, а не «в понедельник лента пустеет»).
export function weekStartIso(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 6);
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
  // Период ленты — пилюли «Сегодня / Неделя» в шапке. Ридер уже умеет fromIso,
  // так что «Неделя» реально расширяет запрос, а не только подсвечивает пилюлю.
  const [period, setPeriod] = useState("today");
  const fromIso = useMemo(() => (period === "week" ? weekStartIso() : todayStartIso()), [period]);

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
      className="rounded-[24px] overflow-hidden text-cream"
      style={{
        // Тёмная секция по эталону (design/reference.html → .deals): тёплый glow
        // из левого верхнего угла поверх #17150F.
        background:
          "radial-gradient(500px 260px at 6% -30%, rgba(238,178,92,.10), transparent 60%), #17150F",
        // Единые тона сетки — правятся одним значением. На тёмном фоне сетка
        // светлая с низкой альфой, иначе строки-карточки сливаются в кашу.
        "--grid": "rgba(255,255,255,.07)",
        "--gridh": "rgba(255,255,255,.15)",
        "--muted": "#A39D8C",
        "--faint": "#7A7565",
        "--faint2": "#6B675C",
        "--card": "#23211A",
        "--row": "#23211A", // фон строки-карточки; заявки переопределяют на своём <tr>
        "--row-order": "#2A2418", // заявка — та же карточка, но теплее (амбер-подмес)
        "--accent": "#C8D96F",
        "--pos": "#C8D96F",
        "--amber": "#E0B04A",
        "--amber-bd": "#7a5f22",
      }}
    >
      {/* Шапка: заголовок · период · обновить · поиск (эталон → .deals-head) */}
      <div className="px-[22px] pt-5 pb-3.5 flex items-center gap-3">
        <span className="text-[15px] text-cream">Сделки</span>
        <span className="text-[12px] text-[#7A7565]">
          {dealsView.length ? `${dealsView.length} за ${period === "week" ? "неделю" : "день"}` : `за ${period === "week" ? "неделю" : "день"}`}
        </span>
        <span className="flex-1" />

        {/* Период — пилюли: активная кремовая, вторая обводкой (эталон .tabs) */}
        <div className="flex gap-1.5">
          {[
            ["today", "Сегодня"],
            ["week", "Неделя"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              aria-pressed={period === key}
              className={`rounded-full text-[11px] px-[13px] py-1.5 transition-colors ${
                period === key
                  ? "bg-cream text-[#17150F]"
                  : "border border-[#3A372C] text-[#A39D8C] hover:text-cream hover:border-[#4a4638]"
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
            className="inline-flex items-center gap-1.5 h-[32px] px-3 rounded-full border border-[#3A372C] text-[12px] text-[#A39D8C] hover:text-cream hover:border-[#4a4638] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} strokeWidth={2} />
            {syncing ? "Обновляю…" : "Обновить"}
          </button>
        )}
        <label className="flex items-center gap-2 rounded-full bg-[#23211A] px-3.5 h-[32px] w-[230px]">
          <Search className="w-3.5 h-3.5 text-[#7A7565] shrink-0" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: контрагент, №…"
            className="w-full bg-transparent outline-none text-[13px] text-cream placeholder:text-[#7A7565]"
          />
        </label>
      </div>

      {/* px = внутренние поля тёмной секции (эталон .deals: padding 20px 22px):
          без них карточки упираются в края и скругления не читаются. */}
      <div className="overflow-x-auto px-[22px]">
        {/* Фиксированная сетка: ширины колонок не пересчитываются от контента,
            поэтому таблица не «прыгает» при наведении/появлении hover-кнопок.
            Контрагент (3-я, без width) забирает остаток. */}
        {/* border-separate + spacing по Y = зазор между строками, из-за которого
            строки читаются карточками (эталон .deal: margin-bottom 8px).
            Скругление краёв — на крайних ячейках, иначе карточка «квадратит». */}
        <table
          className="w-full border-separate [&_tbody_tr>td:first-child]:rounded-l-[18px] [&_tbody_tr>td:last-child]:rounded-r-[18px]"
          style={{ tableLayout: "fixed", borderSpacing: "0 8px" }}
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
            {/* ── Заявки (pending) ── */}
            {ordersView.map((o, oi) => {
              const zbg = ""; // фон задаётся через --row на <tr> (см. ниже)
              const stage = orderStage(o);
              return (
                <tr key={`ord_${o.id}`} className="group" style={{ "--row": "var(--row-order)" }}>
                  <td
                    className={`${td} ${zbg} ${gridR} text-left font-mono tabular-nums text-[12px] text-[color:var(--faint)]`}
                    style={{ boxShadow: "inset 3px 0 0 var(--amber-bd)" }}
                    title={`Статус: ${stage.label}`}
                  >
                    {oi + 1}
                  </td>
                  <td className={`${td} ${zbg} ${gridR} text-left font-mono tabular-nums leading-[1.35]`}>
                    <span className="block text-[color:var(--muted)] text-[12.5px]">{fmtDate(o.createdAt)}</span>
                    <span className="block text-[color:var(--faint2)] text-[11px]">{fmtTime(o.createdAt)}</span>
                  </td>
                  <td className={`${td} ${zbg} ${gridR} text-left`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-[150px] shrink-0 truncate font-semibold text-cream" title={o.contact}>
                        {o.contact || "—"}
                      </span>
                      {o.meetingCode && (
                        <>
                          <span className="shrink-0 self-center w-px h-[15px] bg-[color:var(--gridh)]" aria-hidden="true" />
                          <span
                            className="shrink-0 font-mono font-semibold text-[12.5px] text-[#8a5e10]"
                            title="Код встречи (сделки)"
                          >
                            {o.meetingCode}
                          </span>
                        </>
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
                          className="text-[11px] rounded-full px-2.5 py-1 border border-[#3A372C] text-[#A39D8C] hover:text-cream hover:border-[#4a4638]"
                        >
                          Открыть
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOrder(o)}
                          title="Удалить заявку"
                          className="text-[11px] rounded-full px-2.5 py-1 border border-[#4a2f2c] text-[#d98078] hover:text-[#f0a49c] hover:border-[#63403c]"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  </td>
                  <AmtCells amount={o.fromAmount || null} ccy={o.fromCurrency} tdBase={`${td} ${zbg}`} gridR={gridR} tone="text-[color:var(--amber)]" />
                  <td className={`${td} ${zbg} ${gridR} text-right font-mono tabular-nums text-[color:var(--muted)] text-[12.5px]`}>
                    {o.rate || ""}
                  </td>
                  <AmtCells amount={o.toAmount || null} ccy={o.toCurrency} tdBase={`${td} ${zbg}`} gridR={gridR} tone="text-[color:var(--amber)]" />
                  <td className={`${td} ${zbg} text-left`}>
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
                        // Действие заявки — лайм-пилюля (эталон: .pill.lime).
                        return act ? (
                          <button
                            type="button"
                            onClick={act.onClick}
                            title={act.label}
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2E3312] bg-[#C8D96F] rounded-full px-4 py-2 hover:bg-[#d3e084] shrink-0"
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
      </div>

      {/* Подвал: счётчик. P&L скрыт — профит на сделку не считается (бэклог). */}
      <div className="px-[22px] pt-1 pb-5 flex items-center text-[12px] text-[color:var(--faint)]">
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
