// src/components/accounts/crypto/WalletDetail.jsx
// Экран 3 — детали крипто-кошелька (authed). Оверлей: mobile full / desktop
// центрированная колонка. Данные — /api/aegis/wallet (getWallet+getStats+
// getTransactions). Блоки без данных СКРЫТЫ (stats/transactions могут прийти
// available:false пока AEGIS не поднимет эндпоинты).
import React, { useEffect, useState } from "react";
import { ArrowLeft, Copy, Check, ExternalLink, ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import AegisBadge from "../AegisBadge.jsx";
import { fetchWalletDetail, fetchWalletTransactions } from "../../../lib/aegisMonitoring.js";
import { plainReasons, hopLabel } from "../../../lib/riskReasons.js";

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

// Строка агрегата по контрагенту: адрес + тип + риск, и «получено/отправлено».
function PartyRow({ p, network }) {
  const lvl = levelOfScore(p.riskScore) || null;
  const color = RISK_COLOR[lvl] || "#B5B9BF";
  const type = p.hasData ? (TYPE_LABEL[p.type] || p.type) : null;
  const explorer = p.cp && EXPLORER[network]?.(p.cp);
  const fmt = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-t-[0.5px] border-border-soft">
      <span className="flex flex-col min-w-0 flex-1 gap-1">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[12px] text-ink-soft break-all" title={p.cp}>{p.cp}</span>
          <CopyBtn value={p.cp} />
          {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-ink" title="В эксплорере"><ExternalLink className="w-3 h-3" /></a>}
          {type && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{type}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] font-mono tabular-nums">
          {p.inUsdt > 0 && <span className="text-success">получено +{fmt(p.inUsdt)}</span>}
          {p.outUsdt > 0 && <span className="text-muted">отправлено −{fmt(p.outUsdt)}</span>}
          <span className="text-[11px] text-muted-soft">· {p.count} оп.</span>
        </span>
      </span>
      {p.hasData ? (
        <span className="shrink-0 inline-flex items-center gap-1 mt-0.5 rounded-[7px] px-1.5 py-0.5 text-[11px] font-semibold" style={{ color, background: `${color}14` }}>
          <span className="rounded-full" style={{ width: 6, height: 6, background: color }} /> риск {p.riskScore != null ? p.riskScore : lvl}
        </span>
      ) : (
        <span className="shrink-0 inline-flex items-center mt-0.5 rounded-[7px] px-1.5 py-0.5 text-[10.5px] text-muted bg-surface-sunk" title="Нет меток контрагента в фиде">нет данных</span>
      )}
    </div>
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
  const [txView, setTxView] = useState("list"); // list | party (лентой | по контрагентам)
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
        // Свежесть: баланс синкнулся ПОЗЖЕ, чем собран tx-кэш → был перевод после
        // последнего пула движений (напр. вывод), которого ещё нет в списке →
        // тянем live, чтобы движение показалось сразу (только staff-кэш, не share).
        const bSync = account.syncedAt ? new Date(account.syncedAt).getTime() : 0;
        const txCache = d?.cachedAt ? new Date(d.cachedAt).getTime() : 0;
        if (d?.source === "cache" && bSync && txCache && bSync > txCache + 60000) {
          setRefreshing(true);
          getDetail(account.id, { live: true }).then((live) => {
            if (!alive) return;
            setState({ loading: false, error: null, data: live });
            setExtra([]);
            setCursor(live?.transactions?.cursor || null);
            setMore(!!live?.transactions?.hasMore);
          }).catch(() => {}).finally(() => alive && setRefreshing(false));
        }
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
  const rawTx = [...(txData.items || []), ...extra];
  const allTx = rawTx.filter((t) => txFilter === "all" || t.direction === (txFilter === "in" ? "in" : "out"));
  const score = w.riskScore;

  // Агрегация по контрагентам (из загруженных движений): кто сколько прислал/вывел.
  const parties = (() => {
    const m = new Map();
    for (const t of rawTx) {
      const cp = t.counterparty || "—";
      if (!m.has(cp)) m.set(cp, { cp, inUsdt: 0, outUsdt: 0, count: 0, type: null, riskScore: null, hasData: false });
      const p = m.get(cp);
      const amt = tokenAmt(t.amount) || 0;
      if (t.direction === "in") p.inUsdt += amt; else p.outUsdt += amt;
      p.count += 1;
      if (t.counterpartyType && t.counterpartyType !== "unknown") { p.hasData = true; p.type = t.counterpartyType; }
      const s = t.counterpartyRisk?.score ?? t.riskScore;
      if (s != null) p.riskScore = Math.max(p.riskScore ?? 0, s);
    }
    let list = [...m.values()];
    if (txFilter === "in") list = list.filter((p) => p.inUsdt > 0);
    else if (txFilter === "out") list = list.filter((p) => p.outUsdt > 0);
    return list.sort((a, b) => b.inUsdt + b.outUsdt - (a.inUsdt + a.outUsdt));
  })();

  // Сверка: чистый поток по статистике (входы−выходы) должен ≈ балансу. Если сильно
  // расходится — AEGIS отдал не все транзакции (напр. вывод не пришёл в фид). Показываем
  // честное предупреждение, чтобы «движения не пиздят», а видно, что фид неполный.
  const onchainNum = Number(w.balanceUsdEst ?? account.balanceUsdEst);
  const inSum = stats.in?.sumUsd != null ? Number(stats.in.sumUsd) : null;
  const outSum = stats.out?.sumUsd != null ? Number(stats.out.sumUsd) : null;
  const netFlow = inSum != null && outSum != null ? inSum - outSum : null;
  const reconGap = stats.available && netFlow != null && Number.isFinite(onchainNum) ? netFlow - onchainNum : null;
  const reconMismatch = reconGap != null && Math.abs(reconGap) > Math.max(10, 0.02 * Math.max(Math.abs(netFlow), Math.abs(onchainNum)));

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

          {/* Почему такой риск — вердикт (какой именно риск) + причины человеческим языком */}
          {(() => {
            const reasons = plainReasons(w.riskReasons || account.riskReasons);
            const lvl = w.riskLevel || account.riskLevel;
            const cap = w.capability || account.aegisCapability;
            const verdictWord = cap === "degraded" ? "нет оценки" : lvl === "critical" ? "высокий" : lvl === "warning" ? "повышенный" : "низкий";
            const verdictColor = lvl === "critical" ? "#B91C1C" : lvl === "warning" ? "#B45309" : "#10B981";
            if (!reasons.length && score == null) return null;
            return (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Почему такой риск</div>
                {/* Явный вердикт — чтобы «24/100 зелёный» не путал при наличии флага */}
                <div className="rounded-[12px] px-3 py-2.5 bg-surface-sunk mb-2">
                  <div className="text-[13px]">
                    Общая оценка: <span className="font-semibold" style={{ color: verdictColor }}>{verdictWord} риск</span>
                    {score != null && <span className="font-mono tabular-nums text-muted"> · {score}/100</span>}
                  </div>
                  {reasons.length > 0 && lvl !== "critical" && (
                    <div className="text-[11px] text-muted mt-1 leading-snug">Скор невысокий, но есть флаг — обрати внимание на пункт ниже.</div>
                  )}
                  {reasons.length === 0 && <div className="text-[11px] text-muted mt-1">Флагов не найдено.</div>}
                </div>
                <div className="space-y-2">
                  {reasons.map((r, i) => {
                    const c = r.tone === "critical" ? "#B91C1C" : "#B45309";
                    const hl = hopLabel(r.hop);
                    return (
                      <div key={i} className="rounded-[12px] px-3 py-2.5" style={{ background: `${c}0F` }}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[13px] font-semibold" style={{ color: c }}>{r.title}</span>
                          {hl && <span className="text-[10px] font-semibold rounded-[6px] px-1.5 py-0.5" style={{ color: c, background: `${c}1A` }}>{hl}</span>}
                        </div>
                        <div className="text-[12.5px] text-ink-soft leading-snug">{r.plain}</div>
                        {r.glossary && <div className="text-[11px] text-muted-soft mt-1 leading-snug">ℹ {r.glossary}</div>}
                        {r.note && <div className="text-[11px] text-muted mt-1 leading-snug">{r.note}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div className="inline-flex rounded-[8px] bg-surface-soft p-0.5">
                  {[["list", "Лентой"], ["party", "По контрагентам"]].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTxView(k)} className={`px-2 py-0.5 rounded-[6px] text-[11.5px] font-medium ${txView === k ? "bg-ink text-white" : "text-ink-soft"}`}>{l}</button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {[["all", "Все"], ["in", txView === "party" ? "Источники" : "Входы"], ["out", txView === "party" ? "Получатели" : "Выходы"]].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTxFilter(k)} className={`px-2 py-0.5 rounded-[7px] text-[11.5px] ${txFilter === k ? "bg-ink text-white" : "bg-surface-soft text-ink-soft"}`}>{l}</button>
                  ))}
                </div>
              </div>
              {reconMismatch && (
                <div className="mb-2 rounded-[10px] px-3 py-2.5 bg-warning-soft">
                  <div className="text-[12.5px] font-medium text-ink">Движения не сходятся с балансом</div>
                  <div className="text-[11.5px] text-ink-soft leading-snug mt-0.5">
                    По операциям чистый поток {netFlow >= 0 ? "+" : "−"}{usd(Math.abs(netFlow))}, а на кошельке {usd(onchainNum)}. Значит фид AEGIS отдал не все транзакции (часть {reconGap > 0 ? "выводов" : "поступлений"} отсутствует). Это ограничение фида, не ошибка учёта.
                  </div>
                </div>
              )}
              {txView === "party" ? (
                parties.length === 0 ? (
                  <div className="text-[12.5px] text-muted py-2">Нет контрагентов за период.</div>
                ) : (
                  <>
                    <div className="text-[11px] text-muted-soft mb-1">По загруженным движениям · {parties.length} контрагентов</div>
                    <div>{parties.map((p, i) => <PartyRow key={p.cp || i} p={p} network={account.network} />)}</div>
                  </>
                )
              ) : allTx.length === 0 ? (
                <div className="text-[12.5px] text-muted py-2">Нет движений за период.</div>
              ) : (
                <div>{allTx.map((t, i) => <TxRow key={t.txHash || i} t={t} network={account.network} />)}</div>
              )}
              {txView === "list" && more && !readOnly && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-2 w-full py-2 rounded-[10px] bg-surface-soft text-[12.5px] text-ink-soft hover:text-ink disabled:opacity-50">{loadingMore ? "Загрузка…" : "Показать ещё"}</button>}
            </div>
          ) : (
            !state.loading && <div className="text-[12.5px] text-muted">Движения и контрагенты появятся, когда AEGIS отдаст данные по кошельку.</div>
          )}
        </div>
      </div>
    </div>
  );
}
