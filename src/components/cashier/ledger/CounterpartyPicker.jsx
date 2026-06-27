// src/components/cashier/ledger/CounterpartyPicker.jsx
// Умный пикер контрагента для строки ручного ввода в ленте «Сделки за день».
// Поповер position:fixed через портал в body (горизонтальный скролл ленты не
// обрезает). 3 состояния: СПИСОК | НАЙДЕННАЯ СДЕЛКА ПО КОДУ | ФОРМА НОВОГО.
// Дизайн/поведение — из docs-макета coinplata-cashier. Токены/шрифты кассы.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Plus } from "lucide-react";
import {
  recentClients,
  searchClients,
  createCounterparty,
  findDealByCode,
  DEAL_CODE_SEARCH_ENABLED,
} from "../../../lib/cashierCounterparties.js";

const POP_W = 346;
const looksLikeCode = (q) => /^\d/.test(String(q).trim()) || /-/.test(String(q).trim());
const initial = (n) => (String(n || "?")[0] || "?").toUpperCase();

export default function CounterpartyPicker({ anchorEl, onClose, onSelect, onFillFromDeal }) {
  const popRef = useRef(null);
  const inputRef = useRef(null);
  // place: { left, top } (открытие вниз) или { left, bottom } (вверх). Якорим
  // КРАЙ у ячейки — рост поповера по высоте (подгрузка «Недавних») не двигает
  // видимую часть и не вызывает «прыжок». ready — прячем до позиционирования.
  const [place, setPlace] = useState(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("list");
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState([]);
  const [recentsLoaded, setRecentsLoaded] = useState(false);
  const dirRef = useRef(null); // 'up' | 'down' — решаем ОДИН раз, чтобы не прыгало
  const [results, setResults] = useState([]);
  const [kbd, setKbd] = useState(0);
  const [foundCode, setFoundCode] = useState(null);
  const [foundDeal, setFoundDeal] = useState(undefined); // undefined=loading | null=нет | obj
  const [nf, setNf] = useState({ name: "", tg: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    recentClients(6)
      .then(setRecents)
      .catch(() => setRecents([]))
      .finally(() => setRecentsLoaded(true));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await searchClients(q, 20));
      } catch {
        setResults([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const reposition = useCallback(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
    // Направление решаем ОДИН раз по РЕАЛЬНОЙ высоте поповера: вниз, если
    // помещается под ячейкой; иначе вверх (низ якорим к верху ячейки → рост
    // идёт вверх, без прыжка).
    if (!dirRef.current) {
      const popH = popRef.current?.offsetHeight || 460;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      dirRef.current = popH > spaceBelow && r.top - 8 > spaceBelow ? "up" : "down";
    }
    if (dirRef.current === "up") setPlace({ left, bottom: window.innerHeight - r.top + 6 });
    else setPlace({ left, top: r.bottom + 6 });
  }, [anchorEl]);

  // Позиционируем ДО отрисовки, но направление считаем только КОГДА загружены
  // «Недавние» (реальная высота известна) — тогда же показываем (без прыжка).
  useLayoutEffect(() => {
    if (!recentsLoaded) return;
    reposition();
    setReady(true);
  }, [reposition, recentsLoaded, mode]);

  useEffect(() => {
    const h = () => reposition();
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    return () => {
      window.removeEventListener("resize", h);
      window.removeEventListener("scroll", h, true);
    };
  }, [reposition]);

  useEffect(() => {
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && !anchorEl?.contains(e.target)) {
        onClose?.();
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose, anchorEl]);

  useEffect(() => {
    if (mode === "list") inputRef.current?.focus();
  }, [mode]);

  const q = query.trim();
  const list = q ? results : recents;
  const showByCode = DEAL_CODE_SEARCH_ENABLED && looksLikeCode(q);
  const navItems = useMemo(
    () => (showByCode ? [{ __bycode: true }] : []).concat(list),
    [showByCode, list]
  );
  useEffect(() => setKbd(0), [navItems.length]);

  const partyOf = (c) => ({
    kind: c.accountingCode ? "account" : "client",
    clientId: c.id,
    accountingCode: c.accountingCode || undefined,
    name: c.name || undefined,
    label: c.accountingCode || c.name || "Счёт",
  });
  const pick = (c) => {
    onSelect?.(partyOf(c));
    onClose?.();
  };
  const pickCash = () => {
    onSelect?.({ kind: "cash", label: "Наличные" });
    onClose?.();
  };
  const useCode = (code) => {
    onSelect?.({ kind: "contact", contact: code, label: code });
    onClose?.();
  };
  const openByCode = async (code) => {
    setFoundCode(code);
    setMode("found");
    setFoundDeal(undefined);
    try {
      setFoundDeal(await findDealByCode(code));
    } catch {
      setFoundDeal(null);
    }
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setKbd((k) => Math.min(k + 1, navItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setKbd((k) => Math.max(k - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = navItems[kbd] || navItems[0];
      if (!it) return;
      if (it.__bycode) openByCode(q);
      else pick(it);
    }
  };

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      const c = await createCounterparty({
        name: nf.name,
        telegram: nf.tg,
        phone: nf.phone,
      });
      onSelect?.(partyOf(c));
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Не удалось создать (нужна настройка прав)");
    } finally {
      setBusy(false);
    }
  };

  // ── строки списка ──
  const Row = ({ c, idx }) => {
    const active = kbd === idx;
    const sub = c.accountingCode
      ? `счёт · ${c.telegram || c.phone || "—"}`
      : c.telegram || c.phone || "контрагент";
    return (
      <button
        type="button"
        onMouseEnter={() => setKbd(idx)}
        onClick={() => pick(c)}
        className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[9px] text-left transition-colors ${
          active ? "bg-[#f1f4ff]" : "hover:bg-[#f1f4ff]"
        }`}
      >
        {c.accountingCode ? (
          <span className="font-mono text-[11px] font-bold text-[#586079] bg-[#ebedf4] border border-[#e0e3ee] rounded-[7px] px-[7px] py-1 min-w-[26px] text-center whitespace-nowrap">
            {c.accountingCode}
          </span>
        ) : (
          <span className="w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-extrabold text-white bg-[#5b6cff] shrink-0">
            {initial(c.name)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-ink truncate">{c.name || "Счёт"}</span>
          <span className="block text-[10px] text-muted font-mono mt-px truncate">{sub}</span>
        </span>
      </button>
    );
  };

  let body;
  if (mode === "found") {
    const d = foundDeal;
    body = (
      <div className="p-[13px]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[9px] font-extrabold tracking-wide uppercase text-muted">
            Сделка по коду {foundCode}
          </span>
          <button type="button" className="text-[11px] font-bold text-[#5b6cff]" onClick={() => setMode("list")}>
            ← поиск
          </button>
        </div>
        {d === undefined ? (
          <div className="text-center text-[12px] text-muted py-4">Поиск…</div>
        ) : (
          <div className="border border-[#dde0ea] rounded-[11px] p-3 bg-[#f6f7fb] text-center text-[12px] text-muted">
            По этому коду в истории ничего нет.
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => setMode("list")}
            className="text-[12px] font-bold rounded-[8px] px-2.5 py-2 bg-[#eef0f4] text-[#454a66]"
          >
            Назад
          </button>
        </div>
      </div>
    );
  } else if (mode === "new") {
    body = (
      <div className="p-[13px]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[9px] font-extrabold tracking-wide uppercase text-muted">Новый контрагент</span>
          <button type="button" className="text-[11px] font-bold text-[#5b6cff]" onClick={() => setMode("list")}>
            ← назад
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          <Field
            label="Имя"
            value={nf.name}
            onChange={(v) => setNf((s) => ({ ...s, name: v }))}
            placeholder="например, memet"
          />
          <Field
            label="Telegram (необязательно)"
            value={nf.tg}
            onChange={(v) => setNf((s) => ({ ...s, tg: v }))}
            placeholder="@username"
          />
          <Field
            label="Телефон (необязательно)"
            value={nf.phone}
            onChange={(v) => setNf((s) => ({ ...s, phone: v }))}
            placeholder="+90 5__ ___ __ __"
          />
          {err && <div className="text-[11px] font-semibold text-[#cf3b40]">⚠ {err}</div>}
          <div className="flex gap-2 mt-0.5">
            <button
              type="button"
              onClick={() => setMode("list")}
              className="text-[12px] font-bold rounded-[8px] px-2.5 py-2.5 bg-[#eef0f4] text-[#454a66]"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={create}
              className="flex-1 text-[12px] font-bold rounded-[8px] px-2.5 py-2.5 bg-[#159a5d] text-white disabled:opacity-50"
            >
              {busy ? "Создаём…" : "Создать и выбрать"}
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <div className="flex items-center gap-2.5 px-[13px] py-[11px] border-b border-[#e7e9f1]">
          <Search className="w-4 h-4 text-muted shrink-0" strokeWidth={2.2} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Имя, счёт, телеграм или код…"
            autoComplete="off"
            className="w-full border-0 outline-none text-[13px] text-ink bg-transparent placeholder:text-[#b6bacb]"
          />
        </div>
        <div className="max-h-[316px] overflow-y-auto p-[5px]">
          {showByCode && (
            <button
              type="button"
              onClick={() => openByCode(q)}
              onMouseEnter={() => setKbd(0)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[9px] text-left border border-dashed border-[#c4d0ff] my-0.5 ${
                kbd === 0 ? "bg-[#e6edff]" : "bg-[#eef2ff] hover:bg-[#e6edff]"
              }`}
            >
              <span className="w-[26px] h-[26px] rounded-full grid place-items-center text-[12px] font-bold text-[#5b6cff] bg-[#dfe4ff] shrink-0">
                №
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-[#5b6cff] truncate">Найти по коду «{q}»</span>
                <span className="block text-[10px] text-[#8a93c8]">подтянуть контакт, суммы и курс</span>
              </span>
            </button>
          )}
          <div className="text-[9px] font-extrabold tracking-wide uppercase text-muted px-2.5 pt-2 pb-1">
            {q ? "Найдено" : "Недавние"}
          </div>
          {list.length ? (
            list.map((c, i) => <Row key={c.id} c={c} idx={showByCode ? i + 1 : i} />)
          ) : (
            <div className="px-3.5 py-5 text-center text-muted text-[12px] leading-relaxed">
              Ничего не найдено.
              <br />
              Создайте контрагента ниже.
            </div>
          )}
        </div>
        <div className="border-t border-[#e7e9f1] p-[5px]">
          <button
            type="button"
            onClick={pickCash}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-[12.5px] font-bold text-ink hover:bg-[#f1f4ff]"
          >
            <span className="w-[26px] h-[26px] rounded-[7px] grid place-items-center text-[16px] bg-[#e7f6ee] text-[#0b8a54] shrink-0">
              ¤
            </span>
            Наличные
            <span className="ml-auto text-[11px] font-medium text-muted">без счёта</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setErr("");
              setNf({
                name: query.trim().startsWith("@") ? "" : query.trim(),
                tg: query.trim().startsWith("@") ? query.trim() : "",
                phone: "",
              });
              setMode("new");
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-[12.5px] font-bold text-[#5b6cff] hover:bg-[#f1f4ff]"
          >
            <span className="w-[26px] h-[26px] rounded-[7px] grid place-items-center bg-[#eef0ff] text-[#5b6cff] shrink-0">
              <Plus className="w-4 h-4" strokeWidth={2.6} />
            </span>
            Новый контрагент
          </button>
        </div>
      </>
    );
  }

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="Выбор контрагента"
      className="fixed z-[130] w-[346px] bg-surface border border-[#dde0ea] rounded-[14px] shadow-[0_24px_60px_-18px_rgba(16,24,40,.4),0_6px_18px_-8px_rgba(16,24,40,.18)] overflow-hidden"
      style={{
        left: place?.left ?? -9999,
        top: place?.top,
        bottom: place?.bottom,
        visibility: ready ? "visible" : "hidden",
      }}
    >
      {body}
    </div>,
    document.body
  );
}

function Field({ label, value, onChange, placeholder, mono }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-muted uppercase tracking-wide mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={`w-full box-border text-[13px] text-ink border border-[#dde0ea] rounded-[8px] px-2.5 py-2 outline-none focus:border-[#5b6cff] focus:shadow-[0_0_0_3px_rgba(91,108,255,.12)] ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}
