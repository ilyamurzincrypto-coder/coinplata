// src/pages/CashierPage.jsx
import React, { useState } from "react";
import { Plus, ArrowUpRight, X, Minus, ArrowLeft, ArrowLeftRight } from "lucide-react";
import Balances from "../components/Balances.jsx";
import OpenObligationsWidget from "../components/cashier/widgets/OpenObligationsWidget.jsx";
import RatesBar from "../components/RatesBar.jsx";
import RatesPage from "./RatesPage.jsx";
import RatesSidebar from "../components/RatesSidebar.jsx";
import ExchangeForm from "../components/ExchangeForm.jsx";
import DealForm from "../components/cashier/DealForm.jsx";

// Форма создания сделки: жёстко используем привычную ExchangeForm.
// (Новая v2 DealForm — с боковой панелью курсов — отключена по запросу;
// env-флаг VITE_USE_NEW_DEAL_FORM сейчас игнорируется. Чтобы вернуть v2-форму,
// замените `false` на `import.meta.env.VITE_USE_NEW_DEAL_FORM === "true"`.)
// Это НЕ трогает леджер: ExchangeForm пишет сделки через адаптер в тот же
// ledger.create_deal_v2 — Казначейство/проводки работают как прежде.
const USE_NEW_DEAL_FORM = false;
import OtcDealWizard from "../components/OtcDealWizard.jsx";
import CashClosureModal from "../components/CashClosureModal.jsx";
import CashierLedgerDeals from "../components/cashier/CashierLedgerDeals.jsx";
import PendingTransfersBar from "../components/PendingTransfersBar.jsx";
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
import { rpcSetDealPayee, rpcSetDealCreatedAt, withToast, uuidOrNull, ensureClient } from "../lib/supabaseWrite.js";
import { createDeal } from "../lib/dealOperations.js";
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
  const [otcWizardOpen, setOtcWizardOpen] = useState(false);
  const [cashClosureOpen, setCashClosureOpen] = useState(false);
  // RatesSidebar expanded state — поднимаем сюда чтобы grid columns
  // dashboard mode реактивно сужались/расширялись. Compact = top-6
  // базовых пар + sidebar 260px. Expanded = все пары + sidebar 480px.
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

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

        // Признак OTC: партнёрский счёт в IN или в любой из ног.
        // Без него явно проставляем kind='regular', чтобы БД-derive не
        // ошибочно выводила 'otc' от случайно оставшегося partnerAccountId
        // в state'е формы.
        const inPartnerCleaned = uuidOrNull(tx.inPartnerAccountId);
        const cleanedOutputs = (tx.outputs || []).map((o) => ({
          ...o,
          accountId: uuidOrNull(o.accountId),
          partnerAccountId: uuidOrNull(o.partnerAccountId),
        }));
        const hasOtcMarker =
          !!inPartnerCleaned ||
          cleanedOutputs.some((o) => !!o.partnerAccountId);

        const res = await withToast(
          () =>
            createDeal({
              officeId: uuidOrNull(tx.officeId),
              // tx.managerId выставляется в ExchangeForm: для owner/admin —
              // выбранный в dropdown менеджер, для остальных — currentUser.id.
              managerId: tx.managerId || currentUser.id,
              clientId: resolvedClientId,
              clientNickname: tx.counterparty || null,
              currencyIn: tx.curIn,
              amountIn: tx.amtIn,
              inAccountId: uuidOrNull(tx.accountId),
              // OTC: IN через счёт партнёра (миграция 0078). Взаимоисключающее
              // с inAccountId; rpcCreateDeal сама валидирует.
              inPartnerAccountId: inPartnerCleaned,
              inTxHash: tx.inTxHash || null,
              referral: !!tx.referral,
              comment: tx.comment || "",
              status: tx.status || "completed",
              outputs: cleanedOutputs,
              // Явный kind: regular когда нет partner-маркеров (исключаем
              // ошибочный derive в БД из остаточного state). Если OTC —
              // не передаём, БД сама определит.
              kind: hasOtcMarker ? undefined : "regular",
              // Tier-1 pending fields
              plannedAt: tx.plannedAt || null,
              deferredIn: !!tx.deferredIn,
              // Галочка из ExchangeForm — применять ли min cap офиса (default true)
              applyMinFee: tx.applyMinFee !== false,
              // OTC брокеридж — наш заработок за сведение клиента и партнёра.
              commissionUsd: tx.commissionUsd != null ? Number(tx.commissionUsd) : 0,
              // Кастомная комиссия — переопределяет fee_usd. null = авто.
              customFeeUsd: tx.customFeeUsd != null && Number.isFinite(Number(tx.customFeeUsd))
                ? Number(tx.customFeeUsd)
                : null,
              // Multi-IN: массив [{amount, currency, kind, accountId}] —
              // SQL create_deal пишет account_movements в payment.currency
              // (миграция multi_currency_in_payments).
              inPayments: Array.isArray(tx.inPayments) && tx.inPayments.length > 0
                ? tx.inPayments.map((p) => ({
                    amount: Number(p.amount) || 0,
                    currency: p.currency || tx.curIn,
                    kind: p.kind || "ours_now",
                    accountId: uuidOrNull(p.accountId),
                    partnerAccountId: uuidOrNull(p.partnerAccountId),
                  }))
                : undefined,
            }),
          { success: "Deal created", errorPrefix: "Create deal failed" }
        );
        if (res.ok) {
          setJustCreatedId(res.result);
          setTimeout(() => setJustCreatedId(null), 2500);
          const outStr = (tx.outputs || [])
            .map((o) => `${fmt(o.amount, o.currency)} ${o.currency}`)
            .join(" + ");
          // Если задан payee (interoffice OUT) — назначаем его. RPC может
          // упасть если backend ещё не мигрирован на 0063, но это не должно
          // блокировать сделку — отдельный try/catch.
          if (tx.payeeUserId) {
            try {
              await rpcSetDealPayee({
                dealId: res.result,
                payeeUserId: tx.payeeUserId,
                payeeOfficeId: tx.payeeOfficeId,
              });
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[set_deal_payee] failed", e);
            }
          }
          // Backdate — если задано, обновляем created_at сделки и связанных
          // движений через RPC. Если migration 0070 не применена — silent fail,
          // не блокирует основное создание.
          if (tx.backdateAt) {
            // Backdate: видимый toast вместо silent fail. Без этого юзер
            // не понимал почему сделка остаётся на сегодняшней дате.
            await withToast(
              () =>
                rpcSetDealCreatedAt({
                  dealId: res.result,
                  createdAt: tx.backdateAt,
                }),
              {
                success: "Backdate applied",
                errorPrefix: "Backdate failed",
              }
            );
          }
          logAudit({
            action: "create",
            entity: "transaction",
            entityId: String(res.result),
            summary: `${fmt(tx.amtIn, tx.curIn)} ${tx.curIn} → ${outStr}${tx.payeeUserId ? " · payee assigned" : ""}`,
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
          className="max-w-[1400px] mx-auto px-6 py-6 animate-[fadeIn_180ms_ease-out]"
        >
          {/* Layout через CSS Grid named areas. Sidebar ВСЕГДА узкий
              (~220px). При expand → раскрывается ВНИЗ (больше пар, scroll
              внутри), а Transactions переезжают в правую колонку рядом
              со sidebar и сужаются (как Balances). При compact —
              Transactions внизу на ВСЮ ширину.
              Один mount TransactionsTable — фильтры/scroll сохраняются
              при переключении expand. */}
          {/* 3-row grid layout:
                Row 1 — CTA (full-width)
                Row 2 — sidebar | Balances (parallel, equal height)
                Row 3 — compact: Transactions full-width
                        expanded: Transactions сужены в col2 (sidebar
                                  продолжается в col1 на оба row 2+3)
              Sidebar в row 2 = высота Balances (стретчится). Не до
              transactions. Внутри sidebar динамически считается сколько
              пар поместится через ResizeObserver — пустоты нет. */}
          <div
            className={`grid grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,380px)_1fr] ${
              sidebarExpanded
                ? "lg:[grid-template-areas:'cta_cta'_'sidebar_bal'_'sidebar_tx']"
                : "lg:[grid-template-areas:'cta_cta'_'sidebar_bal'_'tx_tx']"
            }`}
          >
            {/* Sidebar — grid-area "sidebar". Compact: только row 2
                (рядом с Balances), height stretch до Balances height.
                Expanded: row 2+3 (sidebar занимает оба row слева). */}
            <aside
              className={`lg:[grid-area:sidebar] ${
                sidebarExpanded ? "lg:sticky lg:top-[88px] lg:self-start" : ""
              }`}
            >
              <RatesSidebar
                currentOffice={currentOffice}
                onOpenRates={openRates}
                onExpandedChange={setSidebarExpanded}
              />
            </aside>

            {/* CTA "+ New exchange" / "Resume" — большая основная кнопка
                с подзаголовком «С КЛИЕНТОМ». Справа — компактная OTC
                иконка-кнопка для сделки с партнёром. */}
            <section className="min-w-0 lg:[grid-area:cta] flex items-stretch gap-2">
              <div className="flex-1 min-w-0">
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
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600 mb-0.5">
                      С клиентом
                    </div>
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
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400 mb-0.5">
                      С клиентом
                    </div>
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
              </div>
              <button
                onClick={() => setOtcWizardOpen(true)}
                title="Открыть OTC wizard — сделка с партнёром, multi-payment, все 16 IN/OUT сценариев"
                className="group flex flex-col items-center justify-center px-4 py-3 rounded-[16px] bg-white border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400 transition-colors shrink-0"
              >
                <ArrowLeftRight className="w-5 h-5 mb-1" strokeWidth={2.5} />
                <span className="text-[11px] font-bold tracking-tight">OTC</span>
                <span className="text-[9px] text-indigo-500 font-semibold mt-0.5">с партнёром</span>
              </button>
            </section>

            {/* Balances — grid-area "bal", row 2 col2. Sidebar справа от
                него (col1) той же высоты. */}
            <div className="min-w-0 lg:[grid-area:bal] space-y-4">
              <Balances
                currentOffice={currentOffice}
                scope={balanceScope}
                onScopeChange={setBalanceScope}
              />
              <OpenObligationsWidget officeId={currentOffice} />
            </div>

            {/* Transactions — grid-area "tx". Compact: row 3 full-width.
                Expanded: row 3 col2 (рядом с продолжением sidebar).
                Список читается из v2-леджера (ledger.transactions/journal_entries),
                чтобы оператор видел только что созданные сделки. Старый
                TransactionsTable (поверх замороженной public.deals) отключён. */}
            <div className="min-w-0 lg:[grid-area:tx]">
              <PendingTransfersBar />
              <CashierLedgerDeals officeFilter={currentOffice} />
            </div>
          </div>
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
              <header className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
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
                  USE_NEW_DEAL_FORM ? (
                    // DealForm creates the deal itself (runSubmitFlow → createDeal),
                    // shows its own success toast and bumps the data version. Its
                    // onSubmit is just the "drawer is done" signal — close it. (Do NOT
                    // pass handleFormSubmit here: that re-runs createDeal from a legacy
                    // tx shape and produces a spurious error toast right after success.)
                    <DealForm
                      mode="create"
                      currentOffice={currentOffice}
                      onSubmit={() => closeCreate()}
                      submitting={submitting}
                      onCancel={() => setFormMounted(false)}
                    />
                  ) : (
                    <ExchangeForm
                      mode="create"
                      currentOffice={currentOffice}
                      onSubmit={handleFormSubmit}
                      submitting={submitting}
                    />
                  )
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <EditTransactionModal transaction={editingTx} onClose={() => setEditingTx(null)} />

      <OtcDealWizard
        open={otcWizardOpen}
        currentOffice={currentOffice}
        onClose={() => setOtcWizardOpen(false)}
        onCreated={(dealId) => {
          if (dealId) setJustCreatedId(String(dealId));
        }}
      />

      {/* CashClosureModal вынесен в Header через CashClosureBadge — здесь
          оставляем fallback-открытие из старого state для обратной совместимости. */}
      <CashClosureModal
        open={cashClosureOpen}
        currentOffice={currentOffice}
        onClose={() => setCashClosureOpen(false)}
      />


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
