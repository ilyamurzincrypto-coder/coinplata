// src/components/accounts/AegisBadge.jsx
// Бейдж риска AEGIS (ok/warning/critical/нет данных). Переиспользуется в
// AccountsTree (через AegisInline) и в публичном share-view — один вид на всё.
import React from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Shield } from "lucide-react";
import { riskBadge } from "../../utils/accountsRisk.js";

const TONE = {
  ok: { cls: "bg-[#e7f6ec] text-[#1a7f42]", Icon: ShieldCheck },
  warning: { cls: "bg-[#fdf3d6] text-[#9a6b00]", Icon: ShieldAlert },
  critical: { cls: "bg-[#fde5e5] text-[#c0392b]", Icon: ShieldX },
  muted: { cls: "bg-[#eef0f5] text-[#6b7280]", Icon: Shield },
};

export default function AegisBadge({ account }) {
  const b = riskBadge(account);
  if (!b) return null;
  const t = TONE[b.tone] || TONE.muted;
  const reasons = (account.riskReasons || [])
    .map((r) => (typeof r === "string" ? r : r?.message))
    .filter(Boolean);
  const title = [
    `Риск: ${b.label}`,
    b.hint || "",
    ...reasons,
    account.riskUpdatedAt ? `обновлено ${new Date(account.riskUpdatedAt).toLocaleString("ru-RU")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[6px] text-[10px] font-bold shrink-0 ${t.cls}`}
    >
      <t.Icon className="w-3 h-3" strokeWidth={2.2} />
      {b.label}
    </span>
  );
}
