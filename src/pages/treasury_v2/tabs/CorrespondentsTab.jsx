// src/pages/treasury_v2/tabs/CorrespondentsTab.jsx
// Бухгалтерский репорт по корреспондентским счетам:
//   • NOSTRO — наши деньги у внешней стороны (наш счёт у биржи, у банка-
//     корреспондента, у партнёра-обменника). По бухгалтерии это ASSET
//     subtype="nostro".
//   • LORO   — деньги партнёра/контрагента у НАС (он оставил оборотные
//     средства, мы держим их под управлением). Это LIABILITY с двумя
//     каноничными подтипами: subtype="loro" и исторический "partner_liab".
//     Оба показываем как «LORO» — они эквивалентны по сути.
//
// Цель: видеть в одной табличке открытые позиции с каждым корреспондентом,
// нетто-картину по валюте и быстро понять: «партнёр A нам должен $X, мы ему
// должны $Y, итого net $Z».
//
// Read-only: правки делаются стандартным inline-edit (плашка на остатке).
import React, { useMemo, useState } from "react";
import { Globe, ChevronRight, ChevronDown, ArrowUpDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../../utils/money.js";

// Liability subtypes которые считаем LORO (наш долг перед корреспондентом).
const LORO_SUBTYPES = new Set(["loro", "partner_liab"]);
// Asset subtype для NOSTRO.
const NOSTRO_SUBTYPES = new Set(["nostro"]);

const fmtBaseAmount = (n, base) =>
  `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${base}`;
const fmtSignedBase = (n, base) =>
  `${n < 0 ? "−" : ""}${fmtBaseAmount(Math.abs(n), base)}`;
const fmtCur = (a, c) =>
  `${curSymbol(c)}${fmt(a, c)}${curSymbol(c) ? "" : ` ${c}`}`;

function passesOffice(acc, officeFilter) {
  if (officeFilter === "all" || !officeFilter) return true;
  return acc.officeId === officeFilter;
}

// Строит структуру:
//   nostroByAccount[]: { account, currency, balance, balanceInBase, dims }
//   loroByAccount[]: то же
//   netByCurrency: Map<currency, { native: nostro − |loro|, base: ... }>
function buildCorrespondents(ctx, officeFilter) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const balByAccount = new Map();
  for (const b of ctx.balances || []) {
    const list = balByAccount.get(b.accountId) || [];
    list.push(b);
    balByAccount.set(b.accountId, list);
  }

  const nostro = [];
  const loro = [];
  const netByCurrency = new Map();

  for (const acc of ctx.accounts || []) {
    if (!passesOffice(acc, officeFilter)) continue;
    const isNostro = acc.type === "asset" && NOSTRO_SUBTYPES.has(acc.subtype);
    const isLoro = acc.type === "liability" && LORO_SUBTYPES.has(acc.subtype);
    if (!isNostro && !isLoro) continue;

    const rows = balByAccount.get(acc.id) || [];
    let native = 0;
    const dims = [];
    for (const b of rows) {
      const v = Number(b.balance) || 0;
      native += v;
      if (b.clientId || b.partnerId) {
        const inBase = ctx.toBase(v, b.currency) || 0;
        dims.push({
          clientId: b.clientId || null,
          partnerId: b.partnerId || null,
          balance: v,
          balanceInBase: inBase,
        });
      }
    }
    if (Math.abs(native) < 1e-9 && dims.length === 0) continue;
    const inBase = ctx.toBase(native, acc.currency) || 0;
    const item = {
      account: acc,
      currency: acc.currency,
      balance: native,
      balanceInBase: inBase,
      dims: dims.sort((a, b) => Math.abs(b.balanceInBase) - Math.abs(a.balanceInBase)),
    };
    if (isNostro) nostro.push(item);
    else loro.push(item);

    // Net по валюте: nostro = +, loro = − (мы должны, минусом).
    const bucket = netByCurrency.get(acc.currency) || { currency: acc.currency, nostro: 0, loro: 0, nostroBase: 0, loroBase: 0 };
    if (isNostro) {
      bucket.nostro += native;
      bucket.nostroBase += inBase;
    } else {
      bucket.loro += native; // liability balance уже Cr-normal; abs покажем при выводе
      bucket.loroBase += inBase;
    }
    netByCurrency.set(acc.currency, bucket);
  }

  nostro.sort((a, b) => Math.abs(b.balanceInBase) - Math.abs(a.balanceInBase));
  loro.sort((a, b) => Math.abs(b.balanceInBase) - Math.abs(a.balanceInBase));
  const netList = [...netByCurrency.values()]
    .map((b) => ({
      ...b,
      // Для liability balance с Cr-normal у нас хранится отрицательным
      // (Dr−Cr). |loro| = -loro если loro<0; берём абс.
      loroAbs: Math.abs(b.loro),
      loroBaseAbs: Math.abs(b.loroBase),
      netNative: b.nostro - Math.abs(b.loro),
      netBase: b.nostroBase - Math.abs(b.loroBase),
    }))
    .sort((a, b) => Math.abs(b.netBase) - Math.abs(a.netBase));

  return { nostro, loro, netList };
}

function Section({ title, hint, color, items, baseCurrency, ctx, displayMul = 1 }) {
  const [openId, setOpenId] = useState(null);
  const total = items.reduce((s, it) => s + it.balanceInBase * displayMul, 0);
  const colorCls =
    color === "emerald"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-rose-50 text-rose-700 ring-rose-200";
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ring-1 ${colorCls}`}>
          {title}
        </span>
        <span className="text-[11.5px] text-slate-400">{hint}</span>
        <span className="ml-auto text-[14px] font-bold tabular-nums text-slate-900">
          {fmtSignedBase(total, baseCurrency)}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">Счетов этого типа нет</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
              <th className="text-left py-1.5 px-4 font-bold w-6"></th>
              <th className="text-left py-1.5 font-bold">Счёт</th>
              <th className="text-right py-1.5 font-bold">Остаток</th>
              <th className="text-right py-1.5 px-4 font-bold">≈ в base</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const isOpen = openId === it.account.id;
              const hasDims = it.dims && it.dims.length > 0;
              return (
                <React.Fragment key={it.account.id}>
                  <tr
                    onClick={() => hasDims && setOpenId(isOpen ? null : it.account.id)}
                    className={`border-t border-slate-100 ${hasDims ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  >
                    <td className="py-1.5 px-4">
                      {hasDims && (isOpen ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />)}
                    </td>
                    <td className="py-1.5">
                      <span className="font-mono text-[10.5px] text-slate-400 mr-1.5">{it.account.code}</span>
                      <span className="font-medium text-slate-800">{it.account.name}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">
                      {fmtCur(it.balance * displayMul, it.currency)}
                    </td>
                    <td className="py-1.5 px-4 text-right tabular-nums font-semibold text-slate-900">
                      {fmtSignedBase(it.balanceInBase * displayMul, baseCurrency)}
                    </td>
                  </tr>
                  {isOpen && hasDims && (
                    <tr className="bg-slate-50/40">
                      <td colSpan={4} className="py-1.5 px-8">
                        <div className="space-y-0.5">
                          {it.dims.map((d, i) => {
                            const id = d.clientId || d.partnerId;
                            const name = ctx?.counterpartyName ? ctx.counterpartyName(id) : String(id || "").slice(0, 8);
                            const kind = d.clientId ? "client" : d.partnerId ? "partner" : "";
                            return (
                              <div key={`${id || ""}_${i}`} className="flex items-baseline gap-3 text-[11.5px]">
                                <span className="text-slate-400 text-[10px] uppercase tracking-wider w-12">{kind}</span>
                                <span className="text-slate-700 flex-1 truncate">{name || "—"}</span>
                                <span className="tabular-nums text-slate-700 w-28 text-right">{fmtCur(d.balance * displayMul, it.currency)}</span>
                                <span className="tabular-nums text-slate-500 w-24 text-right">{fmtSignedBase(d.balanceInBase * displayMul, baseCurrency)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function CorrespondentsTab({ ctx, officeFilter, baseCurrency }) {
  const { t } = useTranslation();
  const data = useMemo(() => buildCorrespondents(ctx, officeFilter), [ctx, officeFilter]);
  const hasAnything = data.nostro.length > 0 || data.loro.length > 0;

  return (
    <div className="space-y-4">
      {/* Header / explainer */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] px-4 py-3 flex items-start gap-3 flex-wrap">
        <Globe className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[13.5px] font-bold text-slate-900">Корреспондентские счета</h2>
          <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">
            <strong>NOSTRO</strong> — наши деньги у внешней стороны (биржа, банк-корреспондент,
            партнёр держит наш оборот). По бухгалтерии — актив subtype="nostro".
            <br />
            <strong>LORO</strong> — деньги контрагента у нас (партнёр оставил оборотные средства).
            Liability subtype="loro" (или исторический "partner_liab").
          </p>
        </div>
      </div>

      {!hasAnything ? (
        <div className="bg-white border border-slate-200/70 rounded-[14px] px-4 py-10 text-center text-[12.5px] text-slate-400">
          Корр-счета не заведены. Создать новый: «+ Счёт в план» в Активах (subtype "nostro") или
          в Пассивах (subtype "loro").
        </div>
      ) : (
        <>
          <Section
            title="NOSTRO"
            hint="наши деньги у внешней стороны"
            color="emerald"
            items={data.nostro}
            baseCurrency={baseCurrency}
            ctx={ctx}
            displayMul={1}
          />
          <Section
            title="LORO"
            hint="деньги партнёра у нас"
            color="rose"
            items={data.loro}
            baseCurrency={baseCurrency}
            ctx={ctx}
            displayMul={-1}
          />

          {/* Net по валютам — Σ NOSTRO − |LORO| */}
          {data.netList.length > 0 && (
            <div className="bg-white border border-slate-200/70 rounded-[14px] overflow-hidden">
              <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
                <h3 className="text-[13px] font-bold text-slate-900 uppercase tracking-wide">
                  Чистая позиция по валютам
                </h3>
                <span className="text-[11px] text-slate-400 ml-auto">NOSTRO − |LORO|</span>
              </header>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="text-left py-1.5 px-4 font-bold">Валюта</th>
                    <th className="text-right py-1.5 font-bold">NOSTRO</th>
                    <th className="text-right py-1.5 font-bold">LORO</th>
                    <th className="text-right py-1.5 px-4 font-bold">Net (в base)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.netList.map((row) => (
                    <tr key={row.currency} className="border-t border-slate-100">
                      <td className="py-1.5 px-4 font-bold text-slate-700">{row.currency}</td>
                      <td className="py-1.5 text-right tabular-nums text-emerald-700">
                        {row.nostro > 0 ? `+${fmtCur(row.nostro, row.currency)}` : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-rose-700">
                        {row.loroAbs > 0 ? `−${fmtCur(row.loroAbs, row.currency)}` : "—"}
                      </td>
                      <td className={`py-1.5 px-4 text-right tabular-nums font-semibold ${row.netBase < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {fmtSignedBase(row.netBase, baseCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
