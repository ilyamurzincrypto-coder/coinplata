// src/pages/treasury_v2/parts/ChartAccountModal.jsx
// «Добавить счёт в план» — создаёт чистый счёт плана счетов (ledger.accounts)
// через RPC create_ledger_account. Код генерируется автоматически в диапазоне
// класса (asset 19xx / liability 29xx / equity 39xx / revenue 49xx / expense 59xx).
// Свежий счёт нулевой — баланс-нейтрален, не ломает Σ Дт = Σ Кт.
import React, { useEffect, useMemo, useState } from "react";
import Modal from "../../../components/ui/Modal.jsx";
import SearchableSelect from "../../../components/ui/SearchableSelect.jsx";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCurrencies } from "../../../store/currencies.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { SUBTYPE_LABEL_KEYS } from "../../../lib/treasury/v2selectors.js";
import { rpcCreateLedgerAccount, withToast } from "../../../lib/supabaseWrite.js";

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const TYPE_LABEL_KEYS = {
  asset: "trv2_acctype_asset",
  liability: "trv2_acctype_liability",
  equity: "trv2_acctype_equity",
  revenue: "trv2_acctype_revenue",
  expense: "trv2_acctype_expense",
};
// Подтипы, имеющие смысл для каждого класса (для дропдауна). Список — из SUBTYPE_LABEL_KEYS.
const SUBTYPES_BY_TYPE = {
  asset: ["cash", "bank", "crypto_input", "crypto_output", "inter_office", "clearing", "fx_clearing"],
  liability: ["customer_liab", "partner_liab", "unearned", "clearing"],
  equity: ["opening_balance", "retained_earnings", "owner_contribution", "fx_gain", "fx_loss"],
  revenue: ["spread", "commission", "fx_gain"],
  expense: ["exchange_fee", "network_fee", "commission", "fx_loss"],
};
const DEFAULT_SUBTYPE = {
  asset: "cash",
  liability: "customer_liab",
  equity: "opening_balance",
  revenue: "spread",
  expense: "exchange_fee",
};
const NO_OFFICE = "__none__";

export default function ChartAccountModal({ open, onClose, defaultOfficeId = null }) {
  const { t } = useTranslation();
  const { codes } = useCurrencies();
  const { activeOffices, findOffice } = useOffices();

  const [type, setType] = useState("asset");
  const [subtype, setSubtype] = useState(DEFAULT_SUBTYPE.asset);
  const [currency, setCurrency] = useState(codes[0] || "USD");
  const [officeId, setOfficeId] = useState(defaultOfficeId || NO_OFFICE);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset на открытии.
  useEffect(() => {
    if (!open) return;
    setType("asset");
    setSubtype(DEFAULT_SUBTYPE.asset);
    setCurrency(codes[0] || "USD");
    setOfficeId(defaultOfficeId || NO_OFFICE);
    setNameTouched(false);
    setBusy(false);
  }, [open, defaultOfficeId, codes]);

  const subtypeOptions = useMemo(
    () => (SUBTYPES_BY_TYPE[type] || Object.keys(SUBTYPE_LABEL_KEYS)).map((k) => ({ id: k, name: t(SUBTYPE_LABEL_KEYS[k] || "trv2_subtype_other") })),
    [type, t]
  );
  const currencyOptions = useMemo(() => (codes || []).map((c) => ({ id: c, name: c })), [codes]);
  const officeOptions = useMemo(
    () => [{ id: NO_OFFICE, name: t("trv2_assets_no_office") }, ...(activeOffices || []).map((o) => ({ id: o.id, name: o.name }))],
    [activeOffices, t]
  );

  const officeName = officeId && officeId !== NO_OFFICE ? (findOffice(officeId)?.name || "") : "";
  const subtypeLabel = t(SUBTYPE_LABEL_KEYS[subtype] || "trv2_subtype_other");
  const suggestedName = `${officeName ? officeName + " · " : ""}${subtypeLabel} · ${currency}`;
  const effectiveName = nameTouched ? name : suggestedName;

  // Когда меняется тип — подтянуть дефолтный подтип, если текущий не валиден для типа.
  useEffect(() => {
    if (!open) return;
    const valid = SUBTYPES_BY_TYPE[type] || [];
    if (!valid.includes(subtype)) setSubtype(DEFAULT_SUBTYPE[type] || valid[0] || subtype);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Для non-asset типов дефолт — «без офиса»; для asset — defaultOfficeId либо без офиса.
  useEffect(() => {
    if (!open) return;
    if (type !== "asset") setOfficeId(NO_OFFICE);
    else setOfficeId(defaultOfficeId || NO_OFFICE);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = effectiveName.trim().length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await withToast(
        () =>
          rpcCreateLedgerAccount({
            name: effectiveName.trim(),
            type,
            subtype,
            currency,
            officeId: officeId === NO_OFFICE ? null : officeId,
          }),
        { success: t("trv2_chart_add_done"), errorPrefix: t("trv2_chart_add_btn") }
      );
      if (res.ok) onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("trv2_chart_add_title")} width="md">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t("trv2_chart_type")}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold outline-none"
            >
              {TYPES.map((tp) => (
                <option key={tp} value={tp}>{t(TYPE_LABEL_KEYS[tp])}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t("trv2_chart_subtype")}</label>
            <SearchableSelect value={subtype} onChange={(v) => setSubtype(v || subtype)} options={subtypeOptions} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t("trv2_chart_currency")}</label>
            <SearchableSelect value={currency} onChange={(v) => setCurrency(v || currency)} options={currencyOptions} />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t("trv2_chart_office")}</label>
            <SearchableSelect value={officeId} onChange={(v) => setOfficeId(v || NO_OFFICE)} options={officeOptions} />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t("trv2_chart_name")}</label>
          <input
            type="text"
            value={effectiveName}
            onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
            placeholder={suggestedName}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
          <p className="text-[10.5px] text-slate-500 mt-1">
            {t("trv2_chart_add_hint")}
          </p>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? t("trv2_chart_add_btn") + "…" : t("save")}
        </button>
      </div>
    </Modal>
  );
}
