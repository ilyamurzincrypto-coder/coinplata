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
  loadCounterpartyNames,
} from "../lib/ledgerReaders.js";
import { loadClients, loadPartners } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const LedgerContext = createContext(null);

export function LedgerProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [cpData, setCpData] = useState(() => ({ map: new Map(), clients: [], partners: [] }));
  // Полные записи clients/partners — нужны для group-by-counterparty selectors
  // (имя, telegram, tag, referrer_id). cpData.map хранит только id→name.
  const [clientsFull, setClientsFull] = useState([]);
  const [partnersFull, setPartnersFull] = useState([]);
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
      const [accs, bals, txs, jes, names, cls, prts] = await Promise.all([
        loadLedgerAccounts().catch(() => []),
        loadLedgerBalances().catch(() => []),
        loadLedgerTransactions({ sinceIso }).catch(() => []),
        loadJournalEntries({ sinceIso }).catch(() => []),
        loadCounterpartyNames().catch(() => ({ map: new Map(), clients: [], partners: [] })),
        loadClients().catch(() => []),
        loadPartners().catch(() => []),
      ]);
      setAccounts(accs);
      setBalances(bals);
      setTransactions(txs);
      setEntries(jes);
      setCpData(names);
      setClientsFull(cls.filter((c) => !c.archivedAt));
      setPartnersFull(prts.filter((p) => p.active !== false));
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

  const counterpartyName = useCallback(
    (id) => cpData.map.get(id) || (id ? String(id).slice(0, 8) : "—"),
    [cpData]
  );
  const counterpartyOptions = useCallback(
    (kind) => (kind === "partner" ? cpData.partners : cpData.clients),
    [cpData]
  );

  // Map'ы для quick lookup в selector'ах (liabilitiesByCounterparty и т.д.).
  const clientById = useMemo(
    () => new Map(clientsFull.map((c) => [c.id, c])),
    [clientsFull]
  );
  const partnerById = useMemo(
    () => new Map(partnersFull.map((p) => [p.id, p])),
    [partnersFull]
  );

  const value = useMemo(
    () => ({
      accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso,
      counterpartyName, counterpartyOptions,
      clients: clientsFull, partners: partnersFull, clientById, partnerById,
    }),
    [
      accounts, balances, transactions, entries, loading, reload, extendWindow, sinceIso,
      counterpartyName, counterpartyOptions,
      clientsFull, partnersFull, clientById, partnerById,
    ]
  );

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error("useLedger must be inside LedgerProvider");
  return ctx;
}
