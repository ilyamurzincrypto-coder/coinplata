// src/store/ledger.jsx
// Provider for the v2 ledger data consumed by the Treasury section.
// Loads chart of accounts once, balances + transactions + entries on a
// rolling 90-day window. Refreshes on onDataBump events (new deals etc.).

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import {
  loadLedgerAccounts,
  loadLedgerBalances,
  loadLedgerTransactions,
  loadJournalEntries,
} from "../lib/ledgerReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const LedgerContext = createContext(null);

export function LedgerProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  // window start for transactions/entries — default 90 days ago
  const [sinceIso, setSinceIso] = useState(
    () => new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  );

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [accs, bals, txs, jes] = await Promise.all([
        loadLedgerAccounts().catch(() => []),
        loadLedgerBalances().catch(() => []),
        loadLedgerTransactions({ sinceIso }).catch(() => []),
        loadJournalEntries({ sinceIso }).catch(() => []),
      ]);
      setAccounts(accs);
      setBalances(bals);
      setTransactions(txs);
      setEntries(jes);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[LedgerProvider] reload failed", err);
    } finally {
      setLoading(false);
    }
  }, [sinceIso]);

  useEffect(() => {
    reload();
    const unsub = onDataBump(reload);
    return unsub;
  }, [reload]);

  // Extend the window further back (for Журнал year+ / P&L year). Idempotent —
  // only refetches transactions/entries, keeps accounts/balances.
  const extendWindow = useCallback(async (newSinceIso) => {
    if (new Date(newSinceIso) >= new Date(sinceIso)) return; // already covered
    setSinceIso(newSinceIso); // triggers reload via the effect dep
  }, [sinceIso]);

  const value = useMemo(
    () => ({ accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso }),
    [accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso]
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be inside LedgerProvider");
  return ctx;
}
