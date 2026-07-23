// src/components/accounts/crypto/CryptoAccountsList.jsx
// Редизайн «Счета · Крипто» — список. Mobile (≤768) = карточки, Desktop (>768) =
// таблица. Общий для authed/share. Логика — cryptoAccountsView (чистая, тесты).
//
// Инварианты макета:
//  • mono (JetBrains, tabular-nums) ТОЛЬКО для сумм и адресов; лейблы/имена — UI-шрифт.
//  • no-CLS: суммы в контейнерах с min-width, skeleton фикс-размера пока нет данных,
//    слот под Δ зарезервирован, число обновляется не двигая соседей. Единственное
//    допустимое изменение высоты — раскрытие плашки причины.
//  • Статус-точка (риск AEGIS) и Δ-бейдж (расхождение учёт↔он-чейн) — РАЗДЕЛЬНЫ.
//    Он-чейн краснеет только вместе с Δ-бейджем.
import React, { useEffect, useMemo, useState } from "react";
import { Lock, Copy, Check, ChevronRight, X, AlertTriangle, ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff } from "lucide-react";
import { buildCryptoView, DELTA_ALERT_THRESHOLD_USD, SHARE_DRILLDOWN } from "../../../lib/cryptoAccountsView.js";
import { riskBadge } from "../../../utils/accountsRisk.js";
import { fetchCryptoLog } from "../../../lib/aegisMonitoring.js";
import { plainReasons, hopLabel } from "../../../lib/riskReasons.js";

const EXPLORER = {
  TRC20: (a) => `https://tronscan.org/#/address/${a}`,
  ERC20: (a) => `https://etherscan.io/address/${a}`,
  BEP20: (a) => `https://bscscan.com/address/${a}`,
  BTC: (a) => `https://blockstream.info/address/${a}`,
};
const RISK_COLOR = { critical: "#B91C1C", warning: "#B45309", ok: "#10B981", high: "#B91C1C", medium: "#B45309", low: "#10B981" };
const levelOfScore = (s) => (s == null ? null : s > 80 ? "critical" : s > 25 ? "warning" : "ok");
const tokenAmt = (a) => (a && a.amount != null ? Number(a.amount) / 10 ** (a.decimals ?? 6) : null);

const usd = (n) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function midTruncate(addr, head = 6, tail = 5) {
  if (!addr) return "";
  return addr.length > head + tail + 1 ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : addr;
}

const hhmm = (d) => {
  if (!d) return "";
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? "" : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

const STATUS = {
  ok: { color: "#10B981", tile: "bg-surface-sunk", text: "text-success" },
  warning: { color: "#B45309", tile: "bg-warning-soft", text: "text-warning" },
  critical: { color: "#B91C1C", tile: "bg-danger-soft", text: "text-danger" },
  muted: { color: "#B5B9BF", tile: "bg-surface-sunk", text: "text-muted" },
};

const statusOf = (account) => {
  const b = riskBadge(account) || { tone: "muted", label: "нет данных" };
  const s = account?.riskScore;
  const score = s == null || s === "" || !Number.isFinite(Number(s)) ? null : Number(s);
  return { ...(STATUS[b.tone] || STATUS.muted), label: b.label, tone: b.tone, score };
};
const hasDelta = (vm) => vm.hasOnchain && vm.deltaAbs > DELTA_ALERT_THRESHOLD_USD;
// Он-чейн краснеет ТОЛЬКО при недостаче (он-чейн < учёт выше порога) — по макету:
// W88 $0.62<$1000 → красный; Center $5700>$0 (избыток) → чёрный, Δ-чип красный.
const deficitRed = (vm) => vm.hasOnchain && vm.ledger - vm.onchain > DELTA_ALERT_THRESHOLD_USD;

// Сумма в фикс-контейнере (mono, tabular) — обновление не двигает соседей.
// null он-чейн → skeleton фикс-размера (нет данных/грузится).
function Amount({ value, cls = "", minW = 88, red = false }) {
  return (
    <span className={`inline-block text-right font-mono tabular-nums ${cls}`} style={{ minWidth: minW, color: red ? "#B91C1C" : undefined }}>
      {value == null ? <span className="inline-block rounded bg-surface-soft align-middle" style={{ width: Math.max(minW - 16, 48), height: "0.78em" }} /> : usd(value)}
    </span>
  );
}

// Δ-бейдж (расхождение). Слот зарезервирован даже когда Δ нет — no-CLS.
function DeltaBadge({ vm, minW = 96 }) {
  const show = hasDelta(vm);
  return (
    <span className="inline-flex justify-end" style={{ minWidth: minW }}>
      {show ? (
        <span className="inline-flex items-center whitespace-nowrap rounded-[7px] bg-danger-soft text-danger font-mono tabular-nums text-[11px] px-1.5 py-0.5">
          Δ {usd(vm.deltaAbs)}
        </span>
      ) : null}
    </span>
  );
}

// Риск-скор: иконка уровня (точка ok / треугольник warn-crit) + число 0-100.
// Клик → «почему такой скор» (плашка причины). Нет числа (не пришло от AEGIS) →
// фолбэк на словесный лейбл, чтобы не показывать пусто.
// Глазик: скрыть/показать кошелёк из витрины. stopPropagation — не открывает drill.
function EyeToggle({ account, onToggle }) {
  if (!onToggle) return null;
  const hidden = account?.hidden === true;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(account); }}
      title={hidden ? "Показать кошелёк" : "Скрыть кошелёк"}
      className="shrink-0 text-muted-soft hover:text-ink"
    >
      {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
    </button>
  );
}

function StatusDot({ account, onClick, small = false }) {
  const st = statusOf(account);
  const Tag = onClick ? "button" : "span";
  const fs = small ? "text-[12.5px]" : "text-[13px]";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      className={`inline-flex items-center gap-1.5 shrink-0 ${st.text} ${onClick ? "hover:opacity-80" : ""}`}
      title={onClick ? "Почему такой риск-скор" : undefined}
    >
      {st.tone === "warning" || st.tone === "critical" ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: st.color }} strokeWidth={2.2} />
      ) : (
        <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: st.color }} />
      )}
      {st.score != null ? (
        <span className={`font-mono tabular-nums font-semibold ${fs}`}>{st.score}<span className="text-muted font-normal text-[10px]">/100</span></span>
      ) : (
        <span className={`font-medium ${small ? "text-[12px]" : "text-[12.5px]"}`}>{st.label}</span>
      )}
    </Tag>
  );
}

function CopyAddr({ address, network, size = 12, head = 6, tail = 5, full = false }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {});
  };
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${full ? "max-w-full w-full" : ""}`}>
      <span className={`font-mono text-ink-soft truncate ${full ? "min-w-0 flex-1" : ""}`} style={{ fontSize: size }} title={address}>{full ? address : midTruncate(address, head, tail)}</span>
      <button type="button" onClick={copy} title="Скопировать адрес" className="shrink-0 text-muted hover:text-ink">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {network && (
        <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{network}</span>
      )}
    </span>
  );
}

// Расшифровка риск-скора по клику. Показывает само число, расшифровку уровня
// (даже для чистых ok — «флагов нет»), причины AEGIS если есть, и расхождение
// учёта. Цвет — по фактическому уровню (не всегда янтарный).
function ReasonPanel({ vm, reasons, onClose }) {
  const st = statusOf(vm.account);
  const badge = riskBadge(vm.account) || {};
  const bg = st.tone === "critical" ? "bg-danger-soft" : st.tone === "warning" ? "bg-warning-soft" : "bg-surface-sunk";
  const discLine = vm.hasOnchain && vm.deltaAbs > 0 ? `Учёт расходится с он-чейном на ${usd(vm.deltaAbs)}.` : null;
  const plain = plainReasons(reasons);
  const hint = badge.hint || (st.tone === "ok" ? "Флагов нет — проверок не требуется." : "Данных о причине нет.");
  return (
    <div className={`${bg} rounded-[10px] px-3 py-2.5 relative`}>
      <button type="button" onClick={onClose} className="absolute top-2 right-2 text-muted hover:text-ink" title="Закрыть"><X className="w-3.5 h-3.5" /></button>
      <div className="pr-5">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-mono tabular-nums text-[15px] font-semibold" style={{ color: st.color }}>
            {st.score != null ? `${st.score}/100` : "—"}
          </span>
          <span className="text-[12px] font-medium" style={{ color: st.color }}>{st.label}</span>
        </div>
        {/* причины AEGIS человеческим языком, с хопом; иначе — расшифровка уровня */}
        {plain.length > 0 ? (
          <ul className="space-y-1.5">
            {plain.map((r, i) => (
              <li key={i} className="text-[12px] text-ink-soft leading-snug">
                <span className="font-medium text-ink">{r.title}</span>
                {hopLabel(r.hop) && <span className="ml-1 text-[10px] text-muted">· {hopLabel(r.hop)}</span>}
                <div>{r.plain}</div>
                {r.glossary && <div className="text-[11px] text-muted-soft">ℹ {r.glossary}</div>}
                {r.note && <div className="text-[11px] text-muted-soft">{r.note}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[12px] text-ink-soft leading-snug">{hint}</div>
        )}
        {discLine && <div className="mt-1.5 text-[12px] font-medium text-ink leading-snug">⚠ {discLine}</div>}
      </div>
    </div>
  );
}

// ─── Mobile: строка (единый стиль для всех кошельков) ───
// Как таблица на десктопе, но в 2 строки: имя+адрес слева, он-чейн+риск справа.
// Один стиль для ok/проблемных (различие — цвет риск-индикатора и Δ), внутри
// одной карточки на офис с хайрлайнами между строками — без «вакханалии».
function MobileRow({ vm, mode, expanded, onToggleReason, reasons, onOpen, drillEnabled, first, onToggleHidden }) {
  const red = deficitRed(vm);
  const showDelta = hasDelta(vm);
  return (
    <>
      <div
        role={drillEnabled ? "button" : undefined}
        tabIndex={drillEnabled ? 0 : undefined}
        className={`flex items-center gap-2.5 px-3 py-2.5 ${vm.account?.hidden ? "opacity-60" : ""} ${first ? "" : "border-t-[0.5px] border-border-soft"} ${drillEnabled ? "cursor-pointer active:bg-surface-soft" : ""}`}
        onClick={drillEnabled ? () => onOpen?.(vm.account) : undefined}
        onKeyDown={drillEnabled ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(vm.account); } } : undefined}
      >
        <div className="flex flex-col min-w-0 flex-1 gap-1">
          <span className="flex items-center gap-1.5 min-w-0"><EyeToggle account={vm.account} onToggle={onToggleHidden} /><span className="text-[14px] text-ink truncate">{vm.name}</span></span>
          <span className="flex items-center gap-1.5 min-w-0">
            {vm.network && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[5px] px-1 py-0.5">{vm.network}</span>}
            <CopyAddr address={vm.address} network={null} size={11.5} head={6} tail={5} />
          </span>
        </div>
        <div className="flex flex-col items-end shrink-0 gap-1">
          <Amount value={vm.onchain} cls="text-[16px] font-medium text-ink" minW={0} red={red} />
          <div className="flex items-center gap-1.5">
            {showDelta && <DeltaBadge vm={vm} minW={0} />}
            <StatusDot account={vm.account} onClick={() => onToggleReason(vm.id)} small />
          </div>
        </div>
        {drillEnabled && <ChevronRight className="w-4 h-4 text-muted-soft shrink-0" />}
      </div>
      {expanded && mode === "authed" && (
        <div className="px-3 py-2 bg-surface-soft border-t-[0.5px] border-border-soft"><ReasonPanel vm={vm} reasons={reasons} onClose={() => onToggleReason(vm.id)} /></div>
      )}
    </>
  );
}

// ─── Desktop: настоящая таблица (table-fixed) ───
// Один colgroup на ВСЕ офисы → колонки (и суммы) выровнены между таблицами, а не
// «плывут». table-fixed + truncate → контент не вылезает и Δ не клипается.
// Колонки: имя | сеть | адрес | риск | он-чейн | учёт | Δ | ›.
const DCOLW = ["19%", "7%", "21%", "11%", "16%", "11%", "11%", "4%"];
const TD = "px-2.5 border-l-[0.5px] border-border-soft align-middle";
function ColGroup() {
  return <colgroup>{DCOLW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>;
}

function DesktopHead() {
  return (
    <thead>
      <tr className="text-[10px] font-semibold uppercase tracking-wide text-muted border-b-[0.5px] border-border">
        <th className="text-left font-semibold px-2.5 py-2">Кошелёк</th>
        <th className={`${TD} text-left font-semibold py-2`}>Сеть</th>
        <th className={`${TD} text-left font-semibold py-2`}>Адрес</th>
        <th className={`${TD} text-left font-semibold py-2`}>Риск</th>
        <th className={`${TD} text-right font-semibold py-2`}>Он-чейн</th>
        <th className={`${TD} text-right font-semibold py-2`}>Учёт</th>
        <th className={`${TD} text-right font-semibold py-2`}>Δ</th>
        <th className={`${TD} !px-0`} />
      </tr>
    </thead>
  );
}

function DesktopRow({ vm, mode, expanded, onToggleReason, reasons, onOpen, drillEnabled, onToggleHidden }) {
  const red = deficitRed(vm);
  return (
    <>
      <tr
        className={`h-11 border-t-[0.5px] border-border-soft ${vm.account?.hidden ? "opacity-60" : ""} ${expanded ? "bg-surface-soft" : drillEnabled ? "hover:bg-surface-soft cursor-pointer" : ""}`}
        onClick={drillEnabled ? () => onOpen?.(vm.account) : undefined}
      >
        <td className="px-2.5 align-middle"><div className="flex items-center gap-1.5 min-w-0"><EyeToggle account={vm.account} onToggle={onToggleHidden} /><div className="text-[13px] text-ink truncate" title={vm.name}>{vm.name}</div></div></td>
        <td className={`${TD} !px-2`}>{vm.network && <span className="inline-block text-[9px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1 py-0.5">{vm.network}</span>}</td>
        <td className={TD}><CopyAddr address={vm.address} network={null} size={12} full /></td>
        <td className={TD}><StatusDot account={vm.account} onClick={() => onToggleReason(vm.id)} small /></td>
        <td className={`${TD} text-right`}><Amount value={vm.onchain} cls="text-[15px] font-medium text-ink" minW={0} red={red} /></td>
        <td className={`${TD} text-right`}><Amount value={vm.ledger} cls="text-[13px] text-muted" minW={0} /></td>
        <td className={`${TD} text-right`}><DeltaBadge vm={vm} minW={0} /></td>
        <td className={`${TD} !px-0 text-center`}>{drillEnabled ? <ChevronRight className="inline w-4 h-4 text-muted-soft" /> : null}</td>
      </tr>
      {expanded && mode === "authed" && (
        <tr className="bg-surface-soft border-t-[0.5px] border-border-soft">
          <td colSpan={8} className="px-3 py-2"><div className="max-w-[560px]"><ReasonPanel vm={vm} reasons={reasons} onClose={() => onToggleReason(vm.id)} /></div></td>
        </tr>
      )}
    </>
  );
}

// ─── Лог: одна строка общей ленты движений (откуда → куда) ───
const dtRu = (ts) => {
  const d = ts ? new Date(ts) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
};
function LogRow({ t }) {
  const isIn = t.direction === "in";
  const amt = tokenAmt(t.amount);
  const cpScore = t.counterpartyRisk?.score ?? t.riskScore ?? null;
  const lvl = levelOfScore(cpScore) || t.counterpartyRisk?.level;
  const color = RISK_COLOR[lvl] || "#B5B9BF";
  // unknown → нет меток в фиде → «нет данных», а не «риск 0» (по AEGIS).
  const hasData = !!(t.counterpartyType && t.counterpartyType !== "unknown");
  const type = hasData ? t.counterpartyType : null;
  const explorer = t.counterparty && EXPLORER[t.network]?.(t.counterparty);
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 border-t-[0.5px] border-border-soft first:border-t-0">
      <span className={`grid place-items-center w-[26px] h-[26px] rounded-full shrink-0 mt-0.5 ${isIn ? "bg-emerald-soft" : "bg-surface-sunk"}`}>
        {isIn ? <ArrowDown className="w-3.5 h-3.5 text-success" strokeWidth={2.2} /> : <ArrowUp className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
      </span>
      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-[14px] text-ink">{amt != null ? `${isIn ? "+" : "−"}${amt.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT` : "—"}</span>
          {type && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{type}</span>}
        </div>
        {/* откуда → куда: наш кошелёк + адрес контрагента (полностью) */}
        <div className="text-[12px] text-ink-soft flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
          <span className="font-medium text-ink">{t.walletName || "—"}</span>
          <span className="text-muted">{isIn ? "← от" : "→ на"}</span>
          {t.counterparty ? (
            <span className="inline-flex items-center gap-1 min-w-0">
              <span className="font-mono text-[11.5px] break-all">{t.counterparty}</span>
              {explorer && <a href={explorer} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-ink" title="В эксплорере"><ExternalLink className="w-3 h-3" /></a>}
            </span>
          ) : <span className="text-muted">—</span>}
        </div>
        <div className="text-[11px] text-muted">{[t.network, dtRu(t.ts)].filter(Boolean).join(" · ")}</div>
      </div>
      {hasData ? (
        <span className="shrink-0 inline-flex items-center gap-1 mt-0.5 rounded-[7px] px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ color, background: `${color}14` }}>
          <span className="rounded-full" style={{ width: 5, height: 5, background: color }} /> {cpScore != null ? cpScore : lvl}
        </span>
      ) : (
        <span className="shrink-0 inline-flex items-center mt-0.5 rounded-[7px] px-1.5 py-0.5 text-[10px] text-muted bg-surface-sunk" title="Нет меток контрагента в фиде">н/д</span>
      )}
    </div>
  );
}

function LogFeed() {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [dir, setDir] = useState("all"); // all | in | out
  useEffect(() => {
    let alive = true;
    fetchCryptoLog(200).then(
      (d) => alive && setState({ loading: false, error: null, items: d.items || [] }),
      (e) => alive && setState({ loading: false, error: e?.message || "Ошибка", items: [] })
    );
    return () => { alive = false; };
  }, []);
  const shown = state.items.filter((t) => dir === "all" || t.direction === dir);
  return (
    <div className="bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b-[0.5px] border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Движения · все кошельки</span>
        <div className="flex gap-1">
          {[["all", "Все"], ["in", "Поступления"], ["out", "Отправки"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setDir(k)} className={`px-2 py-0.5 rounded-[7px] text-[11.5px] ${dir === k ? "bg-ink text-white" : "bg-surface-soft text-ink-soft"}`}>{l}</button>
          ))}
        </div>
      </div>
      {state.loading ? (
        <div className="px-3 py-4 text-[13px] text-muted">Загрузка ленты…</div>
      ) : state.error ? (
        <div className="px-3 py-4 text-[13px] text-danger">{state.error}</div>
      ) : shown.length === 0 ? (
        <div className="px-3 py-4 text-[13px] text-muted">Движений нет.</div>
      ) : (
        shown.map((t, i) => <LogRow key={t.txHash || i} t={t} />)
      )}
    </div>
  );
}

export default function CryptoAccountsList({
  items = [],
  offices = [],
  mode = "authed",
  asOf = null,
  onOpenWallet,
  reasonsById = {},
  onRequestReasons,
  shareDetails = false,
  onToggleHidden,
}) {
  const [filter, setFilter] = useState("all");
  const [expandedReason, setExpandedReason] = useState(null);
  const [zeroOpen, setZeroOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const view = useMemo(() => buildCryptoView({ items, offices, filter }), [items, offices, filter]);
  const drillEnabled = (mode === "authed" || (mode === "share" && (shareDetails || SHARE_DRILLDOWN))) && !!onOpenWallet;

  const toggleReason = (id, account) => {
    setExpandedReason((cur) => {
      const next = cur === id ? null : id;
      if (next && account && onRequestReasons && !reasonsById[id]) onRequestReasons(account);
      return next;
    });
  };

  const seg = (key, label, n) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`px-2.5 py-1 rounded-[9px] text-[12px] font-medium whitespace-nowrap transition-colors ${
        filter === key
          ? "bg-ink text-white"
          : "bg-surface border-[0.5px] border-border text-ink-soft hover:text-ink"
      }`}
    >
      {label}{n != null ? ` · ${n}` : ""}
    </button>
  );

  const dShowDelta = Math.abs(view.totals.delta) > 0.005;

  return (
    <div className="bg-bg">
      {/* Шапка */}
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-5">
          <div>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">Счета · Крипто</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-[36px] leading-none text-ink">{usd(view.totals.onchain)}</span>
              <span className="text-[12px] text-muted">он-чейн</span>
            </div>
            <div className="md:hidden text-[13px] mt-1.5">
              <span className="text-muted">учёт <span className="font-mono tabular-nums">{usd(view.totals.ledger)}</span></span>
              {dShowDelta && <span className="text-danger"> · Δ <span className="font-mono tabular-nums">{usd(view.totals.delta)}</span></span>}
            </div>
          </div>
          <div className="hidden md:flex items-stretch gap-5 pt-4">
            <div className="pl-5 border-l-[0.5px] border-border">
              <div className="text-[10.5px] text-muted">учёт</div>
              <div className="font-mono tabular-nums text-[17px] text-ink">{usd(view.totals.ledger)}</div>
            </div>
            {dShowDelta && (
              <div className="pl-5 border-l-[0.5px] border-border">
                <div className="text-[10.5px] text-muted">расхождение</div>
                <div className="font-mono tabular-nums text-[17px] text-danger">Δ {usd(view.totals.delta)}</div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {mode === "share" && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Lock className="w-3 h-3" strokeWidth={2} /> просмотр{asOf ? ` · ${hhmm(asOf)}` : ""}</span>}
          <div className="flex items-center gap-1.5">{seg("all", "Все", view.counts.all)}{seg("ok", "OK", view.counts.ok)}{mode !== "share" && seg("log", "Лог", null)}</div>
          {mode !== "share" && asOf && filter !== "log" && <span className="text-[10.5px] text-muted">обновлено {hhmm(asOf)}</span>}
        </div>
      </div>

      {/* Лог движений (все кошельки) — вместо секций */}
      {filter === "log" && <LogFeed />}

      {/* Секции по офисам */}
      {filter !== "log" && (
      <div className="space-y-4">
        {view.sections.map((s) => (
          <div key={s.office.id}>
            <div className="flex items-end justify-between gap-3 mb-2 px-0.5">
              <span className="text-[15px] font-bold text-ink truncate">{s.office.name}</span>
              <span className="flex items-baseline gap-1.5 shrink-0">
                <span className="font-mono tabular-nums text-[17px] font-semibold text-ink">{usd(s.onchainSum)}</span>
                <span className="text-[11px] text-muted">он-чейн</span>
              </span>
            </div>

            {/* Mobile: единый список в одной карточке офиса */}
            <div className="md:hidden bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
              {s.wallets.map((vm, i) => (
                <MobileRow key={vm.id} vm={vm} mode={mode} expanded={expandedReason === vm.id} onToggleReason={(id) => toggleReason(id, vm.account)} reasons={reasonsById[vm.id]} onOpen={onOpenWallet} drillEnabled={drillEnabled} first={i === 0} onToggleHidden={onToggleHidden} />
              ))}
              {s.zeroWallets.length > 0 && (
                <>
                  <button type="button" onClick={() => setZeroOpen((o) => !o)} className={`w-full text-left px-3 py-2.5 ${s.wallets.length ? "border-t-[0.5px] border-border-soft" : ""}`}>
                    <span className="text-[12px] text-muted border-b border-dashed border-muted-soft">Кошельки с нулём · {s.zeroWallets.length}</span>
                  </button>
                  {zeroOpen && s.zeroWallets.map((vm) => (
                    <MobileRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} first={false} onToggleHidden={onToggleHidden} />
                  ))}
                </>
              )}
              {s.hiddenWallets.length > 0 && (
                <>
                  <button type="button" onClick={() => setHiddenOpen((o) => !o)} className={`w-full text-left px-3 py-2.5 ${s.wallets.length || s.zeroWallets.length ? "border-t-[0.5px] border-border-soft" : ""}`}>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><EyeOff className="w-3.5 h-3.5" /> Скрытые · {s.hiddenWallets.length}</span>
                  </button>
                  {hiddenOpen && s.hiddenWallets.map((vm) => (
                    <MobileRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} first={false} onToggleHidden={onToggleHidden} />
                  ))}
                </>
              )}
            </div>

            {/* Desktop: таблица (table-fixed, общий colgroup → выровнено между офисами) */}
            <div className="hidden md:block bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
              <table className="w-full table-fixed border-collapse">
                <ColGroup />
                <DesktopHead />
                <tbody>
                  {s.wallets.map((vm) => (
                    <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={expandedReason === vm.id} onToggleReason={(id) => toggleReason(id, vm.account)} reasons={reasonsById[vm.id]} onOpen={onOpenWallet} drillEnabled={drillEnabled} onToggleHidden={onToggleHidden} />
                  ))}
                  {s.zeroWallets.length > 0 && (
                    <>
                      <tr className="border-t-[0.5px] border-border-soft">
                        <td colSpan={8} className="px-3 py-2">
                          <button type="button" onClick={() => setZeroOpen((o) => !o)} className="text-[12px] text-muted border-b border-dashed border-muted-soft">Кошельки с нулём · {s.zeroWallets.length}</button>
                        </td>
                      </tr>
                      {zeroOpen && s.zeroWallets.map((vm) => (
                        <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} onToggleHidden={onToggleHidden} />
                      ))}
                    </>
                  )}
                  {s.hiddenWallets.length > 0 && (
                    <>
                      <tr className="border-t-[0.5px] border-border-soft">
                        <td colSpan={8} className="px-3 py-2">
                          <button type="button" onClick={() => setHiddenOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-[12px] text-muted"><EyeOff className="w-3.5 h-3.5" /> Скрытые · {s.hiddenWallets.length}</button>
                        </td>
                      </tr>
                      {hiddenOpen && s.hiddenWallets.map((vm) => (
                        <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} onToggleHidden={onToggleHidden} />
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      )}

      {filter !== "log" && view.emptyOffices.length > 0 && <div className="text-[11px] text-muted-soft text-center mt-4">Без счетов: {view.emptyOffices.join(", ")}</div>}
    </div>
  );
}
