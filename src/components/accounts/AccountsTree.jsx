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

export default function AccountsTree({ kindFilter = "all" }) {
  const { accounts, balanceOf, reservedOf, availableOf } = useAccounts();
  const { activeOffices } = useOffices();
  const { toBase, formatBase } = useBaseCurrency();

  const [openOffices, setOpenOffices] = useState(() => new Set());
  const [openCcy, setOpenCcy] = useState(() => new Set()); // ключ `${officeId}|${ccy}`

  const [topUpFor, setTopUpFor] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);
  const [transferFrom, setTransferFrom] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [addAccountFor, setAddAccountFor] = useState(null);

  // Дерево: офис → валюта → счета. Чистая логика вынесена в buildAccountsTree
  // (тестируется отдельно). Разрез по типу счёта (Все/Фиат/Крипто); пустые в
  // разрезе офисы НЕ скрываем — важно бухгалтеру видеть, что пусто.
  const { tree, grandBase } = useMemo(
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

  const openTransfer = (acc) => {
    setTransferFrom(acc);
    setTransferOpen(true);
  };
  const toggle = (set, setSet, key) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setSet(n);
  };

  return (
    <div className="bg-surface border border-[#e7e9f1] rounded-[16px] overflow-hidden">
      {/* Шапка дерева */}
      <div className="grid grid-cols-[1fr_140px_120px_120px] items-center px-4 py-2.5 border-b border-[#e7e9f1] bg-[#fbfcfe] text-[10px] font-bold uppercase tracking-wide text-muted">
        <span>Касса / валюта / счёт</span>
        <span className="text-right">Остаток</span>
        <span className="text-right">Доступно</span>
        <span className="text-right">≈ {formatBase ? "" : ""}итого</span>
      </div>

      {tree.map((ob) => {
        const oOpen = openOffices.has(ob.office.id);
        return (
          <div key={ob.office.id} className="border-b border-[#eef0f4] last:border-0">
            {/* Офис */}
            <div
              onClick={() => toggle(openOffices, setOpenOffices, ob.office.id)}
              className="grid grid-cols-[1fr_140px_120px_120px] items-center px-4 py-2.5 cursor-pointer hover:bg-[#f6f7fb] group"
            >
              <span className="flex items-center gap-2 min-w-0">
                {oOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                )}
                <Building2 className="w-4 h-4 text-[#5b6cff] shrink-0" strokeWidth={2} />
                <span className="text-[13.5px] font-bold text-ink truncate">{ob.office.name}</span>
                <span className="text-[11px] text-muted">· {ob.accsCount}</span>
                <button
                  type="button"
                  title="Добавить счёт в этот офис"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddAccountFor({ officeId: ob.office.id, officeName: ob.office.name });
                  }}
                  className="shrink-0 inline-flex items-center gap-1 h-6 rounded-[6px] px-1.5 text-[10.5px] font-semibold text-[#5b6cff] hover:bg-[#eef0ff] transition-colors"
                >
                  <Plus className="w-3 h-3" strokeWidth={2.6} /> счёт
                </button>
              </span>
              <span className="text-right" />
              <span className="text-right" />
              <span className="text-right text-[13px] font-bold text-ink font-mono">{formatBase(ob.baseTotal, undefined) || ""}</span>
            </div>

            {/* Валюты офиса */}
            {oOpen &&
              ob.ccys.map((cb) => {
                const ckey = `${ob.office.id}|${cb.ccy}`;
                const cOpen = openCcy.has(ckey);
                const single = cb.list.length === 1;
                const acc0 = cb.list[0];
                return (
                  <div key={ckey}>
                    <div
                      onClick={() => (single ? null : toggle(openCcy, setOpenCcy, ckey))}
                      className={`grid grid-cols-[1fr_140px_120px_120px] items-center pl-9 pr-4 py-2 border-t border-[#f3f4f8] group ${
                        single ? "" : "cursor-pointer hover:bg-[#f6f7fb]"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {!single &&
                          (cOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted shrink-0" />
                          ))}
                        <CcyChip ccy={cb.ccy} />
                        <span className="text-[13px] font-bold text-ink">{cb.ccy}</span>
                        {!single && <span className="text-[11px] text-muted">· {cb.list.length} сч.</span>}
                        {single && <AddrChip address={acc0.address} network={acc0.network} />}
                        {/* AEGIS-мониторинг для одно-счётной крипто-валюты */}
                        {single && (
                          <AegisInline
                            account={acc0}
                            ledgerUsd={toBase(cb.total, cb.ccy)}
                            fmtBase={(v) => formatBase(v, undefined)}
                          />
                        )}
                        {/* Действия для одно-счётной валюты — прямо здесь */}
                        {single && (
                          <Actions>
                            <ActBtn title="Корректировка остатка (инвентаризация)" label="Корректировка" onClick={() => setAdjustFor(acc0)}>
                              <SlidersHorizontal className="w-3 h-3" strokeWidth={2} />
                            </ActBtn>
                            <ActBtn title="Перевод между офисами/счетами" label="Перевод" onClick={() => openTransfer(acc0)}>
                              <ArrowLeftRight className="w-3 h-3" strokeWidth={2} />
                            </ActBtn>
                            <ActBtn title="Пополнить / изъять" label="Пополнить" onClick={() => setTopUpFor(acc0)}>
                              <ArrowDownToLine className="w-3 h-3" strokeWidth={2} />
                            </ActBtn>
                            <ActBtn title="История операций" label="История" onClick={() => setHistoryFor(acc0)}>
                              <History className="w-3 h-3" strokeWidth={2} />
                            </ActBtn>
                          </Actions>
                        )}
                      </span>
                      <span className="text-right text-[13px] font-mono font-semibold text-ink">{native(cb.total, cb.ccy)}</span>
                      <span
                        className={`text-right text-[12.5px] font-mono ${
                          cb.reserved > 0 ? "text-[#b8923a]" : "text-muted"
                        }`}
                      >
                        {native(cb.available, cb.ccy)}
                      </span>
                      <span className="text-right text-[12px] font-mono text-muted">{formatBase(toBase(cb.total, cb.ccy), undefined) || ""}</span>
                    </div>

                    {/* Счета внутри валюты (если несколько) */}
                    {!single &&
                      cOpen &&
                      cb.list.map((a) => (
                        <div
                          key={a.id}
                          className="grid grid-cols-[1fr_140px_120px_120px] items-center pl-[68px] pr-4 py-1.5 border-t border-[#f6f7fb] hover:bg-[#f6f7fb] group"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-[12.5px] text-ink-soft truncate">{a.name || a.label || a.id}</span>
                            <AddrChip address={a.address} network={a.network} />
                            <AegisInline
                              account={a}
                              ledgerUsd={toBase(balanceOf(a.id), a.currency)}
                              fmtBase={(v) => formatBase(v, undefined)}
                            />
                            <Actions>
                              <ActBtn title="Корректировка остатка" label="Корректировка" onClick={() => setAdjustFor(a)}>
                                <SlidersHorizontal className="w-3 h-3" strokeWidth={2} />
                              </ActBtn>
                              <ActBtn title="Перевод" label="Перевод" onClick={() => openTransfer(a)}>
                                <ArrowLeftRight className="w-3 h-3" strokeWidth={2} />
                              </ActBtn>
                              <ActBtn title="Пополнить / изъять" label="Пополнить" onClick={() => setTopUpFor(a)}>
                                <ArrowDownToLine className="w-3 h-3" strokeWidth={2} />
                              </ActBtn>
                              <ActBtn title="История" label="История" onClick={() => setHistoryFor(a)}>
                                <History className="w-3 h-3" strokeWidth={2} />
                              </ActBtn>
                            </Actions>
                          </span>
                          <span className="text-right text-[12.5px] font-mono text-ink">{native(balanceOf(a.id), a.currency)}</span>
                          <span className="text-right text-[12px] font-mono text-muted">{native(availableOf(a.id), a.currency)}</span>
                          <span className="text-right text-[11.5px] font-mono text-muted">{formatBase(toBase(balanceOf(a.id), a.currency), undefined) || ""}</span>
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}

      {/* Итого */}
      <div className="grid grid-cols-[1fr_140px_120px_120px] items-center px-4 py-2.5 border-t-2 border-[#e7e9f1] bg-[#fbfcfe]">
        <span className="text-[12px] font-extrabold uppercase tracking-wide text-[#454a66]">Итого по кассам</span>
        <span />
        <span />
        <span className="text-right text-[14px] font-extrabold text-ink font-mono">{formatBase(grandBase, undefined) || ""}</span>
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
