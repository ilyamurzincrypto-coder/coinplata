// src/components/accounts/crypto/CryptoAccountsList.jsx
// Редизайн «Счета · Крипто» — список (Экран 1 mobile-карточки + Экран 2 desktop-
// таблица). Общий для authed-кассы и публичной share-страницы (mode).
// Логика — cryptoAccountsView (чистая, протестирована). Токены кассы: off-white
// bg, emerald ok / warning / danger, font-mono для сумм и адресов, хайрлайны 0.5px.
import React, { useMemo, useState } from "react";
import { Lock, Copy, Check, ChevronRight, X, AlertTriangle, ArrowDownUp, Wallet } from "lucide-react";
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

// tone → цвета точки/слова статуса и тонировки аватара
const STATUS = {
  ok: { color: "#10B981", tile: "bg-surface-sunk", text: "text-success" },
  warning: { color: "#B45309", tile: "bg-warning-soft", text: "text-warning" },
  critical: { color: "#B91C1C", tile: "bg-danger-soft", text: "text-danger" },
  muted: { color: "#B5B9BF", tile: "bg-surface-sunk", text: "text-muted" },
};

function CopyAddr({ address, network }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {}
    );
  };
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="font-mono text-[12px] text-ink-soft truncate" title={address}>
        {midTruncate(address)}
      </span>
      <button type="button" onClick={copy} title="Скопировать адрес" className="shrink-0 text-muted hover:text-ink">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {network && (
        <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide text-muted bg-surface-soft rounded-[6px] px-1.5 py-0.5">
          {network}
        </span>
      )}
    </span>
  );
}

// Плашка причины риска (тонированная, крестик). Показывается по тапу на статус.
function ReasonPanel({ vm, reasons, onClose }) {
  const tone = vm.riskLevel === "critical" ? "danger" : "warning";
  const bg = tone === "danger" ? "bg-danger-soft" : "bg-warning-soft";
  const discLine =
    vm.hasOnchain && vm.deltaAbs > 0
      ? `Учёт расходится с он-чейном на ${usd(vm.deltaAbs)}.`
      : null;
  const msgs = (reasons || []).map((r) => (typeof r === "string" ? r : r?.message)).filter(Boolean);
  return (
    <div className={`${bg} rounded-[10px] px-3 py-2.5 mt-2 relative`}>
      <button type="button" onClick={onClose} className="absolute top-2 right-2 text-muted hover:text-ink" title="Закрыть">
        <X className="w-3.5 h-3.5" />
      </button>
      <ul className="space-y-1 pr-5">
        {msgs.length === 0 && !discLine && (
          <li className="text-[12px] text-ink-soft">Причина по кошельку подгружается в деталях кошелька.</li>
        )}
        {msgs.map((m, i) => (
          <li key={i} className="text-[12px] text-ink-soft leading-snug">
            • {m}
          </li>
        ))}
        {discLine && <li className="text-[12px] font-medium text-ink leading-snug">{discLine}</li>}
      </ul>
    </div>
  );
}

// Одна карточка кошелька (mobile).
function WalletCard({ vm, mode, asOf, expanded, onToggleReason, reasons, onOpen }) {
  const b = riskBadge(vm.account) || { tone: "muted", label: "нет данных" };
  const st = STATUS[b.tone] || STATUS.muted;
  const isProblem = vm.category === "problem";
  const discRed = vm.hasOnchain && vm.deltaAbs > DELTA_ALERT_THRESHOLD_USD;
  // drill-down только authed (или share при SHARE_DRILLDOWN) И когда обработчик передан.
  const drillEnabled = (mode === "authed" || (mode === "share" && SHARE_DRILLDOWN)) && !!onOpen;
  const clickable = drillEnabled;

  if (!isProblem) {
    // OK-карточка — одна строка
    return (
      <div
        className={`flex items-center gap-2.5 px-3 py-2.5 ${clickable ? "cursor-pointer hover:bg-surface-soft" : ""}`}
        onClick={clickable ? () => onOpen?.(vm.account) : undefined}
      >
        <span className={`grid place-items-center w-[34px] h-[34px] rounded-[10px] ${st.tile} shrink-0`}>
          <Wallet className="w-4 h-4 text-muted" strokeWidth={1.8} />
        </span>
        <span className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className="text-[14px] font-medium text-ink truncate">{vm.name}</span>
          <CopyAddr address={vm.address} network={vm.network} />
        </span>
        <span className="flex flex-col items-end shrink-0">
          <span className="font-mono text-[16px] text-ink">{vm.hasOnchain ? usd(vm.onchain) : "—"}</span>
          <span className="text-[10px] text-success font-medium">● = учёт</span>
        </span>
        {clickable && <ChevronRight className="w-4 h-4 text-muted-soft shrink-0" />}
      </div>
    );
  }

  // Проблемная карточка
  return (
    <div className="border-[0.5px] border-border rounded-[16px] overflow-hidden">
      <div className="px-3 pt-3 pb-2.5">
        {/* ряд 1: аватар + имя + статус */}
        <div className="flex items-center gap-2.5">
          <span className={`grid place-items-center w-[38px] h-[38px] rounded-[11px] ${st.tile} shrink-0`}>
            <Wallet className="w-[18px] h-[18px]" style={{ color: st.color }} strokeWidth={1.8} />
          </span>
          <span className="text-[15px] font-medium text-ink truncate flex-1">{vm.name}</span>
          <button
            type="button"
            onClick={() => onToggleReason(vm.id)}
            className={`inline-flex items-center gap-1.5 shrink-0 ${st.text}`}
            title="Показать причину"
          >
            <span className="w-[7px] h-[7px] rounded-full" style={{ background: st.color }} />
            <span className="text-[12.5px] font-medium">{b.label}</span>
          </button>
        </div>
        {/* ряд 2: адрес + сеть */}
        <div className="mt-2 pl-[48px]">
          <CopyAddr address={vm.address} network={vm.network} />
        </div>
        {/* ряд 3: он-чейн крупно + учёт */}
        <div className="mt-2.5 pl-[48px] flex items-end justify-between gap-2">
          <span className="flex flex-col">
            <span
              className="font-mono text-[30px] leading-none"
              style={{ color: discRed ? "#B91C1C" : "#131416" }}
            >
              {vm.hasOnchain ? usd(vm.onchain) : "—"}
            </span>
            <span className="text-[10.5px] text-muted mt-1">он-чейн сейчас</span>
          </span>
          <span className="text-[12px] text-muted font-mono text-right">
            {usd(vm.ledger)} <span className="text-muted-soft">/ в учёте</span>
          </span>
        </div>
        {/* причина (скрыта до тапа); на share недоступна */}
        {expanded && mode === "authed" && (
          <div className="pl-[48px]">
            <ReasonPanel vm={vm} reasons={reasons} onClose={() => onToggleReason(vm.id)} />
          </div>
        )}
      </div>
      {/* футер «Движения» — только authed с активным drill-down (Screen 3) */}
      {drillEnabled && (
        <button
          type="button"
          onClick={() => onOpen?.(vm.account)}
          className="w-full flex items-center justify-between px-3 py-2 border-t-[0.5px] border-border-soft text-[12.5px] text-ink-soft hover:bg-surface-soft"
        >
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownUp className="w-3.5 h-3.5 text-muted" /> Движения и контрагенты
          </span>
          <ChevronRight className="w-4 h-4 text-muted-soft" />
        </button>
      )}
    </div>
  );
}

export default function CryptoAccountsList({
  items = [],
  offices = [],
  mode = "authed", // 'authed' | 'share'
  asOf = null,
  onOpenWallet,
  reasonsById = {}, // { accountId: [{code,message}] } — подгружаемые причины (authed)
  onRequestReasons, // (account) => void — попросить подгрузить причины
}) {
  const [filter, setFilter] = useState("all");
  const [expandedReason, setExpandedReason] = useState(null); // wallet id
  const [zeroOpen, setZeroOpen] = useState(false);

  const view = useMemo(() => buildCryptoView({ items, offices, filter }), [items, offices, filter]);

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
      className={`px-3 py-1.5 rounded-[10px] text-[12.5px] font-medium whitespace-nowrap transition-colors ${
        filter === key ? "bg-ink text-white" : "bg-surface-soft text-ink-soft hover:text-ink"
      }`}
    >
      {label} · {n}
    </button>
  );

  return (
    <div className="bg-bg">
      {/* Шапка */}
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">Счета · Крипто</span>
          {mode === "share" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <Lock className="w-3 h-3" strokeWidth={2} /> просмотр{asOf ? ` · ${hhmm(asOf)}` : ""}
            </span>
          )}
        </div>
        <div className="mt-1.5">
          <div className="font-mono text-[36px] leading-none text-ink">{usd(view.totals.onchain)}</div>
          <div className="text-[11px] text-muted mt-1">он-чейн</div>
          <div className="text-[12.5px] mt-1.5 font-mono">
            <span className="text-muted">учёт {usd(view.totals.ledger)}</span>
            {Math.abs(view.totals.delta) > 0.005 && (
              <span className="text-danger"> · Δ {usd(view.totals.delta)}</span>
            )}
          </div>
        </div>
        {/* Сегменты */}
        <div className="flex items-center gap-1.5 mt-3 overflow-x-auto">
          {seg("all", "Все", view.counts.all)}
          {seg("attention", "Внимание", view.counts.attention)}
          {seg("ok", "OK", view.counts.ok)}
        </div>
      </div>

      {/* Секции по офисам */}
      <div className="space-y-4">
        {view.sections.map((s) => (
          <div key={s.office.id}>
            <div className="flex items-baseline justify-between gap-2 mb-1.5 px-0.5">
              <span className="text-[12px] font-semibold text-ink-soft truncate">{s.office.name}</span>
              <span className="flex-1 border-b-[0.5px] border-border mx-2 translate-y-[-3px]" />
              <span className="font-mono text-[12.5px] text-ink shrink-0">{usd(s.onchainSum)}</span>
            </div>
            <div className="bg-surface rounded-[14px] border-[0.5px] border-border overflow-hidden divide-y-[0.5px] divide-border-soft">
              {s.wallets.map((vm) => (
                <div key={vm.id} className="p-1.5">
                  <WalletCard
                    vm={vm}
                    mode={mode}
                    asOf={asOf}
                    expanded={expandedReason === vm.id}
                    onToggleReason={(id) => toggleReason(id, vm.account)}
                    reasons={reasonsById[vm.id]}
                    onOpen={onOpenWallet}
                  />
                </div>
              ))}
              {/* Нулёвки — свёрнуто */}
              {s.zeroWallets.length > 0 && (
                <div className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setZeroOpen((o) => !o)}
                    className="text-[12px] text-muted border-b border-dashed border-muted-soft"
                  >
                    Кошельки с нулём · {s.zeroWallets.length}
                  </button>
                  {zeroOpen &&
                    s.zeroWallets.map((vm) => (
                      <WalletCard
                        key={vm.id}
                        vm={vm}
                        mode={mode}
                        asOf={asOf}
                        expanded={false}
                        onToggleReason={() => {}}
                        onOpen={onOpenWallet}
                      />
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {view.emptyOffices.length > 0 && (
        <div className="text-[11px] text-muted-soft text-center mt-4">
          Без счетов: {view.emptyOffices.join(", ")}
        </div>
      )}
    </div>
  );
}
