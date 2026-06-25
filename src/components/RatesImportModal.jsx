// src/components/RatesImportModal.jsx
// Трёхстадийная модалка импорта курсов из .xlsx.
//   Step 1 Upload:  drop-zone + template download + format guide
//   Step 2 Preview: diff-таблица (new / updated / unchanged / error)
//   Step 3 Confirm: чекбокс + Apply → RPC import_rates (atomic + snapshot)
//
// Валидация полностью клиентская (utils/xlsxRates.js). Запись — через RPC.

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useOffices } from "../store/offices.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcImportRates, rpcUpsertOfficeRate, rpcReplaceSpecialRates, withToast } from "../lib/supabaseWrite.js";
import {
  parseXlsxFile,
  validateRows,
  buildTemplateBlob,
  downloadBlob,
} from "../utils/xlsxRates.js";
import { parseMorningRates, buildMorningUpdates, resolveRateValue } from "../utils/morningRatesParser.js";

// Безопасный рендер i18n строк формата `<strong>label:</strong> body`.
// Раньше использовали dangerouslySetInnerHTML — это работало (источник
// hardcoded в translations.jsx), но anti-pattern: если когда-нибудь
// перенесём i18n на загрузку из API, открывалась бы XSS.
function renderBoldPrefix(s) {
  if (typeof s !== "string") return s;
  const m = /^<strong>([^<]*)<\/strong>(.*)$/.exec(s);
  if (!m) return s;
  return (
    <>
      <strong>{m[1]}</strong>
      {m[2]}
    </>
  );
}

export default function RatesImportModal({ open, onClose, initialSource }) {
  const { t } = useTranslation();
  const { codes, dict: currencyDict } = useCurrencies();
  const {
    pairs,
    channels,
    getRate,
    applyOfficeOverrideLocal,
    setSpecialRatesSnapshot,
    addChannel,
    addPair,
  } = useRates();
  const { offices } = useOffices();
  const { addEntry: logAudit } = useAudit();

  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [parsed, setParsed] = useState(null); // { valid, errors, duplicates, summary, sheetCount }
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [source, setSource] = useState(initialSource || "file"); // "file" | "text"
  const [bulkText, setBulkText] = useState("");

  // Открытие с предзаданной вкладкой (дашборд «Вставить курсы» → сразу «Текст»).
  useEffect(() => {
    if (open && initialSource) setSource(initialSource);
  }, [open, initialSource]);
  const [textParsed, setTextParsed] = useState(null);
  const fileInputRef = useRef(null);

  const kindOf = (code) => (currencyDict?.[code]?.type === "crypto" ? "crypto" : "cash");

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
    setSource("file");
    setBulkText("");
    setTextParsed(null);
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  // --------- Step 1: file processing ---------
  // Локализация err.message: utils/xlsxRates.js бросает английские строки-маркеры,
  // сопоставляем с t() для UI.
  const localizeErr = (msg) => {
    const m = String(msg || "");
    if (m === "No file provided") return t("rimport_err_no_file");
    if (m.startsWith("File is larger than 5 MB")) return t("rimport_err_too_big");
    if (m === "Could not read file. Make sure it's a valid .xlsx.") return t("rimport_err_read");
    if (m === "Workbook has no sheets.") return t("rimport_err_no_sheets");
    if (m === "File is empty or has no data rows.") return t("rimport_err_empty");
    if (m.startsWith("Header row must contain")) return t("rimport_err_headers");
    return m;
  };

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
      setParseError(localizeErr(err.message || String(err)));
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

  // --------- Text import (утренний документ) ---------
  const handleParseText = () => {
    const parsed = parseMorningRates(bulkText);
    const { updates, skipped } = buildMorningUpdates(parsed, kindOf, offices);
    setTextParsed({ updates, skipped, special: parsed.special });
    setStep(2);
  };

  const ensureSbpPair = async (s) => {
    const SBP_CH = "ch_rub_sbp";
    // СБП-строка даёт RUB-за-USDT (напр. 75,50). Пара RUB→USDT хранит USDT-за-RUB,
    // поэтому конвертируем как cash→crypto (= 1/value), как и офисные якоря.
    const rate = resolveRateValue({ value: s.value, pct: false }, "cash", "crypto");
    if (rate == null || !Number.isFinite(rate) || rate <= 0) return;
    if (!(channels || []).some((c) => c.id === SBP_CH)) {
      addChannel({ id: SBP_CH, currencyCode: "RUB", kind: "sbp", isDefaultForCurrency: false });
    }
    await addPair({ fromChannelId: SBP_CH, toChannelId: "ch_usdt_trc20", rate, priority: 60 });
  };

  const handleApplyText = async () => {
    if (!textParsed || submitting) return;
    setSubmitting(true);
    try {
      // Оборачиваем всю запись в withToast: сбой в середине цикла (RPC/пара/snapshot)
      // теперь всплывает тостом, а не молча подвешивает модалку.
      const res = await withToast(
        async () => {
          for (const u of textParsed.updates) {
            if (isSupabaseConfigured) {
              await rpcUpsertOfficeRate({ officeId: u.officeId, from: u.from, to: u.to, rate: u.rate });
            }
            applyOfficeOverrideLocal(u.officeId, u.from, u.to, { rate: u.rate });
          }
          const specials = textParsed.special || [];
          for (const s of specials.filter((x) => x.kind === "sbp")) {
            await ensureSbpPair(s);
          }
          const nerez = specials
            .filter((x) => x.kind === "nerez")
            .map((s) => ({ ...s, importedAt: new Date().toISOString() }));
          // Персист снимка НЕРЕЗ в Supabase (переживает рефреш), + локально.
          if (isSupabaseConfigured) {
            await rpcReplaceSpecialRates(nerez);
          }
          setSpecialRatesSnapshot(nerez);
          logAudit({
            action: "update",
            entity: "rates",
            entityId: "bulk",
            summary: `morning-import: ${textParsed.updates.length} якорей, ${specials.length} спец, ${textParsed.skipped.length} пропущено`,
          });
        },
        {
          success: `Импорт: ${textParsed.updates.length} якорей`,
          errorPrefix: "Импорт не удался",
        }
      );
      if (res.ok) handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("rimport_title")}
      subtitle={step === 1 ? t("rimport_step_upload") : step === 2 ? t("rimport_step_review") : t("rimport_step_confirm")}
      width="2xl"
    >
      {/* Step progress */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <React.Fragment key={n}>
              <div
                className={`h-1.5 flex-1 rounded-full ${
                  n <= step ? "bg-ink" : "bg-surface-sunk"
                }`}
              />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step 1 — Upload */}
      {step === 1 && (
        <div className="p-5 space-y-4">
          {/* Source tabs: XLSX file / Text */}
          <div className="flex items-center gap-1 p-1 rounded-card bg-surface-sunk">
            {[
              { id: "file", label: t("rimport_tab_file") },
              { id: "text", label: t("rimport_tab_text") },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSource(tab.id)}
                className={`flex-1 px-3 py-1.5 rounded-button text-caption font-semibold transition-colors ${
                  source === tab.id
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {source === "file" && (
            <>
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
            className={`relative cursor-pointer rounded-card-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-ink bg-surface-soft" : "border-border hover:border-accent/40 bg-surface-soft/60"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Upload className="w-8 h-8 text-muted-soft mx-auto mb-2" />
            <div className="text-body font-semibold text-ink">
              {t("rimport_drop_here")}
            </div>
            <div className="text-tiny text-muted mt-1">
              {t("rimport_size_hint")}
            </div>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-card bg-danger-soft border border-danger/20 text-caption text-danger">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>{parseError}</div>
            </div>
          )}

          <button
            onClick={handleTemplateDownload}
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-card bg-white border border-border-soft hover:border-border text-caption font-semibold text-ink-soft hover:text-ink"
          >
            <Download className="w-3.5 h-3.5" />
            {t("rimport_download_template")}
          </button>

          <details className="group bg-surface-soft/60 border border-border-soft rounded-card px-4 py-3">
            <summary className="flex items-center gap-2 cursor-pointer text-caption font-semibold text-ink-soft hover:text-ink">
              <Info className="w-3.5 h-3.5 text-muted-soft" />
              {t("rimport_format_guide")}
            </summary>
            <div className="mt-3 space-y-2 text-caption text-ink-soft">
              <p>
                {renderBoldPrefix(t("rimport_format_row1"))}{" "}
                <code className="px-1 py-0.5 bg-white border border-border-soft rounded">From</code>,{" "}
                <code className="px-1 py-0.5 bg-white border border-border-soft rounded">To</code>,{" "}
                <code className="px-1 py-0.5 bg-white border border-border-soft rounded">Rate</code>.
              </p>
              <p>{renderBoldPrefix(t("rimport_format_row"))}</p>
              <p>{renderBoldPrefix(t("rimport_format_codes"))}</p>
              <p>{renderBoldPrefix(t("rimport_format_rate"))}</p>
              <div className="mt-3 border border-border-soft bg-white rounded-md p-3 text-tiny font-mono">
                <div className="text-muted mb-1">{t("rimport_format_example")}</div>
                <div>From,To,Rate</div>
                <div>USD,TRY,44.9247</div>
                <div>TRY,USD,44.9254</div>
                <div>EUR,USDT,1.1532</div>
              </div>
            </div>
          </details>
            </>
          )}

          {source === "text" && (
            <div className="space-y-3">
              <div className="text-caption text-ink-soft">{t("rimport_text_hint")}</div>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={t("rimport_text_placeholder")}
                rows={12}
                className="w-full rounded-card border border-border bg-surface-soft/60 px-3 py-2 text-caption font-mono text-ink focus:border-ink focus:outline-none resize-y"
              />
              <button
                type="button"
                onClick={handleParseText}
                disabled={!bulkText.trim()}
                className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-button text-caption font-semibold bg-ink text-white hover:bg-ink disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("rimport_text_parse")}
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Preview (text mode) */}
      {step === 2 && source === "text" && textParsed && (
        <div className="p-5 space-y-4">
          {/* Anchors */}
          <div className="border border-border-soft rounded-card overflow-hidden">
            <div className="px-3 py-2 bg-surface-soft border-b border-border-soft text-tiny font-bold text-muted tracking-[0.1em] uppercase">
              {t("rimport_anchors_title")} · {textParsed.updates.length}
            </div>
            <div className="max-h-[240px] overflow-auto divide-y divide-border-soft">
              {textParsed.updates.map((u, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 text-caption">
                  <span className="text-ink-soft">
                    <span className="font-semibold text-ink">{u.officeId}</span> · {u.from}→{u.to}
                  </span>
                  <span className="tabular-nums font-semibold text-ink">{u.rate}</span>
                </div>
              ))}
              {textParsed.updates.length === 0 && (
                <div className="px-3 py-2 text-caption text-muted">—</div>
              )}
            </div>
          </div>

          {/* Special rates */}
          {(textParsed.special || []).length > 0 && (
            <div className="border border-border-soft rounded-card overflow-hidden">
              <div className="px-3 py-2 bg-surface-soft border-b border-border-soft text-tiny font-bold text-muted tracking-[0.1em] uppercase">
                {t("rimport_special_title")} · {textParsed.special.length}
              </div>
              <div className="max-h-[200px] overflow-auto divide-y divide-border-soft">
                {textParsed.special.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 text-caption">
                    <span className="text-ink-soft">
                      {s.kind === "sbp"
                        ? `СБП ${s.from}→${s.to}`
                        : `НЕРЕЗ ${s.side} ${s.settle}`}
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skipped */}
          {(textParsed.skipped || []).length > 0 && (
            <details className="border border-warning/20 rounded-card overflow-hidden bg-warning-soft/40">
              <summary className="cursor-pointer px-3 py-2 text-caption font-bold text-warning hover:bg-warning-soft">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
                {t("rimport_skipped_title")} · {textParsed.skipped.length}
              </summary>
              <div className="max-h-[200px] overflow-auto divide-y divide-border-soft">
                {textParsed.skipped.map((s, i) => (
                  <div key={i} className="px-3 py-1.5 text-tiny text-ink-soft">
                    «{s.line}» — <span className="text-warning">{s.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border-soft">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
            >
              <ChevronLeft className="w-3 h-3" />
              {t("rimport_upload_another")}
            </button>
            <button
              type="button"
              onClick={handleApplyText}
              disabled={submitting || textParsed.updates.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-caption font-semibold bg-success text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {t("rimport_text_apply")}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Preview */}
      {step === 2 && source === "file" && parsed && (
        <div className="p-5 space-y-4">
          <SummaryBar summary={parsed.summary} fileName={file?.name} t={t} />

          {parsed.sheetCount > 1 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-warning-soft border border-warning/20 text-caption text-warning">
              <Info className="w-3.5 h-3.5" />
              {t("rimport_many_sheets").replace("{n}", parsed.sheetCount)}
            </div>
          )}

          {parsed.duplicates.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-card bg-warning-soft border border-warning/20 text-caption text-warning">
              <Info className="w-3.5 h-3.5 mt-0.5" />
              <div>
                {t("rimport_duplicates_hint")}{" "}
                {parsed.duplicates.map((d) => `${d.from}→${d.to} ×${d.count}`).join(", ")}
              </div>
            </div>
          )}

          <div className="border border-border-soft rounded-card overflow-hidden">
            <div className="max-h-[340px] overflow-auto">
              <table className="w-full text-caption">
                <thead className="sticky top-0 bg-surface-soft border-b border-border-soft">
                  <tr className="text-left text-tiny font-bold text-muted tracking-[0.1em] uppercase">
                    <th className="px-3 py-2">{t("rimport_col_pair")}</th>
                    <th className="px-3 py-2 text-right">{t("rimport_col_old")}</th>
                    <th className="px-3 py-2 text-right">{t("rimport_col_new")}</th>
                    <th className="px-3 py-2 text-right">{t("rimport_col_delta")}</th>
                    <th className="px-3 py-2">{t("rimport_col_status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.valid.map((v, i) => (
                    <tr key={i} className="border-b border-border-soft last:border-0 hover:bg-surface-soft/60">
                      <td className="px-3 py-2 font-semibold text-ink">{v.from}→{v.to}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {v.oldRate != null ? v.oldRate : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{v.rate}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {v.deltaPct != null ? (
                          <span className={v.deltaPct > 0 ? "text-success" : v.deltaPct < 0 ? "text-danger" : "text-muted-soft"}>
                            {v.deltaPct > 0 ? "+" : ""}{v.deltaPct.toFixed(2)}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={v.status} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {parsed.errors.length > 0 && (
            <details className="border border-danger/20 rounded-card overflow-hidden bg-danger-soft/40">
              <summary className="cursor-pointer px-3 py-2 text-caption font-bold text-danger hover:bg-danger-soft">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
                {parsed.errors.length} {t("rimport_errors_caption")}
              </summary>
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-tiny">
                  <tbody>
                    {parsed.errors.map((err, i) => (
                      <tr key={i} className="border-t border-rose-100">
                        <td className="px-3 py-1.5 text-muted tabular-nums">row {err.row}</td>
                        <td className="px-3 py-1.5 font-mono text-ink-soft">
                          {err.rawFrom || "?"}→{err.rawTo || "?"}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-ink-soft">{String(err.rawRate ?? "")}</td>
                        <td className="px-3 py-1.5 text-danger font-semibold">{err.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border-soft">
            <button
              type="button"
              onClick={() => {
                reset();
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
            >
              <ChevronLeft className="w-3 h-3" />
              {t("rimport_upload_another")}
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={parsed.valid.filter((v) => v.status !== "unchanged").length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-caption font-semibold bg-ink text-white hover:bg-ink disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("rimport_continue")}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Confirm */}
      {step === 3 && parsed && (
        <div className="p-5 space-y-4">
          <div className="bg-warning-soft border border-warning/20 rounded-card px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-body-sm font-bold text-warning">
              <AlertTriangle className="w-4 h-4" />
              {t("rimport_about_to_overwrite")}
            </div>
            <div className="text-caption text-warning">
              {t("rimport_summary_line")
                .replace("{upd}", parsed.summary.updated)
                .replace("{add}", parsed.summary.added)
                .replace("{unch}", parsed.summary.unchanged)
                .replace("{err}", parsed.summary.errors)}
            </div>
            <div className="text-tiny text-warning mt-1">
              {t("rimport_snapshot_hint")}
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border text-ink focus:ring-accent"
            />
            <span className="text-caption text-ink-soft">
              {t("rimport_ack")}
            </span>
          </label>

          <div className="flex items-center justify-between pt-2 border-t border-border-soft">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
            >
              <ChevronLeft className="w-3 h-3" />
              {t("rimport_back")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-button text-caption font-semibold text-ink-soft hover:text-ink hover:bg-surface-sunk"
              >
                {t("rimport_cancel")}
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!acknowledged || submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-button text-caption font-semibold bg-success text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {submitting ? t("rimport_applying") : t("rimport_apply")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SummaryBar({ summary, fileName, t }) {
  return (
    <div className="flex items-center gap-3 flex-wrap bg-surface-soft border border-border-soft rounded-card px-4 py-3">
      <FileSpreadsheet className="w-4 h-4 text-muted" />
      <span className="text-caption font-semibold text-ink truncate max-w-[200px]" title={fileName}>
        {fileName || "upload.xlsx"}
      </span>
      <div className="h-4 w-px bg-surface-sunk" />
      <Pill tone="emerald" label={t("rimport_pills_new").replace("{n}", summary.added)} />
      <Pill tone="sky" label={t("rimport_pills_updated").replace("{n}", summary.updated)} />
      <Pill tone="slate" label={t("rimport_pills_unchanged").replace("{n}", summary.unchanged)} />
      {summary.errors > 0 && <Pill tone="rose" label={t("rimport_pills_errors").replace("{n}", summary.errors)} />}
    </div>
  );
}

function Pill({ tone, label }) {
  const styles = {
    emerald: "bg-emerald-100 text-success ring-emerald-200",
    sky: "bg-sky-100 text-info ring-sky-200",
    slate: "bg-surface-sunk text-ink-soft ring-border-soft",
    rose: "bg-rose-100 text-danger ring-rose-200",
  }[tone];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-tiny font-bold tracking-wider ring-1 ${styles}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status, t }) {
  const map = {
    new: { label: t("rimport_status_new"), cls: "bg-emerald-100 text-success ring-emerald-200" },
    updated: { label: t("rimport_status_updated"), cls: "bg-sky-100 text-info ring-sky-200" },
    unchanged: { label: t("rimport_status_unchanged"), cls: "bg-surface-sunk text-muted ring-border-soft" },
  };
  const it = map[status] || map.unchanged;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-tiny font-bold uppercase tracking-wider ring-1 ${it.cls}`}>
      {it.label}
    </span>
  );
}
