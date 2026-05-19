// src/components/clients/PartnerProfileModal.jsx
//
// Профиль партнёра — открывается из ListTab по клику на partner row.
// Показывает: основная инфа, балансы по счетам, обязательства партнёра,
// settlement-actions (Внёс / Забрал) и история движений по каждому счёту.
//
// CRUD счетов остаётся в Settings → Партнёры (там добавление/редактирование/
// удаление). Здесь — только обзор + операции.

import React, { useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  Coins,
  Wallet,
  History as HistoryIcon,
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  Phone,
  Scale,
} from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { usePartners } from "../../store/partners.jsx";
import { usePartnerAccounts } from "../../store/partnerAccounts.jsx";
import { useObligations } from "../../store/obligations.jsx";
import PartnerSettlementModal from "../settings/PartnerSettlementModal.jsx";
import PartnerAccountHistoryModal from "../settings/PartnerAccountHistoryModal.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const TYPE_ICONS = { cash: Banknote, bank: Building2, crypto: Coins };

export function PartnerProfileModal({ partnerId, onClose, base, sym, toBase }) {
  const { t } = useTranslation();
  const { partners } = usePartners();
  const { accountsByPartner, balanceOf } = usePartnerAccounts();
  const { obligations } = useObligations();

  const partner = partnerId ? partners.find((p) => p.id === partnerId) : null;

  // Все счета партнёра (включая неактивные — показываем off-бейджем).
  const allAccounts = useMemo(
    () => (partnerId ? accountsByPartner(partnerId) : []),
    [partnerId, accountsByPartner]
  );
  const activeAccountsCount = useMemo(
    () => allAccounts.filter((a) => a.active).length,
    [allAccounts]
  );

  // Obligations отфильтрованные по partner_id (см. supabaseReaders 0079:
  // obligations.partnerId).
  const partnerObligations = useMemo(() => {
    if (!partner || !Array.isArray(obligations)) return [];
    return obligations.filter(
      (o) => o.partnerId === partner.id && o.status === "open"
    );
  }, [partner, obligations]);

  const obligationTotals = useMemo(() => {
    let weOwe = 0;
    let theyOwe = 0;
    partnerObligations.forEach((o) => {
      const remaining = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
      const inBase = toBase(remaining, o.currency);
      if (o.direction === "we_owe") weOwe += inBase;
      else if (o.direction === "they_owe") theyOwe += inBase;
    });
    return { weOwe, theyOwe, net: theyOwe - weOwe };
  }, [partnerObligations, toBase]);

  // Суммарный баланс по всем активным счетам — конвертируем каждый в base.
  // Семантика partner_account balance: + → они нам должны, − → мы им должны.
  const totalBalanceBase = useMemo(
    () =>
      allAccounts
        .filter((a) => a.active)
        .reduce((sum, a) => sum + toBase(balanceOf(a.id), a.currency), 0),
    [allAccounts, balanceOf, toBase]
  );

  const [settlementState, setSettlementState] = useState(null); // { account, partnerName, mode }
  const [historyAccount, setHistoryAccount] = useState(null);

  if (!partner) return null;

  const subtitle = [partner.telegram, partner.phone].filter(Boolean).join(" · ") || "—";

  return (
    <Modal
      open={!!partner}
      onClose={onClose}
      title={partner.name}
      subtitle={subtitle}
      width="2xl"
    >
      <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label={t("pp_accounts_short")} value={activeAccountsCount} />
          <StatCard
            label={t("pp_total_balance")}
            value={`${totalBalanceBase >= 0 ? "+" : ""}${sym}${fmt(totalBalanceBase, base)}`}
            tone={totalBalanceBase >= 0 ? "emerald" : "rose"}
          />
          <StatCard
            label={t("pp_we_owe_short")}
            value={`${sym}${fmt(obligationTotals.weOwe, base)}`}
            tone={obligationTotals.weOwe > 0 ? "rose" : null}
          />
          <StatCard
            label={t("pp_they_owe_short")}
            value={`${sym}${fmt(obligationTotals.theyOwe, base)}`}
            tone={obligationTotals.theyOwe > 0 ? "emerald" : null}
          />
        </div>

        {!partner.active && (
          <div className="text-tiny font-bold text-muted bg-surface-sunk inline-flex items-center px-2 py-0.5 rounded uppercase tracking-wider">
            {t("pp_deactivated")}
          </div>
        )}

        {partner.note && (
          <div className="text-caption text-ink-soft bg-surface-soft border border-border-soft rounded-md px-3 py-2">
            <span className="font-semibold text-muted uppercase text-tiny tracking-wider mr-1.5">
              {t("pp_note")}:
            </span>
            {partner.note}
          </div>
        )}

        {/* Obligations card — рендерим только если есть открытые */}
        {partnerObligations.length > 0 && (
          <div className="border border-warning/20 bg-warning-soft/50 rounded-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-caption font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                <Scale className="w-3 h-3" />
                {t("pp_open_obligations")} · {partnerObligations.length}
              </h3>
              <div className="flex items-center gap-3 text-tiny tabular-nums">
                {obligationTotals.theyOwe > 0 && (
                  <span className="font-semibold text-success">
                    {t("pp_they_owe_label")}: {sym}{fmt(obligationTotals.theyOwe, base)}
                  </span>
                )}
                {obligationTotals.weOwe > 0 && (
                  <span className="font-semibold text-danger">
                    {t("pp_we_owe_label")}: {sym}{fmt(obligationTotals.weOwe, base)}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1">
              {partnerObligations.map((o) => {
                const remaining = (Number(o.amount) || 0) - (Number(o.paidAmount) || 0);
                const cur = o.currency;
                const isWeOwe = o.direction === "we_owe";
                return (
                  <div
                    key={o.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-md text-tiny"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-micro font-bold uppercase tracking-wider ${
                        isWeOwe
                          ? "bg-rose-100 text-danger"
                          : "bg-emerald-100 text-success"
                      }`}
                    >
                      {isWeOwe ? "we owe" : "they owe"}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">
                      {fmt(remaining, cur)} {cur}
                    </span>
                    {(o.paidAmount || 0) > 0 && (
                      <span className="text-tiny text-muted">
                        paid {fmt(o.paidAmount, cur)} / {fmt(o.amount, cur)}
                      </span>
                    )}
                    <span className="text-muted-soft text-tiny flex-1 min-w-0 truncate">
                      {o.note || ""}
                    </span>
                    {o.dealId && (
                      <span className="text-muted-soft text-tiny tabular-nums">
                        #{o.dealId}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Accounts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-muted" />
              <h3 className="text-caption font-bold uppercase tracking-wider text-ink-soft">
                {t("pp_accounts_title")} · {allAccounts.length}
              </h3>
            </div>
            <span className="text-tiny text-muted-soft">
              {t("pp_crud_hint_inline")}
            </span>
          </div>
          {allAccounts.length === 0 ? (
            <div className="text-caption text-muted-soft italic py-3 text-center bg-surface-soft border border-border-soft rounded-card">
              {t("pp_no_accounts")}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {allAccounts.map((acc) => (
                <PartnerAccountRow
                  key={acc.id}
                  account={acc}
                  balance={balanceOf(acc.id)}
                  onSettlement={(mode) =>
                    setSettlementState({ account: acc, partnerName: partner.name, mode })
                  }
                  onHistory={() => setHistoryAccount(acc)}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="px-5 py-4 border-t border-border-soft flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-card bg-ink text-white text-body-sm font-semibold hover:bg-ink transition-colors"
        >
          {t("close")}
        </button>
      </div>

      {/* Nested modals */}
      <PartnerSettlementModal
        open={!!settlementState}
        mode={settlementState?.mode}
        partnerAccount={settlementState?.account}
        partnerName={settlementState?.partnerName}
        onClose={() => setSettlementState(null)}
      />
      <PartnerAccountHistoryModal
        open={!!historyAccount}
        account={historyAccount}
        onClose={() => setHistoryAccount(null)}
      />
    </Modal>
  );
}

function PartnerAccountRow({ account, balance, onSettlement, onHistory, t }) {
  const Icon = TYPE_ICONS[account.type] || Wallet;
  return (
    <div
      className={`flex flex-col gap-1.5 px-2.5 py-2 rounded-card border ${
        account.active
          ? "bg-surface-soft/60 border-border-soft"
          : "bg-surface-sunk/60 border-border-soft opacity-60"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-white border border-border-soft flex items-center justify-center text-muted shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-caption font-semibold text-ink truncate">
            {account.name}
            {!account.active && (
              <span className="ml-1.5 text-micro font-bold text-muted bg-surface-sunk px-1 py-0.5 rounded uppercase">
                off
              </span>
            )}
          </div>
          <div className="text-tiny text-muted tabular-nums">
            {curSymbol(account.currency)}
            {fmt(balance, account.currency)}{" "}
            <span className="opacity-60">{account.currency}</span>
            {account.networkId && (
              <span className="ml-1 text-muted-soft">· {account.networkId}</span>
            )}
          </div>
        </div>
        <button
          onClick={onHistory}
          className="p-1.5 rounded-md text-muted-soft hover:text-ink-soft hover:bg-surface-sunk/70"
          title={t("pp_history_tip")}
        >
          <HistoryIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {account.active && (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => onSettlement("inflow")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-success-soft text-success border border-success/20 hover:bg-emerald-100 text-tiny font-bold"
            title={t("pp_inflow_tip")}
          >
            <ArrowDownLeft className="w-3 h-3" />
            {t("pp_inflow")}
          </button>
          <button
            onClick={() => onSettlement("outflow")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-danger-soft text-danger border border-danger/20 hover:bg-rose-100 text-tiny font-bold"
            title={t("pp_outflow_tip")}
          >
            <ArrowUpRight className="w-3 h-3" />
            {t("pp_outflow")}
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone, small }) {
  const toneCls =
    tone === "emerald" ? "text-success bg-success-soft border-emerald-100"
    : tone === "rose" ? "text-danger bg-danger-soft border-rose-100"
    : "text-ink bg-surface-soft/60 border-border-soft";
  return (
    <div className={`rounded-button border p-2 ${toneCls}`}>
      <div className="text-micro font-bold text-muted uppercase tracking-wider">{label}</div>
      <div className={`${small ? "text-tiny" : "text-[15px]"} font-bold tabular-nums leading-tight mt-0.5`}>
        {value}
      </div>
    </div>
  );
}
