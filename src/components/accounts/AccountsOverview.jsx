// src/components/accounts/AccountsOverview.jsx
// Страница «Счета» по эталону design/accounts-r9.html.
//
// Отличия от эталона — сознательные, согласованы:
//   • Колонки «Смена» нет: бэкенда смен не существует, рисовать «Смена закрыта»
//     у работающих офисов = врать. Слот под неё помечен TODO ниже.
//   • Газ показывается только при наличии собственного поля счёта
//     gasBalanceUsd (AEGIS). channel.gasFee — комиссия сети, не остаток.
//   • Цвета — токены платформы (tailwind.config.js), а не хексы эталона.
//   • Пастельные кружки валют эталона заменены на нейтраль из палитры:
//     новые hex вводить нельзя. Различается только фиат / крипта.
//   • Добавлено сверх эталона: «···» на строке субсчёта и «+ Счёт» в развороте.
//     Без них Add/Пополнить/Корректировка/Изменить/Деактивировать теряют
//     единственную точку входа во всём приложении (жили в AccountsTree).
//
// Приглушение офиса — по нулевому итогу текущего среза, не по смене.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Search,
  MoreHorizontal,
  Upload,
  Download,
  Wallet as WalletIcon,
  Share2,
  ShieldAlert,
  FileSpreadsheet,
  HelpCircle,
  Plus,
  ArrowUpCircle,
  Scale,
  History as HistoryIcon,
  Pencil,
  Trash2,
} from "lucide-react";
import { fmtSpace } from "../../lib/accountsOverview.js";
import { curSymbol } from "../../utils/money.js";

const EXPAND_KEY = "coinplata.accounts.expanded"; // UI-преференс, не бизнес-данные

// Единый grid-template для шапки и строк офиса. Колонки:
// Офис | Наличные | Крипто | Итого ≈$ | шеврон.  «Смена» — TODO(shifts): при
// появлении бэкенда смен вернуть minmax(120px,.9fr) вторым треком и колонку
// в шапку; вёрстка строки под это уже разложена по одному template.
// Брейкпоинт эталона — 1100px (у Tailwind xl = 1280), поэтому arbitrary-variant
// max-[1100px]. Один и тот же класс на шапке и на строках офиса — колонки
// гарантированно совпадают.
const GRID_CLS =
  "grid-cols-[minmax(240px,1.5fr)_110px_110px_120px_40px] " +
  "max-[1100px]:grid-cols-[minmax(0,1.5fr)_120px_40px]";

const MODES = [
  { id: "all", label: "Все" },
  { id: "fiat", label: "Фиат" },
  { id: "crypto", label: "Крипто" },
];

/* ── дропдаун «···» ─────────────────────────────────────────────────── */
function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Ещё"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full border border-surface/20 grid place-items-center text-surface/80 hover:bg-surface/10 transition-colors motion-reduce:transition-none"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[214px] bg-surface text-ink border border-line rounded-card-sm p-1.5 shadow-modal">
          {items.map((it, i) =>
            it.sep ? (
              <div key={`s${i}`} className="h-px bg-line mx-2 my-1.5" />
            ) : (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className="flex w-full items-center gap-2.5 text-left px-3 py-2.5 rounded-[12px] text-body-sm font-medium text-ink-soft hover:bg-cream-2 hover:text-ink transition-colors motion-reduce:transition-none"
              >
                {it.icon}
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ── меню действий на строке субсчёта ───────────────────────────────── */
function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const live = items.filter(Boolean);
  if (live.length === 0) return <span className="w-6 shrink-0" />;
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-label="Действия со счётом"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`w-6 h-6 rounded-full grid place-items-center text-muted hover:bg-cream-2 hover:text-ink transition-opacity motion-reduce:transition-none ${
          open ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"
        }`}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-20 min-w-[190px] bg-surface border border-line rounded-card-sm p-1.5 shadow-modal">
          {live.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick?.();
              }}
              className={`flex w-full items-center gap-2 text-left px-3 py-2 rounded-[10px] text-caption font-medium transition-colors motion-reduce:transition-none ${
                it.danger
                  ? "text-danger hover:bg-danger-soft"
                  : "text-ink-soft hover:bg-cream-2 hover:text-ink"
              }`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── номер счёта леджера ────────────────────────────────────────────── */
// Приходит с сервера (accounts.ledger_account_code). На клиенте не генерится.
// Ссылка-заглушка на будущую карточку счёта с проводками — чтобы потом не
// переделывать строку. Фиксированная ширина держит номера в вертикаль.
// JetBrains выведен из интерфейса → Onest + tnum + лёгкий tracking.
function LedgerCode({ code }) {
  const cls =
    "w-[42px] shrink-0 text-[11px] leading-none tabular-nums tracking-[0.03em] text-muted";
  if (!code) return <span className={cls}>—</span>;
  return (
    <a
      href="#account"
      onClick={(e) => e.preventDefault()}
      // TODO(account-card): роут на карточку счёта с проводками
      title={`Счёт ${code} — карточка с проводками`}
      className={`${cls} hover:text-ink hover:underline underline-offset-2`}
    >
      {code}
    </a>
  );
}

const Circle = ({ children, crypto }) => (
  <span
    className={`w-[25px] h-[25px] shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${
      crypto ? "bg-emerald-100 text-emerald-700" : "bg-cream-2 text-ink-soft"
    }`}
  >
    {children}
  </span>
);

/* ── строки субсчетов ───────────────────────────────────────────────── */
function FiatRow({ row, actions }) {
  const dim = row.isZero;
  return (
    <div className="group/row flex items-center gap-2.5 min-h-9 py-0.5 border-b border-line/60 last:border-b-0">
      <LedgerCode code={row.ledgerCode} />
      <Circle>{row.symbol || row.currency[0]}</Circle>
      <span className="text-[12.5px] font-semibold whitespace-nowrap">{row.currency}</span>
      <span className="flex-1 min-w-0" />
      {/* Родная сумма уходит первой на узком экране: ≈$ важнее для сверки */}
      <span
        className={`tabular-nums text-[12.5px] whitespace-nowrap max-[560px]:hidden ${
          dim ? "text-muted-soft font-normal" : "text-ink-soft"
        }`}
      >
        {fmtSpace(row.native, 2)}
      </span>
      <span
        className={`tabular-nums text-[13px] font-semibold whitespace-nowrap min-w-[62px] text-right ${
          dim ? "text-muted-soft font-normal" : "text-ink"
        }`}
      >
        {fmtSpace(row.usd)}
      </span>
      <RowMenu items={actions} />
    </div>
  );
}

function CryptoRow({ row, actions, onOpen, onCopy }) {
  const dim = row.isZero;
  return (
    <div
      className="group/row flex items-center gap-2.5 min-h-[46px] py-0.5 border-b border-line/60 last:border-b-0"
    >
      <LedgerCode code={row.ledgerCode} />
      <Circle crypto>{row.symbol || "₮"}</Circle>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen?.(row.account)}
          className="block text-[12.5px] font-semibold leading-[1.25] hover:underline underline-offset-2"
        >
          {row.currency}
        </button>
        {/* Одна моно-подстрока: точка-статус · сеть · адрес [· газ].
            Клик по подстроке копирует адрес — отдельной иконки копирования
            в эталоне нет. */}
        <button
          type="button"
          onClick={() => onCopy?.(row.address)}
          title="Скопировать адрес"
          className="flex max-[560px]:items-start items-center gap-1.5 mt-px max-w-full overflow-hidden text-[10.5px] tabular-nums tracking-[0.02em] text-muted whitespace-nowrap text-ellipsis max-[560px]:whitespace-normal max-[560px]:break-all max-[560px]:text-left hover:text-ink-soft transition-colors motion-reduce:transition-none"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              row.problem ? "bg-warning ring-[2.5px] ring-warning/20" : "bg-success"
            }`}
          />
          {[row.network, row.addressShort].filter(Boolean).join(" · ")}
          {row.gasLow != null && (
            <span className="font-semibold text-warning not-italic">
              · газ ${row.gasLow.toFixed(2)}
            </span>
          )}
        </button>
      </div>
      {/* Одно число: USDT ≈ $, не дублируем родную сумму */}
      <span
        className={`tabular-nums text-[13px] font-semibold whitespace-nowrap min-w-[62px] text-right ${
          dim ? "text-muted-soft font-normal" : "text-ink"
        }`}
      >
        {fmtSpace(row.usd)}
      </span>
      <RowMenu items={actions} />
    </div>
  );
}

const SectionLabel = ({ children }) => (
  <div className="flex items-center gap-2.5 text-micro text-muted pt-2.5 pb-1 px-0.5">
    {children}
    <span className="flex-1 h-px bg-line" />
  </div>
);

/* ── карточка офиса ─────────────────────────────────────────────────── */
function OfficeCard({ block, open, onToggle, mode, rowActions, onAddAccount, onOpenWallet, onCopy }) {
  const { office, total, cash, crypto, isZero, subCount, warnCount } = block;
  const numCls = isZero ? "text-muted-soft" : "text-ink-soft";
  const totCls = isZero ? "text-muted-soft font-medium" : "text-ink font-semibold";

  return (
    <div className="bg-surface rounded-2xl mb-1.5 last:mb-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full grid ${GRID_CLS} items-center gap-3.5 max-[1100px]:gap-2 min-h-[54px] px-4 max-[560px]:px-3 py-1.5 text-left hover:bg-cream/40 transition-colors motion-reduce:transition-none`}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold bg-cream-2 text-ink-soft">
            {block.initials}
          </span>
          <span className="min-w-0">
            <span
              className={`block text-[13.5px] font-semibold truncate ${
                isZero ? "text-muted-soft" : "text-ink"
              }`}
            >
              {office.name}
            </span>
            <span className="block text-[11.5px] text-muted whitespace-nowrap">
              {[office.city, `${subCount} субсчетов`].filter(Boolean).join(" · ")}
            </span>
          </span>
          {warnCount > 0 && (
            <span className="inline-flex items-center gap-1 shrink-0 text-micro font-semibold text-warning bg-warning-soft rounded-pill px-2.5 py-1 whitespace-nowrap">
              ⚠ {warnCount} {warnCount === 1 ? "кошелёк" : "кошельков"}
            </span>
          )}
        </span>

        {/* Наличные / Крипто скрываются на узком экране (брейкпоинт эталона ~1100) */}
        <span className={`max-[1100px]:hidden text-right tabular-nums text-[13.5px] whitespace-nowrap min-w-0 ${numCls}`}>
          {mode === "crypto" ? "—" : fmtSpace(cash)}
        </span>
        <span className={`max-[1100px]:hidden text-right tabular-nums text-[13.5px] whitespace-nowrap min-w-0 ${numCls}`}>
          {mode === "fiat" ? "—" : fmtSpace(crypto)}
        </span>
        <span className={`text-right tabular-nums text-[14px] whitespace-nowrap min-w-0 ${totCls}`}>
          {fmtSpace(total)}
        </span>
        <span className="justify-self-end w-7 h-7 rounded-full grid place-items-center bg-cream-2">
          <ChevronDown
            className={`w-3 h-3 transition-transform duration-200 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
            strokeWidth={2.2}
          />
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3.5 pt-0.5">
          <div className="bg-cream rounded-[14px] px-3.5 py-1">
            {block.fiatRows.length === 0 && block.cryptoRows.length === 0 ? (
              <div className="py-3.5 px-0.5 text-[12.5px] text-muted">
                Субсчета пусты — пополните кассу переводом или ОТС сделкой
              </div>
            ) : (
              <>
                {block.fiatRows.length > 0 && (
                  <div>
                    <SectionLabel>Наличные</SectionLabel>
                    {block.fiatRows.map((r) => (
                      <FiatRow key={r.id} row={r} actions={rowActions(r.account)} />
                    ))}
                  </div>
                )}
                {block.cryptoRows.length > 0 && (
                  <div>
                    <SectionLabel>Крипто</SectionLabel>
                    {block.cryptoRows.map((r) => (
                      <CryptoRow
                        key={r.id}
                        row={r}
                        actions={rowActions(r.account)}
                        onOpen={onOpenWallet}
                        onCopy={onCopy}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            {onAddAccount && (
              <div className="py-2 px-0.5">
                <button
                  type="button"
                  onClick={() => onAddAccount(office)}
                  className="inline-flex items-center gap-1.5 text-caption font-semibold text-muted hover:text-ink transition-colors motion-reduce:transition-none"
                >
                  <Plus className="w-3.5 h-3.5" /> Счёт
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── страница ───────────────────────────────────────────────────────── */
export default function AccountsOverview({
  model,
  base = "USD",
  mode,
  onModeChange,
  query,
  onQueryChange,
  sort,
  onSortChange,
  onImportCsv,
  onExportCsv,
  onImportWallets,
  onShare,
  onHelp,
  onAmlOverview,
  onTurnover,
  onAddAccount,
  onTopUp,
  onAdjust,
  onEdit,
  onHistory,
  onDelete,
  onOpenWallet,
}) {
  const sym = curSymbol(base) || "$";
  const { totals, offices, officeCount, subCount } = model;

  const [expanded, setExpanded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(EXPAND_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const toggleOffice = useCallback((id) => {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(EXPAND_KEY, JSON.stringify(next));
      } catch {
        /* приватный режим — состояние просто не переживёт перезагрузку */
      }
      return next;
    });
  }, []);

  const copyAddress = useCallback((addr) => {
    if (addr) navigator.clipboard?.writeText(addr);
  }, []);

  const rowActions = useCallback(
    (account) => [
      onTopUp && { label: "Пополнить", icon: <ArrowUpCircle className="w-3.5 h-3.5" />, onClick: () => onTopUp(account) },
      onAdjust && { label: "Корректировка", icon: <Scale className="w-3.5 h-3.5" />, onClick: () => onAdjust(account) },
      onHistory && { label: "История", icon: <HistoryIcon className="w-3.5 h-3.5" />, onClick: () => onHistory(account) },
      onEdit && { label: "Изменить", icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => onEdit(account) },
      onDelete && { label: "Деактивировать", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => onDelete(account) },
    ],
    [onTopUp, onAdjust, onHistory, onEdit, onDelete]
  );

  const menuItems = [
    { label: "Импорт CSV", icon: <Upload className="w-4 h-4" />, onClick: onImportCsv },
    { label: "Экспорт CSV", icon: <Download className="w-4 h-4" />, onClick: onExportCsv },
    { sep: true },
    { label: "Импорт кошельков", icon: <WalletIcon className="w-4 h-4" />, onClick: onImportWallets },
    { label: "Поделиться", icon: <Share2 className="w-4 h-4" />, onClick: onShare },
    // Справка жила иконкой у заголовка страницы; заголовка в эталоне нет —
    // чтобы не потерять точку входа, пункт переехал сюда.
    ...(onHelp ? [{ label: "Справка по разделу", icon: <HelpCircle className="w-4 h-4" />, onClick: onHelp }] : []),
    // Крипто-инструменты жили на вкладке «Крипто», которой в эталоне нет.
    // Чтобы не потерять точку входа — сюда, только в крипто-срезе.
    ...(mode === "crypto" && (onAmlOverview || onTurnover)
      ? [
          { sep: true },
          onAmlOverview && { label: "AML-обзор", icon: <ShieldAlert className="w-4 h-4" />, onClick: onAmlOverview },
          onTurnover && { label: "Сальдовая ведомость", icon: <FileSpreadsheet className="w-4 h-4" />, onClick: onTurnover },
        ].filter(Boolean)
      : []),
  ];

  const stripLabel =
    mode === "fiat" ? "Наличные по компании" : mode === "crypto" ? "Крипто по компании" : "Всего по компании";

  return (
    <div className="space-y-3.5">
      {/* ── тёмная полоса общего баланса ───────────────────────────── */}
      <section className="bg-dark rounded-[26px] text-surface flex items-center gap-6 px-6 py-[18px] flex-wrap">
        <span className="w-[46px] h-[46px] shrink-0 rounded-full bg-lime text-lime-ink grid place-items-center text-[19px] font-semibold">
          {sym}
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] text-surface/60">{stripLabel}</div>
          <div className="text-[34px] font-semibold tracking-[-0.03em] leading-[1.1] tabular-nums whitespace-nowrap">
            <span className="text-[0.62em] [vertical-align:14%] text-surface/75 mr-px">{sym}</span>
            {fmtSpace(totals.total)}
          </div>
        </div>

        <div className="flex gap-6 pl-6 border-l border-surface/15 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11.5px] text-surface/55 mb-0.5">Наличные</div>
            <div className="text-[16.5px] font-semibold tabular-nums whitespace-nowrap">
              {sym}
              {fmtSpace(totals.cash)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11.5px] text-surface/55 mb-0.5">Крипто</div>
            <div className="text-[16.5px] font-semibold tabular-nums whitespace-nowrap">
              {sym}
              {fmtSpace(totals.crypto)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11.5px] text-surface/55 mb-0.5">За день</div>
            <span className="inline-flex bg-lime text-lime-ink rounded-pill px-3 py-[5px] text-[12.5px] font-semibold whitespace-nowrap tabular-nums">
              {totals.delta < 0 ? "−" : "+"}
              {sym}
              {fmtSpace(Math.abs(totals.delta))}
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[11.5px] text-surface/55 mb-0.5">Вчера</div>
            <span className="inline-flex bg-surface/10 text-surface/75 rounded-pill px-3 py-[5px] text-[12.5px] font-medium whitespace-nowrap tabular-nums">
              {totals.deltaYesterday < 0 ? "−" : "+"}
              {sym}
              {fmtSpace(Math.abs(totals.deltaYesterday))}
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(m.id)}
              aria-pressed={mode === m.id}
              className={`px-4 py-2 rounded-pill transition-colors motion-reduce:transition-none ${
                mode === m.id
                  ? "bg-lime text-lime-ink font-semibold"
                  : "text-surface/70 font-medium hover:bg-surface/10"
              }`}
            >
              {m.label}
            </button>
          ))}
          <MoreMenu items={menuItems} />
        </div>
      </section>

      {/* ── список офисов ──────────────────────────────────────────── */}
      <section className="bg-cream-2 rounded-[26px] p-2">
        <div className="flex items-center gap-3.5 px-4 pt-3 pb-2.5 flex-wrap">
          <div className="text-body font-semibold whitespace-nowrap">
            {officeCount} офисов <span className="text-muted font-medium">· {subCount} субсчетов</span>
          </div>
          <label className="flex-1 max-w-[340px] min-w-[180px] flex items-center gap-2.5 bg-surface border border-line rounded-pill px-4 py-2 text-muted">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Офис, субсчёт или адрес"
              className="w-full bg-transparent border-none outline-none text-body-sm text-ink placeholder:text-muted"
            />
          </label>
          <button
            type="button"
            onClick={() => onSortChange(sort === "total" ? "name" : "total")}
            className="ml-auto text-caption font-medium text-muted hover:text-ink px-3 py-2 rounded-pill hover:bg-cream transition-colors motion-reduce:transition-none whitespace-nowrap"
          >
            {sort === "total" ? "По итогу ↓" : "По названию"}
          </button>
        </div>

        <div className={`grid ${GRID_CLS} max-[1100px]:hidden gap-3.5 px-4 pb-2 pt-1.5 text-micro text-muted`}>
          <div>Офис</div>
          <div className="text-right">Наличные</div>
          <div className="text-right">Крипто</div>
          <div className="text-right">Итого ≈ {sym}</div>
          <div />
        </div>

        {offices.length === 0 ? (
          <div className="px-4 py-8 text-center text-body-sm text-muted">Ничего не найдено</div>
        ) : (
          offices.map((b) => (
            <OfficeCard
              key={b.office.id}
              block={b}
              mode={mode}
              open={!!expanded[b.office.id]}
              onToggle={() => toggleOffice(b.office.id)}
              rowActions={rowActions}
              onAddAccount={onAddAccount}
              onOpenWallet={onOpenWallet}
              onCopy={copyAddress}
            />
          ))
        )}
      </section>

      {/* Поиск и сортировка клиентские: офисов единицы (в проде 7).
          TODO(scale): при >50 офисах — серверный поиск с debounce и пагинация;
          виртуализацию не тянем, новых зависимостей в проекте быть не должно. */}
    </div>
  );
}
