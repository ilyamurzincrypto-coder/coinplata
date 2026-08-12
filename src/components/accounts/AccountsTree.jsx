// src/components/accounts/AccountsTree.jsx
// Редизайн «Счета»: вертикальное дерево Офис → Валюта → Счёт (как «Активы» в
// Казначействе), но это УПРАВЛЕНИЕ КАССАМИ — корректировки остатков, переводы
// между офисами/счетами, пополнение/изъятие. Данные из useAccounts (movements);
// операции — переиспуют готовые модалки (проводки v2: create_transfer/adjustment).

import React, { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Building2,
  SlidersHorizontal,
  ArrowLeftRight,
  History,
  ArrowDownToLine,
  Copy,
  Check,
} from "lucide-react";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { BAL_COLUMNS, ccyMeta, fmtRu } from "../balances/currencyMeta.js";
import { curSymbol } from "../../utils/money.js";
import TopUpModal from "./TopUpModal.jsx";
import BalanceAdjustmentModal from "./BalanceAdjustmentModal.jsx";
import TransferModal from "./TransferModal.jsx";
import AccountHistoryModal from "./AccountHistoryModal.jsx";
import AddAccountModal from "./AddAccountModal.jsx";
import { buildAccountsTree } from "./buildAccountsTree.js";
import AegisInline from "./AegisInline.jsx";

const ccyOrder = (c) => {
  const i = BAL_COLUMNS.indexOf(c);
  return i < 0 ? 99 : i;
};
const native = (amt, ccy) => `${curSymbol(ccy)}${fmtRu(amt, ccyMeta(ccy).dp ?? 2)}`;

// Адрес крипто-кошелька: сеть + усечённый адрес, клик — копировать полностью.
function AddrChip({ address, network }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const short = address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard недоступен — адрес всё равно виден в title */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={`${network ? network + " · " : ""}${address}\n(клик — скопировать)`}
      className="inline-flex items-center gap-1 shrink-0 text-[10.5px] font-mono text-muted-soft hover:text-ink transition-colors"
    >
      {network && <span className="text-[9px] uppercase tracking-wide opacity-70">{network}</span>}
      <span>{short}</span>
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 opacity-40" />}
    </button>
  );
}

function CcyChip({ ccy }) {
  const m = ccyMeta(ccy);
  return (
    <span
      className="inline-grid place-items-center w-[22px] h-[22px] rounded-[7px] text-[11px] font-bold shrink-0"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.sym}
    </span>
  );
}

// Подписанная кнопка действия (иконка + текст), компактная.
function ActBtn({ title, label, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 inline-flex items-center gap-1 h-6 rounded-[6px] px-1.5 text-[10.5px] font-semibold text-[#5a6072] bg-[#eef0f7] hover:bg-[#e1e4ee] hover:text-ink transition-colors"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

// Группа действий: место зарезервировано (нет resize строки), видно по ховеру.
function Actions({ children }) {
  return (
    <span className="flex items-center gap-1 ml-1.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
      {children}
    </span>
  );
}

// Бейдж типа счёта: Наличные (зелёный) / Крипто (янтарный).
function TypeTag({ crypto }) {
  return crypto ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-[10px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-100/80">
      Крипто
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] text-[10px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100/80">
      Наличные
    </span>
  );
}

// Единая 7-колоночная сетка: субсчёт | тип | валюта/сеть | наличные | крипто | доступно | итого.
const GRID = "grid grid-cols-[minmax(220px,1.5fr)_92px_130px_112px_112px_112px_116px] gap-x-2";
// Денежная ячейка в base (≈): значение или прочерк, если не применимо/ноль.
const money = (v, fmtBase, { dash = true, cls = "" } = {}) =>
  Math.abs(Number(v) || 0) < 0.005 && dash ? (
    <span className="text-muted-soft">—</span>
  ) : (
    <span className={cls}>{fmtBase(v)}</span>
  );

export default function AccountsTree({ kindFilter = "all" }) {
  const { accounts, balanceOf, reservedOf, availableOf } = useAccounts();
  const { activeOffices } = useOffices();
  const { toBase, formatBase } = useBaseCurrency();
  const fb = React.useCallback((v) => formatBase(v) || "", [formatBase]);

  // Раскрыто по умолчанию: держим множество ЗАКРЫТЫХ офисов (пусто = всё открыто).
  // Так свежесозданный офис тоже сразу раскрыт — «всё на одном экране».
  const [closedOffices, setClosedOffices] = useState(() => new Set());

  const [topUpFor, setTopUpFor] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);
  const [transferFrom, setTransferFrom] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [addAccountFor, setAddAccountFor] = useState(null);

  // Дерево: офис → валюта → счета. Чистая логика в buildAccountsTree (тестируется).
  // Разрез по типу (Все/Фиат/Крипто); пустые офисы НЕ скрываем — бухгалтеру важно.
  const { tree } = useMemo(
    () =>
      buildAccountsTree({
        accounts,
        offices: activeOffices,
        kindFilter,
        balanceOf,
        reservedOf,
        toBase,
        ccyOrder,
      }),
    [accounts, activeOffices, balanceOf, reservedOf, toBase, kindFilter]
  );

  // Плоский, отсортированный список счетов на офис + base-агрегаты (нал/крипто/
  // доступно/итого). Порядок: сначала нал, потом крипто; внутри — по валюте и имени.
  const officeRows = useMemo(
    () =>
      tree.map((ob) => {
        const rows = ob.ccys
          .flatMap((c) => c.list)
          .map((a) => {
            const isCrypto = a.kind === "crypto";
            const bal = balanceOf(a.id);
            return {
              a,
              isCrypto,
              bal,
              baseBal: toBase(bal, a.currency),
              baseAvail: toBase(availableOf(a.id), a.currency),
              hasReserved: reservedOf(a.id) > 0.0001,
            };
          })
          .sort((x, y) => {
            if (x.isCrypto !== y.isCrypto) return x.isCrypto ? 1 : -1;
            const d = ccyOrder(x.a.currency) - ccyOrder(y.a.currency);
            return d !== 0 ? d : (x.a.name || "").localeCompare(y.a.name || "");
          });
        const cashBase = rows.reduce((s, r) => (r.isCrypto ? s : s + r.baseBal), 0);
        const cryptoBase = rows.reduce((s, r) => (r.isCrypto ? s + r.baseBal : s), 0);
        const availBase = rows.reduce((s, r) => s + r.baseAvail, 0);
        return { ob, rows, cashBase, cryptoBase, availBase, total: cashBase + cryptoBase };
      }),
    [tree, balanceOf, availableOf, reservedOf, toBase]
  );

  const grand = useMemo(
    () =>
      officeRows.reduce(
        (g, o) => ({
          cash: g.cash + o.cashBase,
          crypto: g.crypto + o.cryptoBase,
          avail: g.avail + o.availBase,
          total: g.total + o.total,
        }),
        { cash: 0, crypto: 0, avail: 0, total: 0 }
      ),
    [officeRows]
  );

  const openTransfer = (acc) => {
    setTransferFrom(acc);
    setTransferOpen(true);
  };
  const toggleOffice = (id) =>
    setClosedOffices((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="bg-surface border border-[#e7e9f1] rounded-[16px] overflow-hidden">
      {/* Шапка таблицы */}
      <div className={`${GRID} items-center px-4 py-2 border-b border-[#e7e9f1] bg-[#fbfcfe] text-[10px] font-bold uppercase tracking-wide text-muted`}>
        <span>Субсчёт</span>
        <span>Тип</span>
        <span>Валюта / сеть</span>
        <span className="text-right">Наличные</span>
        <span className="text-right">Крипто</span>
        <span className="text-right">Доступно</span>
        <span className="text-right">Итого ≈</span>
      </div>

      {officeRows.map(({ ob, rows, cashBase, cryptoBase, availBase, total }) => {
        const oOpen = !closedOffices.has(ob.office.id);
        return (
          <div key={ob.office.id} className="border-b border-[#eef0f4] last:border-0">
            {/* Офис — агрегат нал/крипто/доступно/итого (в base) */}
            <div
              onClick={() => toggleOffice(ob.office.id)}
              className={`${GRID} items-center px-4 py-2.5 cursor-pointer bg-[#f9fafd] hover:bg-[#f2f4fa] group`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {oOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                )}
                <Building2 className="w-4 h-4 text-[#5b6cff] shrink-0" strokeWidth={2} />
                <span className="text-[13.5px] font-bold text-ink truncate">{ob.office.name}</span>
                <span className="text-[11px] text-muted shrink-0">· {ob.accsCount}</span>
                <button
                  type="button"
                  title="Добавить счёт в этот офис"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddAccountFor({ officeId: ob.office.id, officeName: ob.office.name });
                  }}
                  className="shrink-0 inline-flex items-center gap-1 h-6 rounded-[6px] px-1.5 text-[10.5px] font-semibold text-[#5b6cff] hover:bg-[#eef0ff] transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Plus className="w-3 h-3" strokeWidth={2.6} /> счёт
                </button>
              </span>
              <span />
              <span />
              <span className="text-right text-[12.5px] font-mono font-semibold text-ink">{money(cashBase, fb)}</span>
              <span className="text-right text-[12.5px] font-mono font-semibold text-ink">{money(cryptoBase, fb)}</span>
              <span className="text-right text-[12.5px] font-mono text-[#0d8f63]">{money(availBase, fb)}</span>
              <span className="text-right text-[13px] font-mono font-bold text-ink">{fb(total)}</span>
            </div>

            {/* Счета офиса — плоско, все сразу (без вложенного клика) */}
            {oOpen &&
              rows.map(({ a, isCrypto, bal, baseBal, baseAvail, hasReserved }) => (
                <div
                  key={a.id}
                  className={`${GRID} items-center pl-9 pr-4 py-1.5 border-t border-[#f3f4f8] hover:bg-[#f6f7fb] group`}
                >
                  {/* Субсчёт: имя + натуральный остаток мелким + адрес/aegis/действия */}
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[12.5px] font-medium text-ink truncate">{a.name || a.label || a.id}</span>
                    <span className="text-[10.5px] font-mono text-muted-soft shrink-0">{native(bal, a.currency)}</span>
                    {isCrypto && <AddrChip address={a.address} network={a.network} />}
                    {isCrypto && (
                      <AegisInline account={a} ledgerUsd={baseBal} fmtBase={fb} />
                    )}
                    <Actions>
                      <ActBtn title="Корректировка остатка (инвентаризация)" label="Корректировка" onClick={() => setAdjustFor(a)}>
                        <SlidersHorizontal className="w-3 h-3" strokeWidth={2} />
                      </ActBtn>
                      <ActBtn title="Перевод между офисами/счетами" label="Перевод" onClick={() => openTransfer(a)}>
                        <ArrowLeftRight className="w-3 h-3" strokeWidth={2} />
                      </ActBtn>
                      <ActBtn title="Пополнить / изъять" label="Пополнить" onClick={() => setTopUpFor(a)}>
                        <ArrowDownToLine className="w-3 h-3" strokeWidth={2} />
                      </ActBtn>
                      <ActBtn title="История операций" label="История" onClick={() => setHistoryFor(a)}>
                        <History className="w-3 h-3" strokeWidth={2} />
                      </ActBtn>
                    </Actions>
                  </span>
                  {/* Тип */}
                  <span><TypeTag crypto={isCrypto} /></span>
                  {/* Валюта / сеть */}
                  <span className="flex items-center gap-1.5 min-w-0">
                    <CcyChip ccy={a.currency} />
                    <span className="text-[11.5px] text-ink-soft truncate">
                      {a.currency}
                      {isCrypto && a.network ? <span className="text-muted-soft"> · {a.network}</span> : null}
                    </span>
                  </span>
                  {/* Наличные (base) */}
                  <span className="text-right text-[12px] font-mono text-ink">
                    {isCrypto ? <span className="text-muted-soft">—</span> : money(baseBal, fb)}
                  </span>
                  {/* Крипто (base) */}
                  <span className="text-right text-[12px] font-mono text-ink">
                    {isCrypto ? money(baseBal, fb) : <span className="text-muted-soft">—</span>}
                  </span>
                  {/* Доступно (base) — янтарный, если есть резерв */}
                  <span className={`text-right text-[12px] font-mono ${hasReserved ? "text-[#b8923a]" : "text-muted"}`}>
                    {money(baseAvail, fb, { dash: false })}
                  </span>
                  {/* Итого (base) */}
                  <span className="text-right text-[12px] font-mono font-semibold text-ink">{fb(baseBal)}</span>
                </div>
              ))}
          </div>
        );
      })}

      {/* Итого по кассам */}
      <div className={`${GRID} items-center px-4 py-2.5 border-t-2 border-[#e7e9f1] bg-[#fbfcfe]`}>
        <span className="text-[12px] font-extrabold uppercase tracking-wide text-[#454a66]">Итого по кассам</span>
        <span />
        <span />
        <span className="text-right text-[12.5px] font-mono font-bold text-ink">{money(grand.cash, fb)}</span>
        <span className="text-right text-[12.5px] font-mono font-bold text-ink">{money(grand.crypto, fb)}</span>
        <span className="text-right text-[12.5px] font-mono font-bold text-[#0d8f63]">{money(grand.avail, fb)}</span>
        <span className="text-right text-[14px] font-mono font-extrabold text-ink">{fb(grand.total)}</span>
      </div>

      {/* Модалки операций (готовые) */}
      <TopUpModal account={topUpFor} onClose={() => setTopUpFor(null)} />
      <BalanceAdjustmentModal open={!!adjustFor} account={adjustFor} onClose={() => setAdjustFor(null)} />
      <TransferModal
        open={transferOpen}
        fromAccount={transferFrom}
        onClose={() => {
          setTransferOpen(false);
          setTransferFrom(null);
        }}
      />
      <AccountHistoryModal account={historyFor} onClose={() => setHistoryFor(null)} />
      <AddAccountModal
        open={!!addAccountFor}
        officeId={addAccountFor?.officeId}
        officeName={addAccountFor?.officeName}
        onClose={() => setAddAccountFor(null)}
      />
    </div>
  );
}
