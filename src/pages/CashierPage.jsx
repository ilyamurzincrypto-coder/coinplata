// src/pages/CashierPage.jsx
import React, { useState } from "react";
import { Plus, ArrowUpRight, X, Minus, ArrowLeft } from "lucide-react";
import Balances from "../components/Balances.jsx";
import RatesBar from "../components/RatesBar.jsx";
import RatesPage from "./RatesPage.jsx";
import RatesSidebar from "../components/RatesSidebar.jsx";
import ExchangeForm from "../components/ExchangeForm.jsx";
import TransactionsTable from "../components/TransactionsTable.jsx";
import EditTransactionModal from "../components/EditTransactionModal.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useAudit } from "../store/audit.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useObligations } from "../store/obligations.jsx";
import { officeName } from "../store/data.js";
import { fmt } from "../utils/money.js";
import { buildMovementsFromTransaction } from "../utils/exchangeMovements.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateDeal, withToast, uuidOrNull, ensureClient } from "../lib/supabaseWrite.js";
import { supabase } from "../lib/supabase.js";
import { useRates } from "../store/rates.jsx";
import { useTranslation } from "../i18n/translations.jsx";

export default function CashierPage({
  currentOffice,
  mode = "dashboard",
  setMode = () => {},
  formMounted = false,
  setFormMounted = () => {},
  onNavigate,
}) {
  const { t } = useTranslation();
  const [balanceScope, setBalanceScope] = useState("selected");
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // mode / formMounted теперь lifted в App.jsx, чтобы переживать переход
  // на другие вкладки (Clients/Capital и т.д.). ExchangeForm сохраняет
  // ввод через sessionStorage — draft восстанавливается при возврате.

  const openCreate = () => {
    setFormMounted(true);
    setMode("create");
  };
  const minimizeCreate = () => setMode("dashboard"); // form stays mounted + draft
  const closeCreate = () => {
    setMode("dashboard");
    setFormMounted(false); // discard: form unmounts
    try {
      sessionStorage.removeItem("coinplata.exchangeDraft");
    } catch {}
  };

  // N / Esc — обрабатываются глобально в App.jsx через useKeyboardShortcuts.

  const { addTransaction, updateTransaction, counterparties } = useTransactions();
  const { addEntry: logAudit } = useAudit();
  const { accounts, addMovement, removeMovementsByRefId, balanceOf, reservedOf } = useAccounts();
  const { currentUser } = useAuth();
  const { addObligation, openWeOweByOfficeCurrency } = useObligations();
  const { getRate } = useRates();

  // Находит легы, для которых не хватает available — они станут obligations.
  // Правило: проверяется доступное по КОНКРЕТНОМУ выбранному аккаунту
  //   available = balanceOf(acc) - reservedOf(acc) - уже-зарезервированное-выше-в-этой-сделке
  // Open obligations по office+currency также учитываются (не даём повторно зарезервировать
  // то что уже обещано).
  const detectObligationLegs = (tx) => {
    const set = new Set();
    const committed = new Map(); // accountId → сколько уже зарезервировали в legs выше
    const outs = tx.outputs || [];
    outs.forEach((leg, idx) => {
      if (!leg.accountId) return; // без account сделка уже с warning, не obligation
      const acc = accounts.find((a) => a.id === leg.accountId);
      if (!acc) return;
      const balance = balanceOf(leg.accountId);
      const reserved = reservedOf(leg.accountId);
      const priorCommit = committed.get(leg.accountId) || 0;
      // Open we_owe по office+currency — уменьшает пул (деньги уже обещаны).
      const owedOnOfficeCurrency = openWeOweByOfficeCurrency(acc.officeId, leg.currency);
      const available = balance - reserved - priorCommit - owedOnOfficeCurrency;
      if (available < leg.amount) {
        set.add(idx);
      } else {
        committed.set(leg.accountId, priorCommit + leg.amount);
      }
    });
    return set;
  };

  // Возвращает { ok } — чтобы drawer закрывался только при успехе.
  const handleCreate = async (tx) => {
    if (submitting) return { ok: false };
    // DB-режим: всю логику (obligation decisions, movements, fee, profit)
    // берёт на себя RPC create_deal. Frontend только строит payload + бампает.
    if (isSupabaseConfigured) {
      setSubmitting(true);
      try {
        // Гарантируем существование клиента в clients (match-or-insert).
        // Дедупликация по nickname/telegram. Если не удалось — fallback на
        // client_nickname only (deal создастся без FK-связи, не блокируется).
        const resolvedClientId = await ensureClient(
          {
            nickname: tx.counterparty,
            telegram: tx.counterpartyTelegram,
            counterpartyId: tx.counterpartyId,
          },
          counterparties
        );

        const res = await withToast(
          () =>
            rpcCreateDeal({
              officeId: uuidOrNull(tx.officeId),
              managerId: currentUser.id,
              clientId: resolvedClientId,
              clientNickname: tx.counterparty || null,
              currencyIn: tx.curIn,
              amountIn: tx.amtIn,
              inAccountId: uuidOrNull(tx.accountId),
              inTxHash: tx.inTxHash || null,
              referral: !!tx.referral,
              comment: tx.comment || "",
              status: tx.status || "completed",
              outputs: (tx.outputs || []).map((o) => ({
                ...o,
                accountId: uuidOrNull(o.accountId),
              })),
              // Tier-1 pending fields
              plannedAt: tx.plannedAt || null,
              deferredIn: !!tx.deferredIn,
            }),
          { success: "Deal created", errorPrefix: "Create deal failed" }
        );
        if (res.ok) {
          setJustCreatedId(res.result);
          setTimeout(() => setJustCreatedId(null), 2500);
          const outStr = (tx.outputs || [])
            .map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`)
            .join(" + ");
          logAudit({
            action: "create",
            entity: "transaction",
            entityId: String(res.result),
            summary: `${fmt(tx.amtIn, tx.curIn)} ${tx.curIn} → ${outStr}`,
          });

          // Manual rate → snapshot. Если любой output имеет rate отличный
          // от текущего market rate (getRate) хотя бы на 0.5% — пишем snapshot
          // в rate_snapshots с reason "deal #X: custom rate FROM→TO applied=X
          // market=Y". PnL может ретроспективно использовать эти snapshot'ы
          // для расчёта реальной прибыли.
          try {
            const customRates = [];
            (tx.outputs || []).forEach((o) => {
              const market = getRate(tx.curIn, o.currency);
              const applied = Number(o.rate);
              if (!Number.isFinite(applied) || applied <= 0) return;
              if (!Number.isFinite(market) || market <= 0) return;
              const diff = Math.abs(applied - market) / market;
              if (diff >= 0.005) {
                customRates.push({
                  from: tx.curIn,
                  to: o.currency,
                  applied,
                  market,
                });
              }
            });
            if (customRates.length > 0) {
              // Снимок ВСЕХ текущих default-пар + override для manual
              const { data: currentPairs } = await supabase
                .from("pairs")
                .select("from_currency, to_currency, rate")
                .eq("is_default", true);
              const ratesMap = {};
              (currentPairs || []).forEach((p) => {
                ratesMap[`${p.from_currency}_${p.to_currency}`] = Number(p.rate);
              });
              // Перезаписываем manual-курсы — в snapshot хранится то что реально
              // использовалось в сделке.
              customRates.forEach((r) => {
                ratesMap[`${r.from}_${r.to}`] = r.applied;
              });
              const reasonParts = customRates.map(
                (r) => `${r.from}→${r.to}: applied=${r.applied} market=${r.market.toFixed(6)}`
              );
              await supabase.from("rate_snapshots").insert({
                created_by: currentUser.id || null,
                reason: `deal #${res.result} manual: ${reasonParts.join("; ")}`,
                rates: ratesMap,
                pairs_count: Object.keys(ratesMap).length,
              });
            }
          } catch (err) {
            // Snapshot не критичен — логируем и продолжаем
            // eslint-disable-next-line no-console
            console.warn("[manual rate snapshot] failed", err);
          }
        }
        return { ok: res.ok };
      } finally {
        setSubmitting(false);
      }
    }

    // Demo-режим (in-memory): оригинальная логика.
    // 1. Защита от дублей
    removeMovementsByRefId(tx.id);

    // 2. Ищем легы с недостатком available → obligations.
    const obligationLegs = detectObligationLegs(tx);

    // 3. Если есть obligations — сделка форсится в 'pending' (неважно что пришло).
    //    Инвариант: баланс не уходит в минус.
    const nowIso = new Date().toISOString();
    let finalTx = obligationLegs.size > 0
      ? { ...tx, status: "pending", hasObligations: true }
      : tx;

    // === Leg-level lifecycle ===
    // Для каждого OUT leg решаем: paid-out сейчас или pending.
    //   — obligation-leg     → actual=0, completedAt=null (деньги обещаны, не выданы)
    //   — crypto send        → actual=0, completedAt=null (pending_send, ждём on-chain)
    //   — deal 'checking'    → actual=0, completedAt=null (ждём crypto match)
    //   — deal 'pending' (manual) → actual=0, completedAt=null
    //   — всё остальное      → actual=planned, completedAt=now
    const outs = (finalTx.outputs || []).map((leg, idx) => {
      const isObligation = obligationLegs.has(idx);
      const isCryptoSendPending = leg.sendStatus && leg.sendStatus !== "confirmed";
      const isDealPending = finalTx.status === "pending" || finalTx.status === "checking";
      const fullyPaid = !isObligation && !isCryptoSendPending && !isDealPending;
      return {
        ...leg,
        actualAmount: fullyPaid ? leg.plannedAmount ?? leg.amount ?? 0 : 0,
        completedAt: fullyPaid ? nowIso : null,
      };
    });

    // IN side: аналогично — для checking ждём блокчейн, для manual pending ждём действий.
    const inCompleted = finalTx.status === "completed" && finalTx.accountId;
    finalTx = {
      ...finalTx,
      outputs: outs,
      inActualAmount: inCompleted ? (finalTx.amtIn || 0) : 0,
      inCompletedAt: inCompleted ? nowIso : null,
    };

    addTransaction(finalTx);
    setJustCreatedId(finalTx.id);
    setTimeout(() => setJustCreatedId(null), 2500);

    // 4. Создаём movements (OUT по obligation-легам пропускаем).
    const { movements, warnings } = buildMovementsFromTransaction(
      finalTx,
      accounts,
      currentUser.id,
      { obligationLegs }
    );
    movements.forEach(addMovement);

    // 5. Для каждой obligation-леги — создаём we_owe obligation.
    const obligationSummaries = [];
    obligationLegs.forEach((idx) => {
      const leg = (finalTx.outputs || [])[idx];
      if (!leg) return;
      const acc = accounts.find((a) => a.id === leg.accountId);
      if (!acc) return;
      addObligation({
        officeId: acc.officeId,
        dealId: finalTx.id,
        dealLegIndex: idx,
        clientId: finalTx.counterpartyId || null,
        currency: leg.currency,
        amount: leg.amount,
        direction: "we_owe",
        note: `Deal #${finalTx.id} — insufficient ${leg.currency} in ${officeName(acc.officeId)}`,
        createdBy: currentUser.id,
      });
      obligationSummaries.push(`${fmt(leg.amount, leg.currency)} ${leg.currency}`);
    });

    // 6. Audit log.
    const outStr = (finalTx.outputs || [{ currency: finalTx.curOut, amount: finalTx.amtOut }])
      .map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`)
      .join(" + ");
    const warnSuffix = warnings.length > 0 ? ` · ⚠ ${warnings.length} warn` : "";
    const oblSuffix = obligationSummaries.length
      ? ` · 🔒 ${obligationSummaries.length} obligation(s): ${obligationSummaries.join(", ")}`
      : "";
    const statusPrefix =
      finalTx.status === "pending" ? (obligationLegs.size ? "[PENDING/OBLIGATION] " : "[PENDING/RESERVED] ")
        : finalTx.status === "checking" ? "[CHECKING] " : "";
    logAudit({
      action: "create",
      entity: "transaction",
      entityId: String(finalTx.id),
      summary: `${statusPrefix}${fmt(finalTx.amtIn, finalTx.curIn)} ${finalTx.curIn} → ${outStr} · fee $${fmt(finalTx.fee)}${warnSuffix}${oblSuffix}`,
    });
    return { ok: true };
  };

  // Фокусная обёртка формы — submit возвращает { ok }; при успехе закрываем form.
  const handleFormSubmit = async (tx) => {
    const r = await handleCreate(tx);
    if (r?.ok) closeCreate();
  };

  const isDashboard = mode === "dashboard";
  const isCreate = mode === "create";
  const isRates = mode === "rates";

  const openRates = () => setMode("rates");
  const closeRates = () => setMode("dashboard");

  return (
    <main className="min-h-screen">
      {/* ====== DASHBOARD MODE ====== */}
      {/* Rendered когда mode=dashboard. Плавный fade через key remount
          внутри animate-fadeIn. */}
      {isRates && (
        <div key="rates" className="animate-[fadeIn_180ms_ease-out]">
          <RatesPage onBack={closeRates} />
        </div>
      )}

      {isDashboard && (
        <div
          key="dashboard"
          className="max-w-[1400px] mx-auto px-6 py-6 space-y-6 animate-[fadeIn_180ms_ease-out]"
        >
          <RatesBar onOpenRates={openRates} currentOffice={currentOffice} />
          <Balances
            currentOffice={currentOffice}
            scope={balanceScope}
            onScopeChange={setBalanceScope}
          />

          {/* CTA: "+ New exchange" ИЛИ "Resume exchange" если форма в memory. */}
          <section>
            {formMounted ? (
              <button
                onClick={openCreate}
                className="group w-full flex items-center justify-between gap-4 px-6 py-5 rounded-[16px] bg-white border-2 border-emerald-500 text-slate-900 shadow-[0_10px_32px_-12px_rgba(16,185,129,0.35)] hover:shadow-[0_16px_40px_-12px_rgba(16,185,129,0.45)] active:scale-[0.995] transition-all duration-200"
              >
                <div className="flex items-center gap-4">
                  <div className="relative w-11 h-11 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_4px_14px_-2px_rgba(16,185,129,0.5)]">
                    <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2.5} />
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white animate-pulse" />
                  </div>
                  <div className="text-left">
                    <div className="text-[16px] font-bold tracking-tight">
                      {t("cta_resume_exchange_title")}
                    </div>
                    <div className="text-[12px] text-slate-500">
                      {t("cta_resume_exchange_hint")}
                    </div>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-emerald-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            ) : (
              <button
                onClick={openCreate}
                className="group w-full flex items-center justify-between gap-4 px-6 py-5 rounded-[16px] bg-slate-900 text-white shadow-[0_10px_32px_-12px_rgba(15,23,42,0.5)] hover:shadow-[0_16px_40px_-12px_rgba(15,23,42,0.6)] hover:bg-slate-800 active:scale-[0.995] transition-all duration-200"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_4px_14px_-2px_rgba(16,185,129,0.5)] group-hover:bg-emerald-400 transition-colors">
                    <Plus className="w-5 h-5 text-white" strokeWidth={2.5} />
                  </div>
                  <div className="text-left">
                    <div className="text-[16px] font-bold tracking-tight">
                      {t("cta_new_exchange_title")}
                    </div>
                    <div className="text-[12px] text-slate-300">
                      {t("cta_new_exchange_hint")}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                    {t("cta_press_key")}
                    <kbd className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-200 tracking-wider">
                      N
                    </kbd>
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>
              </button>
            )}
          </section>

          <TransactionsTable
            currentOffice={currentOffice}
            justCreatedId={justCreatedId}
            onEdit={setEditingTx}
          />
        </div>
      )}

      {/* ====== CREATE MODE ====== */}
      {/* Sticky rates слева + форма справа. Balances/transactions скрыты. */}
      {/* Форма mount'нута всегда пока formMounted=true — переключение mode не
          теряет её state. В dashboard mode обёртка display:none. */}
      <div
        style={{ display: isCreate ? "block" : "none" }}
        className="max-w-[1400px] mx-auto px-6 py-6 animate-[fadeIn_180ms_ease-out]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_1fr] gap-6 items-start">
          {/* LEFT: sticky rates */}
          <aside className="lg:sticky lg:top-[88px]">
            <RatesSidebar currentOffice={currentOffice} />
          </aside>

          {/* RIGHT: header + ExchangeForm */}
          <section>
            <div className="bg-white rounded-[16px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.06)] overflow-hidden">
              <header className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white shrink-0">
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-slate-900 tracking-tight">
                      {t("cta_new_exchange_title")}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {t("drawer_minimize_hint")}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={minimizeCreate}
                    title={`${t("btn_minimize")} (Esc)`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t("btn_minimize")}</span>
                  </button>
                  <button
                    onClick={closeCreate}
                    title={t("btn_close_discard")}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{t("btn_close")}</span>
                  </button>
                </div>
              </header>

              <div className="p-5">
                {formMounted && (
                  <ExchangeForm
                    mode="create"
                    currentOffice={currentOffice}
                    onSubmit={handleFormSubmit}
                    submitting={submitting}
                  />
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <EditTransactionModal transaction={editingTx} onClose={() => setEditingTx(null)} />

      {/* Глобальные keyframes для fadeIn анимации. */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}
