// src/pages/treasury_v2/parts/AccountDetailModal.jsx
// Детальный модал по счёту ИЛИ контрагенту.
//
// Режимы:
//  • account — один account (Активы/Капитал лист)
//  • account+dim — один account отфильтрованный по client/partner (лист Пассивов)
//  • counterparty — все liability-счета этого CP агрегированно, мульти-валютные KPI,
//    вкладки на валюту (клик по контрагенту в Пассивах)
//
// Props:
//   open, onClose, ctx, formatBase, baseCurrency, onOpenTx
//   accountId?           — если задан, режим account (опционально + dim)
//   clientId? partnerId? — dim или (без accountId) — CP-mode

import React, { useMemo, useState, useEffect } from "react";
import { Search, Calendar, Plus } from "lucide-react";
import Modal from "../../../components/ui/Modal.jsx";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useRates } from "../../../store/rates.jsx";
import { useCan } from "../../../store/permissions.jsx";
import {
  accountEntries, counterpartyEntries, liabilitiesByCounterparty,
  accountGroupContext, groupEntries, SUBTYPE_LABEL_KEYS,
} from "../../../lib/treasury/v2selectors.js";
import { convert } from "../../../utils/convert.js";
import { curSymbol } from "../../../utils/money.js";
import InlineBalanceEditor from "./InlineBalanceEditor.jsx";
import TransactionEntries from "./TransactionEntries.jsx";
import ChartAccountModal from "./ChartAccountModal.jsx";
import CreateLiabilityDialog from "./CreateLiabilityDialog.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const BASE_OPTIONS = ["USD", "EUR", "TRY", "RUB"];

const TYPE_LABEL = {
  asset: "trv2_acctype_asset",
  liability: "trv2_acctype_liability",
  equity: "trv2_acctype_equity",
  revenue: "trv2_acctype_revenue",
  expense: "trv2_acctype_expense",
};
const CREDIT_NORMAL = new Set(["liability", "equity", "revenue"]);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fmtAmount(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountDetailModal({
  open, onClose, ctx, formatBase, baseCurrency, onOpenTx,
  accountId = null, clientId = null, partnerId = null,
}) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const { getRate } = useRates();
  const can = useCan();
  const canAddAccount = can("accounting", "edit");
  const [addCurrencyOpen, setAddCurrencyOpen] = useState(false);
  // Date range — старт: последний месяц.
  const [from, setFrom] = useState(() => daysAgoISO(30));
  const [to, setTo] = useState(() => todayISO());
  const [search, setSearch] = useState("");
  // Клик по документу разворачивает проводки этого документа прямо в строке
  // (а не открывает отдельную модалку поверх/за попапом).
  const [expandedTxId, setExpandedTxId] = useState(null);
  // activeCcy инициализируется на «Все», но в useEffect ниже при открытии модала
  // подсветим валюту кликнутого счёта (если group-mode).
  const [activeCcy, setActiveCcy] = useState("__all__");
  const [displayBase, setDisplayBase] = useState(baseCurrency || "USD");

  // Локальный «привести к» — convert суммы в displayBase через rates.
  const toDisplayBase = useMemo(() => (amt, ccy) => convert(Number(amt) || 0, ccy, displayBase, getRate) || 0, [getRate, displayBase]);
  const fmtBase = useMemo(() => (amt) => {
    const v = Number(amt) || 0;
    return `${curSymbol(displayBase)}${Math.round(v).toLocaleString("en-US")}`;
  }, [displayBase]);

  const cpKind = clientId ? "client" : partnerId ? "partner" : null;
  const cpId = clientId || partnerId;
  const isCpMode = !accountId && !!cpId;
  const dim = cpId ? { clientId, partnerId } : null;

  // Resolve account (для account-mode/group-mode)
  const account = useMemo(() => {
    if (!accountId) return null;
    return (ctx?.accounts || []).find((a) => a.id === accountId) || null;
  }, [ctx, accountId]);

  // Group context — для asset/equity клик на лист → показываем всю кассу
  // (multi-currency). Для liability с dim — НЕ группируем (важен dim filter).
  const groupCtx = useMemo(() => {
    if (!account || isCpMode) return null;
    if (dim) return null; // liability+dim → account-mode, не group
    if (account.type !== "asset" && account.type !== "equity") return null;
    return accountGroupContext(ctx, account.id);
  }, [ctx, account, dim, isCpMode]);
  const isGroupMode = !!groupCtx && groupCtx.accounts.length > 1;

  // При открытии модала: если в group-mode и клик был по конкретной валюте —
  // ставим её как активную вкладку (логично: открыл EUR → видишь EUR-данные).
  useEffect(() => {
    if (!open) return;
    if (isGroupMode && account?.currency) {
      setActiveCcy(account.currency);
    } else {
      setActiveCcy("__all__");
    }
  }, [open, accountId, isGroupMode, account?.currency]);

  // Resolve CP (для cp-mode). includeZero=true чтобы найти даже клиента с
  // нулевым обязательством (которого нет в ledger.balances).
  const cpData = useMemo(() => {
    if (!isCpMode) return null;
    const list = liabilitiesByCounterparty(ctx, cpKind, { includeZero: true });
    return list.find((g) => g.id === cpId) || null;
  }, [ctx, cpKind, cpId, isCpMode]);

  // Balance: account-mode → filter balances by accountId (+ dim если есть)
  const { balanceNative, balanceInBase } = useMemo(() => {
    if (!account) return { balanceNative: 0, balanceInBase: 0 };
    const rows = (ctx?.balances || []).filter((b) => {
      if (b.accountId !== account.id) return false;
      if (dim && dim.clientId && b.clientId !== dim.clientId) return false;
      if (dim && dim.partnerId && b.partnerId !== dim.partnerId) return false;
      return true;
    });
    let bn = 0, bb = 0;
    for (const b of rows) {
      const n = Number(b.balance) || 0;
      bn += n;
      bb += (ctx?.toBase ? ctx.toBase(n, b.currency) : n) || 0;
    }
    return { balanceNative: bn, balanceInBase: bb };
  }, [ctx, account, dim]);

  // period: null когда обе границы пустые («Всё время»); иначе ISO from/to
  const period = useMemo(() => {
    if (!from && !to) return null;
    // from/to — это UTC-даты (todayISO/daysAgoISO берут .toISOString().slice(0,10)
    // и date-input отдаёт календарную дату), поэтому границы парсим тоже в UTC (суффикс Z).
    // Без Z строка трактуется как локальное время — в +03:00 конец дня уезжал на 20:59:59Z
    // и поздние (по UTC) проводки сегодняшнего дня выпадали из дефолтного окна.
    const fromIso = from ? new Date(`${from}T00:00:00Z`).toISOString() : new Date(0).toISOString();
    const toIso = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : new Date().toISOString();
    return { from: fromIso, to: toIso };
  }, [from, to]);

  const applyPreset = (days) => {
    if (days == null) { setFrom(""); setTo(""); return; }
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  };

  // Entries:
  //   CP mode    → counterpartyEntries (+ccy filter)
  //   Group mode → groupEntries для всех sibling accountIds (+ccy filter)
  //   Account    → accountEntries (+optional dim)
  const entries = useMemo(() => {
    if (isCpMode && cpKind && cpId) {
      const ccy = activeCcy === "__all__" ? null : activeCcy;
      return counterpartyEntries(ctx, cpKind, cpId, 500, period, ccy);
    }
    if (isGroupMode && groupCtx) {
      const ccy = activeCcy === "__all__" ? null : activeCcy;
      const ids = groupCtx.accounts.map((a) => a.accountId);
      return groupEntries(ctx, ids, 500, period, ccy);
    }
    if (account) {
      return accountEntries(ctx, account.id, 500, period, dim);
    }
    return [];
  }, [ctx, account, dim, period, isCpMode, cpKind, cpId, isGroupMode, groupCtx, activeCcy]);

  // Карта проводок по transactionId — для поиска контр-счёта (вторая ножка).
  const txEntriesMap = useMemo(() => {
    const m = new Map();
    for (const e of (ctx?.entries || [])) {
      const arr = m.get(e.transactionId) || [];
      arr.push(e);
      m.set(e.transactionId, arr);
    }
    return m;
  }, [ctx]);
  const accById = useMemo(() => new Map((ctx?.accounts || []).map((a) => [a.id, a])), [ctx]);

  function contraOf(entry) {
    const all = txEntriesMap.get(entry.txId) || [];
    // Самая большая по сумме ножка противоположного направления (исключая саму)
    let best = null;
    let bestAmt = -Infinity;
    for (const e of all) {
      if (e.id === entry.id) continue;
      if (e.direction === entry.direction) continue;
      const amt = Number(e.amount) || 0;
      if (amt > bestAmt) { best = e; bestAmt = amt; }
    }
    if (!best) return null;
    const acc = accById.get(best.accountId);
    return acc ? { code: acc.code, name: acc.name } : null;
  }

  // Все ножки документа (для inline-разворота под строкой).
  function legsFor(txId) {
    return (txEntriesMap.get(txId) || []).map((l) => {
      const acc = accById.get(l.accountId);
      return {
        id: l.id,
        direction: l.direction,
        accountCode: acc?.code || "?",
        accountName: acc?.name || l.accountId,
        amount: Number(l.amount) || 0,
        currency: l.currency,
      };
    });
  }

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    const cpName = (id) => {
      if (!id || !ctx?.counterpartyName) return "";
      try { return ctx.counterpartyName(id) || ""; } catch { return ""; }
    };
    return entries.filter((e) => {
      const hay = [
        e.note, e.txKind, e.sourceRefId, e.txId,
        e.currency, String(e.amount),
        e.accountCode, e.accountName,
        cpName(e.clientId), cpName(e.partnerId),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search, ctx]);

  // ОСВ за период (Оборотно-Сальдовая Ведомость):
  // opening = balance at `from` (computed via current minus all entries since `from`)
  // closing = balance at `to`   (current minus all entries after `to`)
  // turnover Дт/Кт = sums by direction over in-period entries.
  // Считаем по entries исходного режима (account / dim / group / cp).
  const osv = useMemo(() => {
    if (!period) {
      // «Всё время» — opening = 0, closing = current, turnover = всё
      const refType = account?.type || "liability";
      const incCr = CREDIT_NORMAL.has(refType);
      let dr = 0, cr = 0, drBase = 0, crBase = 0;
      const fullEntries = isCpMode && cpKind && cpId
        ? counterpartyEntries(ctx, cpKind, cpId, 100000, null, null)
        : isGroupMode && groupCtx
          ? groupEntries(ctx, groupCtx.accounts.map((a) => a.accountId), 100000, null, null)
          : account
            ? accountEntries(ctx, account.id, 100000, null, dim)
            : [];
      for (const e of fullEntries) {
        const amt = Number(e.amount) || 0;
        const inBase = toDisplayBase(amt, e.currency);
        if (e.direction === "dr") { dr += amt; drBase += inBase; }
        else { cr += amt; crBase += inBase; }
      }
      const closing = isCpMode ? cpData.totalInBase : (isGroupMode ? groupCtx.totalInBase : balanceInBase);
      return { opening: 0, openingNative: 0, dr, cr, drBase, crBase, closing, closingNative: balanceNative, incCr };
    }
    const fromMs = new Date(period.from).getTime();
    const toMs = new Date(period.to).getTime();
    // Все entries без period-фильтра
    const allEntries = isCpMode && cpKind && cpId
      ? counterpartyEntries(ctx, cpKind, cpId, 100000, null, null)
      : isGroupMode && groupCtx
        ? groupEntries(ctx, groupCtx.accounts.map((a) => a.accountId), 100000, null, null)
        : account
          ? accountEntries(ctx, account.id, 100000, null, dim)
          : [];
    const txById = new Map((ctx?.transactions || []).map((t) => [t.id, t]));
    const refType = account?.type || "liability";
    const incCr = CREDIT_NORMAL.has(refType);
    const sign = (e) => {
      const s = e.direction === "dr" ? 1 : -1;
      return incCr ? -s : s; // для liability/equity/revenue Кт+ Дт-
    };
    let drInPeriod = 0, crInPeriod = 0, drInPeriodBase = 0, crInPeriodBase = 0;
    let signedAfterTo = 0, signedAfterToBase = 0;
    let signedInPeriod = 0, signedInPeriodBase = 0;
    for (const e of allEntries) {
      const tx = txById.get(e.txId);
      const ts = tx ? new Date(tx.effectiveDate).getTime() : new Date(e.createdAt).getTime();
      const amt = Number(e.amount) || 0;
      const amtBase = toDisplayBase(amt, e.currency);
      const s = sign(e) * amt;
      const sBase = sign(e) * amtBase;
      if (ts > toMs) {
        signedAfterTo += s;
        signedAfterToBase += sBase;
      } else if (ts >= fromMs) {
        signedInPeriod += s;
        signedInPeriodBase += sBase;
        if (e.direction === "dr") { drInPeriod += amt; drInPeriodBase += amtBase; }
        else { crInPeriod += amt; crInPeriodBase += amtBase; }
      }
    }
    const currentInBase = isCpMode ? cpData.totalInBase : (isGroupMode ? groupCtx.totalInBase : balanceInBase);
    // closing = current − all entries strictly after `to`
    const closingNative = balanceNative - signedAfterTo;
    const closing = currentInBase - signedAfterToBase;
    const openingNative = closingNative - signedInPeriod;
    const opening = closing - signedInPeriodBase;
    return {
      opening, openingNative,
      dr: drInPeriod, cr: crInPeriod,
      drBase: drInPeriodBase, crBase: crInPeriodBase,
      closing, closingNative, incCr,
    };
  }, [ctx, period, isCpMode, cpKind, cpId, cpData, isGroupMode, groupCtx, account, dim, balanceNative, balanceInBase, toDisplayBase]);

  // Turnover за период (по видимым после фильтра). Native — только когда все
  // entries одной валюты; иначе native теряет смысл. Зато base всегда суммируется.
  const turnover = useMemo(() => {
    let dr = 0, cr = 0, drBase = 0, crBase = 0;
    const ccySet = new Set();
    for (const e of filteredEntries) {
      const amt = Number(e.amount) || 0;
      ccySet.add(e.currency);
      const inBase = toDisplayBase(amt, e.currency);
      if (e.direction === "dr") { dr += amt; drBase += inBase; }
      else { cr += amt; crBase += inBase; }
    }
    const refType = account?.type || "liability";
    const incCr = CREDIT_NORMAL.has(refType);
    const delta = incCr ? cr - dr : dr - cr;
    const deltaBase = incCr ? crBase - drBase : drBase - crBase;
    const singleCcy = ccySet.size === 1 ? [...ccySet][0] : null;
    return { dr, cr, delta, drBase, crBase, deltaBase, singleCcy };
  }, [filteredEntries, account, toDisplayBase]);

  if (!open) return null;
  if (!isCpMode && !account) return null;
  if (isCpMode && !cpData) return null;

  // === Header ===
  let titleNode;
  if (isCpMode) {
    titleNode = (
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-accent-bg text-accent flex items-center justify-center font-bold text-body-sm">
          {(cpData.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[17px] font-bold tracking-tight text-ink">{cpData.name}</span>
            {cpData.isReferral && (
              <span className="text-tiny font-semibold text-success uppercase tracking-wider">реферал</span>
            )}
          </div>
          <div className="text-caption text-muted mt-0.5">
            {cpKind === "client" ? t("trv2_cp_kind_client") : t("trv2_cp_kind_partner")}
            {cpData.telegram ? ` · ${cpData.telegram}` : ""}
            {cpData.tag ? ` · ${cpData.tag}` : ""}
          </div>
        </div>
      </div>
    );
  } else {
    const officeName = account.officeId ? (findOffice(account.officeId)?.name || account.officeId) : null;
    const subtypeLabel = account.subtype ? t(SUBTYPE_LABEL_KEYS[account.subtype] || "trv2_subtype_other") : null;
    const typeLabel = t(TYPE_LABEL[account.type] || "trv2_acctype_asset");
    const cpName = dim && ctx?.counterpartyName ? (() => {
      try { return ctx.counterpartyName(cpId); } catch { return null; }
    })() : null;
    // В group-mode заголовок — название кассы (без " · CCY") + список валют
    if (isGroupMode) {
      titleNode = (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-accent-bg text-accent flex items-center justify-center font-bold text-body-sm">
            {(groupCtx.kassaName || "?").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[17px] font-bold tracking-tight text-ink">{groupCtx.kassaName}</span>
              <span className="text-tiny font-mono tabular text-muted-soft">{groupCtx.accounts.length} валют</span>
            </div>
            <div className="text-caption text-muted mt-0.5">
              {typeLabel}
              {subtypeLabel ? ` · ${subtypeLabel}` : ""}
              {officeName ? ` · ${officeName}` : ""}
            </div>
          </div>
        </div>
      );
    } else {
      titleNode = (
        <div className="flex items-center gap-3">
          <CurrencyIcon ccy={account.currency} size="md" />
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-tiny text-muted-soft">{account.code}</span>
              <span className="text-[17px] font-bold tracking-tight text-ink">
                {cpName ? `${cpName}` : account.name}
              </span>
              {cpName && <span className="text-caption text-muted">· {account.name}</span>}
            </div>
            <div className="text-caption text-muted mt-0.5">
              {typeLabel}
              {subtypeLabel ? ` · ${subtypeLabel}` : ""}
              {officeName ? ` · ${officeName}` : ""}
            </div>
          </div>
        </div>
      );
    }
  }

  // === Balance block ===
  let balanceNode;
  if (isCpMode) {
    // Multi-currency KPI grid + кнопка «+ Валюта» (открывает CreateLiabilityDialog
    // с preselected клиентом/партнёром для добавления нового остатка).
    balanceNode = (
      <div>
        <div className="flex items-center justify-between mb-2 gap-3">
          <div className="text-tiny text-muted uppercase tracking-wider font-semibold">
            {t("trv2_detail_balance")} · {t("trv2_detail_total")}: <span className="font-mono tabular text-ink">{formatBase(cpData.totalInBase, baseCurrency)}</span>
          </div>
          {canAddAccount && (
            <button
              type="button"
              onClick={() => setAddCurrencyOpen(true)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-button bg-ink text-white text-caption font-semibold hover:bg-black transition-colors"
              title="Добавить новую валюту/начальный остаток"
            >
              <Plus className="w-3 h-3" strokeWidth={2.5} />
              Валюта
            </button>
          )}
        </div>
        {cpData.byCurrency.length === 0 ? (
          <div className="text-caption text-muted-soft text-center py-3">
            У контрагента нет балансов. Жми «+ Валюта» чтобы создать начальный остаток.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {cpData.byCurrency.map((c) => (
              <div key={c.currency} className="bg-surface rounded-card p-2.5 border border-border-soft">
                <div className="flex items-center gap-1.5 mb-1">
                  <CurrencyIcon ccy={c.currency} size="sm" />
                  <span className="text-caption font-bold text-ink-soft tracking-wider">{c.currency}</span>
                </div>
                <div className="font-mono tabular text-body font-bold text-ink">{fmtAmount(c.balance)}</div>
                <div className="font-mono tabular text-tiny text-muted-soft mt-0.5">
                  ≈ {formatBase(c.balanceInBase, baseCurrency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else if (isGroupMode) {
    // Multi-currency KPI per sibling account — каждая ячейка кликабельна для inline-edit
    balanceNode = (
      <div>
        <div className="flex items-center justify-between mb-2 gap-3">
          <div className="text-tiny text-muted uppercase tracking-wider font-semibold">
            {t("trv2_detail_balance")} · {t("trv2_detail_total")}: <span className="font-mono tabular text-ink">{formatBase(groupCtx.totalInBase, baseCurrency)}</span>
          </div>
          {canAddAccount && (
            <button
              type="button"
              onClick={() => setAddCurrencyOpen(true)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-button bg-ink text-white text-caption font-semibold hover:bg-black transition-colors"
              title="Добавить новую валюту в эту кассу"
            >
              <Plus className="w-3 h-3" strokeWidth={2.5} />
              Валюта
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {groupCtx.accounts.map((a) => {
            const isBase = a.currency === baseCurrency;
            return (
              <div key={a.accountId} className="bg-surface rounded-card p-2.5 border border-border-soft">
                <div className="flex items-center gap-1.5 mb-1">
                  <CurrencyIcon ccy={a.currency} size="sm" />
                  <span className="text-caption font-bold text-ink-soft tracking-wider">{a.currency}</span>
                  <span className="text-tiny text-muted-soft font-mono ml-auto">{a.code}</span>
                </div>
                <div className="font-mono tabular text-body font-bold text-ink" onClick={(e) => e.stopPropagation()}>
                  <InlineBalanceEditor
                    account={{
                      code: a.code, currency: a.currency,
                      type: groupCtx.type, subtype: groupCtx.subtype,
                      balance: a.balance,
                    }}
                    displayMul={1}
                    accounts={ctx?.accounts || []}
                    suffix={a.currency}
                    balanceOverride={a.balance}
                  />
                </div>
                {!isBase && (
                  <div className="font-mono tabular text-tiny text-muted-soft mt-0.5">
                    ≈ {formatBase(a.balanceInBase, baseCurrency)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  } else {
    const isBaseCcy = account.currency === baseCurrency;
    balanceNode = (
      <div>
        <div className="text-tiny text-muted uppercase tracking-wider font-semibold mb-2">
          {t("trv2_detail_balance")}
        </div>
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="text-[26px] font-bold font-mono tabular text-ink">
            {fmtAmount(balanceNative)} <span className="text-body-sm text-muted ml-1">{account.currency}</span>
          </span>
          {!isBaseCcy && (
            <span className="text-body text-muted-soft font-mono tabular">
              ≈ {formatBase(balanceInBase, baseCurrency)}
            </span>
          )}
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <InlineBalanceEditor
              account={{
                code: account.code,
                currency: account.currency,
                type: account.type,
                subtype: account.subtype,
                balance: balanceNative,
              }}
              displayMul={1}
              accounts={ctx?.accounts || []}
              suffix={account.currency}
              clientId={clientId}
              partnerId={partnerId}
              balanceOverride={balanceNative}
            />
          </span>
        </div>
      </div>
    );
  }

  // Currency tabs (CP-mode и group-mode — multi-currency views)
  const tabCurrencies = isCpMode
    ? cpData.byCurrency.map((c) => c.currency)
    : isGroupMode
      ? groupCtx.currencies
      : null;
  const currencyTabs = tabCurrencies ? (
    <div className="px-5 py-2 border-b border-border-soft flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => setActiveCcy("__all__")}
        className={`h-7 px-2.5 rounded-button text-caption font-semibold transition-colors ${
          activeCcy === "__all__" ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
        }`}
      >
        {t("trv2_detail_ccy_all")}
      </button>
      {tabCurrencies.map((ccy) => (
        <button
          key={ccy}
          type="button"
          onClick={() => setActiveCcy(ccy)}
          className={`h-7 px-2.5 rounded-button text-caption font-semibold transition-colors inline-flex items-center gap-1.5 ${
            activeCcy === ccy ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
          }`}
        >
          <CurrencyIcon ccy={ccy} size="sm" />
          {ccy}
        </button>
      ))}
    </div>
  ) : null;

  // Дт/Кт display for an entry — visible на «прирост» зеленым.
  const refType = isCpMode ? "liability" : (account?.type || "asset");
  const incCr = CREDIT_NORMAL.has(refType);
  const ccyLabel = (isCpMode || isGroupMode)
    ? (activeCcy === "__all__" ? "" : activeCcy)
    : account.currency;

  return (
    <Modal open={open} onClose={onClose} width="4xl">
      <div className="px-5 py-4 border-b border-border-soft flex items-start justify-between gap-3">
        <div>{titleNode}</div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-button hover:bg-surface-sunk text-muted hover:text-ink transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Balance block */}
      <div className="px-5 py-4 border-b border-border-soft bg-surface-soft/40">
        {balanceNode}
      </div>

      {currencyTabs}

      {/* Period: date range + quick presets + base picker */}
      <div className="px-5 py-3 border-b border-border-soft flex items-center gap-2 flex-wrap">
        <Calendar className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
        <span className="text-caption text-muted font-semibold mr-1">{t("trv2_detail_period")}:</span>
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="h-7 px-2 text-caption font-mono tabular bg-surface-sunk text-ink rounded-button border border-transparent focus:border-border focus:bg-surface focus:outline-none transition-colors"
        />
        <span className="text-muted">—</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="h-7 px-2 text-caption font-mono tabular bg-surface-sunk text-ink rounded-button border border-transparent focus:border-border focus:bg-surface focus:outline-none transition-colors"
        />
        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-border-soft">
          <button type="button" onClick={() => applyPreset(7)} className="h-7 px-2 rounded-button text-caption text-muted-soft hover:text-ink hover:bg-surface-soft transition-colors">{t("trv2_period_week")}</button>
          <button type="button" onClick={() => applyPreset(30)} className="h-7 px-2 rounded-button text-caption text-muted-soft hover:text-ink hover:bg-surface-soft transition-colors">{t("trv2_period_month")}</button>
          <button type="button" onClick={() => applyPreset(365)} className="h-7 px-2 rounded-button text-caption text-muted-soft hover:text-ink hover:bg-surface-soft transition-colors">{t("trv2_period_year")}</button>
          <button type="button" onClick={() => applyPreset(null)} className="h-7 px-2 rounded-button text-caption text-muted-soft hover:text-ink hover:bg-surface-soft transition-colors">{t("trv2_period_all")}</button>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-tiny text-muted-soft uppercase tracking-wider font-bold">≈</span>
          <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
            {BASE_OPTIONS.map((ccy) => (
              <button
                key={ccy}
                type="button"
                onClick={() => setDisplayBase(ccy)}
                className={`h-6 px-2 rounded-pill text-tiny font-bold tracking-wider transition-colors ${
                  displayBase === ccy ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                {ccy}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-5 py-2 border-b border-border-soft">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("trv2_detail_search_ph")}
            className="w-full h-8 pl-8 pr-3 text-body-sm bg-surface-sunk rounded-button border border-transparent focus:border-border focus:bg-surface focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Остаток на начало периода — горизонтальная полоса как в 1С */}
      <div className="px-5 py-2 border-b border-border-soft bg-surface-soft/40 flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-tiny text-muted uppercase tracking-wider font-bold">
          Остаток на {period ? new Date(period.from).toISOString().slice(0, 10) : "начало"}
        </span>
        <span className="font-mono tabular text-body-sm font-bold text-ink-soft">
          {!isCpMode && !isGroupMode && account ? (
            <>
              <span>{fmtAmount(osv.openingNative)} {account.currency}</span>
              {account.currency !== displayBase && (
                <span className="text-muted-soft ml-2">≈ {fmtBase(osv.opening)}</span>
              )}
            </>
          ) : (
            <span>{fmtBase(osv.opening)}</span>
          )}
        </span>
      </div>

      {/* Entries table — жёсткая сетка с vertical dividers */}
      <div className="max-h-[420px] overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="px-5 py-10 text-center text-caption text-muted">
            {t("trv2_no_entries")}
          </div>
        ) : (
          <table className="w-full text-caption border-collapse table-fixed">
            <colgroup>
              <col className="w-[88px]" />
              <col />
              <col className="w-[220px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
              <col className="w-[110px]" />
              <col className="w-[90px]" />
            </colgroup>
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="border-b-2 border-border-soft">
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 border-r border-border-soft">{t("trv2_detail_col_date")}</th>
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_detail_col_descr")}</th>
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_detail_col_contra")}</th>
                <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_col_dr")}</th>
                <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft">{t("trv2_col_cr")}</th>
                <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 border-r border-border-soft whitespace-nowrap">≈&nbsp;{displayBase}</th>
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2">{t("trv2_detail_col_doc")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((e, idx) => {
                const isDr = e.direction === "dr";
                const grows = isDr === !incCr;
                const amtStr = `${fmtAmount(e.amount)} ${e.currency}`;
                const contra = contraOf(e);
                const inBase = toDisplayBase(e.amount, e.currency);
                const baseStr = fmtBase(inBase);
                const isExpanded = expandedTxId === e.txId;
                return (
                  <React.Fragment key={e.id}>
                  <tr className={`border-b border-border-soft transition-colors ${idx % 2 === 1 ? "bg-surface-soft/40" : ""} ${isExpanded ? "bg-accent-bg" : "hover:bg-surface-soft"}`}>
                    <td className="px-3 py-1.5 text-muted font-mono tabular text-tiny whitespace-nowrap border-r border-border-soft">
                      {new Date(e.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-2 py-1.5 border-r border-border-soft">
                      <span className="text-body-sm text-ink truncate block">{e.note || e.txKind}</span>
                    </td>
                    <td className="px-2 py-1.5 border-r border-border-soft">
                      {contra ? (
                        <span className="flex items-baseline gap-1.5 truncate">
                          <span className="font-mono text-tiny text-muted-soft shrink-0">{contra.code}</span>
                          <span className="text-body-sm text-ink-soft truncate">{contra.name}</span>
                        </span>
                      ) : <span className="text-muted-soft">—</span>}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono tabular whitespace-nowrap border-r border-border-soft ${isDr ? (grows ? "text-success font-bold" : "text-danger font-semibold") : "text-muted-soft"}`}>
                      {isDr ? amtStr : "—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono tabular whitespace-nowrap border-r border-border-soft ${!isDr ? (grows ? "text-success font-bold" : "text-danger font-semibold") : "text-muted-soft"}`}>
                      {!isDr ? amtStr : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular text-muted-soft whitespace-nowrap border-r border-border-soft">
                      {baseStr}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setExpandedTxId(isExpanded ? null : e.txId)}
                        className="text-accent hover:text-accent-hover transition-colors font-mono text-tiny"
                        title={isExpanded ? "Свернуть проводки" : "Показать проводки документа"}
                      >
                        {e.sourceRefId || e.txId.slice(0, 8)} {isExpanded ? "▾" : "→"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-accent-bg/40">
                      <td colSpan={7} className="px-3 pb-2 border-b border-border-soft">
                        <div className="text-tiny text-muted uppercase tracking-wider font-bold pt-2 pb-0.5">
                          Проводки документа · {e.txKind}{e.sourceRefId ? ` · #${e.sourceRefId}` : ""}
                        </div>
                        <TransactionEntries entries={legsFor(e.txId)} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Обороты за период — компактная строка */}
      <div className="px-5 py-2 border-t border-border-soft bg-surface-soft/40 flex items-baseline justify-between gap-3 flex-wrap text-caption">
        <span className="text-tiny text-muted uppercase tracking-wider font-bold">
          Обороты {period ? `${new Date(period.from).toISOString().slice(0, 10)} — ${new Date(period.to).toISOString().slice(0, 10)}` : "за всё время"} · {filteredEntries.length} проводок
        </span>
        <div className="flex items-baseline gap-4 font-mono tabular">
          {turnover.singleCcy && (
            <>
              <span className="text-muted-soft">Дт: <span className="text-ink font-bold">{fmtAmount(turnover.dr)} {turnover.singleCcy}</span></span>
              <span className="text-muted-soft">Кт: <span className="text-ink font-bold">{fmtAmount(turnover.cr)} {turnover.singleCcy}</span></span>
            </>
          )}
          <span className="text-muted-soft">≈ Дт: <span className="text-ink font-bold">{fmtBase(turnover.drBase)}</span></span>
          <span className="text-muted-soft">≈ Кт: <span className="text-ink font-bold">{fmtBase(turnover.crBase)}</span></span>
        </div>
      </div>

      {/* Остаток на конец периода — финальная подсветка как в 1С */}
      <div className="px-5 py-2.5 border-t border-border-soft bg-success-soft flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-tiny text-success uppercase tracking-wider font-bold">
          Остаток на {period ? new Date(period.to).toISOString().slice(0, 10) : "конец"}
        </span>
        <span className="font-mono tabular text-body font-bold text-success">
          {!isCpMode && !isGroupMode && account ? (
            <>
              <span>{fmtAmount(osv.closingNative)} {account.currency}</span>
              {account.currency !== displayBase && (
                <span className="opacity-70 ml-2">≈ {fmtBase(osv.closing)}</span>
              )}
            </>
          ) : (
            <span>{fmtBase(osv.closing)}</span>
          )}
        </span>
      </div>
      {isGroupMode && addCurrencyOpen && (
        <ChartAccountModal
          open
          onClose={() => setAddCurrencyOpen(false)}
          defaultOfficeId={groupCtx.officeId}
          defaultType={groupCtx.type}
          defaultSubtype={groupCtx.subtype}
        />
      )}
      {isCpMode && addCurrencyOpen && (
        <CreateLiabilityDialog
          open
          onClose={() => setAddCurrencyOpen(false)}
          ctx={ctx}
          clients={ctx?.clients || []}
          partners={ctx?.partners || []}
          defaultKind={cpKind}
          defaultCounterpartyId={cpId}
        />
      )}
    </Modal>
  );
}
