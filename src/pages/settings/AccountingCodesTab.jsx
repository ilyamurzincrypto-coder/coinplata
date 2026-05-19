// src/pages/settings/AccountingCodesTab.jsx
//
// План счетов — назначение бухгалтерских кодов (вида «2008», «386») трём
// типам сущностей: accounts, clients, partner_accounts. Inline-редактор
// прямо в таблице: ввёл код → на blur сохраняется через rpc.
//
// В DealDetailPanel проводки префиксят код перед именем («2008 Касса
// Mark Antalya»), если код задан.

import React, { useMemo, useState } from "react";
import { Search, Building2, Users, Handshake } from "lucide-react";
import { useAccounts } from "../../store/accounts.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { usePartnerAccounts } from "../../store/partnerAccounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { updateAccountingCode, withToast } from "../../lib/supabaseWrite.js";

const SCOPES = [
  { id: "accounts", label: "Наши счета", icon: Building2 },
  { id: "clients", label: "Клиенты", icon: Users },
  { id: "partner_accounts", label: "Счета партнёров", icon: Handshake },
];

export default function AccountingCodesTab() {
  const { accounts } = useAccounts();
  const { counterparties } = useTransactions();
  const { partnerAccounts } = usePartnerAccounts();
  const { offices } = useOffices();
  const officeName = useMemo(
    () => Object.fromEntries((offices || []).map((o) => [o.id, o.name])),
    [offices]
  );

  const [scope, setScope] = useState("accounts");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list;
    if (scope === "accounts") {
      list = (accounts || [])
        .filter((a) => a.active)
        .map((a) => ({
          entityType: "account",
          id: a.id,
          name: a.name,
          subtitle: `${a.currency} · ${officeName[a.officeId] || a.officeId}`,
          accountingCode: a.accountingCode || "",
        }));
    } else if (scope === "clients") {
      list = (counterparties || []).map((c) => ({
        entityType: "client",
        id: c.id,
        name: c.name || c.nickname,
        subtitle: c.telegram ? `${c.nickname} · ${c.telegram}` : c.nickname,
        accountingCode: c.accountingCode || "",
      }));
    } else {
      list = (partnerAccounts || []).map((p) => ({
        entityType: "partner_account",
        id: p.id,
        name: `${p.partnerName || "Партнёр"} · ${p.name}`,
        subtitle: `${p.currency}${p.type ? " · " + p.type : ""}`,
        accountingCode: p.ledgerAccountCode || "",
      }));
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.subtitle.toLowerCase().includes(q) ||
          (r.accountingCode || "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => (a.accountingCode || "zzz").localeCompare(b.accountingCode || "zzz"));
    return list;
  }, [scope, accounts, counterparties, partnerAccounts, officeName, query]);

  return (
    <div>
      <div className="px-5 py-4 border-b border-border-soft">
        <h2 className="text-[16px] font-semibold tracking-tight">План счетов</h2>
        <p className="text-[12px] text-muted mt-0.5">
          Бухгалтерские коды (например 2008, 386). Префиксят имя в проводках
          Дт/Кт. Поле опциональное — пусто = код не показывается.
        </p>
      </div>

      <div className="px-5 py-3 border-b border-border-soft flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-surface-sunk p-0.5 rounded-card gap-0.5">
          {SCOPES.map((s) => {
            const Icon = s.icon;
            const isActive = scope === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-button text-[12px] font-semibold transition-colors ${
                  isActive ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"
                }`}
              >
                <Icon className="w-3 h-3" />
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto relative w-[220px]">
          <Search className="w-3 h-3 text-muted-soft absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по имени или коду"
            className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-surface-soft border border-border-soft rounded-button outline-none focus:bg-white focus:border-border"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-soft border-b border-border-soft text-[10px] font-bold text-muted tracking-wider uppercase">
            <tr>
              <th className="px-5 py-2 text-left w-32">Код</th>
              <th className="px-3 py-2 text-left">Название</th>
              <th className="px-5 py-2 text-left">Описание</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-12 text-center text-[13px] text-muted-soft">
                  Нет записей
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <CodeRow key={`${r.entityType}_${r.id}`} row={r} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeRow({ row }) {
  const [value, setValue] = useState(row.accountingCode || "");
  const [busy, setBusy] = useState(false);
  const initial = row.accountingCode || "";

  React.useEffect(() => {
    setValue(row.accountingCode || "");
  }, [row.accountingCode]);

  const commit = async () => {
    const next = value.trim();
    if (next === initial.trim()) return;
    if (busy) return;
    setBusy(true);
    try {
      await withToast(
        () => updateAccountingCode(row.entityType, row.id, next || null),
        { success: next ? `Код сохранён: ${next}` : "Код удалён", errorPrefix: "Не сохранилось" }
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border-soft hover:bg-surface-soft">
      <td className="px-5 py-2">
        <input
          type="text"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          placeholder="—"
          className="w-24 bg-surface-soft border border-border-soft focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 rounded-button px-2 py-1 text-[12.5px] tabular-nums font-semibold outline-none transition-colors"
        />
      </td>
      <td className="px-3 py-2 text-ink font-semibold">{row.name}</td>
      <td className="px-5 py-2 text-muted">{row.subtitle}</td>
    </tr>
  );
}
