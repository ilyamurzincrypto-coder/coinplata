// src/components/ui/Avatar.jsx
//
// Аватар-инициалы со стабильным gradient'ом по hash имени. Переиспользуется
// везде где нужен глиф контрагента: DealClientChip, DealClientAutocomplete
// (через локальные helpers), Treasury → Liabilities (LiabilitiesTab tree).

import React from "react";

const GRADIENTS = [
  "from-rose-400 to-orange-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-600",
  "from-cyan-400 to-blue-600",
  "from-violet-400 to-indigo-600",
  "from-fuchsia-400 to-purple-600",
  "from-pink-400 to-rose-600",
  "from-lime-400 to-emerald-600",
];

function hashIdx(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % GRADIENTS.length;
}

function initialsOf(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || s[0].toUpperCase();
}

export default function Avatar({ name, size = 32, className = "" }) {
  const grad = GRADIENTS[hashIdx(name || "")];
  const textCls = size <= 24 ? "text-micro" : size <= 32 ? "text-tiny" : "text-body-sm";
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full bg-gradient-to-br ${grad} text-white font-bold flex items-center justify-center shrink-0 ${textCls} ${className}`.trim()}
    >
      {initialsOf(name)}
    </div>
  );
}
