// src/components/RatesImportModal.jsx
// Трёхстадийная модалка импорта курсов из .xlsx.
//   Step 1 Upload:  drop-zone + template download + format guide
//   Step 2 Preview: diff-таблица (new / updated / unchanged / error)
//   Step 3 Confirm: чекбокс + Apply → RPC import_rates (atomic + snapshot)
//
// Валидация полностью клиентская (utils/xlsxRates.js). Запись — через RPC.

import React, { useMemo, useRef, useState } from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useAudit } from "../store/audit.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcImportRates, withToast } from "../lib/supabaseWrite.js";
import {
  parseXlsxFile,
  validateRows,
  buildTemplateBlob,
  downloadBlob,
} from "../utils/xlsxRates.js";

export default function RatesImportModal({ open, onClose }) {
  const { codes } = useCurrencies();
  const { pairs, channels, getRate } = useRates();
  const { addEntry: logAudit } = useAudit();

  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [parsed, setParsed] = useState(null); // { valid, errors, duplicates, summary, sheetCount }
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const fileInputRef = useRef(null);

  // Map из текущих pairs для diff: key = "FROM_TO"
  const currentRatesMap = useMemo(() => {
    const m = new Map();
    pairs.forEach((p) => {
      if (!p.isDefault) return;
      const fromCh = channels.find((c) => c.id === p.fromChannelId);
      const toCh = channels.find((c) => c.id === p.toChannelId);
      if (!fromCh || !toCh) return;
      m.set(`${fromCh.currencyCode}_${toCh.currencyCode}`, p.rate);
    });
    return m;
  }, [pairs, channels]);

  const reset = () => {
    setStep(1);
    setFile(null);
    setParseError(null);
    setParsed(null);
    setDragOver(false);
    setSubmitting(false);
    setAcknowledged(false);
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  // --------- Step 1: file processing ---------
  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setParseError(null);
    setParsed(null);
    try {
      const { rows, sheetCount } = await parseXlsxFile(f);
      const result = validateRows(rows, codes, currentRatesMap);
      setParsed({ ...result, sheetCount });
      setStep(2);
    } catch (err) {
      setParseError(err.message || String(err));
    }
  };

  const handleTemplateDownload = () => {
    const templateRows = [];
    currentRatesMap.forEach((rate, key) => {
      const [from, to] = key.split("_");
      templateRows.push({ from, to, rate });
    });
    const blob = buildTemplateBlob(templateRows);
    downloadBlob(blob, "coinplata-rates-template.xlsx");
  };

  // --------- Step 3: apply import ---------
  const handleApply = async () => {
    if (!parsed || parsed.valid.length === 0 || submitting) return;
    // "unchanged" — не посылаем на бэк (незачем бить snapshot + writes).
    const toSend = parsed.valid
      .filter((v) => v.status !== "unchanged")
      .map((v) => ({ from: v.from, to: v.to, rate: v.rate }));
    if (toSend.length === 0) {
      handleClose();
      return;
    }
    setSubmitting(true);
    try {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () =>
            rpcImportRates(
              toSend,
              `xlsx: ${file?.name || "import"} · ${toSend.length} pairs`
            ),
          {
            success: `Imported ${toSend.length} rate(s)`,
            errorPrefix: "Import failed",
          }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "rates",
            entityId: "bulk",
            summary: `xlsx import: ${parsed.summary.updated} updated, ${parsed.summary.added} added, ${parsed.summary.unchanged} unchanged, ${parsed.summary.errors} errors (${file?.name || ""})`,
          });
          handleClose();
        }
      } else {
        // Demo-режим: молча закрываем — курсы в in-memory seed не меняем
        // чтобы не расходиться с остальной логикой.
        logAudit({
          action: "update",
          entity: "rates",
          entityId: "bulk",
          summary: `[demo] xlsx preview: ${toSend.length} would be applied`,
        });
        handleClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import rates from Excel"
      subtitle={step === 1 ? "Step 1 · Upload file" : step === 2 ? "Step 2 · Review" : "Step 3 · Confirm"}
      width="2xl"
    >
      {/* Step progress */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <React.Fragment key={n}>
              <div
                className={`h-1.5 flex-1 rounded-full ${
                  n <= step ? "bg-slate-900" : "bg-slate-200"
                }`}
              />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step 1 — Upload */}
      {step === 1 && (
        <div className="p-5 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`relative cursor-pointer rounded-[14px] border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300 hover:border-slate-400 bg-slate-50/60"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <div className="text-[14px] font-semibold text-slate-900">
              Drop .xlsx here or click to browse
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Max 5 MB · First sheet only
            </div>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[10px] bg-rose-50 border border-rose-200 text-[12px] text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>{parseError}</div>
            </div>
          )}

          <button
            onClick={handleTemplateDownload}
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] bg-white border border-slate-200 hover:border-slate-300 text-[12px] font-semibold text-slate-700 hover:text-slate-900"
          >
            <Download className="w-3.5 h-3.5" />
            Download template.xlsx (current rates)
          </button>

          <details className="group bg-slate-50/60 border border-slate-200 rounded-[10px] px-4 py-3">
            <summary className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-slate-700 hover:text-slate-900">
              <Info className="w-3.5 h-3.5 text-slate-400" />
              File format guide
            </summary>
            <div className="mt-3 space-y-2 text-[12px] text-slate-600">
              <p>
                <strong>Row 1:</strong> headers <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">From</code>,{" "}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">To</code>,{" "}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">Rate</code>{" "}
                (case-insensitive).
              </p>
              <p>
                <strong>Each row:</strong> one exchange direction. <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">USD → TRY</code> and{" "}
                <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">TRY → USD</code> are two separate rows.
              </p>
              <p>
                <strong>Currency codes:</strong> as in Settings (USD, EUR, USDT, TRY, GBP, CHF, RUB…).
              </p>
              <p>
                <strong>Rate:</strong> positive number. Comma decimal auto-fixed. Max 10 decimals.
              </p>
              <div className="mt-3 border border-slate-200 bg-white rounded-md p-3 text-[11px] font-mono">
                <div className="text-slate-500 mb-1">Example:</div>
                <div>From,To,Rate</div>
                <div>USD,TRY,44.9247</div>
                <div>TRY,USD,44.9254</div>
                <div>EUR,USDT,1.1532</div>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Step 2 — Preview */}
      {step === 2 && parsed && (
        <div className="p-5 space-y-4">
          <SummaryBar summary={parsed.summary} fileName={file?.name} />

          {parsed.sheetCount > 1 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
              <Info className="w-3.5 h-3.5" />
              Workbook has {parsed.sheetCount} sheets — only the first one was parsed.
            </div>
          )}

          {parsed.duplicates.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[10px] bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
              <Info className="w-3.5 h-3.5 mt-0.5" />
              <div>
                Duplicate pairs in file (last one wins):{" "}
                {parsed.duplicates.map((d) => `${d.from}→${d.to} ×${d.count}`).join(", ")}
              </div>
            </div>
          )}

          <div className="border border-slate-200 rounded-[10px] overflow-hidden">
            <div className="max-h-[340px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase">
                    <th className="px-3 py-2">Pair</th>
                    <th className="px-3 py-2 text-right">Old rate</th>
                    <th className="px-3 py-2 text-right">New rate</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.valid.map((v, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-semibold text-slate-900">{v.from}→{v.to}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {v.oldRate != null ? v.oldRate : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{v.rate}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {v.deltaPct != null ? (
                          <span className={v.deltaPct > 0 ? "text-emerald-700" : v.deltaPct < 0 ? "text-rose-700" : "text-slate-400"}>
                            {v.deltaPct > 0 ? "+" : ""}{v.deltaPct.toFixed(2)}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={v.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {parsed.errors.length > 0 && (
            <details className="border border-rose-200 rounded-[10px] overflow-hidden bg-rose-50/40">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-rose-700 hover:bg-rose-50">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
                {parsed.errors.length} error{parsed.errors.length === 1 ? "" : "s"} — will be skipped
              </summary>
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-[11px]">
                  <tbody>
                    {parsed.errors.map((err, i) => (
                      <tr key={i} className="border-t border-rose-100">
                        <td className="px-3 py-1.5 text-slate-500 tabular-nums">row {err.row}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-700">
                          {err.rawFrom || "?"}→{err.rawTo || "?"}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{String(err.rawRate ?? "")}</td>
                        <td className="px-3 py-1.5 text-rose-700 font-semibold">{err.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                reset();
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <ChevronLeft className="w-3 h-3" />
              Upload another file
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={parsed.valid.filter((v) => v.status !== "unchanged").length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Confirm */}
      {step === 3 && parsed && (
        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-[13px] font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4" />
              You're about to overwrite rates
            </div>
            <div className="text-[12px] text-amber-800">
              <strong>{parsed.summary.updated}</strong> existing pair(s) will be updated,{" "}
              <strong>{parsed.summary.added}</strong> new pair(s) added,{" "}
              <strong>{parsed.summary.unchanged}</strong> unchanged,{" "}
              <strong>{parsed.summary.errors}</strong> row(s) skipped.
            </div>
            <div className="text-[11px] text-amber-700 mt-1">
              A snapshot of current rates is saved before the import — you can find it in audit / rate history.
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            <span className="text-[12px] text-slate-700">
              I understand this will overwrite existing rates. My team will see the new values immediately.
            </span>
          </label>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <ChevronLeft className="w-3 h-3" />
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!acknowledged || submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {submitting ? "Applying…" : "Apply import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SummaryBar({ summary, fileName }) {
  return (
    <div className="flex items-center gap-3 flex-wrap bg-slate-50 border border-slate-200 rounded-[10px] px-4 py-3">
      <FileSpreadsheet className="w-4 h-4 text-slate-500" />
      <span className="text-[12px] font-semibold text-slate-900 truncate max-w-[200px]" title={fileName}>
        {fileName || "upload.xlsx"}
      </span>
      <div className="h-4 w-px bg-slate-300" />
      <Pill tone="emerald" label={`${summary.added} new`} />
      <Pill tone="sky" label={`${summary.updated} updated`} />
      <Pill tone="slate" label={`${summary.unchanged} unchanged`} />
      {summary.errors > 0 && <Pill tone="rose" label={`${summary.errors} errors`} />}
    </div>
  );
}

function Pill({ tone, label }) {
  const styles = {
    emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    sky: "bg-sky-100 text-sky-700 ring-sky-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    rose: "bg-rose-100 text-rose-700 ring-rose-200",
  }[tone];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wider ring-1 ${styles}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    new: { label: "new", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
    updated: { label: "updated", cls: "bg-sky-100 text-sky-700 ring-sky-200" },
    unchanged: { label: "unchanged", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
  };
  const it = map[status] || map.unchanged;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ring-1 ${it.cls}`}>
      {it.label}
    </span>
  );
}
