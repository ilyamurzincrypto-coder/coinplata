// src/components/RatesPanelV2.jsx
// Блочная панель курсов (фаза 2а, PR-C) — Экран 1 эталона r8. За флагом
// rates_v2_ui; всем без флага показывается переходная панель (Экран 1а),
// её источники не тронуты.
//
// ЗАЧЕМ ВПЕРЁД ОКНА ВСТАВКИ: без этой панели публикация уходит в пустоту —
// кассир жмёт «Опубликовать v.N» и нигде, кроме самого редактора, результата
// не видит. Цикл «опубликовал → увидел» замыкается здесь.
//
// Данные — ТОЛЬКО из get_published_rates(): панель показывает опубликованное,
// а не черновик. Пока публикаций нет — так и написано.

import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Pencil, Plus } from "lucide-react";
import { loadBlocks, loadPublished, publishedMap } from "../lib/ratesV2.js";
import { COL_INTO, COL_OUT, Reveal, useRevealHover } from "./rates/hoverReveal.jsx";

// Порядок колонок блочной панели: сначала «USDT →», потом «→ USDT» — обратный
// переходной панели. Именно поэтому пара берётся из дескриптора (см. hoverReveal).
const USDT_COLS = [COL_OUT, COL_INTO];

const fmtNum = (v, dp = 4) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: dp });

// Число-герой: целая часть крупно, дробная мельче (эталон .num).
function Hero({ value }) {
  if (value == null || !Number.isFinite(value)) return <span className="font-light text-[40px] leading-none">—</span>;
  const s = fmtNum(value, 2);
  const [int, frac] = s.split(",");
  return (
    <span className="font-light leading-none tracking-[-0.01em]">
      <span className="text-[40px]">{int}</span>
      {frac && <span className="text-[21px] text-[#6B675C]">,{frac}</span>}
    </span>
  );
}

const hhmm = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : "";
};

/** Карточка блока — белая (эталон .bcard) или акцентная сине-серая. */
function BlockCard({ accent = false, icon, label, foot, onOpen, children }) {
  return (
    <div
      className={`rounded-card-2 p-[18px] mb-2.5 relative ${accent ? "text-blue-ink" : "bg-card"}`}
      style={accent ? { backgroundImage: "radial-gradient(220px 160px at 88% -20%, rgba(240,196,130,.55), transparent 70%), linear-gradient(148deg, #93A0B5, #76869E)" } : undefined}
    >
      <div className="flex justify-between items-start mb-5">
        <span className={`w-[34px] h-[34px] rounded-full border flex items-center justify-center ${accent ? "border-[rgba(233,237,242,.45)] text-blue-ink" : "border-line-2 text-[#6B675C]"}`}>
          {icon}
        </span>
        <button
          type="button"
          onClick={onOpen}
          title="Открыть в редакторе"
          className={`w-[34px] h-[34px] rounded-full flex items-center justify-center ${accent ? "bg-card text-ink" : "bg-ink text-cream"}`}
        >
          <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
      </div>
      <div className={`text-[13px] mb-1 ${accent ? "text-blue-soft" : "text-muted"}`}>{label}</div>
      {children}
      {foot && <div className={`text-[11.5px] mt-3 ${accent ? "text-blue-soft" : "text-faint"}`}>{foot}</div>}
    </div>
  );
}

export default function RatesPanelV2({ onOpenRates }) {
  const { revealed, bind } = useRevealHover();
  const [blocks, setBlocks] = useState(null);
  const [published, setPublished] = useState(null);
  const [err, setErr] = useState("");
  const [scopeByBlock, setScopeByBlock] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [bs, pub] = await Promise.all([loadBlocks(), loadPublished()]);
        if (!alive) return;
        setBlocks(bs);
        setPublished(pub);
        setScopeByBlock(Object.fromEntries(bs.map((b) => [b.code, b.scopes?.[0] || null])));
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  const priceMap = useMemo(() => publishedMap(published), [published]);
  const rateOf = (block, scope, from, to) => priceMap[`${block}|${scope || ""}|${from}|${to}`];

  if (err) return <aside className="text-[12.5px] text-danger p-2">Панель курсов: {err}</aside>;
  if (!blocks) return <aside className="text-[12.5px] text-muted p-2">Загрузка курсов…</aside>;

  const byCode = Object.fromEntries(blocks.map((b) => [b.code, b]));
  const cash = byCode.cash;
  const usdt = byCode.usdt;
  const per = byCode.perestanovka;
  const qr = byCode.qr;
  const nerez = byCode.nerez;

  const usdtScope = scopeByBlock.usdt || usdt?.scopes?.[0];
  const nerezScope = scopeByBlock.nerez || nerez?.scopes?.[0];

  // Строки USDT текущего города: пара валют × две стороны.
  const usdtCcys = usdt
    ? [...new Set(usdt.rows.filter((r) => r.scope === usdtScope && r.enabled !== false).map((r) => (r.from_ccy === "USDT" ? r.to_ccy : r.from_ccy)))]
    : [];

  // Перестановки: сколько маршрутов со своей маржой против дефолта блока.
  const perOwn = per ? per.rows.filter((r) => r.value != null).length : 0;

  return (
    <aside className="flex flex-col">
      <div className="flex items-center justify-between px-1.5 pt-1 pb-3">
        <span className="text-[17px]">Курсы</span>
        <span className="text-[12px] text-muted tabular-nums">
          {published ? `v. ${published.version} · ${hhmm(published.published_at)}` : "публикаций ещё нет"}
        </span>
      </div>

      {/* 1. Нал */}
      {cash && (
        <BlockCard
          onOpen={onOpenRates}
          label={`${cash.title} · ${cash.config?.provider || "авто"}`}
          foot={`${(cash.scopes || []).join(" и ")} · спред ${cash.config?.spread_pct ?? 0}${cash.config?.spread_mode === "abs" ? " коп." : "%"}`}
          icon={<span className="text-[13px]">₺</span>}
        >
          {cash.rows.filter((r) => r.to_ccy === "TRY" && r.enabled !== false).map((r) => (
            <div key={r.id} className="flex justify-between items-baseline py-2.5 border-t border-line first:border-t-0 first:pt-0">
              <span className="text-[12.5px] text-muted">{r.from_ccy} → {r.to_ccy}</span>
              <span className="font-light text-[24px] tabular-nums">{fmtNum(rateOf("cash", r.scope, r.from_ccy, r.to_ccy), 2)}</span>
            </div>
          ))}
        </BlockCard>
      )}

      {/* 2. USDT — акцентная карточка с чипами городов */}
      {usdt && (
        <BlockCard
          accent
          onOpen={onOpenRates}
          label={`${usdt.title} · вручную, с утра`}
          foot="всё, что связано с тезером · MSK и SPB — пары к RUB"
          icon={<span className="text-[13px]">₮</span>}
        >
          <div className="flex gap-1.5 mb-1">
            {(usdt.scopes || []).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScopeByBlock((m) => ({ ...m, usdt: s }))}
                className={`text-[11px] px-3 py-[5px] rounded-full border ${
                  s === usdtScope ? "bg-blue-ink text-[#3E4C63] border-transparent" : "border-[rgba(233,237,242,.4)] text-blue-soft"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid gap-2.5 py-0.5" style={{ gridTemplateColumns: "minmax(0,1fr) 64px 64px" }}>
            <span />
            {USDT_COLS.map((col) => (
              <span
                key={col.key}
                {...bind(col.key)}
                className={`text-[10.5px] text-right cursor-default transition-colors duration-300 ${
                  revealed === col.key ? "text-white opacity-100" : "text-blue-soft opacity-85"
                }`}
              >
                {col.caption}
              </span>
            ))}
          </div>
          {usdtCcys.map((c) => {
            const out = rateOf("usdt", usdtScope, "USDT", c);
            const into = rateOf("usdt", usdtScope, c, "USDT");
            const isPct = usdt.rows.find((r) => r.scope === usdtScope && r.from_ccy === "USDT" && r.to_ccy === c)?.value_mode === "pct";
            const show = (v) => (v == null ? "—" : isPct ? `${((v - 1) * 100).toFixed(2)}%` : fmtNum(v, 4));
            const byKey = { out, into };
            const shown = USDT_COLS.find((x) => x.key === revealed);
            return (
              <div key={c} className="grid gap-2.5 items-baseline py-2 border-t border-[rgba(233,237,242,.22)]" style={{ gridTemplateColumns: "minmax(0,1fr) 64px 64px" }}>
                <Reveal
                  base={c}
                  full={shown ? shown.pair(c) : ""}
                  on={!!shown}
                  glow
                  className="text-[12.5px] text-blue-soft"
                  revealClass="text-white"
                />
                {USDT_COLS.map((col) => (
                  <span
                    key={col.key}
                    className={`font-light text-[19px] text-right tabular-nums whitespace-nowrap transition-opacity duration-[350ms] ${
                      revealed && revealed !== col.key ? "opacity-35" : "opacity-100"
                    }`}
                  >
                    {show(byKey[col.key])}
                  </span>
                ))}
              </div>
            );
          })}
        </BlockCard>
      )}

      {/* 3. Перестановки — маршрутная маржа */}
      {per && (
        <BlockCard
          onOpen={onOpenRates}
          label={per.title}
          foot={`от USDT · маржа ${Number(per.config?.margin_pct ?? 0).toLocaleString("ru-RU")}% по умолчанию · ${perOwn} ${perOwn === 1 ? "маршрут" : "маршрутов"} со своей`}
          icon={<span className="text-[13px]">⇄</span>}
        >
          <div className="font-light leading-none tracking-[-0.01em]">
            <span className="text-[40px]">+{String(per.config?.margin_pct ?? 0).split(".")[0]}</span>
            <span className="text-[21px] text-[#6B675C]">,{(String(per.config?.margin_pct ?? 0).split(".")[1] || "0")}%</span>
          </div>
        </BlockCard>
      )}

      {/* 4. QR ₽ */}
      {qr && (
        <BlockCard
          onOpen={onOpenRates}
          label={`${qr.title} · ЦБ + спред ${qr.config?.spread_pct ?? 0}%`}
          foot={`блок ${qr.position} · авто от ЦБ · ${qr.rows.map((r) => r.from_ccy).join(" / ")} → ₽`}
          icon={<span className="text-[13px]">▦</span>}
        >
          <Hero value={rateOf("qr", null, "USDT", "RUB")} />
        </BlockCard>
      )}

      {/* 5. НЕРЕЗ — сетка Прод./Покуп. × базисы */}
      {nerez && (
        <BlockCard
          onOpen={onOpenRates}
          label={`${nerez.title} · USDT ↔ RUB · ${nerez.config?.source || "вручную"}`}
          foot={`блок ${nerez.position} · TOD/TOM — расчётные базисы, не города`}
          icon={<span className="text-[13px]">≡</span>}
        >
          <div className="grid gap-2 py-0.5" style={{ gridTemplateColumns: "56px repeat(3, minmax(0,1fr))" }}>
            <span />
            {(nerez.scopes || []).map((s) => (
              <span key={s} className="text-[10.5px] text-faint text-right">{s.replace("TOD-TOD", "Т-Т").replace("TOD-TOM", "Т-М").replace("TOM-TOM", "М-М")}</span>
            ))}
          </div>
          {[["USDT", "RUB", "Прод."], ["RUB", "USDT", "Покуп."]].map(([f, t, label]) => (
            <div key={label} className="grid gap-2 items-baseline py-1.5 border-t border-line" style={{ gridTemplateColumns: "56px repeat(3, minmax(0,1fr))" }}>
              <span className="text-[12px] text-muted">{label}</span>
              {(nerez.scopes || []).map((s) => (
                <span key={s} className="font-light text-[16px] text-right tabular-nums whitespace-nowrap">{fmtNum(rateOf("nerez", s, f, t), 2)}</span>
              ))}
            </div>
          ))}
        </BlockCard>
      )}

      {/* Пунктирный слот «Добавить блок» — новый блок заводится записью в БД */}
      <div className="rounded-card-2 border-[1.5px] border-dashed border-line-2 flex items-center justify-center gap-2 text-muted text-[13px] p-4 mb-2.5">
        <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
        Добавить блок
      </div>

      <button
        type="button"
        onClick={onOpenRates}
        className="w-full rounded-full bg-ink text-cream text-[14px] py-3.5 flex items-center justify-center gap-2 hover:bg-black transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
        Редактировать курсы
      </button>
    </aside>
  );
}
