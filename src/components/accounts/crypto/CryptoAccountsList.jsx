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
import React, { useMemo, useState } from "react";
import { Lock, Copy, Check, ChevronRight, X, ArrowDownUp, Wallet } from "lucide-react";
import { buildCryptoView, DELTA_ALERT_THRESHOLD_USD, SHARE_DRILLDOWN } from "../../../lib/cryptoAccountsView.js";
import { riskBadge } from "../../../utils/accountsRisk.js";

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
  return { ...(STATUS[b.tone] || STATUS.muted), label: b.label, tone: b.tone };
};
const hasDelta = (vm) => vm.hasOnchain && vm.deltaAbs > DELTA_ALERT_THRESHOLD_USD;

// Сумма в фикс-контейнере (mono, tabular) — обновление не двигает соседей.
// null он-чейн → skeleton фикс-размера (нет данных/грузится).
function Amount({ value, cls = "", minW = 88, red = false }) {
  return (
    <span className={`inline-block text-right font-mono tabular-nums ${cls}`} style={{ minWidth: minW, color: red ? "#B91C1C" : undefined }}>
      {value == null ? <span className="inline-block rounded bg-surface-soft align-middle" style={{ width: minW - 16, height: "0.78em" }} /> : usd(value)}
    </span>
  );
}

// Δ-бейдж (расхождение). Слот зарезервирован даже когда Δ нет — no-CLS.
function DeltaBadge({ vm, minW = 96 }) {
  const show = hasDelta(vm);
  return (
    <span className="inline-flex justify-end" style={{ minWidth: minW }}>
      {show ? (
        <span className="inline-flex items-center rounded-[7px] bg-danger-soft text-danger font-mono tabular-nums text-[11.5px] px-1.5 py-0.5">
          Δ {usd(vm.deltaAbs)}
        </span>
      ) : null}
    </span>
  );
}

function StatusDot({ account, onClick, small = false }) {
  const st = statusOf(account);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      className={`inline-flex items-center gap-1.5 shrink-0 ${st.text} ${onClick ? "hover:opacity-80" : ""}`}
      title={onClick ? "Показать причину" : undefined}
    >
      <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: st.color }} />
      <span className={small ? "text-[12px] font-medium" : "text-[12.5px] font-medium"}>{st.label}</span>
    </Tag>
  );
}

function CopyAddr({ address, network, size = 12 }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {});
  };
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="font-mono text-ink-soft truncate" style={{ fontSize: size }} title={address}>{midTruncate(address)}</span>
      <button type="button" onClick={copy} title="Скопировать адрес" className="shrink-0 text-muted hover:text-ink">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {network && (
        <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{network}</span>
      )}
    </span>
  );
}

function ReasonPanel({ vm, reasons, onClose }) {
  const tone = vm.riskLevel === "critical" ? "danger" : "warning";
  const bg = tone === "danger" ? "bg-danger-soft" : "bg-warning-soft";
  const discLine = vm.hasOnchain && vm.deltaAbs > 0 ? `Учёт расходится с он-чейном на ${usd(vm.deltaAbs)}.` : null;
  const msgs = (reasons || []).map((r) => (typeof r === "string" ? r : r?.message)).filter(Boolean);
  return (
    <div className={`${bg} rounded-[10px] px-3 py-2.5 relative`}>
      <button type="button" onClick={onClose} className="absolute top-2 right-2 text-muted hover:text-ink" title="Закрыть"><X className="w-3.5 h-3.5" /></button>
      <ul className="space-y-1 pr-5">
        {msgs.length === 0 && !discLine && <li className="text-[12px] text-ink-soft">Причина по кошельку — в деталях кошелька.</li>}
        {msgs.map((m, i) => <li key={i} className="text-[12px] text-ink-soft leading-snug">• {m}</li>)}
        {discLine && <li className="text-[12px] font-medium text-ink leading-snug">{discLine}</li>}
      </ul>
    </div>
  );
}

// ─── Mobile: карточка ───
function MobileCard({ vm, mode, expanded, onToggleReason, reasons, onOpen, drillEnabled }) {
  const st = statusOf(vm.account);
  const red = hasDelta(vm);
  if (vm.category !== "problem") {
    return (
      <div
        className={`flex items-center gap-2.5 px-3 min-h-[52px] ${drillEnabled ? "cursor-pointer hover:bg-surface-soft" : ""}`}
        onClick={drillEnabled ? () => onOpen?.(vm.account) : undefined}
      >
        <span className={`grid place-items-center w-[34px] h-[34px] rounded-[10px] ${st.tile} shrink-0`}><Wallet className="w-4 h-4 text-muted" strokeWidth={1.8} /></span>
        <span className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className="text-[14px] text-ink truncate">{vm.name}</span>
          <CopyAddr address={vm.address} network={vm.network} />
        </span>
        <span className="flex flex-col items-end shrink-0">
          <Amount value={vm.onchain} cls="text-[15px] text-ink" minW={84} />
          <span className="text-[10px] text-success">● = учёт</span>
        </span>
        {drillEnabled && <ChevronRight className="w-4 h-4 text-muted-soft shrink-0" />}
      </div>
    );
  }
  return (
    <div className="border-[0.5px] border-border rounded-[14px] overflow-hidden">
      <div className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`grid place-items-center w-[36px] h-[36px] rounded-[11px] ${st.tile} shrink-0`}><Wallet className="w-[17px] h-[17px]" style={{ color: st.color }} strokeWidth={1.8} /></span>
          <span className="text-[15px] text-ink truncate flex-1">{vm.name}</span>
          <StatusDot account={vm.account} onClick={() => onToggleReason(vm.id)} />
        </div>
        <div className="mt-2 pl-[46px]"><CopyAddr address={vm.address} network={vm.network} /></div>
        <div className="mt-2.5 pl-[46px] flex items-end justify-between gap-2 min-h-[40px]">
          <span className="flex flex-col">
            <Amount value={vm.onchain} cls="text-[22px] leading-none text-ink" minW={100} red={red} />
            <span className="text-[11px] text-muted mt-1">он-чейн сейчас</span>
          </span>
          <span className="flex flex-col items-end gap-1">
            <DeltaBadge vm={vm} minW={92} />
            <span className="text-[12px] text-muted"><span className="font-mono tabular-nums">{usd(vm.ledger)}</span> в учёте</span>
          </span>
        </div>
        {expanded && mode === "authed" && <div className="mt-2 pl-[46px]"><ReasonPanel vm={vm} reasons={reasons} onClose={() => onToggleReason(vm.id)} /></div>}
      </div>
      {drillEnabled && (
        <button type="button" onClick={() => onOpen?.(vm.account)} className="w-full flex items-center justify-between px-3 py-2 border-t-[0.5px] border-border-soft text-[12.5px] text-ink-soft hover:bg-surface-soft">
          <span className="inline-flex items-center gap-1.5"><ArrowDownUp className="w-3.5 h-3.5 text-muted" /> Движения и контрагенты</span>
          <ChevronRight className="w-4 h-4 text-muted-soft" />
        </button>
      )}
    </div>
  );
}

// ─── Desktop: строка таблицы ───
const DCOLS = "grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_150px_120px_110px_112px_20px]";
function DesktopRow({ vm, mode, expanded, onToggleReason, reasons, onOpen, drillEnabled }) {
  const red = hasDelta(vm);
  return (
    <>
      <div
        className={`grid ${DCOLS} items-center gap-2 px-3 min-h-[46px] border-t-[0.5px] border-border-soft ${expanded ? "bg-surface-soft" : drillEnabled ? "hover:bg-surface-soft cursor-pointer" : ""}`}
        onClick={drillEnabled ? () => onOpen?.(vm.account) : undefined}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] text-ink truncate">{vm.name}</span>
          {vm.network && <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">{vm.network}</span>}
        </span>
        <span className="min-w-0"><CopyAddr address={vm.address} network={null} size={12} /></span>
        <StatusDot account={vm.account} onClick={() => onToggleReason(vm.id)} small />
        <Amount value={vm.onchain} cls="text-[15px] font-medium text-ink w-full" minW={88} red={red} />
        <Amount value={vm.ledger} cls="text-[13px] text-muted w-full" minW={80} />
        <DeltaBadge vm={vm} minW={104} />
        {drillEnabled ? <ChevronRight className="w-4 h-4 text-muted-soft" /> : <span />}
      </div>
      {expanded && mode === "authed" && (
        <div className="px-3 py-2 border-t-[0.5px] border-border-soft bg-surface-soft"><div className="max-w-[560px]"><ReasonPanel vm={vm} reasons={reasons} onClose={() => onToggleReason(vm.id)} /></div></div>
      )}
    </>
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
}) {
  const [filter, setFilter] = useState("all");
  const [expandedReason, setExpandedReason] = useState(null);
  const [zeroOpen, setZeroOpen] = useState(false);

  const view = useMemo(() => buildCryptoView({ items, offices, filter }), [items, offices, filter]);
  const drillEnabled = (mode === "authed" || (mode === "share" && SHARE_DRILLDOWN)) && !!onOpenWallet;

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
      className={`px-2.5 py-1 rounded-[9px] text-[12px] font-medium whitespace-nowrap transition-colors ${filter === key ? "bg-ink text-white" : "bg-surface-soft text-ink-soft hover:text-ink"}`}
    >
      {label} · {n}
    </button>
  );

  const dShowDelta = Math.abs(view.totals.delta) > 0.005;

  return (
    <div className="bg-bg">
      {/* Шапка */}
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">Счета · Крипто</span>
          <div className="mt-1 font-mono tabular-nums text-[28px] leading-none text-ink">{usd(view.totals.onchain)}</div>
          <div className="text-[13px] mt-1.5">
            <span className="text-muted">он-чейн</span>
            <span className="text-muted"> · учёт <span className="font-mono tabular-nums">{usd(view.totals.ledger)}</span></span>
            {dShowDelta && <span className="text-danger"> · Δ <span className="font-mono tabular-nums">{usd(view.totals.delta)}</span></span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {mode === "share" && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Lock className="w-3 h-3" strokeWidth={2} /> просмотр{asOf ? ` · ${hhmm(asOf)}` : ""}</span>}
          <div className="flex items-center gap-1.5">{seg("all", "Все", view.counts.all)}{seg("attention", "Внимание", view.counts.attention)}{seg("ok", "OK", view.counts.ok)}</div>
          {filter === "attention" && (
            <span className="text-[10.5px] text-muted text-right max-w-[220px]">статус ≠ OK или расхождение учёта с он-чейном</span>
          )}
        </div>
      </div>

      {/* Секции по офисам */}
      <div className="space-y-4">
        {view.sections.map((s) => (
          <div key={s.office.id}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5 px-0.5">
              <span className="text-[12px] font-semibold text-ink-soft truncate">{s.office.name}</span>
              <span className="flex-1 border-b-[0.5px] border-border mx-2 translate-y-[-3px]" />
              <span className="font-mono tabular-nums text-[12.5px] text-ink shrink-0">{usd(s.onchainSum)}</span>
            </div>

            {/* Mobile: карточки */}
            <div className="md:hidden space-y-2">
              {s.wallets.map((vm) => (
                <MobileCard key={vm.id} vm={vm} mode={mode} expanded={expandedReason === vm.id} onToggleReason={(id) => toggleReason(id, vm.account)} reasons={reasonsById[vm.id]} onOpen={onOpenWallet} drillEnabled={drillEnabled} />
              ))}
            </div>

            {/* Desktop: таблица */}
            <div className="hidden md:block bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
              <div className={`grid ${DCOLS} items-center gap-2 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted`}>
                <span>Кошелёк</span><span>Адрес</span><span>Статус</span>
                <span className="text-right">Он-чейн</span><span className="text-right">Учёт</span><span className="text-right">Δ</span><span />
              </div>
              {s.wallets.map((vm) => (
                <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={expandedReason === vm.id} onToggleReason={(id) => toggleReason(id, vm.account)} reasons={reasonsById[vm.id]} onOpen={onOpenWallet} drillEnabled={drillEnabled} />
              ))}
              {s.zeroWallets.length > 0 && (
                <div className="border-t-[0.5px] border-border-soft px-3 py-2">
                  <button type="button" onClick={() => setZeroOpen((o) => !o)} className="text-[12px] text-muted border-b border-dashed border-muted-soft">Кошельки с нулём · {s.zeroWallets.length}</button>
                  {zeroOpen && s.zeroWallets.map((vm) => <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} />)}
                </div>
              )}
            </div>

            {/* Нулёвки — mobile */}
            {s.zeroWallets.length > 0 && (
              <div className="md:hidden mt-2">
                <button type="button" onClick={() => setZeroOpen((o) => !o)} className="text-[12px] text-muted border-b border-dashed border-muted-soft">Кошельки с нулём · {s.zeroWallets.length}</button>
                {zeroOpen && <div className="space-y-2 mt-2">{s.zeroWallets.map((vm) => <MobileCard key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} />)}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {view.emptyOffices.length > 0 && <div className="text-[11px] text-muted-soft text-center mt-4">Без счетов: {view.emptyOffices.join(", ")}</div>}
    </div>
  );
}
