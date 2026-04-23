// src/components/accounts/AccountsImportModal.jsx
// CSV-импорт счетов. 3 шага: Upload → Preview → Apply.
// Формат: Office, Account, Currency, Type, Balance, Address (opt), Network (opt).
// Совместим с экспортом из AccountsPage (Export CSV) — те же колонки.

import React, { useMemo, useRef, useState } from "react";
import {
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { buildTemplateBlob, downloadBlob, parseXlsxFile } from "../../utils/xlsxRates.js";

// Минимальный CSV-парсер: split по новой строке, запятая как sep.
// Поддерживает quoted values с "" внутри.
function parseCSV(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        row.push(field); field = "";
        if (row.length > 0 && !(row.length === 1 && !row[0])) rows.push(row);
        row = [];
        // Handle \r\n
        if (c === "\r" && text[i + 1] === "\n") i += 2;
        else i++;
        continue;
      }
      field += c; i++;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && !row[0])) rows.push(row);
  }
  return rows;
}

const H = (v) => String(v || "").trim().toLowerCase();

function findIdx(headerRow, aliases) {
  return headerRow.findIndex((h) => aliases.includes(H(h)));
}

const ALIASES = {
  office: ["office", "office_name"],
  name: ["account", "name", "account_name"],
  currency: ["currency", "cur", "code"],
  type: ["type", "kind", "channel"],
  balance: ["balance", "amount", "opening"],
  address: ["address", "wallet"],
  network: ["network", "net"],
};

export default function AccountsImportModal({ open, onClose }) {
  const { t } = useTranslation();
  const { addAccount, accounts } = useAccounts();
  const { offices } = useOffices();
  const { codes: CURRENCIES } = useCurrencies();
  const { addEntry: logAudit } = useAudit();

  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [parsed, setParsed] = useState(null); // { valid, errors, summary }
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const officeByName = useMemo(() => {
    const m = new Map();
    offices.forEach((o) => m.set(H(o.name), o));
    return m;
  }, [offices]);

  const currencySet = useMemo(() => new Set(CURRENCIES.map((c) => c.toUpperCase())), [CURRENCIES]);

  const existingAccountKey = (name, officeId) => `${H(name)}__${officeId}`;
  const existingKeys = useMemo(() => {
    const s = new Set();
    accounts.forEach((a) => s.add(existingAccountKey(a.name, a.officeId)));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const reset = () => {
    setStep(1);
    setFile(null);
    setParseError(null);
    setParsed(null);
    setSubmitting(false);
    setAcknowledged(false);
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const validate = (rows) => {
    if (!rows || rows.length < 2) {
      throw new Error(t("acc_import_err_empty") || "File has no data rows.");
    }
    const header = rows[0];
    const idx = {
      office: findIdx(header, ALIASES.office),
      name: findIdx(header, ALIASES.name),
      currency: findIdx(header, ALIASES.currency),
      type: findIdx(header, ALIASES.type),
      balance: findIdx(header, ALIASES.balance),
      address: findIdx(header, ALIASES.address),
      network: findIdx(header, ALIASES.network),
    };
    if (idx.office < 0 || idx.name < 0 || idx.currency < 0) {
      throw new Error(t("acc_import_err_headers") || "Required headers: Office, Account, Currency.");
    }

    const valid = [];
    const errors = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((x) => !String(x || "").trim())) continue;
      const officeName = String(r[idx.office] || "").trim();
      const name = String(r[idx.name] || "").trim();
      const currency = String(r[idx.currency] || "").trim().toUpperCase();
      if (!officeName || !name || !currency) {
        errors.push({ row: i + 1, reason: "Missing office / name / currency", raw: r });
        continue;
      }
      const office = officeByName.get(H(officeName));
      if (!office) {
        errors.push({ row: i + 1, reason: `Unknown office: ${officeName}`, raw: r });
        continue;
      }
      if (!currencySet.has(currency)) {
        errors.push({ row: i + 1, reason: `Unknown currency: ${currency}`, raw: r });
        continue;
      }
      const balanceRaw = String(r[idx.balance] || "").replace(/\s+/g, "").replace(",", ".");
      const balance = Number(balanceRaw);
      if (balanceRaw && !Number.isFinite(balance)) {
        errors.push({ row: i + 1, reason: `Invalid balance: ${balanceRaw}`, raw: r });
        continue;
      }
      const type = idx.type >= 0 ? String(r[idx.type] || "").trim().toLowerCase() : "cash";
      const address = idx.address >= 0 ? String(r[idx.address] || "").trim() : "";
      const network = idx.network >= 0 ? String(r[idx.network] || "").trim().toUpperCase() : "";
      const duplicate = existingKeys.has(existingAccountKey(name, office.id));
      valid.push({
        office,
        name,
        currency,
        type: type || "cash",
        balance: Number.isFinite(balance) ? balance : 0,
        address,
        network,
        duplicate,
      });
    }
    const summary = {
      total: rows.length - 1,
      newCount: valid.filter((v) => !v.duplicate).length,
      duplicates: valid.filter((v) => v.duplicate).length,
      errors: errors.length,
    };
    return { valid, errors, summary };
  };

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setParseError(null);
    setParsed(null);
    try {
      let rows;
      if (f.name.toLowerCase().endsWith(".csv")) {
        const text = await f.text();
        rows = parseCSV(text);
      } else {
        const { rows: xlsxRows } = await parseXlsxFile(f);
        rows = xlsxRows;
      }
      const result = validate(rows);
      setParsed(result);
      setStep(2);
    } catch (err) {
      setParseError(err.message || String(err));
    }
  };

  const handleApply = async () => {
    if (!parsed || submitting || !acknowledged) return;
    setSubmitting(true);
    try {
      let added = 0;
      let skipped = 0;
      for (const row of parsed.valid) {
        if (row.duplicate) {
          skipped += 1;
          continue;
        }
        const payload = {
          name: row.name,
          officeId: row.office.id,
          currency: row.currency,
          type: row.type,
          balance: row.balance,
          active: true,
        };
        if (row.address) payload.address = row.address;
        if (row.network) payload.network = row.network;
        addAccount(payload);
        added += 1;
      }
      logAudit({
        action: "create",
        entity: "account",
        entityId: "bulk-import",
        summary: `CSV import: ${added} new, ${skipped} skipped, ${parsed.summary.errors} errors (${file?.name || ""})`,
      });
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleTemplate = () => {
    // Template = export existing as base
    const rows = [];
    accounts.forEach((a) => {
      const o = offices.find((x) => x.id === a.officeId);
      rows.push({
        from: o?.name || "",
        to: a.name,
        rate: "",
      });
    });
    // Используем buildTemplateBlob — но там From/To/Rate, нам нужно другое.
    // Проще: собрать xlsx вручную. Однако build сейчас есть только через xlsx.
    // Упрощение: экспортируем CSV в новую вкладку.
    const csv = [
      "Office,Account,Currency,Type,Balance,Address,Network",
      ...accounts.map((a) => {
        const o = offices.find((x) => x.id === a.officeId);
        return [
          `"${(o?.name || "").replace(/"/g, '""')}"`,
          `"${(a.name || "").replace(/"/g, '""')}"`,
          a.currency,
          a.type || "cash",
          a.balance || 0,
          a.address || "",
          a.network || "",
        ].join(",");
      }),
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "coinplata-accounts-template.csv");
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("acc_import_title") || "Import accounts"}
      subtitle={step === 1 ? t("rimport_step_upload") : step === 2 ? t("rimport_step_review") : t("rimport_step_confirm")}
      width="2xl"
    >
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-slate-900" : "bg-slate-200"}`} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="p-5 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-[14px] border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-slate-900 bg-slate-50" : "border-slate-300 hover:border-slate-400 bg-slate-50/60"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <div className="text-[14px] font-semibold text-slate-900">
              {t("acc_import_drop") || "Drop .csv or .xlsx here, or click to browse"}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {t("acc_import_hint") || "Columns: Office, Account, Currency, Type, Balance, Address (opt), Network (opt)"}
            </div>
          </div>

          {parseError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[10px] bg-rose-50 border border-rose-200 text-[12px] text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>{parseError}</div>
            </div>
          )}

          <button
            onClick={handleTemplate}
            disabled={accounts.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] bg-white border border-slate-200 hover:border-slate-300 text-[12px] font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            {t("acc_import_template") || "Download template.csv (current accounts)"}
          </button>
        </div>
      )}

      {step === 2 && parsed && (
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap bg-slate-50 border border-slate-200 rounded-[10px] px-4 py-3">
            <Info className="w-4 h-4 text-slate-500" />
            <span className="text-[12px] font-semibold text-slate-900">{file?.name}</span>
            <div className="h-4 w-px bg-slate-300" />
            <Pill tone="emerald" label={`${parsed.summary.newCount} new`} />
            <Pill tone="slate" label={`${parsed.summary.duplicates} duplicate`} />
            {parsed.summary.errors > 0 && <Pill tone="rose" label={`${parsed.summary.errors} errors`} />}
          </div>

          {parsed.valid.length > 0 && (
            <div className="border border-slate-200 rounded-[10px] overflow-hidden">
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase">
                      <th className="px-3 py-2">Office</th>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-3 py-2">Cur</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.valid.map((v, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-3 py-2 text-slate-700">{v.office.name}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{v.name}</td>
                        <td className="px-3 py-2 text-slate-600">{v.currency}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.balance || "—"}</td>
                        <td className="px-3 py-2">
                          {v.duplicate ? (
                            <span className="text-[10px] font-bold uppercase text-slate-400">skip</span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase text-emerald-700">new</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {parsed.errors.length > 0 && (
            <details className="border border-rose-200 rounded-[10px] bg-rose-50/40">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-rose-700 hover:bg-rose-50">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
                {parsed.errors.length} errors — will be skipped
              </summary>
              <div className="max-h-[180px] overflow-auto">
                {parsed.errors.map((err, i) => (
                  <div key={i} className="px-3 py-1.5 text-[11px] border-t border-rose-100 text-slate-700">
                    <span className="text-slate-400 tabular-nums mr-2">row {err.row}</span>
                    <span className="text-rose-700 font-semibold">{err.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100">
              <ChevronLeft className="w-3 h-3" />
              {t("rimport_upload_another")}
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={parsed.summary.newCount === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("rimport_continue")}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && parsed && (
        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-[10px] px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 text-[13px] font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4" />
              {t("acc_import_about") || "You're about to create accounts"}
            </div>
            <div className="text-[12px] text-amber-800">
              <strong>{parsed.summary.newCount}</strong> new accounts,{" "}
              <strong>{parsed.summary.duplicates}</strong> skipped as duplicate,{" "}
              <strong>{parsed.summary.errors}</strong> errors.
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
              {t("acc_import_ack") || "I understand this will create new accounts with opening balances."}
            </span>
          </label>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setStep(2)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100">
              <ChevronLeft className="w-3 h-3" />
              {t("rimport_back")}
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleClose} className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!acknowledged || submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                {submitting ? t("rimport_applying") : t("acc_import_apply") || "Create accounts"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Pill({ tone, label }) {
  const styles = {
    emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
    rose: "bg-rose-100 text-rose-700 ring-rose-200",
  }[tone];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wider ring-1 ${styles}`}>
      {label}
    </span>
  );
}
