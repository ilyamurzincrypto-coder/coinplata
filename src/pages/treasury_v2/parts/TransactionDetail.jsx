// src/pages/treasury_v2/parts/TransactionDetail.jsx
import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import TransactionEntries from "./TransactionEntries.jsx";

export default function TransactionDetail({ node, onClose }) {
  const { t } = useTranslation();
  if (!node) return null;
  const { tx, entries } = node;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-[14px] max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-bold">{tx.kind} {tx.sourceRefId ? `#${tx.sourceRefId}` : ""}</h3>
            <p className="text-[11px] text-slate-400">{new Date(tx.effectiveDate).toISOString().slice(0, 16).replace("T", " ")} · {tx.id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-1">
          {tx.description && <p className="px-5 py-2 text-[12.5px] text-slate-600">{tx.description}</p>}
          <TransactionEntries entries={entries} />
          {tx.metadata && Object.keys(tx.metadata).length > 0 && (
            <pre className="mx-5 my-2 p-2 bg-slate-50 rounded text-[11px] text-slate-500 overflow-auto">{JSON.stringify(tx.metadata, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
