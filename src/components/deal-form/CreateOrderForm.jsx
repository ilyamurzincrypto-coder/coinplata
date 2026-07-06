// src/components/deal-form/CreateOrderForm.jsx
//
// «Новый ордер» — единая форма-конструктор с чипсетом из 5 типов операции:
//   Обмен · Приход · Расход · Перемещение · ОТС
//
// Реализация по макету docs/create-order.html, но ВСЕ данные — из живых
// сторов (rates / accounts / categories / offices / currencies), ничего из
// макета не хардкодится.
//
// Контракт:
//   • Обмен и ОТС → onSubmit(payload). Payload собирается 1-в-1 как в
//     NewDealForm.handleSubmit (см. buildExchangePayload ниже) — родитель
//     дальше зовёт существующий createDeal(payload).
//   • Перемещение → компонент сам зовёт createTransfer() через withToast и
//     onCancel() при успехе. Кросс-валютное перемещение не поддержано
//     (счета фильтруются по одной валюте → from/to всегда совпадают).
//   • Приход / Расход → UI готов, но создание проводки — TODO (нет
//     операционных GL-счетов доход/расход по валютам). Кнопка показывает alert.
//
// Панель курсов слева (RatesSidebar) видна только в Обмене/ОТС; на остальных
// типах уезжает (flex-basis→0 + fade + сдвиг).

import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useRates } from "../../store/rates.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useCategories } from "../../store/categories.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { multiplyAmount } from "../../utils/money.js";
import { displayRate, formatRate, formatRateCompact } from "../../lib/rates.js";
import { createTransfer } from "../../lib/dealOperations.js";
import { rpcCreateManualEntryV2 } from "../../lib/newLedger.js";
import { resolveAccountCode } from "../../lib/newLedgerAdapter.js";
import { supabase } from "../../lib/supabase.js";
import { withToast } from "../../lib/supabaseWrite.js";
import RatesSidebar from "../RatesSidebar.jsx";
import CounterpartyPicker from "../cashier/ledger/CounterpartyPicker.jsx";

// ── Токены из макета (кассовая палитра) ─────────────────────────────────
const C = {
  bg: "#fff",
  page: "#f6f7f5",
  line: "rgba(18,22,26,.08)",
  line2: "rgba(18,22,26,.14)",
  text: "#15191d",
  muted: "#616873",
  faint: "#9aa0a8",
  faint2: "#c4c9cf",
  accent: "#0c9c6b",
  accentD: "#0a865c",
  pos: "#0a8f5f",
  neg: "#ce463d",
  amber: "#a9781a",
  recess: "#f4f6f4",
};

const PREFERRED_ORDER = ["USDT", "USD", "EUR", "TRY", "RUB", "GBP", "CHF"];

// ── Числа ────────────────────────────────────────────────────────────────
const pn = (s) => {
  const v = parseFloat(String(s == null ? "" : s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};
const dpOf = (v) => (Math.abs(v) > 0 && Math.abs(v) < 2 ? 4 : 2);
const grp = (n, dp) =>
  Number(n).toLocaleString("ru-RU", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

// Число с приглушёнными хвостовыми нулями (как Money в DealsLedger).
function Money({ value, dp }) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) {
    return <span style={{ color: C.faint2 }}>—</span>;
  }
  const d = dp != null ? dp : dpOf(Number(value));
  const s = grp(Number(value), d);
  const m = s.match(/^(.*?)(,\d*?)(0+)$/);
  if (m) {
    return (
      <>
        {m[1] + m[2]}
        <span style={{ color: C.faint2 }}>{m[3]}</span>
      </>
    );
  }
  return <>{s}</>;
}

// ── Дата/время ─────────────────────────────────────────────────────────
const MONF = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const pad = (n) => String(n).padStart(2, "0");

// value: 'now' | Date. → ISO string для payload.
function dtToIso(value) {
  if (value === "now" || value == null) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const CalIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </svg>
);

// Переиспользуемый выбор даты/времени: календарь + время, дефолт «Сейчас».
function DateTimePicker({ value, onChange, small }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const anchorRef = useRef(null);
  const popRef = useRef(null);

  const now = new Date();
  const initSel = () => {
    const base = value instanceof Date ? value : now;
    return {
      y: base.getFullYear(),
      m: base.getMonth(),
      d: base.getDate(),
      hh: base.getHours(),
      mm: base.getMinutes(),
    };
  };
  const [sel, setSel] = useState(initSel);
  // Буфер редактирования времени: пока поле в фокусе показываем «сырой» ввод
  // (без pad), иначе набрать «20» поверх «00» невозможно.
  const [tEdit, setTEdit] = useState(null); // { field: 'hh'|'mm', raw: string } | null
  const [viewY, setViewY] = useState(sel.y);
  const [viewM, setViewM] = useState(sel.m);

  const openPop = () => {
    const s = initSel();
    setSel(s);
    setViewY(s.y);
    setViewM(s.m);
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      let top = r.bottom + 6;
      let left = r.left;
      const pw = 272, ph = 360;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      setPlace({ top, left });
    }
    setOpen(true);
  };
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target) &&
        !anchorRef.current?.contains(e.target)
      ) {
        close();
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const commit = (patch) => {
    const nextSel = { ...sel, ...patch };
    setSel(nextSel);
    onChange(new Date(nextSel.y, nextSel.m, nextSel.d, nextSel.hh, nextSel.mm, 0, 0));
  };
  const clampT = (raw, mx) => {
    let v = parseInt(String(raw).replace(/\D/g, ""), 10);
    if (Number.isNaN(v)) v = 0;
    if (v > mx) v = mx;
    return v;
  };

  const isNow = value === "now" || value == null;
  const label = isNow
    ? "Сейчас"
    : `${value.getDate()} ${MON[value.getMonth()]} · ${pad(value.getHours())}:${pad(value.getMinutes())}`;

  // сетка календаря
  const first = new Date(viewY, viewM, 1).getDay();
  const off = (first + 6) % 7;
  const dim = new Date(viewY, viewM + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < off; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        onClick={openPop}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 flex-none rounded-lg font-sans outline-none transition-colors"
        style={{
          height: 34,
          width: small ? "auto" : 172,
          padding: "0 10px",
          border: `1px solid ${C.line2}`,
          background: C.bg,
          fontSize: 12,
          color: isNow ? C.text : C.text,
        }}
      >
        <CalIcon style={{ width: 13, height: 13, color: C.faint, flex: "none" }} />
        <span style={isNow ? { color: C.accent, fontWeight: 600 } : undefined}>{label}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Выбор даты и времени"
            className="fixed z-[140]"
            style={{
              top: place?.top,
              left: place?.left,
              width: 272,
              background: C.bg,
              border: "1px solid rgba(18,22,26,.1)",
              borderRadius: 16,
              boxShadow:
                "0 16px 48px rgba(18,22,26,.18),0 3px 10px rgba(18,22,26,.08)",
              padding: 12,
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange("now");
                close();
              }}
              className="w-full flex items-center justify-center gap-2 font-sans font-bold"
              style={{
                height: 34,
                borderRadius: 9,
                background: C.recess,
                color: C.accent,
                fontSize: 12.5,
                border: "none",
                marginBottom: 10,
                cursor: "pointer",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4l2.5 2" />
              </svg>
              Сейчас
            </button>
            <div className="flex items-center justify-between" style={{ padding: "2px 2px 9px" }}>
              <button
                type="button"
                aria-label="Предыдущий месяц"
                onClick={() => {
                  let m = viewM - 1, y = viewY;
                  if (m < 0) { m = 11; y--; }
                  setViewM(m); setViewY(y);
                }}
                style={{ width: 26, height: 26, border: "none", background: "none", borderRadius: 7, color: C.muted, fontSize: 17, cursor: "pointer", lineHeight: 1 }}
              >
                ‹
              </button>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{MONF[viewM]} {viewY}</span>
              <button
                type="button"
                aria-label="Следующий месяц"
                onClick={() => {
                  let m = viewM + 1, y = viewY;
                  if (m > 11) { m = 0; y++; }
                  setViewM(m); setViewY(y);
                }}
                style={{ width: 26, height: 26, border: "none", background: "none", borderRadius: 7, color: C.muted, fontSize: 17, cursor: "pointer", lineHeight: 1 }}
              >
                ›
              </button>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(7,1fr)", marginBottom: 3 }}>
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w) => (
                <span key={w} style={{ textAlign: "center", fontSize: 10, color: C.faint, fontWeight: 600, padding: "2px 0" }}>{w}</span>
              ))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(7,1fr)", gap: 1 }}>
              {cells.map((d, i) => {
                if (d == null) return <span key={i} style={{ height: 30 }} />;
                const isSel = sel.y === viewY && sel.m === viewM && sel.d === d;
                const isToday = now.getFullYear() === viewY && now.getMonth() === viewM && now.getDate() === d;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => commit({ y: viewY, m: viewM, d })}
                    className="font-mono tabular-nums"
                    style={{
                      height: 30,
                      border: "none",
                      background: isSel ? C.accent : "none",
                      color: isSel ? "#fff" : C.text,
                      fontWeight: isSel ? 700 : 400,
                      borderRadius: 8,
                      fontSize: 12.5,
                      cursor: "pointer",
                      boxShadow: isToday && !isSel ? `inset 0 0 0 1.5px ${C.line2}` : "none",
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between" style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Время</span>
              <div className="flex items-center" style={{ gap: 3, background: C.recess, borderRadius: 9, padding: "4px 8px" }}>
                <input
                  aria-label="Часы"
                  inputMode="numeric"
                  maxLength={2}
                  value={tEdit?.field === "hh" ? tEdit.raw : pad(sel.hh)}
                  onFocus={(e) => { setTEdit({ field: "hh", raw: String(sel.hh) }); e.target.select(); }}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(-2);
                    setTEdit({ field: "hh", raw });
                    commit({ hh: clampT(raw || "0", 23) });
                  }}
                  onBlur={() => setTEdit(null)}
                  className="font-mono tabular-nums text-center outline-none"
                  style={{ width: 26, border: "none", background: "none", fontSize: 15, fontWeight: 600, color: C.text }}
                />
                <span style={{ color: C.faint, fontWeight: 700 }}>:</span>
                <input
                  aria-label="Минуты"
                  inputMode="numeric"
                  maxLength={2}
                  value={tEdit?.field === "mm" ? tEdit.raw : pad(sel.mm)}
                  onFocus={(e) => { setTEdit({ field: "mm", raw: String(sel.mm) }); e.target.select(); }}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "").slice(-2);
                    setTEdit({ field: "mm", raw });
                    commit({ mm: clampT(raw || "0", 59) });
                  }}
                  onBlur={() => setTEdit(null)}
                  className="font-mono tabular-nums text-center outline-none"
                  style={{ width: 26, border: "none", background: "none", fontSize: 15, fontWeight: 600, color: C.text }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="w-full font-sans font-bold"
              style={{ marginTop: 11, height: 36, border: "none", borderRadius: 9, background: C.accent, color: "#fff", fontSize: 13, cursor: "pointer" }}
            >
              Готово
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

// ── Поле выбора контрагента (через CounterpartyPicker) ───────────────────
function CounterpartyField({ value, onChange, placeholder }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        onMouseDown={(e) => { e.preventDefault(); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        className="flex items-center gap-2.5 cursor-pointer"
        style={{ border: `1px solid ${C.line2}`, borderRadius: 10, padding: "0 12px", height: 42 }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, color: C.faint, flex: "none" }}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4-4" />
        </svg>
        {value?.label ? (
          <span className="flex items-center gap-2" style={{ fontSize: 14, color: C.text }}>
            <span style={{ fontWeight: 600 }}>{value.label}</span>
            <button
              type="button"
              aria-label="Очистить контрагента"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null); }}
              style={{ border: "none", background: "none", color: C.faint, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ) : (
          <span style={{ fontSize: 14, color: C.faint }}>{placeholder}</span>
        )}
      </div>
      {open && (
        <CounterpartyPicker
          anchorEl={anchorRef.current}
          onClose={() => setOpen(false)}
          onSelect={(party) => {
            onChange({
              label: party.name || party.label || party.accountingCode || "Контрагент",
              clientId: party.clientId || null,
              accountingCode: party.accountingCode || null,
              kind: party.kind,
              isReferral: party.isReferral === true,
            });
            setOpen(false); // закрываем пикер после выбора
          }}
        />
      )}
    </div>
  );
}

// ── Строка-заголовок секции ─────────────────────────────────────────────
function StepHead({ n, label, badge }) {
  return (
    <div className="flex items-center gap-2.5" style={{ marginBottom: 12 }}>
      <span
        className="flex items-center justify-center flex-none font-bold"
        style={{ width: 20, height: 20, borderRadius: "50%", background: C.recess, color: C.muted, fontSize: 11 }}
      >
        {n}
      </span>
      <span className="uppercase" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".5px" }}>{label}</span>
      {badge && (
        <span
          className="uppercase font-bold"
          style={{ marginLeft: "auto", fontSize: 9.5, letterSpacing: ".4px", color: C.amber, background: "rgba(169,120,26,.12)", borderRadius: 5, padding: "2px 8px" }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Основной компонент ──────────────────────────────────────────────────
let seqCounter = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seqCounter++).toString(36)}`;

export default function CreateOrderForm({
  currentOffice,
  initialData = null,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const { getRate: getRateRaw } = useRates();
  const { accounts } = useAccounts();
  const { byType } = useCategories();
  const { activeOffices, findOffice } = useOffices();
  const { codes: currencyCodes } = useCurrencies();

  const getRate = useCallback(
    (from, to) => getRateRaw(from, to, currentOffice),
    [getRateRaw, currentOffice]
  );

  // Список валют из справочника, в удобном порядке (без хардкода из макета).
  const currencies = useMemo(() => {
    const set = new Set(currencyCodes && currencyCodes.length ? currencyCodes : PREFERRED_ORDER);
    const ordered = PREFERRED_ORDER.filter((c) => set.has(c));
    const rest = [...set].filter((c) => !PREFERRED_ORDER.includes(c)).sort();
    return [...ordered, ...rest];
  }, [currencyCodes]);
  const defaultCcy = currencies[0] || "USDT";
  const secondCcy = currencies.find((c) => c !== defaultCcy) || defaultCcy;

  // Счета под конкретную валюту для текущего офиса.
  const accountsFor = useCallback(
    (ccy) =>
      accounts.filter(
        (a) => a.active !== false && a.officeId === currentOffice && a.currency === ccy
      ),
    [accounts, currentOffice]
  );

  const office = findOffice ? findOffice(currentOffice) : null;
  const feePercent = Number.isFinite(Number(office?.feePercent)) ? Number(office.feePercent) : null;

  // ── Тип операции ──
  const [type, setType] = useState("exchange"); // exchange|income|expense|transfer|otc
  const isExchange = type === "exchange" || type === "otc";
  const isOtc = type === "otc";

  // ── Состояние Обмен/ОТС ──
  const mkInLeg = (ccy = defaultCcy) => ({ id: uid("in"), amount: "", currency: ccy, accountId: "", dt: "now" });
  const mkOutLeg = (ccy = secondCcy) => ({
    id: uid("out"), amount: "", currency: ccy, accountId: "", dt: "now",
    rate: "", manualRate: isOtc, amountTouched: false,
  });

  const [inLegs, setInLegs] = useState(() => (
    Array.isArray(initialData?.inPayments) && initialData.inPayments.length
      ? initialData.inPayments.map((p) => ({ id: uid("in"), amount: p.amount != null ? String(p.amount) : "", currency: p.currency || defaultCcy, accountId: p.accountId || "", dt: "now" }))
      : [mkInLeg(initialData?.curIn || defaultCcy)]
  ));
  const [outLegs, setOutLegs] = useState(() => (
    Array.isArray(initialData?.outputs) && initialData.outputs.length
      ? initialData.outputs.map((o) => ({ id: uid("out"), amount: o.amount != null ? String(o.amount) : "", currency: o.currency || secondCcy, accountId: o.accountId || "", dt: "now", rate: o.rate != null ? String(o.rate) : "", manualRate: !!o.manualRate, amountTouched: false }))
      : [mkOutLeg(initialData?.curOut || secondCcy)]
  ));
  const [manualPrimary, setManualPrimary] = useState(false);
  const [exCp, setExCp] = useState(
    initialData?.counterparty ? { label: initialData.counterparty, clientId: initialData.counterpartyId || null } : null
  ); // контрагент {label, clientId, ...}
  const [exComment, setExComment] = useState(initialData?.comment || "");

  const patchIn = useCallback((idx, patch) => setInLegs((p) => p.map((l, i) => (i === idx ? { ...l, ...patch } : l))), []);
  const patchOut = useCallback((idx, patch) => setOutLegs((p) => p.map((l, i) => (i === idx ? { ...l, ...patch } : l))), []);

  const oneToOne = inLegs.length === 1 && outLegs.length === 1;
  const primaryInCcy = inLegs[0]?.currency || "";

  // Авто-курс: заполняем rate каждой OUT-ноги от рыночного (если нога не ручная,
  // либо ручная но пустая — даём стартовое значение). Ручной курс не перетираем.
  useEffect(() => {
    if (!isExchange) return;
    outLegs.forEach((o, i) => {
      if (!primaryInCcy || !o.currency || primaryInCcy === o.currency) return;
      if (o.manualRate && o.rate) return;
      const raw = getRate(primaryInCcy, o.currency);
      const d = displayRate(raw, primaryInCcy, o.currency);
      if (d.rate != null) {
        const f = formatRate(d.rate);
        if (f !== o.rate) patchOut(i, { rate: f });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryInCcy, outLegs, getRate, isExchange]);

  // Авто-сумма primary OUT = amtIn × rate (пока юзер не правил вручную).
  useEffect(() => {
    if (!isExchange) return;
    const o = outLegs[0];
    if (!o || o.amountTouched) return;
    const amt = pn(inLegs[0]?.amount);
    const rt = pn(o.rate);
    if (!Number.isFinite(amt) || !Number.isFinite(rt) || amt <= 0 || rt <= 0) return;
    try {
      const out = String(multiplyAmount(amt, rt, 2));
      if (out !== o.amount) patchOut(0, { amount: out });
    } catch { /* тихо */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inLegs, outLegs, isExchange]);

  // Сброс accountId ноги при смене её валюты (счёт больше не подходит).
  useEffect(() => {
    inLegs.forEach((l, i) => {
      if (l.accountId && !accountsFor(l.currency).some((a) => a.id === l.accountId)) patchIn(i, { accountId: "" });
    });
    outLegs.forEach((l, i) => {
      if (l.accountId && !accountsFor(l.currency).some((a) => a.id === l.accountId)) patchOut(i, { accountId: "" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inLegs, outLegs, accountsFor]);

  // При переключении в ОТС — курс primary становится ручным по умолчанию.
  useEffect(() => {
    if (isOtc) setManualPrimary(true);
  }, [isOtc]);

  const addIn = () => setInLegs((p) => [...p, mkInLeg(currencies.find((c) => !p.some((l) => l.currency === c)) || defaultCcy)]);
  const addOut = () => setOutLegs((p) => [...p, mkOutLeg(currencies.find((c) => !p.some((l) => l.currency === c)) || secondCcy)]);
  const removeIn = (idx) => setInLegs((p) => p.filter((_, i) => i !== idx));
  const removeOut = (idx) => setOutLegs((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  // Swap IN ↔ OUT (только 1×1) — как reverseRate в NewDealForm.
  const swap = () => {
    if (!oneToOne) return;
    const i0 = inLegs[0], o0 = outLegs[0];
    const oldRate = pn(o0.rate);
    const newRate = Number.isFinite(oldRate) && oldRate > 0 ? formatRateCompact(1 / oldRate) : "";
    setInLegs([{ ...i0, currency: o0.currency, amount: o0.amount, accountId: "" }]);
    setOutLegs([{ ...o0, currency: i0.currency, amount: i0.amount, accountId: "", rate: newRate, manualRate: !!newRate, amountTouched: !!i0.amount }]);
    setManualPrimary(isOtc ? true : !!newRate);
  };

  // ── Состояние Приход / Расход ──
  const [side, setSide] = useState({
    income: { amount: "", currency: defaultCcy, accountId: "", categoryId: "", cp: null, dt: "now", comment: "" },
    expense: { amount: "", currency: secondCcy, accountId: "", categoryId: "", cp: null, dt: "now", comment: "" },
  });
  const patchSide = (kind, patch) => setSide((s) => ({ ...s, [kind]: { ...s[kind], ...patch } }));

  // ── Состояние Перемещение ──
  const [mov, setMov] = useState({ amount: "", currency: defaultCcy, fromAccountId: "", toAccountId: "", dt: "now", comment: "" });
  const [movBusy, setMovBusy] = useState(false);

  // ── Валидация Обмен/ОТС ──
  const validIns = useMemo(
    () => inLegs.filter((l) => pn(l.amount) > 0 && l.currency),
    [inLegs]
  );
  const validOuts = useMemo(
    () => outLegs.filter((l) => pn(l.amount) > 0 && pn(l.rate) > 0 && l.currency),
    [outLegs]
  );
  const canSubmitExchange = useMemo(() => {
    if (!exCp?.label) return false;
    if (validIns.length === 0 && validOuts.length === 0) return false;
    // если есть OUT-ноги с суммой — у них должен быть курс
    const outWithAmt = outLegs.filter((l) => pn(l.amount) > 0);
    if (outWithAmt.length > 0 && validOuts.length !== outWithAmt.length) return false;
    return true;
  }, [exCp, validIns, validOuts, outLegs]);

  // ── Сборка payload обмена (1-в-1 как NewDealForm.handleSubmit) ──
  const buildExchangePayload = useCallback(() => {
    const vIns = inLegs.filter((l) => pn(l.amount) > 0 && l.currency);
    const vOuts = outLegs.filter((l) => pn(l.amount) > 0 && pn(l.rate) > 0);
    const primaryIn = vIns[0];
    // Дата сделки: primary IN (или первый OUT) → backdateAt (ISO); 'now' → пусто.
    const legDt = primaryIn?.dt ?? vOuts[0]?.dt ?? "now";
    const backdateAt = legDt === "now" ? "" : dtToIso(legDt);
    return {
      officeId: currentOffice, // adapter требует officeId
      amtIn: primaryIn ? pn(primaryIn.amount) : 0,
      curIn: primaryIn?.currency || "",
      inPayments:
        vIns.length > 1
          ? vIns.map((l) => ({ currency: l.currency, amount: pn(l.amount), accountId: l.accountId }))
          : undefined,
      outputs: vOuts.map((o, i) => ({
        id: `out_${i}`,
        currency: o.currency,
        amount: pn(o.amount),
        rate: pn(o.rate),
        manualRate: !!o.manualRate,
        accountId: o.accountId || "",
        address: "",
        applyFee: false,
        outKind: "ours",
        partnerAccountId: null, // TODO OTC partner accounts — партнёрские счета в ОТС пока не реализованы
      })),
      counterparty: exCp?.label?.trim() || "",
      accountId: primaryIn?.accountId || "",
      referral: !!exCp?.isReferral,
      comment: exComment,
      deferredIn: false,
      deferredOut: false,
      partialMode: false,
      partialPayNow: {},
      applyMinFee: true,
      backdateAt,
    };
  }, [inLegs, outLegs, exCp, exComment]);

  const handleExchangeSubmit = () => {
    if (!canSubmitExchange || submitting) return;
    onSubmit(buildExchangePayload());
  };

  // ── Перемещение ──
  const movFrom = mov.fromAccountId ? accounts.find((a) => a.id === mov.fromAccountId) : null;
  const movTo = mov.toAccountId ? accounts.find((a) => a.id === mov.toAccountId) : null;
  const movCrossCurrency = movFrom && movTo && movFrom.currency !== movTo.currency;
  const canSubmitTransfer =
    mov.fromAccountId &&
    mov.toAccountId &&
    mov.fromAccountId !== mov.toAccountId &&
    pn(mov.amount) > 0 &&
    !movCrossCurrency;

  const handleTransferSubmit = async () => {
    if (!canSubmitTransfer || movBusy) return;
    setMovBusy(true);
    try {
      const res = await withToast(
        () =>
          createTransfer({
            officeId: currentOffice,
            fromAccountId: mov.fromAccountId,
            toAccountId: mov.toAccountId,
            fromAmount: pn(mov.amount),
            toAmount: pn(mov.amount), // одна валюта → суммы равны
            rate: null,
            note: mov.comment.trim(),
            // effectiveDate: adaptLegacyTransferPayload / create_transfer его не
            // принимают → бэкдейт перемещения пока не поддержан (см. TODO).
            effectiveDate: dtToIso(mov.dt),
          }),
        { success: "Перемещение записано", errorPrefix: "Transfer failed" }
      );
      if (res?.ok) onCancel?.();
    } finally {
      setMovBusy(false);
    }
  };

  // ── Приход / Расход → ledger.create_manual_entry ──
  //   Расход: Дт операц.расход / Кт касса.  Приход: Дт касса / Кт операц.доход.
  // Операционный счёт резолвится по office_id + валюте (счета заведены на офис×валюту).
  const [sideBusy, setSideBusy] = useState(false);
  const sideData = type === "income" ? side.income : side.expense;
  const canSubmitSide =
    (type === "income" || type === "expense") &&
    pn(sideData.amount) > 0 &&
    sideData.accountId &&
    sideData.currency;

  const handleSideSubmit = async () => {
    if (!canSubmitSide || sideBusy) return;
    const isIncome = type === "income";
    setSideBusy(true);
    try {
      // код кассового счёта (Дт при приходе / Кт при расходе)
      const cashCode = await resolveAccountCode(sideData.accountId);
      if (!cashCode) throw new Error("Не найден код кассового счёта");
      // операционный счёт по офису+валюте
      let q = supabase
        .schema("ledger")
        .from("accounts")
        .select("code")
        .eq("office_id", currentOffice)
        .eq("currency_code", sideData.currency)
        .eq("type", isIncome ? "revenue" : "expense");
      q = isIncome ? q.is("subtype", null) : q.eq("subtype", "office_expense");
      const { data: opAcc, error: opErr } = await q.limit(1).maybeSingle();
      if (opErr) throw opErr;
      if (!opAcc?.code)
        throw new Error(`Нет операционного счёта ${isIncome ? "дохода" : "расхода"} для ${sideData.currency} в этом офисе`);

      const cat = (byType(type) || []).find((c) => c.id === sideData.categoryId);
      const amount = pn(sideData.amount);
      const lines = isIncome
        ? [
            { accountCode: cashCode, direction: "dr", amount, currencyCode: sideData.currency },
            { accountCode: opAcc.code, direction: "cr", amount, currencyCode: sideData.currency },
          ]
        : [
            { accountCode: opAcc.code, direction: "dr", amount, currencyCode: sideData.currency },
            { accountCode: cashCode, direction: "cr", amount, currencyCode: sideData.currency },
          ];
      const res = await withToast(
        () =>
          rpcCreateManualEntryV2({
            lines,
            currencyCode: sideData.currency,
            reason: `${isIncome ? "Приход" : "Расход"}: ${cat?.name || "без категории"}${sideData.comment ? ` — ${sideData.comment}` : ""}`,
            description: sideData.comment || undefined,
            effectiveDate: dtToIso(sideData.dt),
            metadata: {
              cashier_side: type,
              category_id: sideData.categoryId || null,
              category: cat?.name || null,
              office_id: currentOffice,
              counterparty: sideData.cp?.label || null,
            },
          }),
        { success: isIncome ? "Приход записан" : "Расход записан", errorPrefix: "Не удалось записать" }
      );
      if (res?.ok) onCancel?.();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[side] create failed", e);
      window.alert(`Не удалось записать ${isIncome ? "приход" : "расход"}:\n${e?.message || e}`);
    } finally {
      setSideBusy(false);
    }
  };

  // ── Сводка + текст кнопки ──
  const modeLabel = isOtc
    ? "ОТС"
    : type === "exchange"
    ? validIns.length && validOuts.length ? "Обмен" : validIns.length ? "Пополнение" : validOuts.length ? "Выдача" : "Обмен"
    : type === "income" ? "Приход"
    : type === "expense" ? "Расход"
    : "Перемещение";

  const createLabel =
    type === "transfer" ? "Создать перемещение"
    : type === "income" ? "Создать приход"
    : type === "expense" ? "Создать расход"
    : isOtc ? "Создать ОТС"
    : modeLabel === "Пополнение" ? "Создать пополнение"
    : modeLabel === "Выдача" ? "Создать выдачу"
    : "Создать ордер";

  const primaryDisabled =
    type === "transfer" ? !canSubmitTransfer || movBusy
    : isExchange ? !canSubmitExchange || submitting
    : !canSubmitSide || sideBusy; // income/expense

  const onPrimary =
    type === "transfer" ? handleTransferSubmit
    : isExchange ? handleExchangeSubmit
    : handleSideSubmit;

  const showDraft = type !== "transfer"; // «Сохранить как заявку» — где применимо

  // ── UI-хелперы ──
  const label = (txt, extra) => (
    <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 7 }}>
      {txt}
      {extra}
    </div>
  );

  const ccySelect = (val, onChange, big) => (
    <select
      value={val}
      onChange={(e) => onChange(e.target.value)}
      className="outline-none cursor-pointer"
      style={{ border: "none", background: "none", fontSize: big ? 14 : 13, fontWeight: 700, color: C.text }}
    >
      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );

  const accSelect = (ccy, val, onChange) => {
    const opts = accountsFor(ccy);
    return (
      <select
        value={val}
        onChange={(e) => onChange(e.target.value)}
        className="outline-none cursor-pointer flex-1 min-w-0"
        style={{ border: `1px solid ${C.line2}`, borderRadius: 8, height: 34, padding: "0 9px", fontSize: 12, color: val ? C.text : C.muted, background: C.bg }}
      >
        <option value="">{opts.length ? "Счёт…" : "Нет счетов в этой валюте"}</option>
        {opts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    );
  };

  const plainSelect = (val, onChange, options, placeholder) => (
    <select
      value={val}
      onChange={(e) => onChange(e.target.value)}
      className="w-full outline-none cursor-pointer"
      style={{ border: `1px solid ${C.line2}`, borderRadius: 9, height: 40, padding: "0 11px", fontSize: 13, background: C.bg, color: val ? C.text : C.muted }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  // ── Карточка ноги (Обмен/ОТС) ──
  const legCard = (leg, idx, dir) => {
    const patch = dir === "in" ? patchIn : patchOut;
    const remove = dir === "in" ? removeIn : removeOut;
    const removable = dir === "in" ? inLegs.length > 0 : outLegs.length > 1;
    return (
      <div key={leg.id} className="relative" style={{ border: `1px solid ${C.line}`, borderRadius: 11, padding: "11px 12px", marginBottom: 9, background: C.recess }}>
        {removable && (
          <button
            type="button"
            aria-label="Удалить ногу"
            onClick={() => remove(idx)}
            className="absolute"
            style={{ top: 8, right: 9, width: 18, height: 18, border: "none", background: "none", color: C.faint, fontSize: 16, lineHeight: 1, cursor: "pointer" }}
          >
            ×
          </button>
        )}
        <div className="flex items-center gap-2.5" style={{ paddingRight: 16 }}>
          <input
            inputMode="decimal"
            value={leg.amount}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value;
              if (dir === "out") patch(idx, { amount: v, amountTouched: true });
              else patch(idx, { amount: v });
            }}
            className="flex-1 min-w-0 outline-none font-mono tabular-nums"
            style={{ border: "none", background: "none", fontSize: 20, fontWeight: 600, letterSpacing: "-.4px", color: C.text }}
          />
          {ccySelect(leg.currency, (v) => patch(idx, dir === "out" ? { currency: v, accountId: "", rate: "", manualRate: isOtc, amountTouched: false } : { currency: v, accountId: "" }), true)}
        </div>
        <div className="flex gap-2" style={{ marginTop: 9 }}>
          {accSelect(leg.currency, leg.accountId, (v) => patch(idx, { accountId: v }))}
          <DateTimePicker value={leg.dt} onChange={(v) => patch(idx, { dt: v })} />
        </div>
      </div>
    );
  };

  // ── Ratebar (только 1×1) ──
  const ratebar = () => {
    if (!oneToOne) return null;
    const inCcy = inLegs[0].currency, outCcy = outLegs[0].currency;
    const man = isOtc ? true : manualPrimary;
    return (
      <div className="flex items-center gap-3" style={{ padding: "10px 2px 12px" }}>
        <button
          type="button"
          aria-label="Поменять направление"
          onClick={swap}
          className="flex items-center justify-center flex-none"
          style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line2}`, background: C.bg, cursor: "pointer" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15, color: C.muted }}>
            <path d="M7 10l-3 3 3 3M4 13h11M17 14l3-3-3-3M20 11H9" />
          </svg>
        </button>
        {man ? (
          <span className="flex items-center gap-2 font-mono tabular-nums" style={{ fontSize: 13, color: C.muted }}>
            1 {inCcy} <span style={{ color: C.faint }}>=</span>
            <input
              aria-label="Курс"
              value={outLegs[0].rate}
              onChange={(e) => patchOut(0, { rate: e.target.value.replace(/[^\d.,]/g, "").replace(",", "."), manualRate: true })}
              className="font-mono tabular-nums outline-none"
              style={{ width: 96, border: `1px solid ${C.accent}`, borderRadius: 7, height: 30, padding: "0 8px", fontSize: 13, color: C.text }}
            />
            {outCcy}
            <span className="uppercase font-bold" style={{ fontSize: 9.5, letterSpacing: ".4px", borderRadius: 5, padding: "2px 7px", color: C.amber, background: "rgba(169,120,26,.12)" }}>Ручной</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 font-mono tabular-nums" style={{ fontSize: 13, color: C.muted }}>
            1 {inCcy} <span style={{ color: C.faint }}>=</span> {outLegs[0].rate || "—"} {outCcy}
            <span className="uppercase font-bold" style={{ fontSize: 9.5, letterSpacing: ".4px", borderRadius: 5, padding: "2px 7px", color: C.accent, background: "rgba(12,156,107,.1)" }}>Авто</span>
          </span>
        )}
        {!isOtc && (
          <button
            type="button"
            onClick={() => {
              if (manualPrimary) {
                // Вернуть авто — сбрасываем ручной флаг и rate (эффект дозаполнит рыночный).
                setManualPrimary(false);
                patchOut(0, { manualRate: false, rate: "" });
              } else {
                setManualPrimary(true);
                patchOut(0, { manualRate: true });
              }
            }}
            className="font-semibold"
            style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted, background: C.bg, border: `1px solid ${C.line2}`, borderRadius: 7, padding: "5px 11px", cursor: "pointer" }}
          >
            {manualPrimary ? "Вернуть авто" : "Ручной курс"}
          </button>
        )}
      </div>
    );
  };

  // ── Тело формы под тип ──
  const sideRule = (txt, cls) => (
    <div className="flex items-center gap-2" style={{ margin: "6px 0 8px" }}>
      <span className="uppercase font-bold" style={{ fontSize: 10.5, letterSpacing: ".6px", color: cls }}>{txt}</span>
      <span className="flex-1" style={{ height: 1, background: C.line }} />
    </div>
  );

  const step = (children, key) => (
    <div key={key} style={{ padding: "18px 20px", borderBottom: `1px solid ${C.line}` }}>{children}</div>
  );

  let formBody = null;
  if (isExchange) {
    formBody = (
      <>
        {step(
          <>
            <StepHead n="1" label={isOtc ? "Сделка ОТС" : "Обмен"} badge={isOtc ? "Крупная сделка" : null} />
            {sideRule("Приход · получаем", C.pos)}
            {inLegs.length ? inLegs.map((l, i) => legCard(l, i, "in")) : <div style={{ fontSize: 12, color: C.faint, padding: "8px 2px 10px" }}>Без прихода → это Выдача клиенту</div>}
            <button type="button" onClick={addIn} className="w-full font-semibold" style={{ border: `1px dashed ${C.line2}`, borderRadius: 9, background: "none", color: C.muted, fontSize: 12.5, padding: 9, cursor: "pointer" }}>+ Добавить приход</button>
            {ratebar()}
            {sideRule("Расход · выдаём", C.neg)}
            {outLegs.length ? outLegs.map((l, i) => legCard(l, i, "out")) : <div style={{ fontSize: 12, color: C.faint, padding: "8px 2px 10px" }}>Без расхода → это Пополнение клиента</div>}
            <button type="button" onClick={addOut} className="w-full font-semibold" style={{ border: `1px dashed ${C.line2}`, borderRadius: 9, background: "none", color: C.muted, fontSize: 12.5, padding: 9, cursor: "pointer" }}>+ Добавить расход</button>
          </>,
          "s1"
        )}
        {step(
          <>
            <StepHead n="2" label="Контрагент" badge={isOtc ? "Обязателен" : null} />
            <CounterpartyField value={exCp} onChange={setExCp} placeholder="Найти контрагента или создать нового…" />
          </>,
          "s2"
        )}
        {step(
          <>
            <StepHead n="3" label="Детали" />
            <div className="flex gap-3.5">
              <div style={{ flex: 1 }}>
                {label(<>Город / офис {feePercent != null && <span className="font-mono font-bold" style={{ fontSize: 10.5, color: C.amber, background: "rgba(169,120,26,.12)", borderRadius: 4, padding: "1px 6px" }}>{grp(feePercent, 1)}%</span>}</>)}
                <div className="w-full flex items-center" style={{ border: `1px solid ${C.line2}`, borderRadius: 9, height: 40, padding: "0 11px", fontSize: 13, background: C.recess, color: C.text }}>
                  {office?.name || currentOffice} {office?.city ? `· ${office.city}` : ""}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                {label("Комментарий")}
                <input value={exComment} onChange={(e) => setExComment(e.target.value)} placeholder="необязательно" className="w-full outline-none" style={{ border: `1px solid ${C.line2}`, borderRadius: 9, height: 40, padding: "0 11px", fontSize: 13, background: C.bg, color: C.text }} />
              </div>
            </div>
          </>,
          "s3"
        )}
      </>
    );
  } else if (type === "income" || type === "expense") {
    const d = side[type];
    const cats = (byType(type) || []).map((c) => ({ value: c.id, label: c.name }));
    formBody = (
      <>
        {step(
          <>
            <StepHead n="1" label={type === "income" ? "Приход" : "Расход"} />
            <div className="relative" style={{ border: `1px solid ${C.line}`, borderRadius: 11, padding: "11px 12px", marginBottom: 14, background: C.recess }}>
              <div className="flex items-center gap-2.5">
                <input inputMode="decimal" value={d.amount} placeholder="0" onChange={(e) => patchSide(type, { amount: e.target.value })} className="flex-1 min-w-0 outline-none font-mono tabular-nums" style={{ border: "none", background: "none", fontSize: 20, fontWeight: 600, letterSpacing: "-.4px", color: C.text }} />
                {ccySelect(d.currency, (v) => patchSide(type, { currency: v, accountId: "" }), true)}
              </div>
            </div>
            <div className="flex gap-3.5">
              <div style={{ flex: 1 }}>
                {label(type === "income" ? "Счёт зачисления" : "Счёт списания")}
                {plainSelect(d.accountId, (v) => patchSide(type, { accountId: v }), accountsFor(d.currency).map((a) => ({ value: a.id, label: a.name })), accountsFor(d.currency).length ? "Счёт…" : "Нет счетов в этой валюте")}
              </div>
              <div style={{ flex: 1 }}>
                {label("Категория")}
                {plainSelect(d.categoryId, (v) => patchSide(type, { categoryId: v }), cats, "Категория…")}
              </div>
            </div>
          </>,
          "s1"
        )}
        {step(
          <>
            <StepHead n="2" label={type === "income" ? "От кого · необязательно" : "Получатель · необязательно"} />
            <CounterpartyField value={d.cp} onChange={(v) => patchSide(type, { cp: v })} placeholder="Найти контрагента…" />
          </>,
          "s2"
        )}
        {step(
          <>
            <StepHead n="3" label="Детали" />
            <div className="flex gap-3.5">
              <div style={{ flex: 1 }}>
                {label("Дата и время")}
                <DateTimePicker value={d.dt} onChange={(v) => patchSide(type, { dt: v })} />
              </div>
              <div style={{ flex: 1 }}>
                {label("Комментарий")}
                <input value={d.comment} onChange={(e) => patchSide(type, { comment: e.target.value })} placeholder="необязательно" className="w-full outline-none" style={{ border: `1px solid ${C.line2}`, borderRadius: 9, height: 40, padding: "0 11px", fontSize: 13, background: C.bg, color: C.text }} />
              </div>
            </div>
          </>,
          "s3"
        )}
      </>
    );
  } else if (type === "transfer") {
    const fromOpts = accountsFor(mov.currency).map((a) => ({ value: a.id, label: office ? a.name : `${a.name}` }));
    formBody = (
      <>
        {step(
          <>
            <StepHead n="1" label="Перемещение" />
            <div className="relative" style={{ border: `1px solid ${C.line}`, borderRadius: 11, padding: "11px 12px", marginBottom: 14, background: C.recess }}>
              <div className="flex items-center gap-2.5">
                <input inputMode="decimal" value={mov.amount} placeholder="0" onChange={(e) => setMov((m) => ({ ...m, amount: e.target.value }))} className="flex-1 min-w-0 outline-none font-mono tabular-nums" style={{ border: "none", background: "none", fontSize: 20, fontWeight: 600, letterSpacing: "-.4px", color: C.text }} />
                {ccySelect(mov.currency, (v) => setMov((m) => ({ ...m, currency: v, fromAccountId: "", toAccountId: "" })), true)}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              {label("Со счёта / офиса")}
              {plainSelect(mov.fromAccountId, (v) => setMov((m) => ({ ...m, fromAccountId: v })), fromOpts, fromOpts.length ? "Счёт…" : "Нет счетов в этой валюте")}
            </div>
            <div style={{ marginBottom: 14 }}>
              {label("На счёт / офис")}
              {plainSelect(mov.toAccountId, (v) => setMov((m) => ({ ...m, toAccountId: v })), fromOpts.filter((o) => o.value !== mov.fromAccountId), fromOpts.length ? "Счёт…" : "Нет счетов в этой валюте")}
            </div>
            {movCrossCurrency ? (
              <div style={{ fontSize: 11.5, color: C.neg, background: "rgba(206,70,61,.08)", borderRadius: 8, padding: "9px 11px", lineHeight: 1.5 }}>
                Кросс-валютное перемещение не поддержано. Выбери счета в одной валюте.
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: C.faint, background: C.recess, borderRadius: 8, padding: "9px 11px", lineHeight: 1.5 }}>
                Внутреннее движение — на общий баланс компании не влияет.
              </div>
            )}
          </>,
          "s1"
        )}
        {step(
          <>
            <StepHead n="2" label="Детали" />
            <div className="flex gap-3.5">
              <div style={{ flex: 1 }}>
                {label("Дата и время")}
                <DateTimePicker value={mov.dt} onChange={(v) => setMov((m) => ({ ...m, dt: v }))} />
              </div>
              <div style={{ flex: 1 }}>
                {label("Комментарий")}
                <input value={mov.comment} onChange={(e) => setMov((m) => ({ ...m, comment: e.target.value }))} placeholder="необязательно" className="w-full outline-none" style={{ border: `1px solid ${C.line2}`, borderRadius: 9, height: 40, padding: "0 11px", fontSize: 13, background: C.bg, color: C.text }} />
              </div>
            </div>
          </>,
          "s2"
        )}
      </>
    );
  }

  // ── Сводка (правая колонка) ──
  const sumLine = (amount, ccy, sign, cls, acc) => (
    <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "3px 0" }}>
      <span className="font-mono tabular-nums font-bold whitespace-nowrap" style={{ fontSize: 13, color: cls }}>
        {sign}<Money value={pn(amount)} /> {ccy}
      </span>
      <span className="truncate text-right" style={{ fontSize: 11, color: C.faint }}>{acc || ""}</span>
    </div>
  );
  const accName = (id) => accounts.find((a) => a.id === id)?.name || "";

  let summaryBody = null;
  if (isExchange) {
    summaryBody = (
      <>
        <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 12, color: C.muted }}>Контрагент</span>
          <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600, textAlign: "right" }}>{exCp?.label || "—"}</span>
        </div>
        <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <div className="uppercase" style={{ fontSize: 10, color: C.faint, letterSpacing: ".5px", marginBottom: 7 }}>Приход в кассу</div>
          {inLegs.length ? inLegs.map((l) => <div key={l.id}>{sumLine(l.amount, l.currency, "+", C.pos, accName(l.accountId))}</div>) : <div style={{ fontSize: 11, color: C.faint }}>—</div>}
        </div>
        <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <div className="uppercase" style={{ fontSize: 10, color: C.faint, letterSpacing: ".5px", marginBottom: 7 }}>Выдача из кассы</div>
          {outLegs.length ? outLegs.map((l) => <div key={l.id}>{sumLine(l.amount, l.currency, "−", C.neg, accName(l.accountId))}</div>) : <div style={{ fontSize: 11, color: C.faint }}>—</div>}
        </div>
        {oneToOne && (
          <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 12, color: C.muted }}>Курс</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 13.5, fontWeight: 600 }}>{outLegs[0].rate || "—"}{(isOtc || manualPrimary) ? " · ручной" : ""}</span>
          </div>
        )}
        {feePercent != null && (
          <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "9px 0" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Комиссия офиса</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 13.5, fontWeight: 600 }}>{grp(feePercent, 1)}%</span>
          </div>
        )}
      </>
    );
  } else if (type === "income" || type === "expense") {
    const d = side[type];
    const catName = (byType(type) || []).find((c) => c.id === d.categoryId)?.name || "—";
    summaryBody = (
      <>
        <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <div className="uppercase" style={{ fontSize: 10, color: C.faint, letterSpacing: ".5px", marginBottom: 7 }}>{type === "income" ? "Приход в кассу" : "Списание из кассы"}</div>
          {sumLine(d.amount, d.currency, type === "income" ? "+" : "−", type === "income" ? C.pos : C.neg, accName(d.accountId))}
        </div>
        <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 12, color: C.muted }}>Категория</span>
          <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600, textAlign: "right" }}>{catName}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "9px 0" }}>
          <span style={{ fontSize: 12, color: C.muted }}>{type === "income" ? "От кого" : "Получатель"}</span>
          <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600, textAlign: "right" }}>{d.cp?.label || "—"}</span>
        </div>
      </>
    );
  } else if (type === "transfer") {
    summaryBody = (
      <>
        <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <div className="uppercase" style={{ fontSize: 10, color: C.faint, letterSpacing: ".5px", marginBottom: 7 }}>Со счёта</div>
          {sumLine(mov.amount, mov.currency, "−", C.neg, accName(mov.fromAccountId))}
        </div>
        <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
          <div className="uppercase" style={{ fontSize: 10, color: C.faint, letterSpacing: ".5px", marginBottom: 7 }}>На счёт</div>
          {sumLine(mov.amount, mov.currency, "+", C.pos, accName(mov.toAccountId))}
        </div>
        <div className="flex items-baseline justify-between gap-2.5" style={{ padding: "9px 0" }}>
          <span style={{ fontSize: 12, color: C.muted }}>Влияние на баланс</span>
          <span className="font-mono tabular-nums" style={{ fontSize: 13.5, fontWeight: 600 }}>0</span>
        </div>
      </>
    );
  }

  const CHIPS = [
    { type: "exchange", label: "Обмен" },
    { type: "income", label: "Приход" },
    { type: "expense", label: "Расход" },
    { type: "transfer", label: "Перемещение" },
    { type: "otc", label: "ОТС" },
  ];

  const card = { background: C.bg, border: `1px solid ${C.line}`, borderRadius: 13, boxShadow: "0 1px 2px rgba(20,30,22,.04),0 2px 10px rgba(20,30,22,.03)" };

  return (
    <div style={{ color: C.text, maxWidth: 1400, padding: "24px 22px 60px" }} className="font-sans mx-auto">
      {/* Заголовок */}
      <div className="flex items-center gap-3" style={{ marginBottom: 18 }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.3px" }}>Новый ордер</span>
        {office && (
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 10px" }}>
            {office.name}{office.city ? ` · ${office.city}` : ""}
          </span>
        )}
        <button type="button" onClick={onCancel} className="ml-auto" style={{ fontSize: 13, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>Отмена</button>
      </div>

      <div className="flex items-start max-[1080px]:flex-col">
        {/* Курсы — только Обмен/ОТС */}
        <div
          className="overflow-hidden transition-[flex-basis,margin,opacity,transform] duration-[400ms] ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none max-[1080px]:w-full max-[1080px]:!basis-auto"
          style={{
            flex: "0 0 288px",
            flexBasis: isExchange ? 288 : 0,
            marginRight: isExchange ? 16 : 0,
            opacity: isExchange ? 1 : 0,
            transform: isExchange ? "none" : "translateX(-16px)",
          }}
          aria-hidden={!isExchange}
        >
          <RatesSidebar currentOffice={currentOffice} onOpenRates={() => {}} />
        </div>

        {/* Форма */}
        <div className="flex-1 min-w-0 max-[1080px]:w-full" style={{ marginRight: 16, ...card }}>
          {/* Чипсет */}
          <div role="tablist" aria-label="Тип операции" className="flex flex-wrap gap-1.5" style={{ padding: "13px 15px", borderBottom: `1px solid ${C.line}` }}>
            {CHIPS.map((ch) => {
              const on = type === ch.type;
              return (
                <button
                  key={ch.type}
                  role="tab"
                  aria-selected={on}
                  type="button"
                  onClick={() => setType(ch.type)}
                  className="font-sans font-semibold transition-colors motion-reduce:transition-none"
                  style={{ fontSize: 12.5, color: on ? "#fff" : C.muted, background: on ? C.accent : C.recess, border: "1px solid transparent", borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}
                >
                  {ch.label}
                </button>
              );
            })}
          </div>
          {formBody}
        </div>

        {/* Сводка */}
        <div className="max-[1080px]:w-full max-[1080px]:mt-4" style={{ flex: "0 0 330px" }}>
          <div className="sticky max-[1080px]:static" style={{ top: 20, ...card }}>
            <div className="flex items-center justify-between" style={{ padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
              <span className="uppercase" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".5px" }}>Сводка</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: C.accent, borderRadius: 6, padding: "3px 9px" }}>{modeLabel}</span>
            </div>
            <div style={{ padding: "8px 18px 14px" }}>{summaryBody}</div>
            <div style={{ padding: "14px 18px 18px", borderTop: `1px solid ${C.line}` }}>
              <button
                type="button"
                onClick={onPrimary}
                disabled={primaryDisabled}
                className="w-full font-bold transition-colors motion-reduce:transition-none"
                style={{ height: 44, border: "none", borderRadius: 10, background: primaryDisabled ? C.faint2 : C.accent, color: "#fff", fontSize: 14, cursor: primaryDisabled ? "not-allowed" : "pointer" }}
              >
                {type === "transfer" && movBusy ? "Создаём…" : submitting && isExchange ? "Создаём…" : createLabel}
              </button>
              {showDraft && (
                <button
                  type="button"
                  onClick={() => window.alert("Сохранение черновика заявки — в бэклоге")}
                  className="w-full font-semibold"
                  style={{ height: 40, marginTop: 9, border: `1px solid ${C.line2}`, borderRadius: 10, background: "none", color: C.muted, fontSize: 13, cursor: "pointer" }}
                >
                  Сохранить как заявку
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
