// src/pages/treasury_v2/tabs/DashboardTab.jsx
// Treasury «Дашборд» — read-only overview built from the v2 ledger: capital
// identity, P&L for a period, asset balances by office, open obligations, and the
// last few deals. Cards-only, no mutations. It's the Treasury landing tab.
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useOpenObligations } from "../../../store/openObligations.js";
import { balanceCheckTotals, pnlForPeriod, groupByClass, transactionTree } from "../../../lib/treasury/v2selectors.js";
import { dealSummary } from "../../../lib/treasury/dealSummary.js";
import { bucketObligations, obligationLegTotals } from "../../../lib/treasury/paymentCalendar.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtBaseAmount = (n, baseCurrency) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency}`;
const fmtSignedBase = (n, baseCurrency) => `${n < 0 ? "−" : ""}${fmtBaseAmount(Math.abs(n), baseCurrency)}`;

function Card({ className = "", children }) {
  return <div className={`bg-white rounded-[14px] border border-slate-200/70 p-4 ${className}`}>{children}</div>;
}

function CapitalCard({ ctx, officeFilter, baseCurrency }) {
  const { t } = useTranslation();
  const totals = useMemo(() => balanceCheckTotals(ctx, officeFilter), [ctx, officeFilter]);
  const ok = totals.identityCheck.ok;
  return (
    <Card className="md:col-span-2 lg:col-span-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-bold text-slate-900">{t("trv2_dash_capital")}</h3>
        <span className={`text-[11.5px] font-medium px-2 py-0.5 rounded-full ${ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {ok ? t("trv2_dash_identity_ok") : t("trv2_dash_identity_off").replace("{delta}", fmtBaseAmount(totals.identityCheck.delta, baseCurrency))}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { k: "trv2_dash_assets", v: totals.assets },
          { k: "trv2_dash_liabilities", v: totals.liabilities },
          { k: "trv2_dash_equity", v: totals.equity },
        ].map((x) => (
          <div key={x.k} className="rounded-[10px] bg-slate-50 px-3 py-2.5">
            <div className="text-[11px] text-slate-500">{t(x.k)}</div>
            <div className="text-[19px] font-bold tabular-nums text-slate-900">{fmtBaseAmount(x.v, baseCurrency)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PnLCard({ ctx, officeFilter, baseCurrency, period, setPeriod }) {
  const { t } = useTranslation();
  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const pnl = useMemo(() => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter), [ctx, win.from, win.to, officeFilter]);
  const net = pnl.netProfit;
  return (
    <Card>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-[13px] font-bold text-slate-900">{t("trv2_dash_pnl")}</h3>
      </div>
      <div className="mb-3"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <div className="text-[11px] text-slate-500">{t("trv2_dash_net_profit")}</div>
      <div className={`text-[22px] font-bold tabular-nums ${net < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(net, baseCurrency)}</div>
      <div className="mt-3 space-y-1 text-[12px]">
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_revenue")}</span><span className="tabular-nums">+{fmtBaseAmount(pnl.revenue.total, baseCurrency)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_expense")}</span><span className="tabular-nums">−{fmtBaseAmount(pnl.expense.total, baseCurrency)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_fx")}</span><span className="tabular-nums">{fmtSignedBase(pnl.fxNet, baseCurrency)}</span></div>
      </div>
    </Card>
  );
}

function ByOfficeCard({ ctx, baseCurrency }) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  // Pull every asset account regardless of the Treasury office picker, then group
  // by the account's own officeId. groupByClass reads ctx.officeFilter internally,
  // so feed it an "all" override.
  const rows = useMemo(() => {
    const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
    const sections = groupByClass({ ...ctx, officeFilter: "all" }, "asset");
    const byOffice = new Map(); // officeId|"" -> totalInBase
    for (const sect of sections) {
      for (const a of sect.accounts) {
        const officeId = accById.get(a.accountId)?.officeId || "";
        byOffice.set(officeId, (byOffice.get(officeId) || 0) + (a.balanceInBase || 0));
      }
    }
    return [...byOffice.entries()]
      .map(([officeId, total]) => ({
        officeId,
        name: officeId ? (findOffice(officeId)?.name || officeId) : t("trv2_dash_no_office"),
        total,
      }))
      .sort((x, y) => y.total - x.total);
  }, [ctx, findOffice, t]);
  return (
    <Card>
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_by_office")}</h3>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-400">—</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.officeId || "_none"} className="border-t border-slate-100 first:border-t-0">
                <td className="py-1.5 text-slate-700">{r.name}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{fmtBaseAmount(r.total, baseCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ObligationsCard({ officeFilter }) {
  const { t } = useTranslation();
  const { items, loading } = useOpenObligations();
  const filtered = useMemo(
    () => (items || []).filter((it) => !officeFilter || officeFilter === "all" || !it.office_id || it.office_id === officeFilter),
    [items, officeFilter]
  );
  const buckets = useMemo(() => bucketObligations(filtered), [filtered]);
  const legTotals = useMemo(() => {
    const byCur = new Map();
    for (const it of filtered) for (const lt of obligationLegTotals(it)) byCur.set(lt.currency, (byCur.get(lt.currency) || 0) + lt.amount);
    return [...byCur.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
  }, [filtered]);

  return (
    <Card>
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_open_oblig")}</h3>
      {loading ? (
        <div className="text-[12px] text-slate-400">…</div>
      ) : filtered.length === 0 ? (
        <div className="text-[12px] text-slate-400">{t("trv2_dash_oblig_none")}</div>
      ) : (
        <>
          <div className="text-[22px] font-bold tabular-nums text-slate-900">{filtered.length}</div>
          <div className="text-[12px] text-slate-600 mt-0.5">
            {legTotals.length === 0 ? "—" : legTotals.map((lt, i) => <span key={lt.currency}>{i > 0 ? " · " : ""}{fmtNum(lt.amount)} {lt.currency}</span>)}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-2">
            {t("trv2_dash_oblig_breakdown")
              .replace("{overdue}", String(buckets.overdue.length))
              .replace("{today}", String(buckets.today.length))
              .replace("{week}", String(buckets.week.length))
              .replace("{later}", String(buckets.later.length))
              .replace("{no_date}", String(buckets.no_date.length))}
          </div>
        </>
      )}
    </Card>
  );
}

const fmtAmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
function dealLine(node, accById, t) {
  const s = dealSummary(node, accById);
  if (!s) return null;
  const leg = (l) => `${fmtAmt(l.amount)} ${l.currency}`;
  const sides = [];
  if (s.in.length) sides.push(s.in.map(leg).join(" + "));
  if (s.out.length) sides.push(s.out.map(leg).join(" + "));
  return sides.join(" → ") || null;
}

function RecentDealsCard({ ctx, officeFilter, onOpenSource, period }) {
  const { t } = useTranslation();
  const win = useMemo(() => presetWindow(period), [period]);
  const tree = useMemo(
    () => transactionTree(ctx, { type: "deal", officeFilter, period: { from: win.from, to: win.to } }).slice(0, 8),
    [ctx, officeFilter, win.from, win.to]
  );
  const accById = useMemo(() => new Map((ctx.accounts || []).map((a) => [a.id, a])), [ctx.accounts]);
  const cpName = (tx) => tx?.metadata?.client_nickname || (ctx.counterpartyName ? ctx.counterpartyName(tx?.metadata?.counterparty_id) : null) || "—";

  return (
    <Card className="md:col-span-2 lg:col-span-3">
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_recent_deals")}</h3>
      {tree.length === 0 ? (
        <div className="text-[12px] text-slate-400">{t("trv2_dash_no_deals")}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {tree.map((node) => {
            const { tx } = node;
            const line = dealLine(node, accById, t);
            const date = new Date(tx.effectiveDate).toISOString().slice(0, 10);
            const clickable = !!onOpenSource;
            return (
              <div
                key={tx.id}
                onClick={clickable ? () => onOpenSource(tx) : undefined}
                className={`py-2 flex items-baseline gap-3 text-[12.5px] ${clickable ? "cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded" : ""}`}
              >
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0 w-20">{date}</span>
                <span className="text-slate-700 shrink-0 max-w-[160px] truncate">{cpName(tx)}</span>
                <span className="text-slate-500 truncate flex-1">{line || tx.description || "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function DashboardTab({ ctx, officeFilter, baseCurrency, onOpenSource }) {
  const [period, setPeriodState] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_dash_period") || "month"; } catch { return "month"; }
  });
  const setPeriod = (v) => { setPeriodState(v); try { localStorage.setItem("coinplata.treasury_dash_period", v); } catch {} };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <CapitalCard ctx={ctx} officeFilter={officeFilter} baseCurrency={baseCurrency} />
      <PnLCard ctx={ctx} officeFilter={officeFilter} baseCurrency={baseCurrency} period={period} setPeriod={setPeriod} />
      <ByOfficeCard ctx={ctx} baseCurrency={baseCurrency} />
      <ObligationsCard officeFilter={officeFilter} />
      <RecentDealsCard ctx={ctx} officeFilter={officeFilter} onOpenSource={onOpenSource} period={period} />
    </div>
  );
}
