// src/store/accounts.jsx
// Провайдер счетов + движений денег.
//
// Модель:
//   Movement {
//     id, timestamp,
//     accountId,
//     amount,              // всегда положительный
//     direction: "in" | "out",
//     currency,            // явно храним, не полагаемся на account.currency
//     source: { kind, refId?, note? },
//                          // kind: opening | topup | transfer_in | transfer_out
//                          //       | exchange_in | exchange_out    (TODO: пока не пишутся)
//                          //       | income | expense
//     createdBy,
//   }
//
//   Transfer {
//     id, timestamp,
//     fromAccountId, toAccountId,
//     fromAmount, toAmount,  // всегда положительные
//     fromCurrency, toCurrency,
//     rate?,                 // если cross-currency
//     note?, createdBy,
//   }
//
// Баланс счёта = Σ(in) − Σ(out) по его movements.
// Вычисляется через useMemo на уровне провайдера, плюс хелпер balanceOf(id).

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import { SEED_ACCOUNTS, ACCOUNT_TYPES } from "./data.js";

const AccountsContext = createContext(null);

// Seed opening movements — из поля balance каждого account
function seedOpeningMovements(accounts) {
  const now = new Date();
  return accounts
    .filter((a) => a.balance && a.balance > 0)
    .map((a, i) => ({
      id: `m_open_${a.id}`,
      // расставляем по времени чтобы сортировка была стабильной
      timestamp: new Date(now.getTime() - (accounts.length - i) * 1000 * 60).toISOString(),
      accountId: a.id,
      amount: a.balance,
      direction: "in",
      currency: a.currency,
      source: { kind: "opening", note: "Opening balance" },
      createdBy: "system",
    }));
}

export function AccountsProvider({ children }) {
  const [accounts, setAccounts] = useState(SEED_ACCOUNTS);
  const [movements, setMovements] = useState(() => seedOpeningMovements(SEED_ACCOUNTS));
  const [transfers, setTransfers] = useState([]);

  // --- CRUD accounts ---
  const addAccount = useCallback((acc) => {
    const full = { id: `a_${Date.now()}`, active: true, balance: 0, ...acc };
    setAccounts((prev) => [...prev, full]);
    // Если указан стартовый balance — добавляем opening movement
    if (full.balance && full.balance > 0) {
      setMovements((prev) => [
        ...prev,
        {
          id: `m_open_${full.id}`,
          timestamp: new Date().toISOString(),
          accountId: full.id,
          amount: full.balance,
          direction: "in",
          currency: full.currency,
          source: { kind: "opening", note: "Opening balance" },
          createdBy: "system",
        },
      ]);
    }
  }, []);

  const updateAccount = useCallback((id, patch) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const deactivateAccount = useCallback((id) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, active: false } : a)));
  }, []);

  // --- Movements API ---
  // Низкоуровневый add — для использования из других операций (topup, transfer, income/expense)
  const addMovement = useCallback((m) => {
    const full = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...m,
    };
    setMovements((prev) => [full, ...prev]);
    return full;
  }, []);

  // Удаление всех движений по refId (используется при edit transaction:
  // сначала сносим старые exchange_in/exchange_out, потом пишем новые).
  // Защита от дублей: при повторном create с тем же tx.id старые тоже снесутся.
  const removeMovementsByRefId = useCallback((refId) => {
    if (!refId) return;
    setMovements((prev) => prev.filter((m) => m.source?.refId !== String(refId)));
  }, []);

  // --- Top up (пополнение счёта) — одно движение "in" ---
  const topUp = useCallback(
    ({ accountId, amount, currency, note, createdBy }) => {
      return addMovement({
        accountId,
        amount: Math.abs(amount),
        direction: "in",
        currency,
        source: { kind: "topup", note },
        createdBy,
      });
    },
    [addMovement]
  );

  // --- Transfer (перевод между счетами) — 2 movement + transfer запись ---
  const transfer = useCallback(
    ({ fromAccountId, toAccountId, fromAmount, toAmount, fromCurrency, toCurrency, rate, note, createdBy }) => {
      if (fromAccountId === toAccountId) return null;
      const id = `tr_${Date.now()}`;
      const timestamp = new Date().toISOString();
      const record = {
        id,
        timestamp,
        fromAccountId,
        toAccountId,
        fromAmount: Math.abs(fromAmount),
        toAmount: Math.abs(toAmount),
        fromCurrency,
        toCurrency,
        rate: rate || null,
        note: note || "",
        createdBy,
      };
      setTransfers((prev) => [record, ...prev]);

      // Два движения
      const outMovement = {
        id: `m_${Date.now()}_out`,
        timestamp,
        accountId: fromAccountId,
        amount: Math.abs(fromAmount),
        direction: "out",
        currency: fromCurrency,
        source: { kind: "transfer_out", refId: id, note },
        createdBy,
      };
      const inMovement = {
        id: `m_${Date.now()}_in`,
        timestamp,
        accountId: toAccountId,
        amount: Math.abs(toAmount),
        direction: "in",
        currency: toCurrency,
        source: { kind: "transfer_in", refId: id, note },
        createdBy,
      };
      setMovements((prev) => [inMovement, outMovement, ...prev]);
      return record;
    },
    []
  );

  // --- Вычисляемый баланс по всем счетам ---
  // balanceOf = "total" = сумма COMPLETED движений (reserved=false).
  //   Reserved movements (pending) не влияют на balanceOf в обе стороны:
  //   pending IN — ещё не поступление, pending OUT — ещё не списание.
  //   Когда pending завершается (unreserveMovementsByRefId), reserved → false,
  //   и обе стороны включаются в balanceOf как обычные движения.
  //
  // available = balanceOf − reservedOf (pending OUT резервируют часть total)
  const balances = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => map.set(a.id, 0));
    movements.forEach((m) => {
      if (m.reserved) return; // pending не влияет на total
      const prev = map.get(m.accountId) || 0;
      const signed = m.direction === "in" ? m.amount : -m.amount;
      map.set(m.accountId, prev + signed);
    });
    return map;
  }, [accounts, movements]);

  const balanceOf = useCallback(
    (accountId) => balances.get(accountId) || 0,
    [balances]
  );

  // Reserved = сумма OUT-движений с флагом reserved=true (pending сделки)
  const reserved = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => map.set(a.id, 0));
    movements.forEach((m) => {
      if (!m.reserved) return;
      if (m.direction !== "out") return;
      const prev = map.get(m.accountId) || 0;
      map.set(m.accountId, prev + m.amount);
    });
    return map;
  }, [accounts, movements]);

  const reservedOf = useCallback(
    (accountId) => reserved.get(accountId) || 0,
    [reserved]
  );

  const availableOf = useCallback(
    (accountId) => (balances.get(accountId) || 0) - (reserved.get(accountId) || 0),
    [balances, reserved]
  );

  // --- Фильтрация ---
  const accountsByOffice = useCallback(
    (officeId, { currency, activeOnly = true } = {}) => {
      return accounts.filter(
        (a) =>
          a.officeId === officeId &&
          (!currency || a.currency === currency) &&
          (!activeOnly || a.active)
      );
    },
    [accounts]
  );

  const findAccount = useCallback(
    (id) => accounts.find((a) => a.id === id),
    [accounts]
  );

  // История движений по счёту (newest first)
  const movementsByAccount = useCallback(
    (accountId) => movements.filter((m) => m.accountId === accountId),
    [movements]
  );

  // Снять флаг reserved с movements по refId (когда pending → completed)
  const unreserveMovementsByRefId = useCallback((refId) => {
    if (!refId) return;
    setMovements((prev) =>
      prev.map((m) =>
        m.source?.refId === String(refId) ? { ...m, reserved: false } : m
      )
    );
  }, []);

  const value = useMemo(
    () => ({
      accounts,
      accountTypes: ACCOUNT_TYPES,
      movements,
      transfers,
      // CRUD
      addAccount,
      updateAccount,
      deactivateAccount,
      // operations
      addMovement,
      removeMovementsByRefId,
      unreserveMovementsByRefId,
      topUp,
      transfer,
      // computed
      balances,
      balanceOf,
      reservedOf,
      availableOf,
      // queries
      accountsByOffice,
      findAccount,
      movementsByAccount,
    }),
    [
      accounts,
      movements,
      transfers,
      addAccount,
      updateAccount,
      deactivateAccount,
      addMovement,
      removeMovementsByRefId,
      unreserveMovementsByRefId,
      topUp,
      transfer,
      balances,
      balanceOf,
      reservedOf,
      availableOf,
      accountsByOffice,
      findAccount,
      movementsByAccount,
    ]
  );

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts() {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error("useAccounts must be inside AccountsProvider");
  return ctx;
}
