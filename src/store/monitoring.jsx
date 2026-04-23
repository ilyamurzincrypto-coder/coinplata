// src/store/monitoring.jsx
// Polling-сервис для автоматического подтверждения crypto-сделок.
//
// Что делает:
//   1. Каждые 15 секунд тикает по всем active crypto-accounts с isDeposit=true и address.
//   2. Для каждого зовёт blockchain-fetcher (стаб / будущий real API) по его network.
//   3. Полученные IncomingTx пытается замэтчить на открытые сделки со status=checking
//      (или pending) по (currency, amount±tolerance, tx внутри временного окна).
//   4. При матче:
//        — transaction.status → "completed", ставит confirmedAt + confirmedTxHash
//        — unreserveMovementsByRefId (снимает reserved с уже созданных движений,
//          так что balanceOf подхватывает сумму как фактическую)
//        — upsertWallet(from_address, network, clientId) — привязывает кошелёк
//          к counterparty, который выбран на сделке
//        — audit log
//   5. Обновляет lastCheckedBlock / lastCheckedAt на аккаунте.
//
// Для demo (без реального блокчейна) — fetcher'ы возвращают [], а внешний вызов
// simulateIncoming(accountId, override) триггерит тот же handleIncoming path,
// что и реальный polling.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useAccounts } from "./accounts.jsx";
import { useTransactions } from "./transactions.jsx";
import { useWallets } from "./wallets.jsx";
import { useAudit } from "./audit.jsx";
import { fetcherForNetwork } from "../utils/blockchainApi.js";
import { checkWalletRisk } from "../utils/aml.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcUpsertClientWallet } from "../lib/supabaseWrite.js";

const POLL_INTERVAL_MS = 15000;
const AMOUNT_TOLERANCE = 0.005; // ±0.5%
const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 часа

const MonitoringContext = createContext(null);

export function MonitoringProvider({ children }) {
  const { accounts, updateAccount, unreserveMovementsByRefId } = useAccounts();
  const { transactions, updateTransaction } = useTransactions();
  const { upsertWallet } = useWallets();
  const { addEntry: logAudit } = useAudit();

  // По умолчанию ВЫКЛЮЧЕНО: fetchers — стабы (см. blockchainApi.js), реального
  // мониторинга блокчейна нет. Включать когда появится реальный backend.
  // Цель выключения: не палить CPU на клиенте каждые 15 сек (triggerит re-render'ы
  // на setState lastCheckedAt) и не вводить в заблуждение, что идёт реальный poll.
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [lastPollAt, setLastPollAt] = useState(null);
  const [events, setEvents] = useState([]); // [{ at, type, summary, txId?, incoming }]

  // Чтобы коллбек interval'а не ловил stale-значения state — через ref.
  const ctxRef = useRef({});
  ctxRef.current = {
    accounts,
    transactions,
    updateAccount,
    updateTransaction,
    unreserveMovementsByRefId,
    upsertWallet,
    logAudit,
  };

  const pushEvent = useCallback((evt) => {
    setEvents((prev) => [{ at: Date.now(), ...evt }, ...prev].slice(0, 20));
  }, []);

  // Находим подходящий транзакционный матч для incoming.
  const matchIncoming = useCallback((incoming) => {
    const { transactions: txs } = ctxRef.current;
    const now = Date.now();
    const candidates = txs
      .filter((tx) => {
        if (tx.status !== "checking" && tx.status !== "pending") return false;
        if (tx.curIn !== incoming.currency) return false;
        const diff = Math.abs((tx.amtIn || 0) - (incoming.amount || 0));
        if (diff > Math.max(tx.amtIn * AMOUNT_TOLERANCE, 0.01)) return false;
        const txMs = tx.createdAtMs || 0;
        if (txMs && now - txMs > MATCH_WINDOW_MS) return false;
        return true;
      })
      .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return candidates[0] || null;
  }, []);

  const handleIncoming = useCallback(
    (account, incoming) => {
      const {
        updateTransaction,
        unreserveMovementsByRefId,
        upsertWallet,
        logAudit,
      } = ctxRef.current;

      // Currency/network берём с аккаунта, т.к. polling знает, какой аккаунт слушает.
      const enriched = {
        ...incoming,
        currency: account.currency,
        network: account.network || incoming.network,
      };

      const match = matchIncoming(enriched);

      if (!match) {
        logAudit({
          action: "detect",
          entity: "incoming_tx",
          entityId: enriched.txHash,
          summary: `Incoming ${enriched.amount} ${account.currency} @ ${account.name} — no matching deal`,
        });
        pushEvent({
          type: "unmatched",
          summary: `Incoming ${enriched.amount} ${account.currency} — unmatched`,
          incoming: enriched,
        });
        return;
      }

      // AML: оцениваем sender-адрес. Высокий риск — не блокируем, просто пишем
      // в tx. UI отобразит warning. В проде можно уйти в manual review.
      const risk = checkWalletRisk(enriched.from_address);

      // Обновляем транзакцию: IN сторона → completed, и все OUT legs
      // которые ещё не закрыты тоже помечаем completed (при матче на checking
      // фактически сделка закрывается целиком, если только нет crypto send
      // pending обязательств; те обновятся отдельно через confirm_deal_leg).
      const nowIso = new Date().toISOString();
      const updatedOuts = (match.outputs || []).map((l) => {
        if (l.completedAt) return l;
        // Не трогаем crypto OUT legs которые ещё в pending_send/sent — они
        // закрываются отдельно через confirm_deal_leg.
        if (l.sendStatus && l.sendStatus !== "confirmed") return l;
        return {
          ...l,
          actualAmount: l.plannedAmount ?? l.amount ?? 0,
          completedAt: nowIso,
        };
      });
      updateTransaction(match.id, {
        status: "completed",
        confirmedAt: nowIso,
        confirmedTxHash: enriched.txHash,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        riskFlags: risk.flags,
        inActualAmount: match.amtIn || 0,
        inCompletedAt: nowIso,
        outputs: updatedOuts,
      });
      unreserveMovementsByRefId(match.id);

      // Привязываем wallet → client, если есть clientId
      let walletResult = null;
      const clientId = match.counterpartyId || null;
      if (clientId && enriched.from_address && enriched.network) {
        if (isSupabaseConfigured) {
          rpcUpsertClientWallet({
            clientId,
            address: enriched.from_address,
            network: enriched.network,
          }).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("[monitoring] upsert_client_wallet failed", err);
          });
          walletResult = { ok: true, status: "queued" };
        } else {
          walletResult = upsertWallet({
            address: enriched.from_address,
            network: enriched.network,
            clientId,
          });
        }
      }

      logAudit({
        action: "confirm",
        entity: "transaction",
        entityId: String(match.id),
        summary: `Auto-confirmed #${match.id} via ${enriched.network} tx ${enriched.txHash.slice(0, 10)}…${
          walletResult?.status === "created"
            ? " · wallet linked"
            : walletResult?.status === "conflict"
            ? " · wallet conflict"
            : ""
        }`,
      });

      pushEvent({
        type: "matched",
        summary: `Matched to #${match.id}${match.counterparty ? ` · ${match.counterparty}` : ""}`,
        txId: match.id,
        incoming: enriched,
      });
    },
    [matchIncoming, pushEvent]
  );

  const pollOnce = useCallback(async () => {
    const { accounts: accs, updateAccount } = ctxRef.current;
    const targets = accs.filter(
      (a) =>
        a.type === "crypto" && a.active && a.isDeposit && a.address && a.network
    );
    const now = new Date().toISOString();
    for (const acc of targets) {
      const fetcher = fetcherForNetwork(acc.network);
      if (!fetcher) continue;
      try {
        const result = await fetcher(acc.address, acc.lastCheckedBlock || 0);
        (result.transactions || []).forEach((incoming) => handleIncoming(acc, incoming));
        updateAccount(acc.id, {
          lastCheckedBlock: result.lastBlock ?? acc.lastCheckedBlock ?? 0,
          lastCheckedAt: now,
        });
      } catch (err) {
        // swallow — демо. В проде здесь retry / alerting.
        // eslint-disable-next-line no-console
        console.warn(`[monitoring] fetch error for ${acc.id}`, err);
      }
    }
    setLastPollAt(now);
  }, [handleIncoming]);

  // Интервал. Гасим при unmount / pollingEnabled=false.
  useEffect(() => {
    if (!pollingEnabled) return undefined;
    // первый тик сразу, потом по таймеру
    pollOnce();
    const timer = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pollingEnabled, pollOnce]);

  // Демо-инжектор: делает вид что incoming tx появилась. Проходит ровно тот же
  // handleIncoming path, что и реальный polling.
  const simulateIncoming = useCallback(
    (accountId, override = {}) => {
      const { accounts: accs } = ctxRef.current;
      const acc = accs.find((a) => a.id === accountId);
      if (!acc || acc.type !== "crypto") return;
      const network = acc.network || "TRC20";
      const defaultAddr =
        network === "ERC20"
          ? "0xSimulatedErc20SenderAddr0000000000abcdef"
          : "TSimulatedTrc20SenderAddress000000";
      const incoming = {
        txHash:
          override.txHash ||
          (network === "ERC20"
            ? `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}`
            : Math.random().toString(16).slice(2).padEnd(64, "0")),
        from_address: override.from_address || defaultAddr,
        to_address: acc.address,
        amount: override.amount ?? 0,
        tokenSymbol: acc.currency,
        blockNumber: Date.now(),
        timestamp: new Date().toISOString(),
      };
      handleIncoming(acc, incoming);
    },
    [handleIncoming]
  );

  const value = useMemo(
    () => ({
      pollingEnabled,
      setPollingEnabled,
      pollNow: pollOnce,
      simulateIncoming,
      events,
      lastPollAt,
    }),
    [pollingEnabled, pollOnce, simulateIncoming, events, lastPollAt]
  );

  return (
    <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>
  );
}

export function useMonitoring() {
  const ctx = useContext(MonitoringContext);
  if (!ctx) throw new Error("useMonitoring must be inside MonitoringProvider");
  return ctx;
}
