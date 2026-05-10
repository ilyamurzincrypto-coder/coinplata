// src/pages/treasury_v2/parts/TransactionRow.jsx
import React, { useState } from "react";
import { ChevronRight, ChevronDown, RotateCcw } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import TransactionEntries from "./TransactionEntries.jsx";
import ReverseEntryModal from "./ReverseEntryModal.jsx";

export default function TransactionRow({ node, onOpenSource }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { tx, entries } = node;
  const can = useCan();
  const [reverseOpen, setReverseOpen] = useState(false);
  const isReversal = !!tx.reversesTransactionId;
  const isReversed = tx.status === "reversed";
  // offer "Reverse" only on an original manual entry — not on a reversal-of-a-manual-entry,
  // and not on one that's already been reversed.
  const canReverseManual = tx.kind === "manual" && !isReversal && !isReversed && can("accounting", "edit");
  const dt = new Date(tx.effectiveDate);
  const sourceLabel = tx.sourceRefId ? `${tx.kind} #${tx.sourceRefId}` : tx.kind;
  return (
    <div className="border-t border-slate-100">
      <div className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        <span className="text-[11px] text-slate-400 w-32">{dt.toISOString().slice(0, 16).replace("T", " ")}</span>
        <span className="text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{tx.kind}</span>
        {isReversal && <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600"><RotateCcw className="w-3 h-3" />{t("trv2_journal_is_reversal")}</span>}
        {isReversed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t("trv2_pm_reversed_chip")}</span>}
        <span className="flex-1 text-[12.5px] text-slate-700 truncate">{tx.description || sourceLabel}</span>
        <span className="text-[11px] text-slate-400">{t("trv2_journal_entries_count").replace("{n}", String(entries.length))}</span>
        <span className="font-mono text-[10px] text-slate-300">{tx.id.slice(0, 8)}</span>
      </div>
      {expanded && (
        <div className="bg-slate-50/60">
          <TransactionEntries entries={entries} />
          {tx.sourceRefId && (
            <div className="px-6 pb-2">
              <button onClick={() => onOpenSource?.(tx)} className="text-[12px] text-indigo-600 hover:underline">
                {t("trv2_journal_open_source").replace("{label}", sourceLabel)}
              </button>
            </div>
          )}
          {canReverseManual && (
            <div className="px-6 pb-2">
              <button onClick={() => setReverseOpen(true)} className="text-[12px] text-rose-600 hover:underline">
                {t("trv2_pm_reverse")}
              </button>
            </div>
          )}
        </div>
      )}
      {reverseOpen && <ReverseEntryModal tx={tx} onClose={() => setReverseOpen(false)} />}
    </div>
  );
}
