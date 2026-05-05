// src/components/PartnerSettlementForm.jsx
//
// Простой settlement-форма для сделки С ПАРТНЁРОМ — встраивается в card
// «Создать сделку» когда юзер переключил toggle на «С партнёром».
//
// Flow: партнёр → его счёт → режим (внёс / забрал) → сумма → (если
// забрал) с какой нашей кассы выдаём → submit.
//
// Записывает через rpcRecordPartnerInflow / rpcRecordPartnerOutflow —
// inflow один-сторонний (только partner_account), outflow парный
// (partner_account − amt, наша касса − amt).
//
// Для сложных multi-payment OTC сделок есть отдельный OTC wizard
// (кнопка на дашборде); сюда не дублируем.

import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Handshake,
  Wallet,
  Banknote,
  Building2,
  Coins,
} from "lucide-react";
import { usePartners } from "../store/partners.jsx";
import { usePartnerAccounts } from "../store/partnerAccounts.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useOffices } from "../store/offices.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  rpcRecordPartnerInflow,
  rpcRecordPartnerOutflow,
  withToast,
} from "../lib/supabaseWrite.js";

const TYPE_ICONS = { cash: Banknote, bank: Building2, crypto: Coins };

export default function PartnerSettlementForm({ onDone }) {
  const { activePartners } = usePartners();
  const { accountsByPartner, balanceOf: pBalanceOf } = usePartnerAccounts();
  const { accounts, balanceOf } = useAccounts();
  const { activeOffices } = useOffices();

  const [partnerId, setPartnerId] = useState("");
  const [partnerAccountId, setPartnerAccountId] = useState("");
  const [mode, setMode] = useState("inflow"); // inflow | outflow
  const [amount, setAmount] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const partner = useMemo(
    () => activePartners.find((p) => p.id === partnerId) || null,
    [activePartners, partnerId]
  );
  const partnerAccounts = useMemo(
    () => (partnerId ? accountsByPartner(partnerId).filter((a) => a.active) : []),
    [partnerId, accountsByPartner]
  );
  const partnerAccount = useMemo(
    () => partnerAccounts.find((a) => a.id === partnerAccountId) || null,
    [partnerAccounts, partnerAccountId]
  );
  const ccy = partnerAccount?.currency || null;

  // При смене партнёра — сбрасываем выбор счёта и сумму
  React.useEffect(() => {
    setPartnerAccountId("");
    setFromAccountId("");
  }, [partnerId]);

  // При смене счёта (валюты) — сбрасываем from-account, потому что
  // там валюта могла измениться
  React.useEffect(() => {
    setFromAccountId("");
  }, [partnerAccountId]);

  // Наши кассы той же валюты что у partner_account — нужны для outflow
  const eligibleAccounts = useMemo(() => {
    if (!ccy) return [];
    return accounts
      .filter((a) => a.active && a.currency === ccy)
      .map((a) => ({
        ...a,
        bal: balanceOf(a.id),
        officeName:
          activeOffices.find((o) => o.id === a.officeId)?.name || a.officeId,
      }))
      .sort((a, b) => a.officeName.localeCompare(b.officeName));
  }, [accounts, balanceOf, ccy, activeOffices]);

  const partnerBal = partnerAccount ? pBalanceOf(partnerAccount.id) : 0;

  const isInflow = mode === "inflow";
  const accent = isInflow ? "emerald" : "rose";

  const canSubmit = useMemo(() => {
    if (!partnerId || !partnerAccountId) return false;
    const amt = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) return false;
    if (!isInflow && !fromAccountId) return false;
    return true;
  }, [partnerId, partnerAccountId, amount, isInflow, fromAccountId]);

  const handleSubmit = async () => {
    if (busy || !canSubmit) return;
    if (!isSupabaseConfigured) {
      // eslint-disable-next-line no-alert
      alert("Supabase не подключён — записать нельзя в demo-режиме");
      return;
    }
    const amt = Number(String(amount).replace(",", "."));
    setBusy(true);
    try {
      const res = await withToast(
        () =>
          isInflow
            ? rpcRecordPartnerInflow({
                partnerAccountId: partnerAccount.id,
                amount: amt,
                currency: ccy,
                note,
              })
            : rpcRecordPartnerOutflow({
                partnerAccountId: partnerAccount.id,
                amount: amt,
                currency: ccy,
                fromAccountId,
                note,
              }),
        {
          success: isInflow ? "Партнёр внёс — записано" : "Партнёр забрал — записано",
          errorPrefix: "Не удалось",
        }
      );
      if (res.ok) {
        // reset form, остаёмся в карточке
        setAmount("");
        setNote("");
        setFromAccountId("");
        onDone?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-[12px] px-4 py-3 flex items-start gap-3">
        <div className="w-9 h-9 rounded-[10px] bg-indigo-100 flex items-center justify-center shrink-0">
          <Handshake className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="text-[12.5px] text-slate-600 leading-snug">
          Сделка с партнёром: внести деньги на его счёт (партнёр внёс к нам)
          или забрать с его счёта (партнёр забрал у нас, выдаём с кассы).
          Баланс на счёте партнёра автоматически отразит кто кому должен.
        </div>
      </div>

      {/* Партнёр */}
      <Field label="Партнёр">
        <select
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
        >
          <option value="">— выбери партнёра —</option>
          {activePartners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.telegram ? ` · ${p.telegram}` : ""}
            </option>
          ))}
        </select>
        {activePartners.length === 0 && (
          <p className="text-[11px] text-slate-500 mt-1">
            Партнёров пока нет. Добавить можно в Настройках → Партнёры.
          </p>
        )}
      </Field>

      {/* Счёт партнёра */}
      {partner && (
        <Field label={`Счёт партнёра (${partner.name})`}>
          {partnerAccounts.length === 0 ? (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-[8px] px-3 py-2">
              У партнёра нет активных счетов. Добавить — Настройки → Партнёры → счёт.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {partnerAccounts.map((a) => {
                const Icon = TYPE_ICONS[a.type] || Wallet;
                const bal = pBalanceOf(a.id);
                const selected = a.id === partnerAccountId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setPartnerAccountId(a.id)}
                    className={`text-left flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] border transition-all ${
                      selected
                        ? "bg-white border-emerald-400 ring-2 ring-emerald-400 shadow-[0_4px_14px_-4px_rgba(16,185,129,0.35)]"
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-slate-900 truncate">
                        {a.name}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {curSymbol(a.currency)}
                        {fmt(bal, a.currency)} {a.currency}
                        {a.networkId ? ` · ${a.networkId}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      )}

      {/* Режим */}
      {partnerAccount && (
        <Field label="Действие">
          <div className="inline-flex bg-slate-100 p-1 rounded-[12px] gap-1">
            <button
              type="button"
              onClick={() => setMode("inflow")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-all ${
                mode === "inflow"
                  ? "bg-white text-emerald-700 ring-2 ring-emerald-400 shadow-[0_4px_14px_-4px_rgba(16,185,129,0.35)]"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              Партнёр внёс
            </button>
            <button
              type="button"
              onClick={() => setMode("outflow")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-all ${
                mode === "outflow"
                  ? "bg-white text-rose-700 ring-2 ring-rose-400 shadow-[0_4px_14px_-4px_rgba(244,63,94,0.35)]"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              Партнёр забрал
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            {isInflow
              ? "Только баланс партнёра пополнится. Нашу кассу не трогаем."
              : "Парная запись: −amt с partner-счёта и −amt с выбранной нашей кассы."}
          </p>
        </Field>
      )}

      {/* Сумма */}
      {partnerAccount && (
        <Field label={`Сумма (${ccy})`}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[13px] font-bold">
              {curSymbol(ccy)}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] text-[15px] tabular-nums outline-none"
            />
          </div>
          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
            Текущий баланс счёта: {curSymbol(ccy)}{fmt(partnerBal, ccy)} {ccy}
          </div>
        </Field>
      )}

      {/* From cash account — только для outflow */}
      {partnerAccount && !isInflow && (
        <Field label={`С какой нашей кассы выдаём (${ccy})`}>
          {eligibleAccounts.length === 0 ? (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-[8px] px-3 py-2">
              Нет активных счетов в {ccy}. Создай счёт в нужной валюте сначала.
            </div>
          ) : (
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            >
              <option value="">— выбери счёт —</option>
              {eligibleAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.officeName} · {a.name} · {curSymbol(a.currency)}
                  {fmt(a.bal, a.currency)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {/* Комментарий */}
      {partnerAccount && (
        <Field label="Комментарий (опционально)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isInflow ? "Например: предоплата за USDT" : "Например: вернул долг наличкой"}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
          />
        </Field>
      )}

      {/* Submit */}
      <div className="pt-2 flex items-center justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`px-5 py-2.5 rounded-[12px] text-white text-[13.5px] font-bold transition-all ${
            isInflow
              ? "bg-emerald-600 hover:bg-emerald-700 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]"
              : "bg-rose-600 hover:bg-rose-700 shadow-[0_8px_24px_-8px_rgba(244,63,94,0.5)]"
          } disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
        >
          {busy
            ? "Записываю…"
            : isInflow
            ? "Записать пополнение"
            : "Записать выдачу"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-500 mb-1.5 tracking-[0.12em] uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}
