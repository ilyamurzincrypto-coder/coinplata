// src/pages/ShareAccountsView.jsx
// Публичный read-only просмотр раздела «Счета» по share-токену. Монтируется
// ВНЕ провайдеров/авторизации (см. App.jsx роутинг /share/accounts/<token>).
// Данные — живой снапшот из /api/share/accounts?token=… ; сборка дерева и base-
// конверсия переиспользуют тот же движок (buildShareTree). Никаких мутаций:
// у страницы нет ни одной кнопки действия, а бэкенд отдаёт только GET.
import { useEffect, useState } from "react";
import { Building2, Eye, Lock, AlertTriangle } from "lucide-react";
import { buildShareTree, SCOPE_LABEL } from "../lib/shareAccounts.js";
import { ccyMeta, fmtRu } from "../components/balances/currencyMeta.js";
import { curSymbol, fmt } from "../utils/money.js";
import AegisBadge from "../components/accounts/AegisBadge.jsx";
import { walletDiscrepancy, syncedLabel, isCryptoAccount } from "../utils/accountsRisk.js";
import CryptoAccountsList from "../components/accounts/crypto/CryptoAccountsList.jsx";
import WalletDetail from "../components/accounts/crypto/WalletDetail.jsx";
import { fetchShareWalletDetail } from "../lib/shareLinks.js";

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
  const [detailWallet, setDetailWallet] = useState(null); // { account, ledgerUsd } — drill на share

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

  // Крипто-скоуп → новый монитор-список (mode=share, read-only, без drill-down).
  if (scope === "crypto") {
    const cryptoItems = tree.flatMap((o) =>
      (o.ccys || []).flatMap((c) =>
        (c.rows || []).filter((r) => isCryptoAccount(r.account)).map((r) => ({ account: r.account, ledgerUsd: r.ledgerUsd }))
      )
    );
    const offices = tree.map((o) => o.office);
    const allowDetails = state.data?.allowDetails === true;
    return (
      <div className="min-h-screen bg-bg py-6 px-4">
        <div className="max-w-3xl mx-auto">
          <CryptoAccountsList
            items={cryptoItems}
            offices={offices}
            mode="share"
            asOf={state.data?.generatedAt}
            shareDetails={allowDetails}
            onOpenWallet={allowDetails ? (account) => {
              const it = cryptoItems.find((i) => i.account.id === account.id);
              setDetailWallet({ account, ledgerUsd: it?.ledgerUsd || 0 });
            } : undefined}
          />
          <div className="mt-3 text-[11px] text-muted-soft text-center">
            Живые данные{genAt ? ` · обновлено ${genAt.toLocaleString("ru-RU")}` : ""} · CoinPlata
          </div>
        </div>
        {detailWallet && (
          <WalletDetail
            account={detailWallet.account}
            ledgerUsd={detailWallet.ledgerUsd}
            onBack={() => setDetailWallet(null)}
            fetchDetail={(id) => fetchShareWalletDetail(token, id)}
            readOnly
          />
        )}
      </div>
    );
  }

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

        {/* Дерево — мобайл-френдли: flex со стеком, он-чейн на отдельной строке */}
        <div className="space-y-3">
          {tree.map((ob) => (
            <div key={ob.office.id} className="bg-surface border border-[#e7e9f1] rounded-[14px] overflow-hidden">
              {/* Офис */}
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#fbfcfe] border-b border-[#eef0f4]">
                <span className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 text-[#5b6cff] shrink-0" strokeWidth={2} />
                  <span className="text-[14px] font-bold text-ink truncate">{ob.office.name}</span>
                  <span className="text-[11px] text-muted shrink-0">· {ob.accsCount}</span>
                </span>
                <span className="text-[14px] font-extrabold text-ink font-mono shrink-0">{fmtBase(ob.baseTotal)}</span>
              </div>

              {ob.ccys.length === 0 && (
                <div className="px-3.5 py-2.5 text-[12px] text-muted">Нет счетов в этом разрезе</div>
              )}

              {ob.ccys.map((cb) => {
                const cryptoRows = (cb.rows || []).filter((r) => isCryptoAccount(r.account));
                return (
                  <div key={`${ob.office.id}|${cb.ccy}`} className="px-3.5 py-2 border-b border-[#f3f4f8] last:border-0">
                    {/* Валюта — итог */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 min-w-0">
                        <CcyChip ccy={cb.ccy} />
                        <span className="text-[13px] font-bold text-ink">{cb.ccy}</span>
                        {cb.list.length > 1 && <span className="text-[11px] text-muted">· {cb.list.length}</span>}
                      </span>
                      <span className="flex flex-col items-end leading-tight shrink-0">
                        <span className="text-[13px] font-mono font-semibold text-ink">{native(cb.total, cb.ccy)}</span>
                        <span className="text-[10.5px] font-mono text-muted">≈ {fmtBase(cb.base)}</span>
                      </span>
                    </div>

                    {/* Крипто-кошельки: имя + бейдж, на второй строке — он-чейн (видно на мобиле) */}
                    {cryptoRows.map((r) => {
                      const a = r.account;
                      const disc = walletDiscrepancy({ ledgerUsd: r.ledgerUsd, balanceUsdEst: a.balanceUsdEst });
                      return (
                        <div key={a.id} className="mt-2 pl-1 flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[12px] text-ink-soft truncate">{a.name}</span>
                              <AegisBadge account={a} />
                            </span>
                            <span className="text-[12px] font-mono text-ink shrink-0">{native(r.native, cb.ccy)}</span>
                          </div>
                          {disc.hasOnchain && (
                            <div
                              className={`flex items-center gap-1.5 flex-wrap text-[11px] font-mono ${
                                disc.flagged ? "text-[#c0392b] font-semibold" : "text-muted"
                              }`}
                            >
                              {disc.flagged && <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={2.2} />}
                              <span>⛓ он-чейн {fmtBase(disc.onchainUsd)}</span>
                              {a.syncedAt && <span className="text-muted-soft">· {syncedLabel(a.syncedAt)}</span>}
                              {disc.flagged && <span className="text-muted-soft">· учёт {fmtBase(r.ledgerUsd)}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
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
