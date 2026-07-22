// src/components/accounts/crypto/WalletDetail.jsx
// Экран 3 — детали крипто-кошелька (authed). Оверлей: mobile full / desktop
// центрированная колонка. Данные — /api/aegis/wallet (getWallet+getStats+
// getTransactions). Блоки без данных СКРЫТЫ (stats/transactions могут прийти
// available:false пока AEGIS не поднимет эндпоинты).
import React, { useEffect, useState } from "react";
import { ArrowLeft, Copy, Check, ExternalLink, ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import AegisBadge from "../AegisBadge.jsx";
import { fetchWalletDetail, fetchWalletTransactions } from "../../../lib/aegisMonitoring.js";

const usd = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokenAmt = (a) => (a && a.amount != null ? Number(a.amount) / 10 ** (a.decimals ?? 6) : null);
const hhmm = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : ""; };

const EXPLORER = {
  TRC20: (a) => `https://tronscan.org/#/address/${a}`,
  ERC20: (a) => `https://etherscan.io/address/${a}`,
  BEP20: (a) => `https://bscscan.com/address/${a}`,
  BTC: (a) => `https://blockstream.info/address/${a}`,
};
const RISK_COLOR = { critical: "#B91C1C", warning: "#B45309", ok: "#10B981", high: "#B91C1C", medium: "#B45309", low: "#10B981" };
// score 0-100 → уровень (пороги AEGIS: ok≤25 / warning 25-80 / critical>80).
const levelOfScore = (s) => (s == null ? null : s > 80 ? "critical" : s > 25 ? "warning" : "ok");
const TYPE_LABEL = { exchange: "биржа", p2p_merchant: "P2P", mixer: "микшер", private: "приватный", internal: "свой", bridge: "мост", contract: "контракт" };

function Metric({ label, children, valueCls = "" }) {
  return (
    <div className="flex-1 bg-surface-sunk rounded-[12px] px-3 py-2.5 min-w-0">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className={`mt-1 font-mono tabular-nums text-[16px] text-ink truncate ${valueCls}`}>{children}</div>
    </div>
  );
}

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button type="button" title="Скопировать адрес" className="shrink-0 text-muted hover:text-ink"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {}); }}>
      {copied ? <Check className="w-3 h-3 text-emerald" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function TxRow({ t, network }) {
  const isIn = t.direction === "in";
  const amt = tokenAmt(t.amount);
  // Риск-скор КОНТРАГЕНТА (его адреса), не самого перевода: сначала counterparty_risk,
  // фолбэк на risk_score перевода.
  const cpScore = t.counterpartyRisk?.score ?? t.riskScore ?? null;
  const lvl = levelOfScore(cpScore) || t.counterpartyRisk?.level;
  const color = RISK_COLOR[lvl] || "#B5B9BF";
  // По AEGIS: counterparty_type != unknown → по контрагенту ЕСТЬ данные (риск 0 честен);
  // unknown → меток нет → «нет данных», а не «риск 0».
  const hasData = !!(t.counterpartyType && t.counterpartyType !== "unknown");
  const type = hasData ? (TYPE_LABEL[t.counterpartyType] || t.counterpartyType) : null;
  const cats = (t.counterpartyRisk?.categories || []).join(", ");
  const dt = t.ts ? new Date(t.ts) : null;
  const explorer = t.counterparty && EXPLORER[network]?.(t.counterparty);
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-t-[0.5px] border-border-soft">
      <span className={`grid place-items-center w-[26px] h-[26px] rounded-full shrink-0 mt-0.5 ${isIn ? "bg-emerald-soft" : "bg-surface-sunk"}`}>
        {isIn ? <ArrowDown className="w-3.5 h-3.5 text-success" strokeWidth={2.2} /> : <ArrowUp className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
      </span>
      <span className="flex flex-col min-w-0 flex-1 gap-1">
        <span className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-[14px] text-ink">{amt != null ? `${isIn ? "+" : "−"}${amt.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT` : "—"}</span>
          {type && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{type}</span>}
        </span>
        {/* Адрес контрагента — ПОЛНОСТЬЮ (mono ink) + копия + эксплорер */}
        {t.counterparty && (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[12px] text-ink-soft break-all" title={t.counterparty}>{t.counterparty}</span>
            <CopyBtn value={t.counterparty} />
            {explorer && <a href={explorer} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 text-muted hover:text-ink" title="В эксплорере"><ExternalLink className="w-3 h-3" /></a>}
          </span>
        )}
        <span className="text-[11px] text-muted truncate">{[cats || null, dt ? dt.toLocaleString("ru-RU") : null].filter(Boolean).join(" · ")}</span>
      </span>
      {hasData ? (
        <span className="shrink-0 inline-flex items-center gap-1 mt-0.5 rounded-[7px] px-1.5 py-0.5 text-[11px] font-semibold" style={{ color, background: `${color}14` }}>
          <span className="rounded-full" style={{ width: 6, height: 6, background: color }} /> риск {cpScore != null ? cpScore : lvl}
        </span>
      ) : (
        <span className="shrink-0 inline-flex items-center mt-0.5 rounded-[7px] px-1.5 py-0.5 text-[10.5px] text-muted bg-surface-sunk" title="У контрагента нет меток в фиде — риск не оценён">нет данных</span>
      )}
    </div>
  );
}

// Распределение оборота по риску. По AEGIS честная рамка: «оценено X% оборота,
// из них Y% рисковых». Низкий бакет = «без high-риска», НЕ «подтверждённо чисто»;
// остальное — «нет данных» (у контрагента нет меток в фиде, разреженность TRON).
const pct = (v) => `${(Math.round((Number(v) || 0) * 10) / 10)}%`;
function RiskDistribution({ dist }) {
  const assessed = Number(dist?.assessed_share);
  // Новый формат (assessed_share) → честная рамка; старый кэш → фолбэк на high/medium/low.
  if (Number.isFinite(assessed)) {
    const risky = Number(dist?.risky_share) || 0;
    const clean = Math.max(assessed - risky, 0);
    const unassessed = Math.max(100 - assessed, 0);
    const Seg = ({ w, c }) => (w > 0 ? <span style={{ width: `${w}%`, background: c }} /> : null);
    return (
      <div className="mt-2.5">
        <div className="flex h-2 rounded-full overflow-hidden bg-surface-sunk">
          <Seg w={risky} c={RISK_COLOR.high} />
          <Seg w={clean} c={RISK_COLOR.low} />
          <Seg w={unassessed} c="#D9DCE1" />
        </div>
        <div className="flex flex-wrap gap-3 mt-1.5 text-[10.5px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="rounded-full" style={{ width: 6, height: 6, background: RISK_COLOR.high }} /> рисковые {pct(risky)}</span>
          <span className="inline-flex items-center gap-1"><span className="rounded-full" style={{ width: 6, height: 6, background: RISK_COLOR.low }} /> без флагов {pct(clean)}</span>
          <span className="inline-flex items-center gap-1"><span className="rounded-full" style={{ width: 6, height: 6, background: "#D9DCE1" }} /> нет данных {pct(unassessed)}</span>
        </div>
        <div className="text-[10.5px] text-muted-soft mt-1 leading-snug">Оценено {pct(assessed)} оборота — у остальных контрагентов нет меток в фиде (это «нет данных», а не «чисто»).</div>
      </div>
    );
  }
  // Фолбэк (старый кэш до перепула poll).
  const t = dist?.total || {};
  const seg = (k) => Number(t?.[k]?.share) || 0;
  const parts = [
    { k: "high", share: seg("high"), color: RISK_COLOR.high },
    { k: "medium", share: seg("medium"), color: RISK_COLOR.medium },
    { k: "low", share: seg("low"), color: RISK_COLOR.low },
  ].filter((p) => p.share > 0);
  return (
    <div className="mt-2.5">
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-sunk">
        {parts.map((p) => <span key={p.k} style={{ width: `${p.share}%`, background: p.color }} />)}
      </div>
      <div className="flex gap-3 mt-1.5 text-[10.5px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="rounded-full" style={{ width: 6, height: 6, background: RISK_COLOR.high }} /> высокий {seg("high")}%</span>
        <span className="inline-flex items-center gap-1"><span className="rounded-full" style={{ width: 6, height: 6, background: RISK_COLOR.medium }} /> средний {seg("medium")}%</span>
        <span className="inline-flex items-center gap-1"><span className="rounded-full" style={{ width: 6, height: 6, background: RISK_COLOR.low }} /> низкий {seg("low")}%</span>
      </div>
    </div>
  );
}

export default function WalletDetail({ account, ledgerUsd = 0, onBack, fetchDetail, readOnly = false }) {
  // Источник данных: staff-эндпоинт по умолчанию; на share — токен-фетчер (read-only).
  const getDetail = fetchDetail || ((id, opts) => fetchWalletDetail(id, opts));
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [txFilter, setTxFilter] = useState("all");
  const [extra, setExtra] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, data: null });
    setExtra([]);
    getDetail(account.id).then(
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

  // «Обновить» — свежий пул из AEGIS мимо кэша (?live=1).
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const d = await getDetail(account.id, { live: true });
      setState({ loading: false, error: null, data: d });
      setExtra([]);
      setCursor(d?.transactions?.cursor || null);
      setMore(!!d?.transactions?.hasMore);
    } catch (e) {
      setState((s) => ({ ...s, error: e?.message || "Ошибка" }));
    } finally {
      setRefreshing(false);
    }
  };

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

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex md:items-center md:justify-center" onClick={onBack}>
      <div className="bg-bg w-full h-full md:h-auto md:max-h-[92vh] md:w-[760px] md:rounded-[18px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Навбар */}
        <div className="sticky top-0 bg-bg/95 backdrop-blur border-b-[0.5px] border-border flex items-center gap-2 px-3 h-12">
          <button type="button" onClick={onBack} className="p-1 -ml-1 text-ink-soft hover:text-ink"><ArrowLeft className="w-5 h-5" /></button>
          <span className="text-[15px] font-medium text-ink truncate flex-1">{account.name}</span>
          {state.data?.cachedAt && (
            <span className="hidden sm:inline text-[10.5px] text-muted mr-0.5">обновлено {hhmm(state.data.cachedAt)}</span>
          )}
          {!readOnly && (
            <button type="button" onClick={refresh} disabled={refreshing} title="Обновить из AEGIS" className="p-1 text-muted hover:text-ink disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
          <AegisBadge account={account} />
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Адрес + эксплорер */}
          <div className="flex items-center gap-2 flex-wrap">
            {account.network && <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{account.network}</span>}
            <span className="font-mono text-[12px] text-ink-soft break-all">{account.address}</span>
            <button type="button" onClick={copy} className="text-muted hover:text-ink" title="Скопировать">{copied ? <Check className="w-4 h-4 text-emerald" /> : <Copy className="w-4 h-4" />}</button>
            {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="В эксплорере"><ExternalLink className="w-4 h-4" /></a>}
          </div>

          {/* 3 метрики. Фолбэк на кэш счёта, если live-detail не пришёл (AEGIS-таймаут). */}
          <div className="flex gap-2">
            <Metric label="он-чейн">{(w.balanceUsdEst ?? account.balanceUsdEst) != null ? usd(w.balanceUsdEst ?? account.balanceUsdEst) : "—"}</Metric>
            <Metric label="учёт">{usd(ledgerUsd)}</Metric>
            <Metric label="риск-скор">
              <span style={{ color: RISK_COLOR[w.riskLevel || account.riskLevel] || "#131416" }}>
                {score != null ? `${score}/100` : (w.riskLevel || account.riskLevel || "—")}
              </span>
            </Metric>
          </div>

          {state.loading && <div className="text-[13px] text-muted">Загрузка деталей…</div>}
          {state.error && <div className="text-[13px] text-danger">{state.error === "aegis wallet timeout" ? "AEGIS не ответил вовремя — попробуй обновить позже." : state.error}</div>}

          {/* Контрагенты · за всё время (только если stats доступны) */}
          {stats.available && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Контрагенты · за всё время</div>
              <div className="flex gap-2">
                <Metric label="входы">{stats.in?.sumUsd != null ? usd(stats.in.sumUsd) : "—"}<span className="text-[11px] text-muted"> · {stats.in?.count ?? 0}</span></Metric>
                <Metric label="выходы">{stats.out?.sumUsd != null ? usd(stats.out.sumUsd) : "—"}<span className="text-[11px] text-muted"> · {stats.out?.count ?? 0}</span></Metric>
                {stats.riskDistribution?.risky_share != null && (() => {
                  const risky = Number(stats.riskDistribution.risky_share) || 0;
                  const assessed = stats.riskDistribution.assessed_share;
                  return (
                    <div className="flex-1 rounded-[12px] px-3 py-2.5 min-w-0 border-[0.5px]" style={{ borderColor: risky > 0 ? "#B91C1C" : "var(--border, #E7E9EE)" }}>
                      <div className="text-[10.5px] text-muted">рисковые</div>
                      <div className="mt-1 font-mono tabular-nums text-[16px]" style={{ color: risky > 0 ? "#B91C1C" : "#10B981" }}>{risky}%</div>
                      {assessed != null && <div className="text-[10px] text-muted-soft mt-0.5">оценено {pct(assessed)}</div>}
                    </div>
                  );
                })()}
              </div>
              {/* стек-бар распределения объёма по риску (null на EVM — скрыт) */}
              {stats.riskDistribution && <RiskDistribution dist={stats.riskDistribution} />}
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
                <div>{allTx.map((t, i) => <TxRow key={t.txHash || i} t={t} network={account.network} />)}</div>
              )}
              {more && !readOnly && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-2 w-full py-2 rounded-[10px] bg-surface-soft text-[12.5px] text-ink-soft hover:text-ink disabled:opacity-50">{loadingMore ? "Загрузка…" : "Показать ещё"}</button>}
            </div>
          ) : (
            !state.loading && <div className="text-[12.5px] text-muted">Движения и контрагенты появятся, когда AEGIS отдаст данные по кошельку.</div>
          )}
        </div>
      </div>
    </div>
  );
}
