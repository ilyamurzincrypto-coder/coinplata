// src/components/cashier/DealDetail.jsx
// Manager-friendly deal-detail panel — the expanded body of a Cashier deal row.
// Reads the v2 journal entries of a deal transaction (already enriched with
// accountCode/accountName by transactionTree) and presents them as a deal "slip":
//   пришло 1000 USD на Кассу USD → ушло 950 USDT на Hot-кошелёк · маржа ~50 USD
//   · контрагент Иван · проведена
// NO Дт/Кт, NO account codes — accounting lives in the Treasury "Сделки" tab.
import React from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { dealSummary } from "../../lib/treasury/dealSummary.js";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const fmtAmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Internal clearing / margin buckets — not "пришло"/"ушло" the manager cares about.
const SKIP_SUBTYPES_IN = new Set(["fx_clearing"]);
const SKIP_SUBTYPES_OUT = new Set(["fx_clearing", "unearned"]);

function Section({ label, lines }) {
  if (!lines.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">{label}</div>
      <ul className="space-y-0.5">
        {lines.map((l, i) => (
          <li key={i} className="text-[12px] text-slate-700">{l}</li>
        ))}
      </ul>
    </div>
  );
}

// node    — { tx, entries: [{ accountId, direction, amount, currency, accountName, clientId? }] }
// accById — Map<accountId, account>
// counterpartyName — fn(clientId) -> display name (from useLedger())
export default function DealDetail({ node, accById, counterpartyName }) {
  const { t } = useTranslation();
  const tx = node?.tx || {};
  const entries = node?.entries || [];
  const meta = tx.metadata || {};

  const inLines = [];
  const outLines = [];
  for (const e of entries) {
    const acc = accById?.get?.(e.accountId);
    const type = acc?.type;
    const subtype = acc?.subtype;
    const name = e.accountName || acc?.name || "?";
    const amt = `${fmtAmt(e.amount)} ${e.currency}`;
    if (e.direction === "dr") {
      // Money received: asset Dr legs; customer_liab Dr = paid from the client's balance.
      if (type === "asset" && !SKIP_SUBTYPES_IN.has(subtype)) {
        inLines.push(`${amt} · ${name}`);
      } else if (subtype === "customer_liab") {
        inLines.push(`${amt} · ${t("cashdeal_in_from_client")}`);
      }
      // skip equity / fx_clearing Dr — internal clearing, not "пришло"
    } else {
      // Money paid out: asset Cr legs; customer_liab Cr = obligation to the client.
      if (type === "asset" && !SKIP_SUBTYPES_OUT.has(subtype)) {
        outLines.push(`${amt} · ${name}`);
      } else if (subtype === "customer_liab") {
        outLines.push(`${amt} · ${t("cashdeal_out_obligation")}`);
      }
      // equity / fx_clearing / unearned / revenue Cr — internal / margin → not shown here
    }
  }

  // Margin / fee — prefer revenue Cr (via dealSummary), else fall back to `unearned` Cr.
  let marginLines = [];
  const summary = dealSummary(node, accById);
  if (summary && summary.margin.length) {
    marginLines = summary.margin.map((m) => `${fmtAmt(m.amount)} ${m.currency}`);
  } else {
    const byCcy = new Map();
    for (const e of entries) {
      const acc = accById?.get?.(e.accountId);
      if (e.direction === "cr" && acc?.subtype === "unearned") {
        byCcy.set(e.currency, (byCcy.get(e.currency) || 0) + Number(e.amount || 0));
      }
    }
    marginLines = [...byCcy.entries()].map(([ccy, amt]) => `${fmtAmt(amt)} ${ccy}`);
  }

  // Counterparty: explicit nickname in metadata wins; else first real client_id on an entry.
  let counterparty = meta.client_nickname || null;
  if (!counterparty) {
    const cid = entries.map((e) => e.clientId).find((id) => id && id !== ZERO_UUID);
    if (cid && typeof counterpartyName === "function") counterparty = counterpartyName(cid);
  }
  if (!counterparty) counterparty = "—";

  const statusKey = tx.status === "reversed" ? "cashdeal_status_reversed"
    : tx.status === "posted" ? "cashdeal_status_posted"
    : null;
  const statusLabel = statusKey ? t(statusKey) : (tx.status || "—");

  const dt = tx.effectiveDate ? new Date(tx.effectiveDate).toISOString().slice(0, 16).replace("T", " ") : null;

  return (
    <div className="px-6 py-3">
      <div className="rounded-[10px] bg-white border border-slate-200/70 p-3 space-y-2.5">
        <Section label={t("xf_in")} lines={inLines} />
        <Section label={t("xf_out")} lines={outLines} />
        {marginLines.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">{t("cashdeal_margin")}</div>
            <div className="text-[12px] text-emerald-700">~ {marginLines.join(" + ")}</div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-slate-100 text-[12px] text-slate-600">
          <span><span className="text-slate-400">{t("cashdeal_counterparty")}:</span> <span className="font-medium text-slate-700">{counterparty}</span></span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-400">{t("cashdeal_status")}:</span>
            <span className="font-medium text-slate-700">{statusLabel}</span>
            {meta.has_deferred && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10.5px] font-medium">{t("cashdeal_has_obligation")}</span>
            )}
          </span>
          {dt && <span><span className="text-slate-400">{t("cashdeal_date")}:</span> {dt}</span>}
        </div>
        {meta.comment && (
          <div className="text-[11.5px] text-slate-500 italic">«{meta.comment}»</div>
        )}
      </div>
    </div>
  );
}
