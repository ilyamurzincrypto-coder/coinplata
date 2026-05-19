// src/components/GroupedAccountSelect.jsx
// Выбор счёта с группировкой Office → Currency → Channel → Account.
// Поиск по имени, валюте, офису, сети. Раздел Recent сверху.
// Recent-список живёт в localStorage (ключ "coinplata.recentAccounts").
//
// Используется в TransferModal. Старый AccountSelect остаётся для ExchangeForm.

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Search,
  ChevronDown,
  Building2,
  Check,
  Network as NetworkIcon,
  Clock,
} from "lucide-react";
import { useOffices } from "../store/offices.jsx";
import { useRates } from "../store/rates.jsx";
import { resolveAccountChannel, channelShortLabel } from "../utils/accountChannel.js";
import { fmt, curSymbol } from "../utils/money.js";
import { useAccounts } from "../store/accounts.jsx";

const RECENT_KEY = "coinplata.recentAccounts";
const MAX_RECENT = 5;

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecent(id) {
  if (!id) return;
  try {
    const prev = loadRecent().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export default function GroupedAccountSelect({
  accounts,              // уже отфильтрованный список (caller решает что показывать)
  value,
  onChange,
  placeholder = "Select account",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  const { offices } = useOffices();
  const { channels } = useRates();
  const { balanceOf } = useAccounts();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = accounts.find((a) => a.id === value);

  const recentIds = useMemo(() => loadRecent(), [open]);
  const recentAccounts = useMemo(
    () =>
      recentIds
        .map((id) => accounts.find((a) => a.id === id))
        .filter(Boolean)
        .slice(0, 3),
    [recentIds, accounts]
  );

  const officeById = useMemo(() => {
    const m = new Map();
    offices.forEach((o) => m.set(o.id, o));
    return m;
  }, [offices]);

  // Фильтрация по query — по name / currency / office / network.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const office = officeById.get(a.officeId);
      const channel = resolveAccountChannel(a, channels);
      const network = channel?.network || "";
      const haystack = [
        a.name,
        a.currency,
        a.type,
        network,
        office?.name,
        office?.city,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accounts, query, officeById, channels]);

  // Группируем: office → currency → channel → accounts[]
  const grouped = useMemo(() => {
    const byOffice = new Map();
    filtered.forEach((a) => {
      const office = officeById.get(a.officeId);
      if (!office) return;
      if (!byOffice.has(office.id)) {
        byOffice.set(office.id, { office, currencies: new Map() });
      }
      const curBucket = byOffice.get(office.id).currencies;
      if (!curBucket.has(a.currency)) {
        curBucket.set(a.currency, new Map());
      }
      const ch = resolveAccountChannel(a, channels);
      const chKey = ch?.id || "__unknown__";
      const chBucket = curBucket.get(a.currency);
      if (!chBucket.has(chKey)) {
        chBucket.set(chKey, { channel: ch, accounts: [] });
      }
      chBucket.get(chKey).accounts.push(a);
    });

    // Вернём массив для детерминированного порядка.
    return Array.from(byOffice.values()).map((block) => ({
      office: block.office,
      currencies: Array.from(block.currencies.entries()).map(([currency, chMap]) => ({
        currency,
        channels: Array.from(chMap.values()),
      })),
    }));
  }, [filtered, officeById, channels]);

  const pick = (acc) => {
    if (!acc) return;
    pushRecent(acc.id);
    onChange(acc.id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 bg-surface-soft border rounded-card px-3 py-2.5 text-left transition-colors ${
          open
            ? "border-accent/40 ring-2 ring-accent/20 bg-white"
            : "border-border-soft hover:border-border"
        } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {selected ? (
          <SelectedBadge account={selected} office={officeById.get(selected.officeId)} channels={channels} />
        ) : (
          <span className="text-[13px] text-muted-soft">{placeholder}</span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-soft ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-border-soft rounded-card shadow-xl shadow-soft overflow-hidden">
          <div className="px-3 py-2 border-b border-border-soft flex items-center gap-2 bg-surface-soft">
            <Search className="w-3.5 h-3.5 text-muted-soft" />
            <input
              type="text"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, currency, office, network…"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-soft"
            />
          </div>

          <div className="max-h-80 overflow-auto py-1">
            {/* Recent */}
            {!query && recentAccounts.length > 0 && (
              <div className="border-b border-border-soft mb-1">
                <div className="px-3 pt-2 pb-1 text-[9px] font-bold text-muted-soft uppercase tracking-widest flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  Recent
                </div>
                {recentAccounts.map((a) => (
                  <AccountItem
                    key={`recent_${a.id}`}
                    account={a}
                    office={officeById.get(a.officeId)}
                    channels={channels}
                    balance={balanceOf(a.id)}
                    isSelected={a.id === value}
                    onPick={pick}
                  />
                ))}
              </div>
            )}

            {grouped.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-muted-soft">
                No accounts match
              </div>
            ) : (
              grouped.map((officeBlock) => (
                <div key={officeBlock.office.id} className="mb-1">
                  <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 bg-surface-soft/60 border-y border-border-soft sticky top-0">
                    <Building2 className="w-3 h-3 text-muted-soft" />
                    <span className="text-[10px] font-bold text-ink-soft tracking-wider uppercase">
                      {officeBlock.office.name}
                    </span>
                  </div>
                  {officeBlock.currencies.map((curBlock) => (
                    <div key={`${officeBlock.office.id}_${curBlock.currency}`} className="pl-4">
                      <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold text-muted-soft uppercase tracking-widest">
                        {curBlock.currency}
                      </div>
                      {curBlock.channels.map((chBlock) => (
                        <div key={chBlock.channel?.id || "unknown"}>
                          <div className="px-3 pb-0.5 text-[10px] text-muted flex items-center gap-1">
                            {chBlock.channel?.kind === "network" ? (
                              <NetworkIcon className="w-2.5 h-2.5 text-accent" />
                            ) : (
                              <span className="text-[10px]">
                                {chBlock.channel?.kind === "cash" ? "💵" : "🏦"}
                              </span>
                            )}
                            <span className="font-semibold text-ink-soft">
                              {channelShortLabel(chBlock.channel)}
                            </span>
                          </div>
                          {chBlock.accounts.map((a) => (
                            <AccountItem
                              key={a.id}
                              account={a}
                              office={officeBlock.office}
                              channels={channels}
                              balance={balanceOf(a.id)}
                              isSelected={a.id === value}
                              onPick={pick}
                              indent
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectedBadge({ account, office, channels }) {
  const ch = resolveAccountChannel(account, channels);
  return (
    <div className="flex-1 min-w-0 flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-surface-sunk text-ink-soft tracking-wider">
        {account.currency}
      </span>
      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
        {channelShortLabel(ch)}
      </span>
      <span className="text-[13px] font-medium text-ink truncate">{account.name}</span>
      {office && (
        <span className="text-[10px] text-muted-soft truncate">· {office.name}</span>
      )}
    </div>
  );
}

function AccountItem({ account: a, office, channels, balance, isSelected, onPick, indent }) {
  const ch = resolveAccountChannel(a, channels);
  return (
    <button
      type="button"
      onClick={() => onPick(a)}
      className={`w-full text-left px-3 py-1.5 hover:bg-surface-soft flex items-center gap-2 text-[12px] ${
        indent ? "pl-6" : ""
      } ${isSelected ? "bg-surface-sunk/60" : ""}`}
    >
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-surface-sunk text-ink-soft tracking-wider">
        {a.currency}
      </span>
      <span className="flex-1 min-w-0 truncate font-medium text-ink">
        {a.name}
      </span>
      <span className="text-[10px] text-muted-soft tabular-nums">
        {curSymbol(a.currency)}
        {fmt(balance, a.currency)}
      </span>
      {office && <span className="text-[9px] text-muted-soft truncate max-w-[80px]">{office.name}</span>}
      {ch?.network && (
        <span className="text-[9px] font-bold text-accent bg-accent-bg px-1 py-0.5 rounded">
          {ch.network}
        </span>
      )}
      {isSelected && <Check className="w-3 h-3 text-success" />}
    </button>
  );
}
