// src/pages/treasury_v2/parts/TransactionRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown, RotateCcw } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import TransactionEntries from "./TransactionEntries.jsx";
import ReverseEntryModal from "./ReverseEntryModal.jsx";
import EditTxNoteModal from "./EditTxNoteModal.jsx";

// `summaryLine` (optional string) — a one-line human summary shown under the title
// while the row is collapsed (e.g. the Cashier passes a deal's «пришло → ушло · спред»).
// `onOpenSource` (optional) — when omitted, the "open source" link is hidden (the
// Cashier has no transaction-detail modal; Treasury keeps passing it).
// `renderDetail` (optional fn `(node) => ReactNode`) — when provided, the expanded
// body renders this INSTEAD of the Dr/Cr <TransactionEntries> tree (the Cashier passes
// a manager-friendly <DealDetail>). The "open source" link + reverse/edit-note actions
// still render below it. When absent → the classic accounting view (default).
export default function TransactionRow({ node, onOpenSource, summaryLine, renderDetail }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { tx, entries } = node;
  const can = useCan();
  const [reverseOpen, setReverseOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const canEditNote = can("transactions", "edit") || can("accounting", "edit");
  const isReversal = !!tx.reversesTransactionId;
  const isReversed = tx.status === "reversed";
  const isDeal = tx.kind === "deal";
  // Offer "reverse" / "undo deal" only on an ORIGINAL manual entry or deal — not on a
  // reversal itself, and not on one that's already been reversed. Manual entries need
  // accounting:edit (accountant); deals need transactions:edit (cashier can undo their own).
  const canReverse = !isReversal && !isReversed && (
    (tx.kind === "manual" && can("accounting", "edit")) ||
    (isDeal && can("transactions", "edit"))
  );
  const dt = new Date(tx.effectiveDate);
  const sourceLabel = tx.sourceRefId ? `${tx.kind} #${tx.sourceRefId}` : tx.kind;
  return (
    <div className="border-t border-border-soft">
      <div className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-surface-soft" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" />}
        <span className="text-tiny text-muted-soft w-32">{dt.toISOString().slice(0, 16).replace("T", " ")}</span>
        <span className="text-tiny uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-sunk text-ink-soft">{tx.kind}</span>
        {isReversal && <span className="inline-flex items-center gap-0.5 text-tiny text-danger"><RotateCcw className="w-3 h-3" />{t("trv2_journal_is_reversal")}</span>}
        {isReversed && <span className="text-tiny px-1.5 py-0.5 rounded bg-surface-sunk text-muted">{t("trv2_pm_reversed_chip")}</span>}
        <span className="flex-1 min-w-0 text-caption text-ink-soft truncate">
          {tx.description || sourceLabel}
          {!expanded && summaryLine && <span className="block text-tiny text-muted-soft truncate">{summaryLine}</span>}
        </span>
        <span className="text-tiny text-muted-soft shrink-0">{t("trv2_journal_entries_count").replace("{n}", String(entries.length))}</span>
        <span className="font-mono text-tiny text-muted-soft shrink-0">{tx.id.slice(0, 8)}</span>
      </div>
      {expanded && (
        <div className="bg-surface-soft/60">
          {renderDetail ? renderDetail(node) : <TransactionEntries entries={entries} />}
          {tx.sourceRefId && onOpenSource && (
            <div className="px-6 pb-2">
              <button onClick={() => onOpenSource(tx)} className="text-caption text-indigo-600 hover:underline">
                {t("trv2_journal_open_source").replace("{label}", sourceLabel)}
              </button>
            </div>
          )}
          <div className="px-6 pb-2 flex items-center gap-4">
            {canEditNote && (
              <button onClick={() => setNoteOpen(true)} className="text-caption text-indigo-600 hover:underline">
                {t("trv2_tx_edit_note")}
              </button>
            )}
            {canReverse && (
              <button onClick={() => setReverseOpen(true)} className="text-caption text-danger hover:underline">
                {isDeal ? t("trv2_journal_undo_deal") : t("trv2_pm_reverse")}
              </button>
            )}
          </div>
          {tx.metadata?.comment && (
            <div className="px-6 pb-2 text-caption text-muted italic">«{tx.metadata.comment}»</div>
          )}
        </div>
      )}
      {reverseOpen && <ReverseEntryModal tx={tx} cascade={isDeal} onClose={() => setReverseOpen(false)} />}
      {noteOpen && <EditTxNoteModal tx={tx} onClose={() => setNoteOpen(false)} />}
    </div>
  );
}
