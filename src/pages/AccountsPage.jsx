// src/pages/AccountsPage.jsx
// Иерархия: Office → Currency (collapsible) → Channel → Account.
// Дефолт — все currency-строки свёрнуты; видны: code, total, available.
// Клик раскрывает — показывает только non-empty каналы с account-карточками.

import React, { useState, useMemo } from "react";
import {
  Plus,
  ArrowLeftRight,
  History as HistoryIcon,
  Building2,
  Network as NetworkIcon,
  Clock,
  CheckCircle2,
  ChevronRight,
  Trash2,
  Download,
  Upload,
} from "lucide-react";
import { useAccounts } from "../store/accounts.jsx";
import { useAudit } from "../store/audit.jsx";
import { useBaseCurrency } from "../store/baseCurrency.js";
import { useCurrencies } from "../store/currencies.jsx";
import { useRates } from "../store/rates.jsx";
import { useOffices } from "../store/offices.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { resolveAccountChannel, channelShortLabel } from "../utils/accountChannel.js";
import TopUpModal from "../components/accounts/TopUpModal.jsx";
import TransferModal from "../components/accounts/TransferModal.jsx";
import AccountHistoryModal from "../components/accounts/AccountHistoryModal.jsx";
import TransferHistoryModal from "../components/accounts/TransferHistoryModal.jsx";
import OtcDealModal from "../components/OtcDealModal.jsx";
import AddAccountModal from "../components/accounts/AddAccountModal.jsx";
import AccountsImportModal from "../components/accounts/AccountsImportModal.jsx";
import { exportCSV } from "../utils/csv.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { deactivateAccountRow, withToast } from "../lib/supabaseWrite.js";

const CURRENCY_ORDER = ["USD", "USDT", "EUR", "TRY", "GBP"];
const curIndex = (code) => {
  const i = CURRENCY_ORDER.indexOf(code);
  return i === -1 ? 999 : i;
};

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
  if (!Number.isFinite(value)) return "text-slate-400";
  if (value > 0.01) return "text-emerald-600";
  if (value < -0.01) return "text-rose-600";
  return "text-slate-400";
}

// Inline пара "сегодня / вчера" через слэш с явными подписями.
function DeltaPair({ today, yesterday, currency, size = "xs" }) {
  const todayStr = fmtDelta(today, currency);
  const yStr = yesterday !== undefined ? fmtDelta(yesterday, currency) : null;
  const sizeCls = size === "sm" ? "text-[11px]" : "text-[10px]";
  const labelCls = size === "sm" ? "text-[9px]" : "text-[8px]";
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
          <span className="text-slate-300 font-normal">/</span>
          <span className={`inline-flex items-baseline gap-0.5 ${deltaClass(yesterday)}`}>
            {yStr}
            <span className={`${labelCls} font-semibold opacity-70`}>вчера</span>
          </span>
        </>
      )}
    </span>
  );
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf, availableOf, deltaOf, deactivateAccount } = useAccounts();
  const { addEntry: logAudit } = useAudit();
  const { activeOffices } = useOffices();
  const { dict: curDict } = useCurrencies();
  const { channels } = useRates();
  const { base, toBase } = useBaseCurrency();
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
  const [transferFrom, setTransferFrom] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);
  const [transferHistoryOpen, setTransferHistoryOpen] = useState(false);
  const [otcOpen, setOtcOpen] = useState(false);
  const [addAccountFor, setAddAccountFor] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

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

  // open[officeId|currencyCode] = true означает раскрытый блок.
  const [openMap, setOpenMap] = useState({});
  const toggleOpen = (key) =>
    setOpenMap((prev) => ({ ...prev, [key]: !prev[key] }));

  // Группировка: office → currencies. Показываем только currencies, для которых
  // есть хотя бы один active account в этом офисе. Сами office-блоки без
  // аккаунтов вообще не рендерим (для scoped менеджеров RLS режет видимость —
  // раньше они видели пустые "карточки-тени" остальных офисов).
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
    .filter((block) => block.accsCount > 0);
  }, [accounts, activeOffices, channels, curDict, balanceOf, reservedOf, deltaOf, dayStartMs, yesterdayStartMs, toBase]);

  const grandTotal = officeBlocks.reduce((s, ob) => s + ob.totals.total, 0);
  const grandReserved = officeBlocks.reduce((s, ob) => s + ob.totals.reserved, 0);
  const grandDelta = officeBlocks.reduce((s, ob) => s + ob.totals.delta, 0);
  const grandDeltaYesterday = officeBlocks.reduce(
    (s, ob) => s + ob.totals.deltaYesterday,
    0
  );

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-6 space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{t("accounts_title")}</h1>
          <p className="text-[12px] text-slate-500">{t("accounts_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CompactTotals total={grandTotal} reserved={grandReserved} sym={sym} />
          <span
            className="inline-flex items-center px-2.5 py-1.5 rounded-[10px] bg-slate-50 ring-1 ring-slate-200"
            title="Сегодня / вчера по всем офисам"
          >
            <DeltaPair
              today={grandDelta}
              yesterday={grandDeltaYesterday}
              currency={base}
              size="sm"
            />
          </span>
          <button
            onClick={handleExportAccounts}
            disabled={accounts.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300 text-[12px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t("acc_export_tip") || "Export accounts to CSV"}
          >
            <Download className="w-3.5 h-3.5" />
            {t("export_csv")}
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300 text-[12px] font-semibold transition-colors"
            title={t("acc_import_tip") || "Import accounts from CSV"}
          >
            <Upload className="w-3.5 h-3.5" />
            {t("acc_import") || "Import CSV"}
          </button>
          <button
            onClick={() => setTransferHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300 text-[12px] font-semibold transition-colors"
            title="История всех перемещений"
          >
            <HistoryIcon className="w-3.5 h-3.5" />
            История перемещений
          </button>
          <button
            onClick={() => setOtcOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-[12px] font-semibold transition-colors"
            title="OTC обмен валюты с партнёром (без fee, можно задним числом)"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            OTC с контрагентом
          </button>
          <button
            onClick={() => {
              setTransferFrom(null);
              setTransferOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[12px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            {t("acc_transfer")}
          </button>
        </div>
      </div>

      {officeBlocks.map((block) => {
        const { office, totals, currencyBlocks, accsCount } = block;
        return (
          <section
            key={office.id}
            className="bg-white rounded-[12px] border border-slate-200/70 overflow-hidden"
          >
            {/* Office strip */}
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <h2 className="text-[13px] font-semibold tracking-tight">{office.name}</h2>
                <span className="text-[11px] text-slate-400">· {accsCount} accounts</span>
                <DeltaPair
                  today={totals.delta}
                  yesterday={totals.deltaYesterday}
                  currency={base}
                  size="sm"
                />
              </div>
              <div className="flex items-center gap-2 tabular-nums text-[11px]">
                <span className="text-slate-600">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                    Total
                  </span>
                  <span className="font-bold text-slate-900">
                    {sym}
                    {fmt(totals.total)}
                  </span>
                </span>
                {totals.hasReserved && (
                  <span className="text-amber-700 inline-flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {sym}
                    {fmt(totals.reserved)}
                  </span>
                )}
                <span className="text-emerald-700 inline-flex items-center gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  {sym}
                  {fmt(totals.available)}
                </span>
                <button
                  onClick={() =>
                    setAddAccountFor({ officeId: office.id, officeName: office.name })
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-slate-900 text-white text-[10px] font-semibold hover:bg-slate-800 transition-colors"
                >
                  <Plus className="w-2.5 h-2.5" />
                  Add
                </button>
              </div>
            </div>

            {/* Currency rows */}
            {currencyBlocks.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-slate-400">
                No accounts yet.
                <div className="mt-2">
                  <button
                    onClick={() =>
                      setAddAccountFor({ officeId: office.id, officeName: office.name })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add first account
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
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
                      onTransfer={(acc) => {
                        setTransferFrom(acc);
                        setTransferOpen(true);
                      }}
                      onHistory={setHistoryFor}
                      onDelete={handleDeleteAccount}
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

      <TopUpModal account={topUpFor} onClose={() => setTopUpFor(null)} />
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
        onClose={() => setOtcOpen(false)}
      />
      <AddAccountModal
        open={!!addAccountFor}
        officeId={addAccountFor?.officeId}
        officeName={addAccountFor?.officeName}
        prefill={addAccountFor?.prefill}
        onClose={() => setAddAccountFor(null)}
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
    <div className="bg-white border border-slate-200 rounded-[10px] px-3 py-1.5 flex items-center gap-3 tabular-nums text-[12px]">
      <span>
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mr-1">Total</span>
        <span className="font-bold text-slate-900">
          {sym}
          {fmt(total)}
        </span>
      </span>
      {hasReserved && (
        <span className="inline-flex items-center gap-0.5 text-amber-700">
          <Clock className="w-2.5 h-2.5" />
          {sym}
          {fmt(reserved)}
        </span>
      )}
      <span className="inline-flex items-center gap-0.5 text-emerald-700">
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
  onTransfer,
  onHistory,
  onDelete,
  onAddAccount,
}) {
  const { currency, totals, channelBlocks, accountsCount } = data;
  const isCrypto = currency.type === "crypto";
  const hasReserved = totals.reserved > 0;

  return (
    <div>
      {/* Summary row (always visible, clickable) */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        />
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center text-[12px] font-bold shrink-0 ${
            isCrypto ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700"
          }`}
        >
          {currency.symbol || currency.code[0]}
        </div>
        <span className="text-[13px] font-bold tracking-wider text-slate-900 min-w-[48px]">
          {currency.code}
        </span>
        <span className="text-[10px] text-slate-400">
          {accountsCount > 0 ? `${accountsCount} acc` : "—"}
        </span>

        <span className="ml-auto flex items-center gap-3 tabular-nums text-[12px]">
          <span className="font-bold text-slate-900">
            {curSymbol(currency.code)}
            {fmt(totals.total, currency.code)}
          </span>
          <DeltaPair
            today={totals.delta}
            yesterday={totals.deltaYesterday}
            currency={currency.code}
          />
          {hasReserved && (
            <span className="inline-flex items-center gap-0.5 text-amber-700 text-[11px]">
              <Clock className="w-2.5 h-2.5" />
              {fmt(totals.reserved, currency.code)}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 text-emerald-700 text-[11px]">
            <CheckCircle2 className="w-2.5 h-2.5" />
            {fmt(totals.available, currency.code)}
          </span>
        </span>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="px-4 pb-3 pt-1 bg-slate-50/40">
          {/* Currency-level actions */}
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={() => onAddAccount({ currency: currency.code })}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              Add account
            </button>
            {channelBlocks.length > 0 && channelBlocks[0].accounts[0] && (
              <button
                onClick={() => onTransfer(channelBlocks[0].accounts[0])}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 transition-colors"
                title={`Transfer from a ${currency.code} account`}
              >
                <ArrowLeftRight className="w-2.5 h-2.5" />
                Transfer
              </button>
            )}
          </div>

          {channelBlocks.length === 0 ? (
            <div className="text-[12px] text-slate-400 italic py-2 text-center bg-white border border-dashed border-slate-200 rounded-[8px]">
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
                  onTransfer={onTransfer}
                  onHistory={onHistory}
                  onDelete={onDelete}
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
  onTransfer,
  onHistory,
  onDelete,
  onAddAccount,
}) {
  const label = channelShortLabel(channel);
  const isNetwork = channel.kind === "network";
  return (
    <div className="bg-white border border-slate-200 rounded-[8px] p-2">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1.5">
        <div className="flex items-center gap-1.5">
          {isNetwork ? (
            <NetworkIcon className="w-3 h-3 text-indigo-500" />
          ) : (
            <span className="text-[11px]">{channel.kind === "cash" ? "💵" : "🏦"}</span>
          )}
          <span className="text-[10px] font-bold text-slate-700 tracking-wider uppercase">
            {label}
          </span>
          {channel.gasFee != null && (
            <span className="text-[10px] text-slate-500 tabular-nums">gas ${channel.gasFee}</span>
          )}
          {channel.isDefaultForCurrency && (
            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">
              default
            </span>
          )}
          <span className="text-[10px] text-slate-400">· {accs.length}</span>
        </div>
        <button
          onClick={() =>
            onAddAccount({ currency: currency.code, channelId: channel.id })
          }
          className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-[6px] px-1.5 py-0.5 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          Add
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {accs.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            balanceOf={balanceOf}
            reservedOf={reservedOf}
            availableOf={availableOf}
            onTopUp={onTopUp}
            onTransfer={onTransfer}
            onHistory={onHistory}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

// -------- AccountCard (compact) --------
function AccountCard({ account: a, balanceOf, reservedOf, availableOf, onTopUp, onTransfer, onHistory, onDelete }) {
  const total = balanceOf(a.id);
  const reserved = reservedOf(a.id);
  const available = availableOf(a.id);
  const hasReserved = reserved > 0.0001;
  return (
    <div className="bg-slate-50/70 border border-slate-200 rounded-[8px] px-2 py-1.5 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-slate-900 leading-tight truncate">
            {a.name}
          </div>
          {a.address && (
            <div className="text-[9px] font-mono text-slate-500 truncate">
              {a.address.length > 16 ? `${a.address.slice(0, 8)}…${a.address.slice(-6)}` : a.address}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-1 tabular-nums">
        <span className="text-[13px] font-bold text-slate-900">
          {curSymbol(a.currency)}
          {fmt(total, a.currency)}
        </span>
        <span
          className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${
            hasReserved ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          {hasReserved ? (
            <>
              <Clock className="w-2.5 h-2.5" />
              {fmt(reserved, a.currency)}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-2.5 h-2.5" />
              {fmt(available, a.currency)}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-0.5 mt-1 pt-1 border-t border-slate-100">
        <button
          onClick={() => onTopUp(a)}
          className="flex-1 text-[9px] font-semibold text-emerald-700 hover:bg-emerald-50 rounded-[4px] px-1 py-0.5 transition-colors inline-flex items-center justify-center gap-0.5"
          title="Top up"
        >
          <Plus className="w-2.5 h-2.5" />
          Top up
        </button>
        <button
          onClick={() => onTransfer(a)}
          className="flex-1 text-[9px] font-semibold text-slate-700 hover:bg-slate-100 rounded-[4px] px-1 py-0.5 transition-colors inline-flex items-center justify-center gap-0.5"
          title="Transfer"
        >
          <ArrowLeftRight className="w-2.5 h-2.5" />
          Transfer
        </button>
        <button
          onClick={() => onHistory(a)}
          className="text-[9px] font-semibold text-slate-500 hover:bg-slate-100 rounded-[4px] px-1 py-0.5 transition-colors"
          title="History"
        >
          <HistoryIcon className="w-2.5 h-2.5" />
        </button>
        {onDelete && (
          <button
            onClick={() => onDelete(a)}
            className="text-[9px] font-semibold text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-[4px] px-1 py-0.5 transition-colors"
            title="Deactivate account"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}
