// src/components/deal-form/DealClientChip.jsx
//
// Чип выбранного клиента в DealHeader (заменяет input после выбора).
// Аватар-инициалы + имя + telegram + meta (★ Реферал · N сделок · $turnover).
// ✕ — сбрасывает выбор, возвращается autocomplete input.
//
// Статистика считается из useTransactions().transactions по counterparty:
//   • dealCount — кол-во сделок с этим nickname (статус ≠ deleted)
//   • turnoverUsd — сумма amtIn в USD (через useBaseCurrency)

import React, { useMemo } from "react";
import { Star, X } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { convert } from "../../utils/convert.js";
import { useRates } from "../../store/rates.jsx";

const AVATAR_GRADIENTS = [
  "from-rose-400 to-orange-500",
  "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-600",
  "from-cyan-400 to-blue-600",
  "from-violet-400 to-indigo-600",
  "from-fuchsia-400 to-purple-600",
  "from-pink-400 to-rose-600",
  "from-lime-400 to-emerald-600",
];
function avatarGradient(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}
function initialsOf(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || s[0].toUpperCase();
}

function fmtCompact(value) {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`.replace(/\.0M$/, "M");
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`.replace(/\.0k$/, "k");
  return `${Math.round(v)}`;
}

export default function DealClientChip({ client, onClear }) {
  const { transactions } = useTransactions();
  const { base: baseCcy } = useBaseCurrency();
  const { getRate } = useRates();

  const isReferral = !!(client?.tag && /referral|реферал/i.test(client.tag));

  const stats = useMemo(() => {
    if (!client) return { count: 0, turnover: 0 };
    const nick = (client.nickname || "").toLowerCase();
    let count = 0;
    let turnover = 0;
    (transactions || []).forEach((tx) => {
      if (tx.status === "deleted") return;
      const cp = (tx.counterparty || "").toLowerCase();
      if (cp !== nick) return;
      count += 1;
      const amt = Number(tx.amtIn) || 0;
      const usd = convert(amt, tx.curIn, baseCcy, getRate);
      if (Number.isFinite(usd)) turnover += usd;
    });
    return { count, turnover };
  }, [client, transactions, baseCcy, getRate]);

  if (!client) return null;

  const grad = avatarGradient(client.nickname || client.id);

  return (
    <div className="flex-1 max-w-xl flex items-center gap-3 h-10">
      <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${grad} text-white text-[12px] font-bold flex items-center justify-center shrink-0`}>
        {initialsOf(client.nickname || client.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 truncate">
          <span className="text-body-sm font-semibold text-ink truncate">
            {client.nickname || client.name || "—"}
          </span>
          {client.telegram && (
            <span className="text-caption text-muted truncate">{client.telegram}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-tiny text-muted mt-0.5">
          {isReferral && (
            <span className="inline-flex items-center gap-0.5 text-warning font-semibold">
              <Star className="w-2.5 h-2.5 fill-current" strokeWidth={0} />
              Реферал
            </span>
          )}
          {isReferral && stats.count > 0 && <span className="text-muted-soft">·</span>}
          {stats.count > 0 && (
            <span className="font-mono tabular">
              {stats.count} {pluralizeDeal(stats.count)}
            </span>
          )}
          {stats.turnover > 0 && (
            <>
              <span className="text-muted-soft">·</span>
              <span className="font-mono tabular">${fmtCompact(stats.turnover)}</span>
            </>
          )}
          {!isReferral && stats.count === 0 && (
            <span className="text-muted-soft">новый клиент</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onClear}
        title="Сбросить выбор клиента"
        className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-soft transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

function pluralizeDeal(n) {
  const last = n % 10;
  const last2 = n % 100;
  if (last2 >= 11 && last2 <= 14) return "сделок";
  if (last === 1) return "сделка";
  if (last >= 2 && last <= 4) return "сделки";
  return "сделок";
}
