// src/pages/AccountsPage.jsx
// Иерархия: Office → Currency (collapsible) → Channel → Account.
// Дефолт — все currency-строки свёрнуты; видны: code, total, available.
// Клик раскрывает — показывает только non-empty каналы с account-карточками.

import React, { useState, useMemo, useCallback } from "react";
import {
  Plus,
  ArrowLeftRight,
  History as HistoryIcon,
  Scale,
  Building2,
  Network as NetworkIcon,
  Clock,
  CheckCircle2,
  ChevronRight,
  Trash2,
  Pencil,
  Download,
  Upload,
  ArrowLeftRight as ArrowLeftRightIcon,
  Wallet as WalletIcon,
  ChevronUp,
  ChevronDown,
  HelpCircle,
  Share2,
} from "lucide-react";
import { useAccounts } from "../store/accounts.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useAudit } from "../store/audit.jsx";
import { useAuth } from "../store/auth.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useCurrencies } from "../store/currencies.jsx";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { resolveAccountChannel, channelShortLabel } from "../utils/accountChannel.js";
import TopUpModal from "../components/accounts/TopUpModal.jsx";
import BalanceAdjustmentModal from "../components/accounts/BalanceAdjustmentModal.jsx";
import TransferModal from "../components/accounts/TransferModal.jsx";
import AccountHistoryModal from "../components/accounts/AccountHistoryModal.jsx";
import TransferHistoryModal from "../components/accounts/TransferHistoryModal.jsx";
import OtcDealModal from "../components/OtcDealModal.jsx";
import AddAccountModal from "../components/accounts/AddAccountModal.jsx";
import EditAccountModal from "../components/accounts/EditAccountModal.jsx";
import DeleteDealButton from "../components/DeleteDealButton.jsx";
import DeleteTransferButton from "../components/DeleteTransferButton.jsx";
import AccountsImportModal from "../components/accounts/AccountsImportModal.jsx";
import AccountsTree from "../components/accounts/AccountsTree.jsx";
import ShareLinksModal from "../components/accounts/ShareLinksModal.jsx";
import ImportWalletsModal from "../components/accounts/ImportWalletsModal.jsx";
import CryptoAccountsList from "../components/accounts/crypto/CryptoAccountsList.jsx";
import WalletDetail from "../components/accounts/crypto/WalletDetail.jsx";
import { fetchWalletDetail } from "../lib/aegisMonitoring.js";
import { exportCSV } from "../utils/csv.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { deactivateAccountRow, withToast } from "../lib/supabaseWrite.js";
import { useCan } from "../store/permissions.jsx";

const CURRENCY_ORDER = ["USD", "USDT", "EUR", "TRY", "GBP"];
const curIndex = (code) => {
  const i = CURRENCY_ORDER.indexOf(code);
  return i === -1 ? 999 : i;
};

// Excel-style единая сетка для Office strip и CurrencyRow.
// Колонки: name(1fr) | today | yesterday | reserved | total | available | actions
// Цифры в одинаковых колонках = вертикальное выравнивание под Office.
const ACCT_GRID_COLS = "minmax(180px,1fr) 110px 110px 100px 130px 130px 70px";

// Delta helpers — общие правила форматирования "+$1,200" / "−€300" /
// "+$0". Всегда возвращает строку — нули показываются нейтральным
// цветом (slate-400) чтобы юзер видел что действительно нет движений.
function fmtDelta(value, currency, opts = {}) {
  const v = Number.isFinite(value) ? value : 0;
  const symStr = opts.symbol === false ? "" : curSymbol(currency);
  if (Math.abs(v) < 0.01) return `+${symStr}0`;
  const sign = v > 0 ? "+" : "−";
  return `${sign}${symStr}${fmt(Math.abs(v), currency)}`;
}
function deltaClass(value) {
  if (!Number.isFinite(value)) return "text-muted-soft";
  if (value > 0.01) return "text-success";
  if (value < -0.01) return "text-danger";
  return "text-muted-soft";
}

// Одна delta-ячейка для Excel-style сетки. Без подписи, цвет по знаку.
function DeltaCell({ value, currency, className = "" }) {
  const cls = deltaClass(value);
  return (
    <span className={`tabular-nums text-tiny font-semibold ${cls} ${className}`}>
      {fmtDelta(value, currency)}
    </span>
  );
}

// Inline пара "сегодня / вчера" через слэш с явными подписями.
function DeltaPair({ today, yesterday, currency, size = "xs" }) {
  const todayStr = fmtDelta(today, currency);
  const yStr = yesterday !== undefined ? fmtDelta(yesterday, currency) : null;
  const sizeCls = size === "sm" ? "text-tiny" : "text-tiny";
  const labelCls = size === "sm" ? "text-micro" : "text-[8px]";
  return (
    <span
      className={`inline-flex items-baseline gap-1 ${sizeCls} font-bold tabular-nums`}
      title={yStr ? "сегодня / вчера" : "Изменение с начала дня"}
    >
      <span className={`inline-flex items-baseline gap-0.5 ${deltaClass(today)}`}>
        {todayStr}
        <span className={`${labelCls} font-semibold opacity-70`}>сегодня</span>
      </span>
      {yStr && (
        <>
          <span className="text-muted-soft font-normal">/</span>
          <span className={`inline-flex items-baseline gap-0.5 ${deltaClass(yesterday)}`}>
            {yStr}
            <span className={`${labelCls} font-semibold opacity-70`}>вчера</span>
          </span>
        </>
      )}
    </span>
  );
}

export default function AccountsPage({ onOpenHelp = null }) {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf, availableOf, deltaOf, deactivateAccount, movements, transfers } = useAccounts();
  const { transactions } = useTransactions();
  const { addEntry: logAudit } = useAudit();
  const { currentUser } = useAuth();
  const can = useCan();
  const canEditAccount = can("accounting", "edit") || can("settings", "edit");
  const canManageOffices = currentUser?.role === "admin" || currentUser?.role === "owner";
  const { activeOffices, swapOfficesOrder } = useOffices();
  const { dict: curDict } = useCurrencies();
  const { channels } = useRates();
  const { base, toBase } = useBaseCurrency();

  // Крипто-раздел: {account, ledgerUsd} + единый таймстемп (макс synced_at).
  const cryptoItems = useMemo(
    () =>
      accounts
        .filter((a) => a.active && a.kind === "crypto")
        .map((a) => ({ account: a, ledgerUsd: toBase(balanceOf(a.id), a.currency) })),
    [accounts, balanceOf, toBase]
  );
  const cryptoAsOf = useMemo(() => {
    const ts = cryptoItems.map((i) => i.account.syncedAt).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : new Date().toISOString();
  }, [cryptoItems]);
  // Drill-down (Экран 3) + подгрузка reasons в плашку списка.
  const [detailWallet, setDetailWallet] = useState(null); // { account, ledgerUsd }
  const [reasonsById, setReasonsById] = useState({});
  const openWallet = useCallback(
    (account) => setDetailWallet({ account, ledgerUsd: toBase(balanceOf(account.id), account.currency) }),
    [toBase, balanceOf]
  );
  const requestReasons = useCallback((account) => {
    fetchWalletDetail(account.id).then(
      (d) => setReasonsById((m) => ({ ...m, [account.id]: d?.wallet?.riskReasons || [] })),
      () => {}
    );
  }, []);
  const sym = curSymbol(base);

  // Период для delta — сегодня + вчера (для сравнения через слэш).
  const { dayStartMs, yesterdayStartMs } = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const today = d.getTime();
    return { dayStartMs: today, yesterdayStartMs: today - 24 * 60 * 60 * 1000 };
  }, []);

  // Delta helpers (fmtDelta / deltaClass / DeltaPair) — module-level,
  // доступны также CurrencyRow и любым sub-компонентам.

  const [topUpFor, setTopUpFor] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);
  const [transferFrom, setTransferFrom] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [transferHistoryOpen, setTransferHistoryOpen] = useState(false);
  const [otcOpen, setOtcOpen] = useState(false);
  const [otcFromAccount, setOtcFromAccount] = useState(null);
  const [addAccountFor, setAddAccountFor] = useState(null);
  const [editAccountFor, setEditAccountFor] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [shareOpen, setShareOpen] = useState(false);
  const [walletImportOpen, setWalletImportOpen] = useState(false);

  const handleExportAccounts = () => {
    if (accounts.length === 0) return;
    exportCSV({
      filename: `coinplata-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { key: "office", label: "Office" },
        { key: "name", label: "Account" },
        { key: "currency", label: "Currency" },
        { key: "type", label: "Type" },
        { key: "balance", label: "Balance" },
        { key: "reserved", label: "Reserved" },
        { key: "available", label: "Available" },
        { key: "active", label: "Active" },
        { key: "address", label: "Address" },
        { key: "network", label: "Network" },
      ],
      rows: accounts.map((a) => ({
        office: officeName(a.officeId) || a.officeId,
        name: a.name,
        currency: a.currency,
        type: a.type || "",
        balance: balanceOf(a.id),
        reserved: reservedOf(a.id),
        available: availableOf(a.id),
        active: a.active ? "yes" : "no",
        address: a.address || "",
        network: a.network || "",
      })),
    });
  };

  const handleDeleteAccount = async (acc) => {
    if (!confirm(`Deactivate account "${acc.name}"? It will disappear from dropdowns; movements stay intact.`)) return;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => deactivateAccountRow(acc.id),
        { success: "Account deactivated", errorPrefix: "Failed" }
      );
      if (!res.ok) return;
    } else {
      deactivateAccount(acc.id);
    }
    logAudit({
      action: "delete",
      entity: "account",
      entityId: acc.id,
      summary: `Deactivated account "${acc.name}" (${acc.currency})`,
    });
  };

  // По умолчанию валюты-блоки СВЁРНУТЫ — юзер раскрывает сам клик-ом по
  // строке. (Раньше пробовал default-open, юзер откатил: оставлять
  // закрытыми, но сами строки/счета внутри сделать крупнее.)
  const [openMap, setOpenMap] = useState({});
  const toggleOpen = (key) =>
    setOpenMap((prev) => ({ ...prev, [key]: !prev[key] }));

  // Группировка: office → currencies. Показываем только currencies, для которых
  // есть хотя бы один active account в этом офисе. Office-блоки без аккаунтов:
  //   - admin/owner — рендерим (чтобы свежесозданный офис был виден и можно
  //     было сразу добавить в него счёт);
  //   - остальные — скрываем (для scoped менеджеров RLS режет accounts, но
  //     не offices — без скрытия они видели "карточки-тени" чужих офисов).
  const officeBlocks = useMemo(() => {
    return activeOffices
      .map((office) => {
      const officeAccs = accounts.filter((a) => a.officeId === office.id && a.active);
      const codes = [...new Set(officeAccs.map((a) => a.currency))].sort((a, b) => {
        const d = curIndex(a) - curIndex(b);
        return d !== 0 ? d : a.localeCompare(b);
      });

      const currencyBlocks = codes.map((code) => {
        const meta = curDict[code] || { code, type: "fiat", symbol: "" };
        const accsForCur = officeAccs.filter((a) => a.currency === code);

        // Группируем по каналу и удаляем пустые.
        const byChannel = new Map();
        accsForCur.forEach((a) => {
          const ch = resolveAccountChannel(a, channels) || {
            id: "__unresolved__",
            kind: a.type || "cash",
            currencyCode: code,
          };
          if (!byChannel.has(ch.id)) byChannel.set(ch.id, { channel: ch, accounts: [] });
          byChannel.get(ch.id).accounts.push(a);
        });

        // Сортировка каналов: default → остальные по id.
        const channelBlocks = [...byChannel.values()]
          .filter((b) => b.accounts.length > 0)
          .sort((a, b) => {
            if (a.channel.isDefaultForCurrency && !b.channel.isDefaultForCurrency) return -1;
            if (!a.channel.isDefaultForCurrency && b.channel.isDefaultForCurrency) return 1;
            return (a.channel.id || "").localeCompare(b.channel.id || "");
          });

        let total = 0;
        let reserved = 0;
        let delta = 0;
        let deltaYesterday = 0;
        accsForCur.forEach((a) => {
          total += balanceOf(a.id);
          reserved += reservedOf(a.id);
          delta += deltaOf(a.id, dayStartMs);
          deltaYesterday += deltaOf(a.id, yesterdayStartMs, dayStartMs);
        });

        return {
          currency: meta,
          totals: { total, reserved, available: total - reserved, delta, deltaYesterday },
          channelBlocks,
          accountsCount: accsForCur.length,
        };
      });

      // Office totals в base currency.
      let officeTotalBase = 0;
      let officeReservedBase = 0;
      let officeDeltaBase = 0;
      let officeDeltaYestBase = 0;
      officeAccs.forEach((a) => {
        officeTotalBase += toBase(balanceOf(a.id), a.currency);
        officeReservedBase += toBase(reservedOf(a.id), a.currency);
        officeDeltaBase += toBase(deltaOf(a.id, dayStartMs), a.currency);
        officeDeltaYestBase += toBase(
          deltaOf(a.id, yesterdayStartMs, dayStartMs),
          a.currency
        );
      });

      return {
        office,
        totals: {
          total: officeTotalBase,
          reserved: officeReservedBase,
          available: officeTotalBase - officeReservedBase,
          delta: officeDeltaBase,
          deltaYesterday: officeDeltaYestBase,
          hasReserved: officeReservedBase > 0,
        },
        currencyBlocks,
        accsCount: officeAccs.length,
      };
    })
    .filter((block) => canManageOffices || block.accsCount > 0);
  }, [accounts, activeOffices, channels, curDict, balanceOf, reservedOf, deltaOf, dayStartMs, yesterdayStartMs, toBase, canManageOffices]);

  const grandTotal = officeBlocks.reduce((s, ob) => s + ob.totals.total, 0);
  const grandReserved = officeBlocks.reduce((s, ob) => s + ob.totals.reserved, 0);
  const grandDelta = officeBlocks.reduce((s, ob) => s + ob.totals.delta, 0);
  const grandDeltaYesterday = officeBlocks.reduce(
    (s, ob) => s + ob.totals.deltaYesterday,
    0
  );

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 space-y-4">
      {/* Header — title + totals */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight">{t("accounts_title")}</h1>
            {onOpenHelp && (
              <button
                type="button"
                onClick={() => onOpenHelp({ sectionId: "accounts" })}
                title="Справка по разделу «Счета»"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-muted-soft hover:text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <HelpCircle className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <p className="text-caption text-muted">{t("accounts_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompactTotals total={grandTotal} reserved={grandReserved} sym={sym} />
          <span
            className="inline-flex items-center px-2.5 py-1.5 rounded-card bg-surface-soft ring-1 ring-border-soft"
            title="Сегодня / вчера по всем офисам"
          >
            <DeltaPair
              today={grandDelta}
              yesterday={grandDeltaYesterday}
              currency={base}
              size="sm"
            />
          </span>
        </div>
      </div>

      {/* Actions bar — primary actions слева, secondary справа */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setTransferFrom(null);
              setTransferOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-card bg-ink text-white text-body-sm font-semibold hover:bg-ink transition-colors shadow-[0_2px_8px_rgba(15,23,42,0.15)]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            {t("acc_transfer") || "Перевод"}
          </button>
          <button
            onClick={() => {
              setOtcFromAccount(null);
              setOtcOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-card bg-indigo-600 text-white text-body-sm font-semibold hover:bg-indigo-700 transition-colors shadow-[0_2px_8px_rgba(79,70,229,0.25)]"
            title="OTC сделка — обмен между счетами / с контрагентом, можно задним числом"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            OTC сделка
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-border-soft text-ink-soft hover:text-ink hover:border-border text-caption font-semibold transition-colors"
            title={t("acc_import_tip") || "Import accounts from CSV"}
          >
            <Upload className="w-3.5 h-3.5" />
            {t("acc_import") || "Импорт"}
          </button>
          <button
            onClick={handleExportAccounts}
            disabled={accounts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-card bg-white border border-border-soft text-ink-soft hover:text-ink hover:border-border text-caption font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t("acc_export_tip") || "Export accounts to CSV"}
          >
            <Download className="w-3.5 h-3.5" />
            {t("export_csv") || "Экспорт"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-border-soft rounded-card p-1 flex gap-0.5 overflow-x-auto">
        {[
          { id: "all", label: "Все" },
          { id: "fiat", label: "Фиат" },
          { id: "crypto", label: "Крипто" },
          { id: "otc", label: "История OTC" },
          { id: "transfers", label: "Перемещения" },
          { id: "ledger", label: "Журнал" },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-button text-body-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-ink text-white"
                  : "text-ink-soft hover:bg-surface-soft hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB: Все/Фиат/Крипто — дерево счетов офис→валюта→счета, фильтр по типу. */}
      {(activeTab === "all" || activeTab === "fiat" || activeTab === "crypto") && (
        <>
          <div className="flex justify-end gap-1 -mb-1">
            {(activeTab === "crypto" || activeTab === "all") && (
              <button
                type="button"
                onClick={() => setWalletImportOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-button text-body-sm font-medium text-ink-soft hover:bg-surface-soft hover:text-ink transition-colors"
                title="Импорт кошельков из CSV (name,address,network) + регистрация в AEGIS"
              >
                <Upload className="w-4 h-4" strokeWidth={2} /> Импорт кошельков
              </button>
            )}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-button text-body-sm font-medium text-ink-soft hover:bg-surface-soft hover:text-ink transition-colors"
              title="Создать публичную read-only ссылку на этот разрез"
            >
              <Share2 className="w-4 h-4" strokeWidth={2} /> Поделиться
            </button>
          </div>
          {activeTab === "crypto" ? (
            <CryptoAccountsList
              items={cryptoItems}
              offices={activeOffices}
              mode="authed"
              asOf={cryptoAsOf}
              onOpenWallet={openWallet}
              reasonsById={reasonsById}
              onRequestReasons={requestReasons}
            />
          ) : (
            <AccountsTree kindFilter={activeTab} />
          )}
        </>
      )}

      {shareOpen && (
        <ShareLinksModal scope={activeTab} onClose={() => setShareOpen(false)} />
      )}
      {walletImportOpen && <ImportWalletsModal onClose={() => setWalletImportOpen(false)} />}
      {detailWallet && (
        <WalletDetail account={detailWallet.account} ledgerUsd={detailWallet.ledgerUsd} onBack={() => setDetailWallet(null)} />
      )}

      {false && activeTab === "operations" && officeBlocks.map((block, blockIdx) => {
        const { office, totals, currencyBlocks, accsCount } = block;
        const isFirstBlock = blockIdx === 0;
        const isLastBlock = blockIdx === officeBlocks.length - 1;
        return (
          <section
            key={office.id}
            className="bg-white rounded-card border border-border-soft overflow-hidden"
          >
            {/* Office strip — Excel-style grid */}
            <div
              className="px-4 py-2 border-b border-border-soft grid items-center gap-x-3 bg-surface-soft/40"
              style={{ gridTemplateColumns: ACCT_GRID_COLS }}
            >
              {/* Col 1: имя + стрелки порядка (admin/owner) */}
              <div className="flex items-center gap-2 min-w-0">
                {canManageOffices && (
                  <div className="flex flex-col items-center gap-0 shrink-0 -my-1">
                    <button
                      onClick={() => {
                        const prev = officeBlocks[blockIdx - 1];
                        if (prev) swapOfficesOrder(office.id, prev.office.id);
                      }}
                      disabled={isFirstBlock}
                      className="p-0 rounded text-muted-soft hover:text-ink hover:bg-surface-sunk disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                      title="Переместить выше"
                    >
                      <ChevronUp className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={() => {
                        const next = officeBlocks[blockIdx + 1];
                        if (next) swapOfficesOrder(office.id, next.office.id);
                      }}
                      disabled={isLastBlock}
                      className="p-0 rounded text-muted-soft hover:text-ink hover:bg-surface-sunk disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                      title="Переместить ниже"
                    >
                      <ChevronDown className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                  </div>
                )}
                <Building2 className="w-3.5 h-3.5 text-muted shrink-0" />
                <h2 className="text-body-sm font-semibold tracking-tight truncate">{office.name}</h2>
                <span className="text-tiny text-muted-soft shrink-0">· {accsCount}</span>
              </div>
              {/* Col 2: сегодня */}
              <div className="text-right">
                <div className="text-[8px] font-bold text-muted-soft uppercase tracking-wider leading-none mb-0.5">сегодня</div>
                <DeltaCell value={totals.delta} currency={base} />
              </div>
              {/* Col 3: вчера */}
              <div className="text-right">
                <div className="text-[8px] font-bold text-muted-soft uppercase tracking-wider leading-none mb-0.5">вчера</div>
                <DeltaCell value={totals.deltaYesterday} currency={base} />
              </div>
              {/* Col 4: reserved */}
              <div className="text-right">
                <div className="text-[8px] font-bold text-muted-soft uppercase tracking-wider leading-none mb-0.5">резерв</div>
                {totals.hasReserved ? (
                  <span className="tabular-nums text-tiny font-semibold text-warning">
                    {sym}{fmt(totals.reserved)}
                  </span>
                ) : (
                  <span className="text-muted-soft text-tiny">—</span>
                )}
              </div>
              {/* Col 5: total */}
              <div className="text-right">
                <div className="text-[8px] font-bold text-muted-soft uppercase tracking-wider leading-none mb-0.5">total</div>
                <span className="tabular-nums text-caption font-bold text-ink">
                  {sym}{fmt(totals.total)}
                </span>
              </div>
              {/* Col 6: available */}
              <div className="text-right">
                <div className="text-[8px] font-bold text-muted-soft uppercase tracking-wider leading-none mb-0.5">доступно</div>
                <span className="tabular-nums text-caption font-semibold text-success">
                  {sym}{fmt(totals.available)}
                </span>
              </div>
              {/* Col 7: action */}
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    setAddAccountFor({ officeId: office.id, officeName: office.name })
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-ink text-white text-tiny font-semibold hover:bg-ink transition-colors"
                >
                  <Plus className="w-2.5 h-2.5" />
                  Add
                </button>
              </div>
            </div>

            {/* Currency rows */}
            {currencyBlocks.length === 0 ? (
              <div className="px-4 py-6 text-center text-caption text-muted-soft">
                No accounts yet.
                <div className="mt-2">
                  <button
                    onClick={() =>
                      setAddAccountFor({ officeId: office.id, officeName: office.name })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-button bg-ink text-white text-tiny font-semibold hover:bg-ink transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add first account
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border-soft">
                {currencyBlocks.map((cb) => {
                  const key = `${office.id}|${cb.currency.code}`;
                  const isOpen = !!openMap[key];
                  return (
                    <CurrencyRow
                      key={key}
                      isOpen={isOpen}
                      onToggle={() => toggleOpen(key)}
                      data={cb}
                      balanceOf={balanceOf}
                      reservedOf={reservedOf}
                      availableOf={availableOf}
                      onTopUp={setTopUpFor}
                      onAdjust={setAdjustFor}
                      onTransfer={(acc) => {
                        setTransferFrom(acc);
                        setTransferOpen(true);
                      }}
                      onOtc={(acc) => {
                        setOtcFromAccount(acc);
                        setOtcOpen(true);
                      }}
                      onHistory={setHistoryFor}
                      onDelete={handleDeleteAccount}
                      onEdit={canEditAccount ? setEditAccountFor : null}
                      onAddAccount={(prefill) =>
                        setAddAccountFor({
                          officeId: office.id,
                          officeName: office.name,
                          prefill,
                        })
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* TAB: История OTC */}
      {activeTab === "otc" && (
        <OtcHistoryPanel transactions={transactions} accountsById={Object.fromEntries(accounts.map((a) => [a.id, a]))} />
      )}

      {/* TAB: Перемещения */}
      {activeTab === "transfers" && (
        <TransfersPanel transfers={transfers} accountsById={Object.fromEntries(accounts.map((a) => [a.id, a]))} />
      )}

      {/* TAB: Журнал — все movements */}
      {activeTab === "ledger" && (
        <LedgerPanel movements={movements} accountsById={Object.fromEntries(accounts.map((a) => [a.id, a]))} />
      )}

      <TopUpModal account={topUpFor} onClose={() => setTopUpFor(null)} />
      <BalanceAdjustmentModal
        open={!!adjustFor}
        account={adjustFor}
        onClose={() => setAdjustFor(null)}
      />
      <TransferModal
        open={transferOpen}
        fromAccount={transferFrom}
        onClose={() => {
          setTransferOpen(false);
          setTransferFrom(null);
        }}
      />
      <AccountHistoryModal account={historyFor} onClose={() => setHistoryFor(null)} />
      <TransferHistoryModal
        open={transferHistoryOpen}
        onClose={() => setTransferHistoryOpen(false)}
      />
      <OtcDealModal
        open={otcOpen}
        initialFromAccountId={otcFromAccount?.id}
        onClose={() => {
          setOtcOpen(false);
          setOtcFromAccount(null);
        }}
      />
      <AddAccountModal
        open={!!addAccountFor}
        officeId={addAccountFor?.officeId}
        officeName={addAccountFor?.officeName}
        prefill={addAccountFor?.prefill}
        onClose={() => setAddAccountFor(null)}
      />
      <EditAccountModal
        open={!!editAccountFor}
        account={editAccountFor}
        onClose={() => setEditAccountFor(null)}
      />
      <AccountsImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </main>
  );
}

// -------- Compact totals badge --------
function CompactTotals({ total, reserved, sym }) {
  const available = total - reserved;
  const hasReserved = reserved > 0;
  return (
    <div className="bg-white border border-border-soft rounded-card px-3 py-1.5 flex items-center gap-3 tabular-nums text-caption">
      <span>
        <span className="text-micro font-bold text-muted-soft uppercase tracking-wider mr-1">Total</span>
        <span className="font-bold text-ink">
          {sym}
          {fmt(total)}
        </span>
      </span>
      {hasReserved && (
        <span className="inline-flex items-center gap-0.5 text-warning">
          <Clock className="w-2.5 h-2.5" />
          {sym}
          {fmt(reserved)}
        </span>
      )}
      <span className="inline-flex items-center gap-0.5 text-success">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {sym}
        {fmt(available)}
      </span>
    </div>
  );
}

// -------- CurrencyRow: collapsed summary → expandable channels --------
function CurrencyRow({
  isOpen,
  onToggle,
  data,
  balanceOf,
  reservedOf,
  availableOf,
  onTopUp,
  onAdjust,
  onTransfer,
  onOtc,
  onHistory,
  onDelete,
  onEdit,
  onAddAccount,
}) {
  const { currency, totals, channelBlocks, accountsCount } = data;
  const isCrypto = currency.type === "crypto";
  const hasReserved = totals.reserved > 0;

  const symCcy = curSymbol(currency.code);
  return (
    <div>
      {/* Summary row — единая Excel-style сетка с Office strip */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 grid items-center gap-x-3 hover:bg-surface-soft transition-colors text-left"
        style={{ gridTemplateColumns: ACCT_GRID_COLS }}
      >
        {/* Col 1: имя валюты */}
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={`w-4 h-4 text-muted-soft shrink-0 transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
          <div
            className={`w-9 h-9 rounded-button flex items-center justify-center text-body font-bold shrink-0 ${
              isCrypto ? "bg-accent-bg text-accent" : "bg-surface-sunk text-ink-soft"
            }`}
          >
            {currency.symbol || currency.code[0]}
          </div>
          <span className="text-[15px] font-bold tracking-wider text-ink">
            {currency.code}
          </span>
          <span className="text-caption text-muted shrink-0">
            {accountsCount > 0 ? `${accountsCount} acc` : "—"}
          </span>
        </div>
        {/* Col 2: today */}
        <div className="text-right">
          <DeltaCell value={totals.delta} currency={currency.code} />
        </div>
        {/* Col 3: yesterday */}
        <div className="text-right">
          <DeltaCell value={totals.deltaYesterday} currency={currency.code} />
        </div>
        {/* Col 4: reserved */}
        <div className="text-right">
          {hasReserved ? (
            <span className="tabular-nums text-caption font-semibold text-warning">
              {symCcy}{fmt(totals.reserved, currency.code)}
            </span>
          ) : (
            <span className="text-muted-soft text-caption">—</span>
          )}
        </div>
        {/* Col 5: total */}
        <div className="text-right">
          <span className="tabular-nums text-body font-bold text-ink">
            {symCcy}{fmt(totals.total, currency.code)}
          </span>
        </div>
        {/* Col 6: available */}
        <div className="text-right">
          <span className="tabular-nums text-body font-semibold text-success">
            {symCcy}{fmt(totals.available, currency.code)}
          </span>
        </div>
        {/* Col 7: пусто (выровнено с кнопкой Add в Office strip) */}
        <div />
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="px-4 pb-3 pt-1 bg-surface-soft/40">
          {/* Currency-level actions */}
          <div className="flex items-center gap-1.5 mb-3">
            <button
              onClick={() => onAddAccount({ currency: currency.code })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-button text-caption font-semibold text-ink-soft bg-white border border-border-soft hover:border-border hover:shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              Add account
            </button>
            {channelBlocks.length > 0 && channelBlocks[0].accounts[0] && (
              <button
                onClick={() => onTransfer(channelBlocks[0].accounts[0])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-button text-caption font-semibold text-ink-soft bg-white border border-border-soft hover:border-border hover:shadow-sm transition-all"
                title={`Transfer from a ${currency.code} account`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Transfer
              </button>
            )}
          </div>

          {channelBlocks.length === 0 ? (
            <div className="text-caption text-muted-soft italic py-2 text-center bg-white border border-dashed border-border-soft rounded-button">
              No accounts
            </div>
          ) : (
            <div className="space-y-2">
              {channelBlocks.map(({ channel, accounts: accs }) => (
                <ChannelBlock
                  key={channel.id}
                  channel={channel}
                  accounts={accs}
                  currency={currency}
                  balanceOf={balanceOf}
                  reservedOf={reservedOf}
                  availableOf={availableOf}
                  onTopUp={onTopUp}
                  onAdjust={onAdjust}
                  onTransfer={onTransfer}
                  onOtc={onOtc}
                  onHistory={onHistory}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onAddAccount={onAddAccount}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -------- ChannelBlock --------
function ChannelBlock({
  channel,
  accounts: accs,
  currency,
  balanceOf,
  reservedOf,
  availableOf,
  onTopUp,
  onAdjust,
  onTransfer,
  onOtc,
  onHistory,
  onDelete,
  onEdit,
  onAddAccount,
}) {
  const label = channelShortLabel(channel);
  const isNetwork = channel.kind === "network";
  return (
    <div className="bg-white border border-border-soft rounded-card p-3">
      <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {isNetwork ? (
            <NetworkIcon className="w-4 h-4 text-accent" />
          ) : (
            <span className="text-body">{channel.kind === "cash" ? "💵" : "🏦"}</span>
          )}
          <span className="text-caption font-bold text-ink-soft tracking-wider uppercase">
            {label}
          </span>
          {channel.gasFee != null && (
            <span className="text-tiny text-muted tabular-nums">gas ${channel.gasFee}</span>
          )}
          {channel.isDefaultForCurrency && (
            <span className="text-tiny font-bold text-success bg-success-soft px-1.5 py-0.5 rounded">
              default
            </span>
          )}
          <span className="text-tiny text-muted-soft">· {accs.length}</span>
        </div>
        <button
          onClick={() =>
            onAddAccount({ currency: currency.code, channelId: channel.id })
          }
          className="inline-flex items-center gap-1 text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-soft rounded-button px-2 py-1 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {accs.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            balanceOf={balanceOf}
            reservedOf={reservedOf}
            availableOf={availableOf}
            onTopUp={onTopUp}
            onAdjust={onAdjust}
            onTransfer={onTransfer}
            onOtc={onOtc}
            onHistory={onHistory}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}

// -------- AccountCard --------
// Раньше карточки были text-[9..13]px и иконки w-2.5 — кликнуть в них было
// «надо постараться». Подняли до читаемых размеров.
function AccountCard({ account: a, balanceOf, reservedOf, availableOf, onTopUp, onAdjust, onTransfer, onOtc, onHistory, onDelete, onEdit }) {
  const total = balanceOf(a.id);
  const reserved = reservedOf(a.id);
  const available = availableOf(a.id);
  const hasReserved = reserved > 0.0001;
  return (
    <div className="bg-white border border-border-soft rounded-card px-3 py-2.5 hover:border-border hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-body font-semibold text-ink leading-tight truncate">
            {a.name}
          </div>
          {a.address && (
            <div className="text-tiny font-mono text-muted truncate mt-0.5">
              {a.address.length > 22 ? `${a.address.slice(0, 12)}…${a.address.slice(-8)}` : a.address}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 tabular-nums mb-2">
        <span className="text-[17px] font-bold text-ink">
          {curSymbol(a.currency)}
          {fmt(total, a.currency)}
        </span>
        <span
          className={`text-caption font-semibold inline-flex items-center gap-1 ${
            hasReserved ? "text-warning" : "text-success"
          }`}
        >
          {hasReserved ? (
            <>
              <Clock className="w-3 h-3" />
              {fmt(reserved, a.currency)}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3 h-3" />
              {fmt(available, a.currency)}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1 pt-2 border-t border-border-soft">
        <button
          onClick={() => onTopUp(a)}
          className="flex-1 text-tiny font-semibold text-success hover:bg-success-soft rounded-[6px] px-2 py-1.5 transition-colors inline-flex items-center justify-center gap-1"
          title="Top up"
        >
          <Plus className="w-3 h-3" />
          Top up
        </button>
        <button
          onClick={() => onTransfer(a)}
          className="flex-1 text-tiny font-semibold text-ink-soft hover:bg-surface-sunk rounded-[6px] px-2 py-1.5 transition-colors inline-flex items-center justify-center gap-1"
          title="Transfer"
        >
          <ArrowLeftRight className="w-3 h-3" />
          Transfer
        </button>
        {onOtc && (
          <button
            onClick={() => onOtc(a)}
            className="flex-1 text-tiny font-semibold text-accent hover:bg-accent-bg rounded-[6px] px-2 py-1.5 transition-colors inline-flex items-center justify-center gap-1"
            title="OTC сделка с контрагентом — обмен валюты с партнёра, можно задним числом"
          >
            <ArrowLeftRight className="w-3 h-3" />
            OTC
          </button>
        )}
        {onAdjust && (
          <button
            onClick={() => onAdjust(a)}
            className="text-tiny font-semibold text-warning hover:bg-warning-soft rounded-[6px] px-2 py-1.5 transition-colors"
            title="Скорректировать баланс — поправить остаток без изменения P&L"
          >
            <Scale className="w-3 h-3" />
          </button>
        )}
        {onEdit && (
          <button
            onClick={() => onEdit(a)}
            className="text-tiny font-semibold text-ink-soft hover:bg-surface-sunk rounded-[6px] px-2 py-1.5 transition-colors"
            title="Редактировать счёт — имя, адрес, сеть, активность"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => onHistory(a)}
          className="text-tiny font-semibold text-muted hover:bg-surface-sunk rounded-[6px] px-2 py-1.5 transition-colors"
          title="History"
        >
          <HistoryIcon className="w-3 h-3" />
        </button>
        {onDelete && (
          <button
            onClick={() => onDelete(a)}
            className="text-tiny font-semibold text-muted-soft hover:text-danger hover:bg-danger-soft rounded-[6px] px-2 py-1.5 transition-colors"
            title="Deactivate account"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tab: История OTC ─────────────────────────────────────────────────
//
// Показывает только OTC/broker сделки со всех счетов с раскрытием по клику.

function OtcHistoryPanel({ transactions, accountsById }) {
  const otcDeals = useMemo(
    () => (transactions || []).filter((t) =>
      (t.kind === "otc" || t.kind === "broker") && t.status !== "deleted"
    ),
    [transactions]
  );

  if (otcDeals.length === 0) {
    return (
      <section className="bg-white rounded-card-lg border border-border-soft p-8 text-center">
        <ArrowLeftRightIcon className="w-8 h-8 mx-auto text-muted-soft mb-2" />
        <div className="text-body-sm text-muted">Нет OTC сделок</div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-card-lg border border-border-soft overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-soft flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRightIcon className="w-3.5 h-3.5 text-accent" />
          <h2 className="text-body-sm font-semibold tracking-tight">История OTC</h2>
          <span className="text-tiny text-muted-soft">· {otcDeals.length} сделок</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-caption">
          <thead className="bg-surface-soft border-b border-border-soft text-tiny font-bold text-muted tracking-wider uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Дата</th>
              <th className="px-3 py-2 text-left">Тип</th>
              <th className="px-3 py-2 text-left">Контрагент</th>
              <th className="px-3 py-2 text-right">IN</th>
              <th className="px-3 py-2 text-right">OUT</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {otcDeals.map((tx) => {
              const dt = new Date(tx.createdAtMs || tx.time || Date.now());
              const firstOut = (tx.outputs || [])[0];
              return (
                <tr key={tx.id} className="border-b border-border-soft last:border-0 hover:bg-surface-soft">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-semibold tabular-nums text-ink-soft">
                      {dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                    </div>
                    <div className="text-tiny text-muted-soft tabular-nums">
                      {dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-tiny font-bold ring-1 bg-accent-bg text-accent ring-indigo-200">
                      {tx.kind === "broker" ? "BROKER" : "OTC"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft max-w-[180px] truncate">
                    {tx.counterparty || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold">{fmt(tx.amtIn, tx.curIn)}</span>
                    <span className="text-tiny text-muted-soft ml-1">{tx.curIn}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {firstOut ? (
                      <>
                        <span className="font-semibold">{fmt(firstOut.amount, firstOut.currency)}</span>
                        <span className="text-tiny text-muted-soft ml-1">{firstOut.currency}</span>
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {tx.profit > 0 ? (
                      <span className="text-success font-bold">+${fmt(tx.profit, "USD")}</span>
                    ) : tx.profit < 0 ? (
                      <span className="text-danger font-bold">−${fmt(Math.abs(tx.profit), "USD")}</span>
                    ) : <span className="text-muted-soft">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-tiny text-muted">{tx.status || "—"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <DeleteDealButtonInline dealId={tx.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Tab: Перемещения ────────────────────────────────────────────────
//
// Все transfers (interoffice + inter-account).

function TransfersPanel({ transfers, accountsById }) {
  // Локально храним список — после delete оптимистично убираем строку
  // (полный refresh идёт через bumpDataVersion → useAccounts reload).
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const sorted = useMemo(
    () => (transfers || []).filter((t) => !removedIds.has(t.id)).slice().sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ),
    [transfers, removedIds]
  );

  const handleDeleted = (id) => setRemovedIds((s) => new Set(s).add(id));

  if (sorted.length === 0) {
    return (
      <section className="bg-white rounded-card-lg border border-border-soft p-8 text-center">
        <WalletIcon className="w-8 h-8 mx-auto text-muted-soft mb-2" />
        <div className="text-body-sm text-muted">Нет перемещений</div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-card-lg border border-border-soft overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2">
        <ArrowLeftRightIcon className="w-3.5 h-3.5 text-info" />
        <h2 className="text-body-sm font-semibold tracking-tight">Перемещения</h2>
        <span className="text-tiny text-muted-soft">· {sorted.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-caption">
          <thead className="bg-surface-soft border-b border-border-soft text-tiny font-bold text-muted tracking-wider uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Дата</th>
              <th className="px-3 py-2 text-left">Откуда</th>
              <th className="px-3 py-2 text-left">Куда</th>
              <th className="px-3 py-2 text-right">Сумма</th>
              <th className="px-3 py-2 text-right">Получено</th>
              <th className="px-3 py-2 text-left">Заметка</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tr) => {
              const from = accountsById[tr.fromAccountId];
              const to = accountsById[tr.toAccountId];
              const dt = new Date(tr.createdAt || 0);
              return (
                <tr key={tr.id} className="border-b border-border-soft last:border-0 hover:bg-surface-soft">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-semibold tabular-nums text-ink-soft">
                      {dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                    </div>
                    <div className="text-tiny text-muted-soft tabular-nums">
                      {dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft max-w-[180px] truncate">
                    {from?.name || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft max-w-[180px] truncate">
                    {to?.name || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-danger">−{fmt(tr.fromAmount, tr.fromCurrency)}</span>
                    <span className="text-tiny text-muted-soft ml-1">{tr.fromCurrency}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-success">+{fmt(tr.toAmount, tr.toCurrency)}</span>
                    <span className="text-tiny text-muted-soft ml-1">{tr.toCurrency}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted max-w-xs truncate">{tr.note || "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <DeleteTransferButton transferId={tr.id} onDeleted={handleDeleted} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Tab: Журнал — полный ledger ────────────────────────────────────
//
// Все account_movements за последний период (limit 1000 для перформанса).

function LedgerPanel({ movements, accountsById }) {
  const sorted = useMemo(
    () => (movements || []).slice(0, 500),
    [movements]
  );

  if (sorted.length === 0) {
    return (
      <section className="bg-white rounded-card-lg border border-border-soft p-8 text-center">
        <HistoryIcon className="w-8 h-8 mx-auto text-muted-soft mb-2" />
        <div className="text-body-sm text-muted">Нет операций</div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-card-lg border border-border-soft overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-soft flex items-center gap-2">
        <HistoryIcon className="w-3.5 h-3.5 text-muted" />
        <h2 className="text-body-sm font-semibold tracking-tight">Журнал</h2>
        <span className="text-tiny text-muted-soft">· {sorted.length} (последние)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-caption">
          <thead className="bg-surface-soft border-b border-border-soft text-tiny font-bold text-muted tracking-wider uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Дата</th>
              <th className="px-3 py-2 text-left">Счёт</th>
              <th className="px-3 py-2 text-left">Тип</th>
              <th className="px-3 py-2 text-right">Изменение</th>
              <th className="px-3 py-2 text-left">Заметка</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const acc = accountsById[m.accountId];
              const dt = new Date(m.timestamp || 0);
              const isIn = m.direction === "in";
              return (
                <tr key={m.id} className="border-b border-border-soft last:border-0 hover:bg-surface-soft">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="font-semibold tabular-nums text-ink-soft">
                      {dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                    </div>
                    <div className="text-tiny text-muted-soft tabular-nums">
                      {dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft max-w-[180px] truncate">
                    {acc?.name || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-tiny font-bold ring-1 bg-surface-soft text-ink-soft ring-border-soft">
                      {m.source?.kind || "—"}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${isIn ? "text-success" : "text-danger"}`}>
                    {isIn ? "+" : "−"}{fmt(m.amount, m.currency)}
                    <span className="text-tiny text-muted-soft font-normal ml-1">{m.currency}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted max-w-xs truncate">{m.source?.note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Inline delete для table-row — без size-prop
function DeleteDealButtonInline({ dealId }) {
  return <DeleteDealButton dealId={dealId} />;
}
