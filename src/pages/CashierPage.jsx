// src/pages/CashierPage.jsx
import React, { useState } from "react";
import { Plus, ArrowUpRight, X, Minus, ArrowLeft, ArrowRightLeft, HelpCircle } from "lucide-react";
import Balances from "../components/Balances.jsx";
import OpenObligationsWidget from "../components/cashier/widgets/OpenObligationsWidget.jsx";
import RatesBar from "../components/RatesBar.jsx";
import RatesEditorDrawer from "../components/rates/RatesEditorDrawer.jsx";
import RatesSidebar from "../components/RatesSidebar.jsx";
import ExchangeForm from "../components/ExchangeForm.jsx";
import DealForm from "../components/cashier/DealForm.jsx";
import NewDealForm from "../components/deal-form/NewDealForm.jsx";

// Форма создания сделки. По умолчанию — новая редизайн-форма (Phase 1+).
// Чтобы вернуть legacy ExchangeForm — выставить
// VITE_USE_NEW_DEAL_FORM_REDESIGN=false явно в Vercel ENV.
//   • new redesign (default) — src/components/deal-form/NewDealForm.jsx
//   • USE_NEW_DEAL_FORM (legacy v2 с RatesPanel sidebar) — false, юзер
//     отказался отдельно
// ledger.create_deal_v2 — единая точка записи для всех вариантов.
const USE_NEW_DEAL_FORM = false;
const USE_NEW_DEAL_FORM_REDESIGN =
  import.meta.env?.VITE_USE_NEW_DEAL_FORM_REDESIGN !== "false";
import TransferModal from "../components/accounts/TransferModal.jsx";
import CashClosureModal from "../components/CashClosureModal.jsx";
import CashierLedgerDeals from "../components/cashier/CashierLedgerDeals.jsx";
import DealsLedger from "../components/cashier/ledger/DealsLedger.jsx";
import ObligationsPanel from "../components/cashier/ledger/ObligationsPanel.jsx";
// PendingTransfersBar (legacy public.transfers, frozen) and EditTransactionModal
// (legacy edit, disabled under v2) are no longer mounted in the Cashier — v2
// transfers are immediate and have no "pending" state, and deal edit/undo is
// handled from the v2 transactions list (TransactionRow → reverse).
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
  onOfficeChange = () => {},
  mode = "dashboard",
  setMode = () => {},
  formMounted = false,
  setFormMounted = () => {},
  onNavigate,
  // demoDealSeed — пример из Справки («Попробовать в форме»): когда задан,
  // форма создания сделки открывается пред-заполненной этими значениями.
  demoDealSeed = null,
  onDemoConsumed = () => {},
  onOpenHelp = null,
}) {
  const { t } = useTranslation();
  const [balanceScope, setBalanceScope] = useState("selected");
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [cashClosureOpen, setCashClosureOpen] = useState(false);
  // RatesSidebar expanded state — поднимаем сюда чтобы grid columns
  // dashboard mode реактивно сужались/расширялись. Compact = top-6
  // базовых пар + sidebar 260px. Expanded = все пары + sidebar 480px.
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // mode / formMounted теперь lifted в App.jsx, чтобы переживать переход
  // на другие вкладки (Clients/Capital и т.д.). ExchangeForm сохраняет
  // ввод через sessionStorage — draft восстанавливается при возврате.

  const openCreate = () => {
    onDemoConsumed(); // фолбэк: «+Новый обмен» всегда открывает чистую форму
    setFormMounted(true);
    setMode("create");
  };
  const minimizeCreate = () => setMode("dashboard"); // form stays mounted + draft
  const closeCreate = () => {
    setMode("dashboard");
    setFormMounted(false); // discard: form unmounts
    onDemoConsumed();
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

  // Форма сделки и перемещение убраны — дашборд показываем всегда, кроме режима
  // правки курсов (rates). «create» больше не достижим, но на всякий случай не
  // оставляем пустой экран.
  // Дашборд рендерится всегда; редактор курсов — выезжающим drawer'ом поверх
  // правой колонки (mode==="rates"). Так strip курсов слева остаётся виден.
  const isDashboard = true;
  const isRates = mode === "rates";

  const openRates = () => setMode("rates");
  const closeRates = () => setMode("dashboard");

  return (
    <main className="min-h-screen">
      {isDashboard && (
        <div
          key="dashboard"
          className="max-w-[1680px] mx-auto px-4 py-6 animate-[fadeIn_180ms_ease-out]"
        >
          {/* Layout через CSS Grid named areas. Sidebar ВСЕГДА узкий
              (~220px). При expand → раскрывается ВНИЗ (больше пар, scroll
              внутри), а список сделок (CashierLedgerDeals) переезжает в
              правую колонку рядом со sidebar и сужается (как Balances).
              При compact — список внизу на ВСЮ ширину. */}
          {/* 3-row grid layout:
                Row 1 — CTA (full-width)
                Row 2 — sidebar | Balances (parallel, equal height)
                Row 3 — compact: Transactions full-width
                        expanded: Transactions сужены в col2 (sidebar
                                  продолжается в col1 на оба row 2+3)
              Sidebar в row 2 = высота Balances (стретчится). Не до
              transactions. Внутри sidebar динамически считается сколько
              пар поместится через ResizeObserver — пустоты нет. */}
          {/* Раскладка: слева узкий sticky-сайдбар Курсов, справа основная
              колонка (Остатки + Сделки стопкой вплотную — ОДНА grid-ячейка).
              items-start, чтобы высокий сайдбар не растягивал основную колонку. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,258px)_1fr] items-start">
            {/* Курсы — самостоятельный скролл: sticky под топбаром + max-h по
                вьюпорту + overflow-y. Иначе высокая панель курсов раздувает
                высоту страницы, и при скролле короткий список сделок уезжает
                под залипшую карточку «Остатки». Теперь высоту скролла задаёт
                только колонка сделок. */}
            <aside className="lg:sticky lg:top-[56px] lg:max-h-[calc(100vh-64px)] lg:overflow-y-auto lg:[scrollbar-width:thin]">
              <RatesSidebar
                currentOffice={currentOffice}
                onOpenRates={openRates}
                onExpandedChange={setSidebarExpanded}
              />
            </aside>

            <div className={`min-w-0 space-y-4 relative ${isRates ? "lg:min-h-[calc(100vh-92px)]" : ""}`}>
              <Balances
                currentOffice={currentOffice}
                onOfficeChange={onOfficeChange}
                scope={balanceScope}
                onScopeChange={setBalanceScope}
              />
              <DealsLedger officeId={currentOffice} />
              <ObligationsPanel officeId={currentOffice} />
              {/* Выезжающий редактор курсов — поверх этой колонки */}
              <RatesEditorDrawer open={isRates} onClose={closeRates} />
            </div>
          </div>
        </div>
      )}

      {/* CREATE MODE и форма сделки убраны. Перемещение между счетами тоже. */}

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
