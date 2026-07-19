// src/pages/ShareAccountsView.jsx
// Публичный read-only просмотр раздела «Счета» по share-токену. Монтируется
// ВНЕ провайдеров/авторизации (см. App.jsx роутинг /share/accounts/<token>).
// Данные — живой снапшот из /api/share/accounts?token=… ; сборка дерева и base-
// конверсия переиспользуют тот же движок (buildShareTree). Никаких мутаций:
// у страницы нет ни одной кнопки действия, а бэкенд отдаёт только GET.
import React, { useEffect, useState } from "react";
import { Building2, Eye, Lock } from "lucide-react";
import { buildShareTree, SCOPE_LABEL } from "../lib/shareAccounts.js";
import { ccyMeta, fmtRu } from "../components/balances/currencyMeta.js";
import { curSymbol, fmt } from "../utils/money.js";

function CcyChip({ ccy }) {
  const m = ccyMeta(ccy);
  return (
    <span
      className="inline-grid place-items-center w-[22px] h-[22px] rounded-[7px] text-[11px] font-bold shrink-0"
      style={{ background: m.bg, color: m.fg }}
    >
      {curSymbol(ccy)}
    </span>
  );
}

const native = (amt, ccy) => `${curSymbol(ccy)}${fmtRu(amt, ccyMeta(ccy).dp ?? 2)}`;

export default function ShareAccountsView({ token }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/share/accounts?token=${encodeURIComponent(token)}`);
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          setState({ loading: false, error: body?.error || `Ошибка ${r.status}`, data: null });
          return;
        }
        setState({ loading: false, error: null, data: body });
      } catch (e) {
        if (alive) setState({ loading: false, error: String(e?.message || e), data: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (state.loading) {
    return <Centered><span className="text-muted text-sm">Загрузка…</span></Centered>;
  }
  if (state.error) {
    return (
      <Centered>
        <div className="text-center max-w-sm">
          <Lock className="w-8 h-8 text-muted mx-auto mb-3" strokeWidth={1.6} />
          <div className="text-[15px] font-bold text-ink mb-1">Ссылка недоступна</div>
          <div className="text-[13px] text-muted">{state.error === "link not found or revoked"
            ? "Ссылка отозвана или не существует."
            : state.error}</div>
        </div>
      </Centered>
    );
  }

  const { tree, grandBase, base, scope } = buildShareTree(state.data);
  const fmtBase = (v) => `${curSymbol(base)}${fmt(v, base)}`;
  const genAt = state.data?.generatedAt ? new Date(state.data.generatedAt) : null;

  return (
    <div className="min-h-screen bg-[#f4f5f9] py-6 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Шапка */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-[18px] font-extrabold text-ink truncate">Счета</h1>
            <span className="inline-flex items-center h-6 px-2 rounded-[7px] bg-[#eef0ff] text-[#5b6cff] text-[11.5px] font-bold">
              {SCOPE_LABEL[scope] || scope}
            </span>
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-[7px] bg-[#f0f1f5] text-muted text-[11px] font-semibold">
              <Eye className="w-3 h-3" strokeWidth={2} /> только просмотр
            </span>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted uppercase tracking-wide font-bold">Итого</div>
            <div className="text-[17px] font-extrabold text-ink font-mono">{fmtBase(grandBase)}</div>
          </div>
        </div>

        {/* Дерево (всё развёрнуто, без действий) */}
        <div className="bg-surface border border-[#e7e9f1] rounded-[16px] overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_120px] items-center px-4 py-2.5 border-b border-[#e7e9f1] bg-[#fbfcfe] text-[10px] font-bold uppercase tracking-wide text-muted">
            <span>Касса / валюта</span>
            <span className="text-right">Остаток</span>
            <span className="text-right">≈ итого</span>
          </div>

          {tree.map((ob) => (
            <div key={ob.office.id} className="border-b border-[#eef0f4] last:border-0">
              <div className="grid grid-cols-[1fr_140px_120px] items-center px-4 py-2.5 bg-[#fbfcfe]">
                <span className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-[#5b6cff] shrink-0" strokeWidth={2} />
                  <span className="text-[13.5px] font-bold text-ink truncate">{ob.office.name}</span>
                  <span className="text-[11px] text-muted">· {ob.accsCount}</span>
                </span>
                <span className="text-right" />
                <span className="text-right text-[13px] font-bold text-ink font-mono">{fmtBase(ob.baseTotal)}</span>
              </div>

              {ob.ccys.map((cb) => (
                <div
                  key={`${ob.office.id}|${cb.ccy}`}
                  className="grid grid-cols-[1fr_140px_120px] items-center pl-9 pr-4 py-2 border-t border-[#f3f4f8]"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <CcyChip ccy={cb.ccy} />
                    <span className="text-[13px] font-bold text-ink">{cb.ccy}</span>
                    {cb.list.length > 1 && (
                      <span className="text-[11px] text-muted">· {cb.list.length} сч.</span>
                    )}
                  </span>
                  <span className="text-right text-[13px] font-mono font-semibold text-ink">{native(cb.total, cb.ccy)}</span>
                  <span className="text-right text-[12px] font-mono text-muted">{fmtBase(cb.base)}</span>
                </div>
              ))}

              {ob.ccys.length === 0 && (
                <div className="pl-9 pr-4 py-2.5 border-t border-[#f3f4f8] text-[12px] text-muted">
                  Нет счетов в этом разрезе
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 text-[11px] text-muted text-center">
          Живые данные{genAt ? ` · обновлено ${genAt.toLocaleString("ru-RU")}` : ""} · CoinPlata
        </div>
      </div>
    </div>
  );
}

function Centered({ children }) {
  return <div className="min-h-screen bg-[#f4f5f9] grid place-items-center px-4">{children}</div>;
}
