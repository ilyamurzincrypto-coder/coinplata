// src/pages/treasury_v2/parts/AccountRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import AccountInlineEntries from "./AccountInlineEntries.jsx";
import AccountSubcontoRow from "./AccountSubcontoRow.jsx";
import InlineBalanceEditor from "./InlineBalanceEditor.jsx";

// `displayMul` — display-sign multiplier for the shown balances (1 by default; −1 for
// liability accounts so an obligation reads as a negative number). Presentation only —
// the underlying ledger figures (`account.balance` / `account.balanceInBase` / `dims`) are
// untouched; the multiplier is applied at render and passed down to subconto rows.
export default function AccountRow({ account, ctx, formatBase, baseCurrency, onOpenTx, displayMul = 1 }) {
  const [expanded, setExpanded] = useState(false);
  const dims = account.dims; // null for a plain account; array for a dimensioned one

  // Поднимаем metadata родителя из chart of accounts — нужно чтобы понять
  // какой kind dim требуется (client vs partner) для нового субконто.
  const parentFull = (ctx?.accounts || []).find((a) => a.id === account.accountId);
  const wantsClient = !!parentFull?.clientDimRequired;
  const wantsPartner = !!parentFull?.partnerDimRequired;
  const dimKind = wantsClient ? "client" : wantsPartner ? "partner" : null;
  return (
    <>
      <div
        className="px-card py-2 flex items-center gap-2 cursor-pointer hover:bg-surface-soft border-t border-border-soft transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
          : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
        <span className="font-mono text-tiny text-muted-soft w-12">{account.code}</span>
        <span className="flex-1 text-body-sm font-medium text-ink truncate">{account.name}</span>
        <span className="text-body-sm font-mono tabular text-ink-soft w-32 text-right">
          {/* Если у юзера нет accounting:edit и счёт — субконто-агрегат
              (dims != null), редактор всё равно деградирует в read-only;
              для dimensioned счетов inline-edit на родителе блокируем
              (там надо выбирать клиента/партнёра — отдельная итерация). */}
          {dims ? (
            <>
              {(Number(account.balance) * displayMul).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              {account.currency}
            </>
          ) : (
            <InlineBalanceEditor
              account={account}
              displayMul={displayMul}
              accounts={ctx?.accounts || []}
              suffix={account.currency}
            />
          )}
        </span>
        <span className="text-body-sm font-mono tabular font-semibold text-ink w-28 text-right">{formatBase(account.balanceInBase * displayMul, baseCurrency)}</span>
      </div>
      {expanded && (dims
        ? (
            <>
              {dims.length === 0 ? (
                <div className="pl-9 pr-card py-2 text-tiny text-muted-soft">—</div>
              ) : (
                dims.map((d, i) => (
                  <AccountSubcontoRow
                    key={`${d.clientId || ""}-${d.partnerId || ""}-${i}`}
                    ctx={ctx}
                    accountId={account.accountId}
                    dim={d}
                    formatBase={formatBase}
                    baseCurrency={baseCurrency}
                    onOpenTx={onOpenTx}
                    displayMul={displayMul}
                  />
                ))
              )}
              {/* «+ Контрагент» — добавить новый субсчёт. Видно если у
                  родителя задан client_dim_required или partner_dim_required. */}
              {dimKind && parentFull && (
                <div className="pl-9 pr-card py-2 border-t border-border-soft bg-surface-soft/30">
                  <InlineBalanceEditor
                    mode="newDim"
                    dimKind={dimKind}
                    dimOptions={ctx?.counterpartyOptions ? ctx.counterpartyOptions(dimKind) : []}
                    account={{
                      code: parentFull.code,
                      currency: parentFull.currency,
                      type: parentFull.type,
                      subtype: parentFull.subtype,
                      balance: 0,
                    }}
                    balanceOverride={0}
                    displayMul={displayMul}
                    accounts={ctx?.accounts || []}
                    suffix={parentFull.currency}
                  />
                </div>
              )}
            </>
          )
        : <AccountInlineEntries ctx={ctx} accountId={account.accountId} onOpenTx={onOpenTx} />)}
    </>
  );
}
