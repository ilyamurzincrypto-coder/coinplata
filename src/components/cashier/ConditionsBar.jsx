// src/components/cashier/ConditionsBar.jsx
// 3 группы chips + on-demand panel. Управляет state.conditions через
// setCondition(field, value).
//
// Group 1 — Расчёт (single-select): pro_rata | single_leg | manual(disabled)
// Group 2 — Тип    (multi-select):  referral, vip, partner, otc
// Group 3 — Комиссии (multi-select): network_fee_exchange, network_fee_client,
//                                    bank_fee, no_commission

import React, { useCallback, useState } from "react";
import ChipPill from "./ChipPill.jsx";
import OnDemandPanel from "./OnDemandPanel.jsx";
import Modal from "../ui/Modal.jsx";
import { useTranslation } from "../../i18n/translations.jsx";

const MARGIN_OPTIONS = [
  { value: "pro_rata", label: "conditions_chip_pro_rata" },
  { value: "single_leg", label: "conditions_chip_single_leg" },
  { value: "manual", label: "conditions_chip_manual", disabled: true,
    titleKey: "conditions_chip_manual_tooltip" },
];

const FLAG_OPTIONS = [
  { value: "referral", label: "conditions_chip_referral" },
  { value: "vip", label: "conditions_chip_vip" },
  { value: "partner", label: "conditions_chip_partner" },
  { value: "otc", label: "conditions_chip_otc" },
];

const FEE_OPTIONS = [
  { value: "network_fee_exchange", label: "conditions_chip_network_fee_exchange" },
  { value: "network_fee_client", label: "conditions_chip_network_fee_client" },
  { value: "bank_fee", label: "conditions_chip_bank_fee", disabled: true,
    titleKey: "conditions_chip_manual_tooltip" }, // Q3 placeholder same tooltip
  { value: "no_commission", label: "conditions_chip_no_commission" },
];

export default function ConditionsBar({
  conditions,
  setCondition,
  legs = [],
}) {
  const { t } = useTranslation();
  const [pendingNoCommission, setPendingNoCommission] = useState(false);

  const flags = conditions.flags || [];
  const fees = conditions.fees || [];

  const toggleFlag = useCallback(
    (value) => {
      const next = flags.includes(value)
        ? flags.filter((v) => v !== value)
        : [...flags, value];
      setCondition("flags", next);
    },
    [flags, setCondition]
  );

  const toggleFee = useCallback(
    (value) => {
      const willBeActive = !fees.includes(value);
      // no_commission → требует confirmation при включении
      if (value === "no_commission" && willBeActive) {
        setPendingNoCommission(true);
        return;
      }
      // network_fee_exchange ↔ network_fee_client — взаимоисключающие
      let next;
      if (value === "network_fee_exchange" || value === "network_fee_client") {
        const other =
          value === "network_fee_exchange"
            ? "network_fee_client"
            : "network_fee_exchange";
        next = willBeActive
          ? [...fees.filter((f) => f !== other), value]
          : fees.filter((f) => f !== value);
      } else {
        next = willBeActive
          ? [...fees, value]
          : fees.filter((f) => f !== value);
      }
      setCondition("fees", next);
    },
    [fees, setCondition]
  );

  const confirmNoCommission = () => {
    setCondition("fees", [...fees, "no_commission"]);
    setPendingNoCommission(false);
  };

  const setOnDemand = useCallback(
    (key, value) => setCondition(`on_demand.${key}`, value),
    [setCondition]
  );

  return (
    <div className="border-t border-slate-200 px-3 py-2.5 bg-slate-50/30 space-y-1.5">
      {/* Group 1: Расчёт */}
      <Row label={t("conditions_label_calculation")}>
        {MARGIN_OPTIONS.map((opt) => (
          <ChipPill
            key={opt.value}
            active={conditions.margin_strategy === opt.value}
            disabled={opt.disabled}
            onClick={() => setCondition("margin_strategy", opt.value)}
            title={opt.titleKey ? t(opt.titleKey) : undefined}
          >
            {t(opt.label)}
          </ChipPill>
        ))}
      </Row>

      {/* Group 2: Тип (multi) */}
      <Row label={t("conditions_label_type")}>
        {FLAG_OPTIONS.map((opt) => (
          <ChipPill
            key={opt.value}
            active={flags.includes(opt.value)}
            onClick={() => toggleFlag(opt.value)}
          >
            {t(opt.label)}
          </ChipPill>
        ))}
      </Row>

      {/* Group 3: Комиссии (multi) */}
      <Row label={t("conditions_label_fees")}>
        {FEE_OPTIONS.map((opt) => (
          <ChipPill
            key={opt.value}
            active={fees.includes(opt.value)}
            disabled={opt.disabled}
            onClick={() => toggleFee(opt.value)}
            title={opt.titleKey ? t(opt.titleKey) : undefined}
          >
            {t(opt.label)}
          </ChipPill>
        ))}
      </Row>

      {/* On-demand */}
      <div className="pt-1">
        <OnDemandPanel
          onDemand={conditions.on_demand || {}}
          setOnDemand={setOnDemand}
          legs={legs}
        />
      </div>

      {/* Confirm modal — Без комиссии */}
      {pendingNoCommission && (
        <Modal
          open
          onClose={() => setPendingNoCommission(false)}
          title={t("conditions_no_commission_confirm_title")}
          width="sm"
        >
          <div className="px-5 py-4 space-y-4">
            <p className="text-[13px] text-slate-700">
              {t("conditions_no_commission_confirm_body")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingNoCommission(false)}
                className="px-3 py-1.5 rounded-[var(--radius-cell)] bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-semibold"
              >
                {t("conditions_cancel")}
              </button>
              <button
                type="button"
                onClick={confirmNoCommission}
                className="px-3 py-1.5 rounded-[var(--radius-cell)] bg-rose-600 hover:bg-rose-700 text-white text-[12px] font-bold uppercase tracking-wider"
              >
                {t("conditions_confirm")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-400 uppercase tracking-wider w-20 shrink-0">
        {label}:
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
