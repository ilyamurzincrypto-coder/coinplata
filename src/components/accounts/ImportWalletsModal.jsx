// src/components/accounts/ImportWalletsModal.jsx
// Импорт списка кошельков из CSV (name,address,network). Офис выбирается ВРУЧНУЮ
// (из имени не выводим). Для каждой не-дублирующейся строки: создаём крипто-счёт
// тем же путём, что AddAccountModal (insertAccount → create_account_v2, с ledger-
// привязкой), затем регистрируем в AEGIS (label=name). Отчёт в конце.
import React, { useMemo, useState } from "react";
import { X, Upload, CheckCircle2, AlertTriangle, Ban } from "lucide-react";
import { useOffices } from "../../store/offices.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useToast } from "../../lib/toast.jsx";
import { insertAccount } from "../../lib/supabaseWrite.js";
import { connectMonitoring } from "../../lib/aegisMonitoring.js";
import { parseWalletsCsv, existingWalletKeys, isDuplicateRow } from "../../lib/walletsCsv.js";

const SAMPLE = "name,address,network\nW88 Mark,TMark...,trc20\nW89 Lara,0xLara...,erc20";

export default function ImportWalletsModal({ onClose }) {
  const { offices } = useOffices();
  const { accounts } = useAccounts();
  const toast = useToast();

  const [text, setText] = useState("");
  const [batchOffice, setBatchOffice] = useState("");
  const [currency, setCurrency] = useState("USDT");
  const [rowOffice, setRowOffice] = useState({}); // line → officeId override
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);

  const parsed = useMemo(() => parseWalletsCsv(text), [text]);
  const existing = useMemo(() => existingWalletKeys(accounts), [accounts]);
  const officeList = useMemo(
    () => (offices || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [offices]
  );

  const officeFor = (row) => rowOffice[row.line] || batchOffice || "";

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  };

  const doImport = async () => {
    if (importing) return;
    const toCreate = parsed.rows.filter((r) => !isDuplicateRow(r, existing));
    const missingOffice = toCreate.filter((r) => !officeFor(r));
    if (missingOffice.length) {
      toast.error(`Выбери офис для всех строк (${missingOffice.length} без офиса)`);
      return;
    }
    setImporting(true);
    const res = { created: 0, registered: 0, skipped: 0, errors: [] };
    for (const r of parsed.rows) {
      if (isDuplicateRow(r, existing)) {
        res.skipped += 1;
        continue;
      }
      try {
        const row = await insertAccount({
          name: r.name || `${r.network.toUpperCase()} ${r.address.slice(0, 6)}`,
          officeId: officeFor(r),
          currency,
          type: "crypto",
          network: r.network, // insertAccount → UPPER
          address: r.address,
          isDeposit: true,
          isWithdrawal: true,
        });
        res.created += 1;
        // Регистрация в AEGIS — best-effort (если /v1 не поднят → 503, счёт создан).
        try {
          if (row?.id) {
            await connectMonitoring(row.id);
            res.registered += 1;
          }
        } catch (e) {
          res.errors.push(`${r.name || r.address}: AEGIS ${e?.code || e?.status || e?.message || "нет"}`);
        }
      } catch (e) {
        res.errors.push(`${r.name || r.address}: ${e?.message || e}`);
      }
    }
    setImporting(false);
    setReport(res);
    toast.success(`Импорт: создано ${res.created}, зарегистрировано ${res.registered}, пропущено ${res.skipped}`);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-card border border-border-soft shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#5b6cff]" strokeWidth={2} />
            <span className="text-body font-bold text-ink">Импорт кошельков (CSV)</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-soft text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {!report && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-[12.5px] text-ink-soft">
                  Офис по умолчанию:{" "}
                  <select
                    value={batchOffice}
                    onChange={(e) => setBatchOffice(e.target.value)}
                    className="border border-border-soft rounded-[7px] px-2 py-1 text-[12.5px]"
                  >
                    <option value="">— выбери —</option>
                    {officeList.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[12.5px] text-ink-soft">
                  Валюта:{" "}
                  <input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    className="w-20 border border-border-soft rounded-[7px] px-2 py-1 text-[12.5px] font-mono"
                  />
                </label>
                <label className="text-[12.5px] text-[#5b6cff] cursor-pointer">
                  Загрузить файл
                  <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                </label>
              </div>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={SAMPLE}
                rows={5}
                className="w-full text-[12px] font-mono border border-border-soft rounded-[8px] px-2 py-1.5"
              />

              {parsed.errors.length > 0 && (
                <div className="text-[12px] text-amber-700 bg-amber-50 rounded-[8px] p-2 space-y-0.5">
                  {parsed.errors.map((e, i) => (
                    <div key={i}>стр.{e.line}: {e.message}</div>
                  ))}
                </div>
              )}

              {parsed.rows.length > 0 && (
                <div className="border border-border-soft rounded-[8px] overflow-hidden">
                  <div className="grid grid-cols-[1fr_1.4fr_70px_1fr_80px] items-center px-2 py-1.5 bg-[#fbfcfe] text-[10px] font-bold uppercase text-muted">
                    <span>Имя</span><span>Адрес</span><span>Сеть</span><span>Офис</span><span className="text-right">Статус</span>
                  </div>
                  {parsed.rows.map((r) => {
                    const dup = isDuplicateRow(r, existing);
                    return (
                      <div key={r.line} className="grid grid-cols-[1fr_1.4fr_70px_1fr_80px] items-center px-2 py-1 border-t border-[#f3f4f8] text-[11.5px]">
                        <span className="truncate">{r.name || "—"}</span>
                        <span className="font-mono text-muted truncate" title={r.address}>{r.address}</span>
                        <span className="uppercase">{r.network}</span>
                        <span>
                          {dup ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <select
                              value={officeFor(r)}
                              onChange={(e) => setRowOffice((m) => ({ ...m, [r.line]: e.target.value }))}
                              className="w-full border border-border-soft rounded-[6px] px-1 py-0.5 text-[11px]"
                            >
                              <option value="">— офис —</option>
                              {officeList.map((o) => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                          )}
                        </span>
                        <span className="text-right">
                          {dup ? (
                            <span className="inline-flex items-center gap-1 text-muted"><Ban className="w-3 h-3" /> дубль</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3 h-3" /> новый</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={importing || parsed.rows.every((r) => isDuplicateRow(r, existing))}
                  onClick={doImport}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-button bg-ink text-white text-body-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" strokeWidth={2.2} />
                  {importing ? "Импорт…" : "Импортировать"}
                </button>
              </div>
            </>
          )}

          {report && (
            <div className="space-y-2 text-[13px]">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="w-4 h-4" /> Создано счетов: <b>{report.created}</b>
              </div>
              <div className="text-ink-soft">Зарегистрировано в AEGIS: <b>{report.registered}</b></div>
              <div className="text-muted">Пропущено (дубли): <b>{report.skipped}</b></div>
              {report.errors.length > 0 && (
                <div className="text-[12px] text-amber-700 bg-amber-50 rounded-[8px] p-2 space-y-0.5">
                  <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> Замечания:</div>
                  {report.errors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onClose} className="px-3 py-2 rounded-button bg-ink text-white text-body-sm font-semibold">Готово</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
