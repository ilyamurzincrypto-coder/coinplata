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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Copy, Check, ChevronRight, X, AlertTriangle, ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff } from "lucide-react";
import { buildCryptoView, DELTA_ALERT_THRESHOLD_USD, SHARE_DRILLDOWN } from "../../../lib/cryptoAccountsView.js";
import { riskBadge } from "../../../utils/accountsRisk.js";
import { plainReasons, hopLabel } from "../../../lib/riskReasons.js";
import { supabase } from "../../../lib/supabase.js";

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

// Склонение счётчика: 1 нулевой · 2 нулевых. Без этого «1 нулевых».
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

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

// Δ в ведомости — красный ТЕКСТ без плашки-бейджа (эталон r6 .wal .dlt).
// Порог «показывать ли» — тот же hasDelta, что и у бейджа: логику расхождения
// не трогаем, меняется только подача.
function DeltaText({ vm }) {
  if (!hasDelta(vm)) return null;
  return (
    <span className="whitespace-nowrap tabular-nums text-[12.5px] text-[#C43A2B]">
      Δ {usd(vm.deltaAbs)}
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

// dotOnly — подача ведомости (r6): всегда цветная ТОЧКА + число, без
// треугольника. Уровни и пороги берутся из существующей риск-логики
// (statusOf → riskBadge), здесь меняется только форма значка.
function StatusDot({ account, onClick, small = false, dotOnly = false }) {
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
      {!dotOnly && (st.tone === "warning" || st.tone === "critical") ? (
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
// Колонки ведомости по эталону r6 (.wal): Кошелёк | Адрес | Риск | Он-чейн |
// Учёт | Δ. Сеть уехала припиской в первую колонку, столбец-стрелка убран —
// клик по строке ведёт туда же, куда вела стрелка.
const DCOLW = ["216px", "auto", "92px", "140px", "104px", "142px"];
const TD = "px-3 border-l border-apps-line-v align-middle";

function ColGroup() {
  return <colgroup>{DCOLW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>;
}

function DesktopHead() {
  return (
    <thead>
      <tr className="text-[11px] font-normal text-apps-muted">
        <th className="text-left font-normal px-3 pb-[9px] pl-0.5 border-b border-apps-line-h whitespace-nowrap">Кошелёк</th>
        <th className={`${TD} text-left font-normal pb-[9px] border-b border-apps-line-h whitespace-nowrap`}>Адрес</th>
        <th className={`${TD} text-left font-normal pb-[9px] border-b border-apps-line-h whitespace-nowrap`}>Риск</th>
        <th className={`${TD} text-right font-normal pb-[9px] border-b border-apps-line-h whitespace-nowrap`}>Он-чейн</th>
        <th className={`${TD} text-right font-normal pb-[9px] border-b border-apps-line-h whitespace-nowrap`}>Учёт</th>
        <th className={`${TD} text-right font-normal pb-[9px] pr-0.5 border-b border-apps-line-h whitespace-nowrap`}>Δ</th>
      </tr>
    </thead>
  );
}

/**
 * Строка-группа офиса. Клик разворачивает нулевые/скрытые ИМЕННО этой группы
 * (раньше состояние было одно на всю страницу — клик в одном офисе раскрывал
 * их во всех). Неактивный офис показывается наравне с прочими, с оранжевой
 * пометкой: по r6 группы строятся по фактическому офису кошелька.
 */
function GroupRow({ name, meta, warn, total, dim = false, onClick }) {
  return (
    <tr>
      <td
        colSpan={6}
        className={`bg-apps-group px-3 py-[9px] ${onClick ? "cursor-pointer hover:brightness-[0.985]" : ""}`}
        onClick={onClick}
      >
        <span className="flex items-baseline gap-3">
          <span className={`text-[13px] ${dim ? "font-normal text-[#A39D8C]" : "font-medium"}`}>{name}</span>
          {meta && <span className="text-[11px] text-apps-muted">{meta}</span>}
          {warn && <span className="text-[11px] text-apps-warn">{warn}</span>}
          {total != null && (
            <span className="ml-auto font-light text-[16px] tabular-nums">
              {usd(total)}
              <small className="text-[11px] text-apps-muted ml-1.5 font-normal">он-чейн</small>
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}

function DesktopRow({ vm, mode, expanded, onToggleReason, reasons, onOpen, drillEnabled, onToggleHidden }) {
  const red = deficitRed(vm);
  return (
    <>
      <tr
        className={`border-t border-apps-line ${vm.account?.hidden ? "opacity-60" : ""} ${expanded ? "bg-[rgba(26,25,21,.04)]" : drillEnabled ? "hover:bg-[rgba(26,25,21,.03)] cursor-pointer" : ""}`}
        onClick={drillEnabled ? () => onOpen?.(vm.account) : undefined}
      >
        <td className="px-3 pl-0.5 align-middle">
          <div className="flex items-center gap-1.5 min-w-0">
            <EyeToggle account={vm.account} onToggle={onToggleHidden} />
            <div className="text-[13px] truncate" title={vm.name}>
              {vm.name}
              {/* Сеть — серой припиской вместо чипа (r6) */}
              {vm.network && <small className="text-[11px] text-apps-muted ml-2">{vm.network}</small>}
            </div>
          </div>
        </td>
        <td className={TD}><CopyAddr address={vm.address} network={null} size={11.5} head={5} tail={4} /></td>
        <td className={TD}><StatusDot account={vm.account} onClick={() => onToggleReason(vm.id)} small dotOnly /></td>
        <td className={`${TD} text-right`}><Amount value={vm.onchain} cls="text-[16px] font-light" minW={0} red={red} /></td>
        {/* Нулевой учёт приглушён — он тут норма, а не сигнал */}
        <td className={`${TD} text-right`}><Amount value={vm.ledger} cls={`text-[12.5px] ${vm.ledger === 0 ? "text-[#A39D8C]" : "text-muted"}`} minW={0} /></td>
        <td className={`${TD} pr-0.5 text-right`}><DeltaText vm={vm} /></td>
      </tr>
      {expanded && mode === "authed" && (
        <tr className="bg-[rgba(26,25,21,.04)] border-t border-apps-line">
          <td colSpan={6} className="px-3 py-2"><div className="max-w-[560px]"><ReasonPanel vm={vm} reasons={reasons} onClose={() => onToggleReason(vm.id)} /></div></td>
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

// Строка ленты платежей (wallet_move_alerts) → форма LogRow. Имя счёта из accountsById;
// нет счёта (нераспознанный офис) → адрес, платёж не теряется.
function mapPayment(r, accountsById) {
  const acc = r.account_id ? accountsById?.[r.account_id] : null;
  const short = r.address ? `${r.address.slice(0, 8)}…${r.address.slice(-6)}` : "";
  return {
    txHash: r.tx_hash,
    direction: r.direction,
    amount: { amount: r.amount_minor, decimals: r.decimals ?? 6 },
    walletName: acc?.name || (r.address ? `Нераспознан · ${short}` : "Нераспознан"),
    counterparty: r.counterparty || null,
    counterpartyType: r.counterparty_label || null, // метка сущности (биржа/приватный/…)
    network: r.network,
    ts: r.ts || r.created_at,
  };
}

const PAY_COLS = "id, account_id, address, network, tx_hash, direction, counterparty, amount_minor, decimals, usd_est, counterparty_label, ts, created_at";

// Лента «Поступления» — реального времени из wallet_move_alerts (ВСЕ офисы/сети),
// новые сверху. Источник — webhook(transfer.detected)+tx-watch, дедуп общий.
function LogFeed({ accountsById }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [dir, setDir] = useState("all"); // all | in | out
  const load = useCallback(async () => {
    if (!supabase) { setState({ loading: false, error: "Не настроено", items: [] }); return; }
    const { data, error } = await supabase
      .from("wallet_move_alerts")
      .select(PAY_COLS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) { setState({ loading: false, error: error.message, items: [] }); return; }
    setState({ loading: false, error: null, items: (data || []).map((r) => mapPayment(r, accountsById)) });
  }, [accountsById]);
  useEffect(() => {
    let alive = true;
    load();
    if (!supabase) return;
    const ch = supabase
      .channel("wma-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wallet_move_alerts" }, () => { if (alive) load(); })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [load]);
  const shown = state.items.filter((t) => dir === "all" || t.direction === dir);
  return (
    <div className="bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b-[0.5px] border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Поступления · все офисы</span>
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

const RISK_COLS = "alert_id, category, network, risk_address, via_counterparty, via_counterparty_name, office_id, office_label, note, source_created_at, created_at, seen";
const shortAddr = (a) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || "");

// Лента «EDD / Риск-находки» — реального времени из aegis_risk_findings (HOP2_RISK).
// Наш контрагент в 1 шаге от грязного адреса → сигнал «проверь контрагента (EDD)».
function RiskFindingsFeed({ officesById }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const load = useCallback(async () => {
    if (!supabase) { setState({ loading: false, error: "Не настроено", items: [] }); return; }
    const { data, error } = await supabase
      .from("aegis_risk_findings")
      .select(RISK_COLS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) { setState({ loading: false, error: error.message, items: [] }); return; }
    setState({ loading: false, error: null, items: data || [] });
  }, []);
  useEffect(() => {
    let alive = true;
    load();
    if (!supabase) return;
    const ch = supabase
      .channel("arf-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "aegis_risk_findings" }, () => { if (alive) load(); })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [load]);
  return (
    <div className="bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b-[0.5px] border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">EDD · связь контрагента с риском (в 1 шаге)</span>
      </div>
      {state.loading ? (
        <div className="px-3 py-4 text-[13px] text-muted">Загрузка…</div>
      ) : state.error ? (
        <div className="px-3 py-4 text-[13px] text-danger">{state.error}</div>
      ) : state.items.length === 0 ? (
        <div className="px-3 py-4 text-[13px] text-muted">Находок нет.</div>
      ) : (
        state.items.map((r) => {
          const officeName = officesById[r.office_id]?.name || r.office_label || "нераспознан";
          const via = r.via_counterparty_name || shortAddr(r.via_counterparty) || "—";
          return (
            <div key={r.alert_id} className="flex items-start gap-2 px-3 py-2.5 border-b-[0.5px] border-border last:border-b-0">
              <span className="text-[15px] leading-none mt-0.5">⚠️</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">
                  Контрагент <span className="font-medium">{via}</span> связан с{" "}
                  <span className="font-semibold text-danger">{r.category || "риском"}</span> <span className="text-muted">(в 1 шаге)</span>
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  Офис <span className="text-ink-soft">{officeName}</span> · грязный адрес <span className="font-mono">{shortAddr(r.risk_address)}</span> · рекомендуется EDD
                </div>
              </div>
              {hhmm && r.created_at && <span className="text-[10.5px] text-muted whitespace-nowrap mt-0.5">{hhmm(r.created_at)}</span>}
            </div>
          );
        })
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
  // Разворот нулевых/скрытых — ПО ОФИСУ. Раньше было два флага на всю
  // страницу: клик в одном офисе раскрывал скрытые сразу во всех.
  const [openGroups, setOpenGroups] = useState({});
  const toggleGroup = useCallback((officeId) => {
    setOpenGroups((m) => ({ ...m, [officeId]: !m[officeId] }));
  }, []);

  const view = useMemo(() => buildCryptoView({ items, offices, filter }), [items, offices, filter]);
  // Карта счёт→имя для ленты поступлений (резолв офиса по account_id в realtime).
  const accountsById = useMemo(() => Object.fromEntries((items || []).map((a) => [a.id, a])), [items]);
  const officesById = useMemo(() => Object.fromEntries((offices || []).map((o) => [o.id, o])), [offices]);
  // Офисы без крипто-счетов — берём с id/active, чтобы отрисовать строкой-группой.
  // Считаем из props, чистую логику buildCryptoView не трогаем.
  const emptyOfficeRows = useMemo(() => {
    const withAccounts = new Set(view.sections.map((s) => s.office.id));
    return (offices || []).filter((o) => !withAccounts.has(o.id));
  }, [offices, view.sections]);

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
      className={`rounded-full px-[15px] py-[7px] text-[12px] whitespace-nowrap transition-colors ${
        filter === key
          ? "bg-ink text-cream"
          : "border border-line-2 text-[#6B675C] hover:text-ink hover:border-muted"
      }`}
    >
      {label}{n != null ? ` · ${n}` : ""}
    </button>
  );

  const dShowDelta = Math.abs(view.totals.delta) > 0.005;

  return (
    <div className="bg-bg">
      {/* Герой (эталон r6 .wal-hero): сумма он-чейн крупным тонким, под ней
          одной строкой учёт · расхождение · обновлено. Три отдельных блока с
          вертикальными разделителями схлопнуты в эту строку. */}
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13px] text-muted mb-1.5">Счета · Крипто · он-чейн</div>
          <div className="font-light tabular-nums text-[40px] leading-none tracking-[-0.01em]">
            {usd(view.totals.onchain)}
          </div>
          <div className="text-[12px] text-[#A39D8C] mt-2">
            учёт <span className="tabular-nums">{usd(view.totals.ledger)}</span>
            {dShowDelta && (
              <> · расхождение <span className="tabular-nums text-[#C43A2B]">Δ {usd(view.totals.delta)}</span></>
            )}
            {asOf && filter !== "log" && <> · обновлено {hhmm(asOf)}</>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {mode === "share" && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Lock className="w-3 h-3" strokeWidth={2} /> просмотр{asOf ? ` · ${hhmm(asOf)}` : ""}</span>}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {seg("all", "Все", view.counts.all)}
            {seg("ok", "ОК", view.counts.ok)}
            {mode !== "share" && seg("log", "Поступления", null)}
            {mode !== "share" && seg("edd", "EDD", null)}
          </div>
        </div>
      </div>

      {/* Лента поступлений (все офисы, реального времени) — вместо секций */}
      {filter === "log" && <LogFeed accountsById={accountsById} />}

      {/* Лента EDD-находок (HOP2_RISK, все офисы, реального времени) */}
      {filter === "edd" && <RiskFindingsFeed officesById={officesById} />}

      {/* ── ВЕДОМОСТЬ: одна таблица на все офисы (эталон r6, Экран 4) ──
          Было: карточка на офис со своей шапкой колонок — 26 кошельков
          растягивались на четыре экрана. Стало: один <table>, офис —
          строка-группа внутри. Mobile (≤768) остаётся карточками. */}
      {filter !== "log" && filter !== "edd" && (
      <>
        {/* Mobile: как было — карточки по офисам */}
        <div className="md:hidden space-y-4">
          {view.sections.map((s) => (
            <div key={s.office.id}>
              <div className="flex items-end justify-between gap-3 mb-2 px-0.5">
                <span className="text-[15px] font-bold text-ink truncate">{s.office.name}</span>
                <span className="flex items-baseline gap-1.5 shrink-0">
                  <span className="font-mono tabular-nums text-[17px] font-semibold text-ink">{usd(s.onchainSum)}</span>
                  <span className="text-[11px] text-muted">он-чейн</span>
                </span>
              </div>
              <div className="bg-surface rounded-[12px] border-[0.5px] border-border overflow-hidden">
                {s.wallets.map((vm, i) => (
                  <MobileRow key={vm.id} vm={vm} mode={mode} expanded={expandedReason === vm.id} onToggleReason={(id) => toggleReason(id, vm.account)} reasons={reasonsById[vm.id]} onOpen={onOpenWallet} drillEnabled={drillEnabled} first={i === 0} onToggleHidden={onToggleHidden} />
                ))}
                {s.zeroWallets.length > 0 && (
                  <>
                    <button type="button" onClick={() => toggleGroup(s.office.id)} className={`w-full text-left px-3 py-2.5 ${s.wallets.length ? "border-t-[0.5px] border-border-soft" : ""}`}>
                      <span className="text-[12px] text-muted border-b border-dashed border-muted-soft">Кошельки с нулём · {s.zeroWallets.length}</span>
                    </button>
                    {openGroups[s.office.id] && s.zeroWallets.map((vm) => (
                      <MobileRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} first={false} onToggleHidden={onToggleHidden} />
                    ))}
                  </>
                )}
                {s.hiddenWallets.length > 0 && (
                  <>
                    <button type="button" onClick={() => toggleGroup(s.office.id)} className={`w-full text-left px-3 py-2.5 ${s.wallets.length || s.zeroWallets.length ? "border-t-[0.5px] border-border-soft" : ""}`}>
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><EyeOff className="w-3.5 h-3.5" /> Скрытые · {s.hiddenWallets.length}</span>
                    </button>
                    {openGroups[s.office.id] && s.hiddenWallets.map((vm) => (
                      <MobileRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} first={false} onToggleHidden={onToggleHidden} />
                    ))}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: ОДНА таблица */}
        <div className="hidden md:block bg-surface-apps rounded-[24px] px-5 py-[18px]">
          <table className="w-full table-fixed border-collapse">
            <ColGroup />
            <DesktopHead />
            <tbody>
              {view.sections.map((s) => {
                const extra = [
                  s.zeroWallets.length ? `${s.zeroWallets.length} ${plural(s.zeroWallets.length, "нулевой", "нулевых", "нулевых")}` : null,
                  s.hiddenWallets.length ? `${s.hiddenWallets.length} скрытых` : null,
                ].filter(Boolean).join(" · ");
                const collapsible = s.zeroWallets.length + s.hiddenWallets.length > 0;
                const open = !!openGroups[s.office.id];
                return (
                  <React.Fragment key={s.office.id}>
                    <GroupRow
                      name={s.office.name}
                      meta={extra || null}
                      warn={s.office.active === false ? "офис неактивен · кошельки вне городов" : null}
                      total={s.onchainSum}
                      onClick={collapsible ? () => toggleGroup(s.office.id) : undefined}
                    />
                    {s.wallets.map((vm) => (
                      <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={expandedReason === vm.id} onToggleReason={(id) => toggleReason(id, vm.account)} reasons={reasonsById[vm.id]} onOpen={onOpenWallet} drillEnabled={drillEnabled} onToggleHidden={onToggleHidden} />
                    ))}
                    {open && s.zeroWallets.map((vm) => (
                      <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} onToggleHidden={onToggleHidden} />
                    ))}
                    {open && s.hiddenWallets.map((vm) => (
                      <DesktopRow key={vm.id} vm={vm} mode={mode} expanded={false} onToggleReason={() => {}} onOpen={onOpenWallet} drillEnabled={drillEnabled} onToggleHidden={onToggleHidden} />
                    ))}
                  </React.Fragment>
                );
              })}

              {/* Офисы без крипто-счетов — приглушённой строкой-группой, а не
                  строчкой текста в пустоте под таблицей (r6). */}
              {emptyOfficeRows.map((o) => (
                <GroupRow key={o.id} name={o.name} meta="счетов нет" dim />
              ))}
            </tbody>
          </table>

          <div className="flex justify-between items-center mt-[11px] text-[11px] text-apps-muted">
            <span>{view.counts.all} кошельков · {view.sections.length} офисов · нулевые и скрытые разворачиваются кликом по офису</span>
            <span>адрес полностью — по клику · копирование ⧉</span>
          </div>
        </div>
      </>
      )}


      {/* Строка «Без счетов: …» убрана: офисы без крипто-счетов теперь
          показываются приглушёнными строками-группами внутри таблицы (r6). */}
    </div>
  );
}
