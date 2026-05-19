// src/components/accounts/AccountHistoryModal.jsx
// История движений по одному счёту — из v2-леджера (ledger.journal_entries),
// а не из замороженной public.account_movements. Баланс — из v_account_balances
// (тоже v2). Каждая строка движения — ссылка на свою транзакцию в Журнале.

import React, { useMemo } from "react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useLedger } from "../../store/ledger.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { accountEntries } from "../../lib/treasury/v2selectors.js";
import AccountInlineEntries from "../../pages/treasury_v2/parts/AccountInlineEntries.jsx";

export default function AccountHistoryModal({ account, onClose }) {
  const { t } = useTranslation();
  const { balanceOf } = useAccounts();
  const lctx = useLedger();

  const ledgerAcc = useMemo(
    () => (account?.ledgerAccountCode ? (lctx.accounts || []).find((a) => a.code === account.ledgerAccountCode) || null : null),
    [lctx.accounts, account]
  );
  const entryCount = useMemo(
    () => (ledgerAcc ? accountEntries(lctx, ledgerAcc.id, 200, null, null).length : 0),
    [lctx, ledgerAcc]
  );

  if (!account) return null;

  return (
    <Modal
      open={!!account}
      onClose={onClose}
      title={account.name}
      subtitle={`${account.currency} · ${t("acc_history")}`}
      width="lg"
    >
      <div className="p-5 border-b border-border-soft bg-surface-soft/40">
        <div className="text-tiny font-semibold text-muted uppercase tracking-wider mb-1">
          {t("current_balance")}
        </div>
        <div className="text-[24px] font-bold tabular-nums tracking-tight text-ink">
          {curSymbol(account.currency)}
          {fmt(balanceOf(account.id), account.currency)}{" "}
          <span className="text-body-sm text-muted font-medium">{account.currency}</span>
        </div>
        <div className="text-tiny text-muted mt-1 tabular-nums">
          {entryCount} {t("acc_movements_count") || "движений"}
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto">
        {!ledgerAcc ? (
          <div className="p-8 text-center text-body-sm text-muted-soft">
            {t("acc_no_ledger_link") || "Счёт не привязан к плану счетов v2 — истории нет."}
          </div>
        ) : (
          <AccountInlineEntries ctx={lctx} accountId={ledgerAcc.id} />
        )}
      </div>
    </Modal>
  );
}
