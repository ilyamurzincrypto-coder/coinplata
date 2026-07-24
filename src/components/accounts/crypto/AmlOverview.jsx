// src/components/accounts/crypto/AmlOverview.jsx
// AML-обзор портфеля (комплаенс-кокпит): итоги + кошельки по риску + рисковые
// движения по всем крипто-кошелькам. Данные из /api/aegis/aml (кэш, мгновенно).
import React, { useEffect, useState } from "react";
import { X, ShieldAlert, ArrowDown, ArrowUp, Copy, Check } from "lucide-react";
import { fetchAmlOverview } from "../../../lib/aegisMonitoring.js";

const usd = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const usdt = (n) => (n == null ? "—" : `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT`);
const CAT = {
  mixer: { label: "микшер", color: "#B91C1C" }, gambling: { label: "гэмблинг", color: "#B45309" },
  darknet: { label: "даркнет", color: "#7F1D1D" }, scam: { label: "скам", color: "#DC2626" },
  sanctioned: { label: "санкции", color: "#991B1B" }, blacklist: { label: "чёрный список", color: "#991B1B" },
  exchange: { label: "биржа", color: "#2563EB" }, cex: { label: "биржа", color: "#2563EB" }, p2p: { label: "P2P", color: "#7C3AED" }, p2p_merchant: { label: "P2P", color: "#7C3AED" },
  personal: { label: "приватный", color: "#6B7280" }, private: { label: "приватный", color: "#6B7280" }, internal: { label: "свой", color: "#10B981" },
};
const catMeta = (c) => CAT[String(c || "").toLowerCase()] || { label: c || "—", color: "#9AA0A6" };
const RISK_COLOR = { critical: "#B91C1C", warning: "#B45309", ok: "#10B981" };
const levelOf = (s) => (s == null ? null : s > 80 ? "critical" : s > 25 ? "warning" : "ok");
const mid = (s, h = 8, t = 6) => (!s ? "" : s.length > h + t + 1 ? `${s.slice(0, h)}…${s.slice(-t)}` : s);

function Copyable({ v }) {
  const [c, setC] = useState(false);
  if (!v) return null;
  return (
    <button type="button" className="shrink-0 text-muted hover:text-ink" title="Скопировать"
      onClick={() => navigator.clipboard?.writeText(v).then(() => { setC(true); setTimeout(() => setC(false), 1000); }, () => {})}>
      {c ? <Check className="w-3 h-3 text-emerald" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function Tile({ label, value, tone }) {
  const color = tone === "danger" ? "#B91C1C" : tone === "warn" ? "#B45309" : "#131416";
  return (
    <div className="flex-1 min-w-[110px] bg-surface-sunk rounded-[12px] px-3 py-2.5">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className="mt-0.5 font-mono tabular-nums text-[20px] font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

export default function AmlOverview({ onOpenWallet, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let alive = true;
    fetchAmlOverview().then(
      (d) => alive && setState({ loading: false, error: null, data: d }),
      (e) => alive && setState({ loading: false, error: e?.message || "Ошибка", data: null })
    );
    return () => { alive = false; };
  }, []);

  const d = state.data;
  const t = d?.totals;
  const riskyWallets = (d?.wallets || []).filter((w) => w.riskLevel !== "ok" || (w.riskyExposurePct || 0) > 0.5);

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-bg w-full h-full md:h-auto md:max-h-[92vh] md:w-[860px] md:rounded-[18px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bg/95 backdrop-blur border-b-[0.5px] border-border flex items-center gap-2 px-4 h-12">
          <ShieldAlert className="w-4 h-4 text-danger" />
          <span className="text-[15px] font-semibold text-ink flex-1">AML-обзор портфеля</span>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-4 space-y-5">
          {state.loading && <div className="text-[13px] text-muted">Загрузка…</div>}
          {state.error && <div className="text-[13px] text-danger">{state.error}</div>}

          {d && (
            <>
              {/* Итоги */}
              <div className="flex gap-2 flex-wrap">
                <Tile label="кошельков" value={t.wallets} />
                <Tile label="внимание" value={t.walletsWarn} tone={t.walletsWarn ? "warn" : undefined} />
                <Tile label="пред-бан" value={t.walletsCrit} tone={t.walletsCrit ? "danger" : undefined} />
                <Tile label="рисковых операций" value={t.riskyTxCount} tone={t.riskyTxCount ? "warn" : undefined} />
                <Tile label="санкц. касаний" value={t.sanctionedTouch} tone={t.sanctionedTouch ? "danger" : undefined} />
              </div>

              {/* Кошельки по риску */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Кошельки по риску</div>
                {riskyWallets.length === 0 ? (
                  <div className="text-[12.5px] text-muted py-1">Кошельков с риском/рисковой экспозицией нет.</div>
                ) : (
                  <div className="space-y-1">
                    {riskyWallets.map((w) => {
                      const lvlColor = RISK_COLOR[w.riskLevel] || "#9AA0A6";
                      return (
                        <button key={w.id} type="button" onClick={() => onOpenWallet?.(w.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] hover:bg-surface-soft text-left">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lvlColor }} />
                          <span className="text-[13px] text-ink truncate flex-1 min-w-0">{w.name} <span className="text-[10px] text-muted">{w.network}</span></span>
                          {w.topRiskyCategory && <span className="shrink-0 text-[10px] font-semibold uppercase rounded-[5px] px-1.5 py-0.5" style={{ color: catMeta(w.topRiskyCategory).color, background: `${catMeta(w.topRiskyCategory).color}14` }}>{catMeta(w.topRiskyCategory).label}</span>}
                          {w.riskyExposurePct != null && w.riskyExposurePct > 0.5 && <span className="shrink-0 text-[11px] font-mono tabular-nums text-danger">{w.riskyExposurePct.toFixed(0)}% риск</span>}
                          {w.riskScore != null && <span className="shrink-0 font-mono tabular-nums text-[12px] font-semibold" style={{ color: lvlColor }}>{w.riskScore}<span className="text-muted font-normal text-[9px]">/100</span></span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Рисковые движения */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Рисковые движения · все кошельки</div>
                {(d.riskyTx || []).length === 0 ? (
                  <div className="text-[12.5px] text-muted py-1">Рисковых движений нет (контрагенты без флагов микшер/гэмблинг/санкции/высокий риск).</div>
                ) : (
                  <div className="rounded-[12px] border-[0.5px] border-border overflow-hidden">
                    {d.riskyTx.map((x, i) => {
                      const isIn = x.direction === "in";
                      const cm = catMeta(x.category);
                      const sc = levelOf(x.cpScore);
                      const rc = RISK_COLOR[sc] || "#B5B9BF";
                      const dt = x.ts ? new Date(x.ts) : null;
                      return (
                        <div key={i} className={`flex items-start gap-2.5 px-3 py-2 ${i ? "border-t-[0.5px] border-border-soft" : ""} ${x.sanctioned ? "bg-danger-soft" : ""}`}>
                          <span className={`grid place-items-center w-[22px] h-[22px] rounded-full shrink-0 mt-0.5 ${isIn ? "bg-emerald-soft" : "bg-surface-sunk"}`}>
                            {isIn ? <ArrowDown className="w-3 h-3 text-success" strokeWidth={2.2} /> : <ArrowUp className="w-3 h-3 text-muted" strokeWidth={2.2} />}
                          </span>
                          <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono tabular-nums text-[12.5px] text-ink">{x.amountUsdt != null ? `${isIn ? "+" : "−"}${usdt(x.amountUsdt)}` : "—"}</span>
                              <span className="text-[10px] font-semibold uppercase rounded-[5px] px-1.5 py-0.5" style={{ color: cm.color, background: `${cm.color}14` }}>{x.entityName || cm.label}</span>
                              {x.sanctioned && <span className="text-[9.5px] font-bold uppercase text-danger bg-danger-soft rounded-[5px] px-1.5 py-0.5">санкции</span>}
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[11px] text-ink-soft truncate">{x.walletName} <span className="text-muted">{x.network}</span></span>
                              <span className="text-muted text-[10px]">{isIn ? "← от" : "→ на"}</span>
                              <span className="font-mono text-[10.5px] text-muted-soft truncate">{mid(x.counterparty)}</span>
                              <Copyable v={x.counterparty} />
                            </div>
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-0.5">
                            {x.cpScore != null && <span className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: rc, background: `${rc}14` }}>риск {x.cpScore}</span>}
                            <span className="text-[10px] text-muted-soft">{dt ? dt.toLocaleDateString("ru-RU") : ""}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-muted-soft leading-snug">
                По данным AEGIS из кэша. Рисковое = контрагент-микшер/гэмблинг/даркнет/скам/санкции/чёрный список или риск-скор &gt; 25. Клик по кошельку — детали.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
