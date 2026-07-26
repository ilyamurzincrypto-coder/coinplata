// src/pages/treasury_v2/parts/CashboxWizard.jsx
// Слайс 1.5.e — заведение кассы/банка/кошелька (отдельный поток, не общий ChartAccountModal).
// Инварианты (спека владельца):
//   • офис — ОБЯЗАТЕЛЬНОЕ поле (леджер-счёт несёт office_id; иначе Ностро повиснет на «Без офиса»);
//   • валютный гейт — только валюты с позицией в Капитале (subtype='position' в ledger.accounts);
//   • нет позиции → человеческий отказ + кнопка в мастер валют (акцент №2), не немой дизейбл.
import React, { useMemo, useState } from "react";
import Modal from "../../../components/ui/Modal.jsx";
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { rpcCreateLedgerAccount, withToast } from "../../../lib/supabaseWrite.js";
import CurrencyWizard from "../../../components/currencies/CurrencyWizard.jsx";

const KINDS = [
  { key: "cash", label: "Касса", subtype: "cash" },
  { key: "bank", label: "Банк", subtype: "bank" },
  { key: "crypto", label: "Кошелёк", subtype: "crypto_input" },
];

export default function CashboxWizard({ open, onClose, ctx, defaultOfficeId = null, onCreated }) {
  const { activeOffices, findOffice } = useOffices();
  // Валюты с позицией в Капитале (создаются мастером валют 1.5.c).
  const positionCurrencies = useMemo(() => {
    const set = new Set();
    for (const a of ctx?.accounts || []) {
      if (a.type === "equity" && a.subtype === "position" && a.currency) set.add(a.currency);
    }
    return [...set].sort();
  }, [ctx]);

  const [kind, setKind] = useState("cash");
  const [officeId, setOfficeId] = useState(defaultOfficeId && defaultOfficeId !== "all" ? defaultOfficeId : "");
  const [currency, setCurrency] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [curWizOpen, setCurWizOpen] = useState(false);

  const officeOptions = useMemo(() => (activeOffices || []).map((o) => ({ id: o.id, name: o.name })), [activeOffices]);
  const currencyOptions = useMemo(() => positionCurrencies.map((c) => ({ id: c, name: c })), [positionCurrencies]);
  const kindLabel = KINDS.find((k) => k.key === kind)?.label || "Счёт";
  const officeName = officeId ? (findOffice(officeId)?.name || "") : "";
  const suggested = `${officeName ? officeName + " · " : ""}${kindLabel}${currency ? " · " + currency : ""}`;
  const effectiveName = nameTouched ? name : suggested;

  const noPositions = positionCurrencies.length === 0;
  const canSubmit = !!officeId && !!currency && effectiveName.trim() && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const subtype = KINDS.find((k) => k.key === kind)?.subtype || "cash";
      const res = await withToast(
        () => rpcCreateLedgerAccount({ name: effectiveName.trim(), type: "asset", subtype, currency, officeId }),
        { success: "Счёт заведён", errorPrefix: "Не удалось завести счёт" }
      );
      if (res.ok) { onCreated?.(); onClose?.(); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Завести кассу / кошелёк" subtitle="Счёт офиса в валюте с позицией в Капитале" width="md">
      <div className="p-5 space-y-4">
        {noPositions ? (
          // Человеческий отказ (акцент №2), не немой дизейбл.
          <div className="space-y-4">
            <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Нет ни одной валюты с балансовым счётом в Капитале. Сначала добавьте валюту — тогда её можно завести на кассе/кошельке.
            </div>
            <div className="flex justify-end">
              <button onClick={() => setCurWizOpen(true)} className="px-4 py-2 rounded-button bg-accent text-white text-sm font-semibold hover:opacity-90">Добавить валюту</button>
            </div>
          </div>
        ) : (
          <>
            <div className="inline-flex rounded-button border border-border-soft p-0.5 bg-surface-sunk">
              {KINDS.map((k) => (
                <button key={k.key} onClick={() => setKind(k.key)} className={`px-4 py-1.5 rounded-[8px] text-sm font-semibold transition-colors ${kind === k.key ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{k.label}</button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-micro text-muted uppercase mb-1.5">Офис <span className="text-danger">*</span></label>
                <SearchableSelect value={officeId} onChange={(v) => setOfficeId(v || "")} options={officeOptions} placeholder="Выберите офис" />
              </div>
              <div>
                <label className="block text-micro text-muted uppercase mb-1.5">Валюта <span className="text-danger">*</span></label>
                <SearchableSelect value={currency} onChange={(v) => setCurrency(v || "")} options={currencyOptions} placeholder="Валюта с позицией" />
              </div>
            </div>

            <div>
              <label className="block text-micro text-muted uppercase mb-1.5">Название</label>
              <input
                type="text"
                value={effectiveName}
                onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
                placeholder={suggested}
                className="w-full h-10 bg-surface-sunk text-ink placeholder:text-muted-soft rounded-input px-3 text-body border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
              />
            </div>

            <p className="text-caption text-muted">
              Нужной валюты нет в списке?{" "}
              <button onClick={() => setCurWizOpen(true)} className="text-accent font-semibold hover:underline">Добавить валюту</button>
              {" "}— у неё появится балансовый счёт в Капитале, и она станет доступна здесь.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 rounded-button border border-border-soft text-sm font-medium hover:bg-surface-sunk">Отмена</button>
              <button onClick={submit} disabled={!canSubmit} className="px-4 py-2 rounded-button bg-ink text-white text-sm font-semibold hover:bg-black disabled:opacity-40">{busy ? "Завожу…" : "Завести"}</button>
            </div>
          </>
        )}
      </div>
      {curWizOpen && <CurrencyWizard open onClose={() => setCurWizOpen(false)} />}
    </Modal>
  );
}
