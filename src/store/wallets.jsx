// src/store/wallets.jsx
// Хранилище crypto-кошельков клиентов. Привязывает (address, network) к clientId
// (counterparty.id в текущей модели). Накапливает usage stats.
//
// Wallet:
//   { id, address, network, clientId,
//     firstSeenAt, lastUsedAt, usageCount }
//
// Уникальность — по (network, normalized address). Если тот же кошелёк видим
// снова у того же клиента → bump usageCount + lastUsedAt. Если видим у ДРУГОГО
// клиента → upsert возвращает status: "conflict" и НЕ пишет; вызывающий код
// решает что показать (warning в UI).

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadClientWallets } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const WalletsContext = createContext(null);

function normalizeAddress(address) {
  return (address || "").trim();
}

function walletKey(address, network) {
  return `${(network || "").toUpperCase()}::${normalizeAddress(address).toLowerCase()}`;
}

export function WalletsProvider({ children }) {
  const [wallets, setWallets] = useState([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadClientWallets()
        .then((rows) => {
          if (cancelled) return;
          if (Array.isArray(rows)) setWallets(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[wallets] load failed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const findWallet = useCallback(
    (address, network) => {
      if (!address || !network) return null;
      const k = walletKey(address, network);
      return wallets.find((w) => walletKey(w.address, w.network) === k) || null;
    },
    [wallets]
  );

  const upsertWallet = useCallback(
    ({ address, network, clientId }) => {
      if (!address || !network || !clientId) {
        return { ok: false, status: "noop", warning: "missing address / network / clientId" };
      }
      const existing = findWallet(address, network);
      const now = new Date().toISOString();

      if (!existing) {
        const w = {
          id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          address: normalizeAddress(address),
          network: network.toUpperCase(),
          clientId,
          firstSeenAt: now,
          lastUsedAt: now,
          usageCount: 1,
        };
        setWallets((prev) => [w, ...prev]);
        return { ok: true, status: "created", wallet: w };
      }

      if (existing.clientId !== clientId) {
        return {
          ok: false,
          status: "conflict",
          warning: "wallet used by another client",
          wallet: existing,
        };
      }

      const updated = {
        ...existing,
        lastUsedAt: now,
        usageCount: (existing.usageCount || 0) + 1,
      };
      setWallets((prev) => prev.map((w) => (w.id === existing.id ? updated : w)));
      return { ok: true, status: "updated", wallet: updated };
    },
    [findWallet]
  );

  const walletsByClient = useCallback(
    (clientId) => wallets.filter((w) => w.clientId === clientId),
    [wallets]
  );

  const value = useMemo(
    () => ({ wallets, upsertWallet, findWallet, walletsByClient }),
    [wallets, upsertWallet, findWallet, walletsByClient]
  );

  return <WalletsContext.Provider value={value}>{children}</WalletsContext.Provider>;
}

export function useWallets() {
  const ctx = useContext(WalletsContext);
  if (!ctx) throw new Error("useWallets must be inside WalletsProvider");
  return ctx;
}
