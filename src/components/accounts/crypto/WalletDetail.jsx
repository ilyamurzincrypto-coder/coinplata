// src/components/accounts/crypto/WalletDetail.jsx
// Экран 3 — детали крипто-кошелька (authed). Оверлей: mobile full / desktop
// центрированная колонка. Данные — /api/aegis/wallet (getWallet+getStats+
// getTransactions). Блоки без данных СКРЫТЫ (stats/transactions могут прийти
// available:false пока AEGIS не поднимет эндпоинты).
import React, { useEffect, useState } from "react";
import { ArrowLeft, Copy, Check, ExternalLink, ArrowDown, ArrowUp } from "lucide-react";
import AegisBadge from "../AegisBadge.jsx";
import { fetchWalletDetail, fetchWalletTransactions } from "../../../lib/aegisMonitoring.js";

const usd = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokenAmt = (a) => (a && a.amount != null ? Number(a.amount) / 10 ** (a.decimals ?? 6) : null);
const mid = (s, h = 8, t = 6) => (!s ? "" : s.length > h + t + 1 ? `${s.slice(0, h)}…${s.slice(-t)}` : s);

const EXPLORER = {
  TRC20: (a) => `https://tronscan.org/#/address/${a}`,
  ERC20: (a) => `https://etherscan.io/address/${a}`,
  BEP20: (a) => `https://bscscan.com/address/${a}`,
  BTC: (a) => `https://blockstream.info/address/${a}`,
};
const RISK_COLOR = { critical: "#B91C1C", warning: "#B45309", ok: "#10B981" };

function Metric({ label, children, valueCls = "" }) {
  return (
    <div className="flex-1 bg-surface-sunk rounded-[12px] px-3 py-2.5 min-w-0">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className={`mt-1 font-mono tabular-nums text-[16px] text-ink truncate ${valueCls}`}>{children}</div>
    </div>
  );
}

function TxRow({ t }) {
  const isIn = t.direction === "in";
  const amt = tokenAmt(t.amount);
  const lvl = t.counterpartyRisk?.level;
  const color = RISK_COLOR[lvl] || "#B5B9BF";
  const cats = (t.counterpartyRisk?.categories || []).join(", ");
  const dt = t.ts ? new Date(t.ts) : null;
  return (
    <div className="flex items-center gap-2.5 py-2 border-t-[0.5px] border-border-soft">
      <span className={`grid place-items-center w-[26px] h-[26px] rounded-full shrink-0 ${isIn ? "bg-emerald-soft" : "bg-surface-sunk"}`}>
        {isIn ? <ArrowDown className="w-3.5 h-3.5 text-success" strokeWidth={2.2} /> : <ArrowUp className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
      </span>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="font-mono tabular-nums text-[13px] text-ink">{amt != null ? `${isIn ? "+" : "−"}${amt.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT` : "—"}</span>
        <span className="text-[11px] text-muted truncate">{[cats || null, mid(t.counterparty, 6, 5), dt ? dt.toLocaleString("ru-RU") : null].filter(Boolean).join(" · ")}</span>
      </span>
      {lvl && (
        <span className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-medium" style={{ color }}>
          <span className="rounded-full" style={{ width: 6, height: 6, background: color }} /> риск {lvl}
        </span>
      )}
    </div>
  );
}

export default function WalletDetail({ account, ledgerUsd = 0, onBack }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [txFilter, setTxFilter] = useState("all");
  const [extra, setExtra] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, data: null });
    fetchWalletDetail(account.id).then(
      (d) => {
        if (!alive) return;
        setState({ loading: false, error: null, data: d });
        setCursor(d?.transactions?.cursor || null);
        setMore(!!d?.transactions?.hasMore);
      },
      (e) => alive && setState({ loading: false, error: e?.message || "Ошибка", data: null })
    );
    return () => { alive = false; };
  }, [account.id]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const tx = await fetchWalletTransactions(account.id, cursor);
      setExtra((x) => [...x, ...(tx.items || [])]);
      setCursor(tx.cursor || null);
      setMore(!!tx.hasMore);
    } catch { /* ignore */ } finally { setLoadingMore(false); }
  };

  const copy = () => navigator.clipboard?.writeText(account.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {});
  const explorer = EXPLORER[account.network]?.(account.address);

  const w = state.data?.wallet || {};
  const stats = state.data?.stats || {};
  const txData = state.data?.transactions || {};
  const allTx = [...(txData.items || []), ...extra].filter((t) => txFilter === "all" || t.direction === (txFilter === "in" ? "in" : "out"));
  const score = w.riskScore;
  const scoreColor = RISK_COLOR[w.riskLevel] || "#131416";

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex md:items-center md:justify-center" onClick={onBack}>
      <div className="bg-bg w-full h-full md:h-auto md:max-h-[90vh] md:w-[560px] md:rounded-[18px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Навбар */}
        <div className="sticky top-0 bg-bg/95 backdrop-blur border-b-[0.5px] border-border flex items-center gap-2 px-3 h-12">
          <button type="button" onClick={onBack} className="p-1 -ml-1 text-ink-soft hover:text-ink"><ArrowLeft className="w-5 h-5" /></button>
          <span className="text-[15px] font-medium text-ink truncate flex-1">{account.name}</span>
          <AegisBadge account={account} />
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Адрес + эксплорер */}
          <div className="flex items-center gap-2 flex-wrap">
            {account.network && <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{account.network}</span>}
            <span className="font-mono text-[12px] text-ink-soft break-all">{mid(account.address, 12, 10)}</span>
            <button type="button" onClick={copy} className="text-muted hover:text-ink" title="Скопировать">{copied ? <Check className="w-4 h-4 text-emerald" /> : <Copy className="w-4 h-4" />}</button>
            {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="В эксплорере"><ExternalLink className="w-4 h-4" /></a>}
          </div>

          {/* 3 метрики */}
          <div className="flex gap-2">
            <Metric label="он-чейн">{w.balanceUsdEst != null ? usd(w.balanceUsdEst) : "—"}</Metric>
            <Metric label="учёт">{usd(ledgerUsd)}</Metric>
            <Metric label="риск-скор" valueCls="">
              <span style={{ color: scoreColor }}>{score != null ? `${score}/100` : (w.riskLevel || "—")}</span>
            </Metric>
          </div>

          {state.loading && <div className="text-[13px] text-muted">Загрузка деталей…</div>}
          {state.error && <div className="text-[13px] text-danger">{state.error === "aegis wallet timeout" ? "AEGIS не ответил вовремя — попробуй обновить позже." : state.error}</div>}

          {/* Контрагенты · 30 дней (только если stats доступны) */}
          {stats.available && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Контрагенты · 30 дней</div>
              <div className="flex gap-2">
                <Metric label="входы">{stats.in?.sumUsd != null ? usd(stats.in.sumUsd) : "—"}<span className="text-[11px] text-muted"> · {stats.in?.count ?? 0}</span></Metric>
                <Metric label="выходы">{stats.out?.sumUsd != null ? usd(stats.out.sumUsd) : "—"}<span className="text-[11px] text-muted"> · {stats.out?.count ?? 0}</span></Metric>
              </div>
              {/* «рисковые N%» + стек-бар распределения — скрыты: нет агрегата от AEGIS */}
            </div>
          )}

          {/* Движения (только если доступны) */}
          {txData.available ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Движения</span>
                <div className="flex gap-1">
                  {[["all", "Все"], ["in", "Входы"], ["out", "Выходы"]].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTxFilter(k)} className={`px-2 py-0.5 rounded-[7px] text-[11.5px] ${txFilter === k ? "bg-ink text-white" : "bg-surface-soft text-ink-soft"}`}>{l}</button>
                  ))}
                </div>
              </div>
              {allTx.length === 0 ? (
                <div className="text-[12.5px] text-muted py-2">Нет движений за период.</div>
              ) : (
                <div>{allTx.map((t, i) => <TxRow key={t.txHash || i} t={t} />)}</div>
              )}
              {more && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-2 w-full py-2 rounded-[10px] bg-surface-soft text-[12.5px] text-ink-soft hover:text-ink disabled:opacity-50">{loadingMore ? "Загрузка…" : "Показать ещё"}</button>}
            </div>
          ) : (
            !state.loading && <div className="text-[12.5px] text-muted">Движения и контрагенты появятся, когда AEGIS отдаст данные по кошельку.</div>
          )}
        </div>
      </div>
    </div>
  );
}
