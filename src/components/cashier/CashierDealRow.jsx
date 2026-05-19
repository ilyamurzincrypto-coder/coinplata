// src/components/cashier/CashierDealRow.jsx
// A manager-friendly deal row for the Cashier page — reads like a deal slip, NOT a
// journal entry. Collapsed: time · counterparty · «пришло → ушло» · маржа · статус.
// Expanded: <DealDetail> (manager language, no Дт/Кт) + actions (undo deal / edit note).
// The accounting view (Дт/Кт trees, all-offices) is the Treasury "Сделки"/"Журнал" tabs.
import React, { useState } from "react";
import { ChevronRight, ChevronDown, RotateCcw, CheckCircle2, Clock } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useCan } from "../../store/permissions.jsx";
import { dealSummary, dealRate } from "../../lib/treasury/dealSummary.js";
import DealDetail from "./DealDetail.jsx";
import ReverseEntryModal from "../../pages/treasury_v2/parts/ReverseEntryModal.jsx";
import EditTxNoteModal from "../../pages/treasury_v2/parts/EditTxNoteModal.jsx";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const fmtAmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtRate = (r) => Number(r).toLocaleString(undefined, { maximumSignificantDigits: 6 });
const legStr = (l) => `${fmtAmt(l.amount)} ${l.currency}`;

// node — { tx, entries }; accById — Map<accountId, account>; counterpartyName — fn(clientId)→name
export default function CashierDealRow({ node, accById, counterpartyName }) {
  const { t } = useTranslation();
  const can = useCan();
  const [expanded, setExpanded] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const { tx } = node;
  const meta = tx.metadata || {};

  // Counterparty: explicit nickname in metadata wins; else first real client_id on an entry.
  let counterparty = meta.client_nickname || null;
  if (!counterparty) {
    const cid = (node.entries || []).map((e) => e.clientId).find((id) => id && id !== ZERO_UUID);
    if (cid && typeof counterpartyName === "function") counterparty = counterpartyName(cid) || null;
  }
  if (!counterparty) counterparty = "—";

  const s = dealSummary(node, accById);
  const inStr = s && s.in.length ? s.in.map(legStr).join(" + ") : "—";
  const outStr = s && s.out.length ? s.out.map(legStr).join(" + ") : "—";
  const marginStr = s && s.margin.length ? s.margin.map(legStr).join(" + ") : null;
  const rate = dealRate(s);

  const isReversed = tx.status === "reversed";
  const isReversal = !!tx.reversesTransactionId;
  const isOtc = meta.kind === "otc";
  const hasObligation = !!meta.has_deferred;
  const canReverse = !isReversal && !isReversed && can("transactions", "edit");
  const canEditNote = can("transactions", "edit") || can("accounting", "edit");

  const dt = new Date(tx.effectiveDate);
  const pad = (n) => String(n).padStart(2, "0");
  const dtStr = `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

  return (
    <div className="border-t border-border-soft first:border-t-0">
      <div className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-surface-soft" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-soft shrink-0" />}
        <span className="text-[11px] text-muted-soft tabular-nums w-[64px] shrink-0">{dtStr}</span>
        <span className="text-[12.5px] font-semibold text-ink w-[120px] truncate shrink-0" title={counterparty}>{counterparty}</span>
        {isOtc && (
          <span className="text-[9.5px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-accent-bg text-accent shrink-0">OTC</span>
        )}
        <span className="flex-1 min-w-0 text-[12.5px] text-ink-soft truncate tabular-nums">
          {inStr} <span className="text-muted-soft mx-0.5">→</span> {outStr}
          {rate && <span className="text-muted-soft ml-2">@ {fmtRate(rate.rate)}</span>}
        </span>
        {marginStr && (
          <span className="text-[11.5px] text-success font-medium tabular-nums shrink-0 whitespace-nowrap">{t("cashier_deal_margin")} {marginStr}</span>
        )}
        {isReversed ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-surface-sunk text-muted shrink-0"><RotateCcw className="w-3 h-3" />{t("cashdeal_status_reversed")}</span>
        ) : hasObligation ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-warning-soft text-warning shrink-0"><Clock className="w-3 h-3" />{t("cashdeal_has_obligation")}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-success-soft text-success shrink-0"><CheckCircle2 className="w-3 h-3" />{t("cashdeal_status_posted")}</span>
        )}
      </div>
      {expanded && (
        <div className="bg-surface-soft/60">
          <DealDetail node={node} accById={accById} counterpartyName={counterpartyName} />
          {(canEditNote || canReverse) && (
            <div className="px-6 pb-3 flex items-center gap-4">
              {canEditNote && (
                <button onClick={() => setNoteOpen(true)} className="text-[12px] text-accent hover:underline">{t("trv2_tx_edit_note")}</button>
              )}
              {canReverse && (
                <button onClick={() => setReverseOpen(true)} className="text-[12px] text-danger hover:underline">{t("trv2_journal_undo_deal")}</button>
              )}
            </div>
          )}
        </div>
      )}
      {reverseOpen && <ReverseEntryModal tx={tx} cascade onClose={() => setReverseOpen(false)} />}
      {noteOpen && <EditTxNoteModal tx={tx} onClose={() => setNoteOpen(false)} />}
    </div>
  );
}
