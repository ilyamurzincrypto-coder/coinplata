// src/utils/aml.js
// Базовый AML/риск-скоринг кошельков. Стаб — в проде интегрируется с внешним
// сервисом (Chainalysis / TRM Labs / Elliptic / etc.).
//
// Сейчас: детерминированный score по эвристикам адреса. Нужен чтобы UI можно
// было прокликать и видеть разные уровни риска в seed-данных.
//
// API:
//   checkWalletRisk(address) → { riskScore: 0-100, riskLevel: "low"|"medium"|"high", flags: string[] }

const KNOWN_BAD_PREFIXES = [
  "0xBAD",
  "0xHACK",
  "TRISK",
];

const KNOWN_GOOD_PREFIXES = [
  "TMark",
  "0xBinance",
];

function hashInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function checkWalletRisk(address) {
  const a = (address || "").trim();
  if (!a) return { riskScore: 0, riskLevel: "low", flags: [] };

  const flags = [];
  let score = 0;

  // Known lists
  if (KNOWN_BAD_PREFIXES.some((p) => a.toUpperCase().startsWith(p.toUpperCase()))) {
    score = 90;
    flags.push("known_bad_list");
  } else if (KNOWN_GOOD_PREFIXES.some((p) => a.toLowerCase().startsWith(p.toLowerCase()))) {
    score = 5;
    flags.push("whitelisted");
  } else {
    // Детерминированный score по хешу адреса. Демо-распределение:
    // большинство 0-30, 15% medium (30-60), 5% high (60-100).
    const bucket = hashInt(a) % 100;
    if (bucket < 80) {
      score = bucket % 30;
    } else if (bucket < 95) {
      score = 30 + (bucket % 30);
      flags.push("mixer_exposure_heuristic");
    } else {
      score = 60 + (bucket % 40);
      flags.push("high_risk_cluster");
    }
  }

  // Структурные эвристики.
  if (a.length > 50) flags.push("unusually_long_address");

  const riskLevel = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { riskScore: score, riskLevel, flags };
}

export function riskLevelStyle(level) {
  switch (level) {
    case "high":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "medium":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "low":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    default:
      return "bg-slate-100 text-slate-500 ring-slate-200";
  }
}

export function riskLevelLabel(level) {
  if (level === "high") return "High risk";
  if (level === "medium") return "Medium risk";
  if (level === "low") return "Low risk";
  return "—";
}
