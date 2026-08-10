// «Начальные остатки» — ввод стартовых остатков из физической инвентаризации 7 касс.
// Три блока-источника: нал (пересчёт купюр) · безнал (банк-выписка, Этап 2, disabled) ·
// цифр (он-чейн). Дата инвентаризации обязательна. После ввода блок кассы становится
// read-only («Введено DD.MM · оператор») — форма сама показывает repeat-guard, не даёт нарваться.
// Пишет через ledger.create_opening_inventory (Дт актив / Кт opening-equity, Σ=0).
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useLedger } from "../../../store/ledger.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useAuth } from "../../../store/auth.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { supabase } from "../../../lib/supabase.js";
import { rpcCreateOpeningInventory, newIdempotencyKey } from "../../../lib/newLedger.js";

const fmtD = (d) => { try { return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return String(d); } };

export default function OpeningInventoryTab() {
  const { accounts = [], reload } = useLedger();
  const offices = (useOffices?.() || {}).offices || [];
  const auth = useAuth?.() || {};
  const users = auth.users || [];
  const currentUser = auth.currentUser;
  const can = useCan();
  const editable = can("accounting", "edit");

  const [date, setDate] = useState("");
  const [amt, setAmt] = useState({});
  const [openings, setOpenings] = useState([]);
  const [reqId, setReqId] = useState(() => newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  const officeName = useCallback((id) => offices.find((o) => o.id === id)?.name || id, [offices]);
  const userName = useCallback((id) => { const u = users.find((x) => x.id === id); return u?.name || u?.full_name || "—"; }, [users]);

  const loadOpenings = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.schema("ledger").from("office_opening")
      .select("office_id, block, source_ref, currency_code, form, effective_date, amount, entered_by");
    setOpenings(data || []);
  }, []);
  useEffect(() => { loadOpenings(); }, [loadOpenings]);

  // Нал (cash) + цифр (crypto_input) счета по офисам. source_ref в БД = адрес||код → в UI код.
  const byOffice = useMemo(() => {
    const m = new Map();
    for (const a of accounts) {
      const off = a.officeId ?? a.office_id; const cur = a.currency ?? a.currency_code;
      const block = a.subtype === "cash" ? "cash" : a.subtype === "crypto_input" ? "crypto" : null;
      if (!block || !off || !cur) continue;
      if (!m.has(off)) m.set(off, { cash: [], crypto: [] });
      m.get(off)[block].push({ block, id: a.id ?? a.accountId, code: a.code, name: a.name, cur });
    }
    return [...m.entries()].sort((x, y) => officeName(x[0]).localeCompare(officeName(y[0])));
  }, [accounts, officeName]);

  const openingOf = useCallback((block, code) => openings.find((o) => o.block === block && o.source_ref === code), [openings]);
  const anyEntered = openings.length > 0;

  const submit = async () => {
    setErr(null); setOk(null);
    if (!date) { setErr("Укажите дату инвентаризации"); return; }
    const pick = (block) => byOffice.flatMap(([off, g]) => g[block]
      .filter((r) => Number(amt[r.id]) > 0 && !openingOf(block, r.code))
      .map((r) => ({ office_id: off, account_code: r.code, currency: r.cur, amount: Number(amt[r.id]) })));
    const officeCash = pick("cash");
    const crypto = pick("crypto");
    if (!officeCash.length && !crypto.length) { setErr("Введите хотя бы один остаток"); return; }
    setBusy(true);
    try {
      await rpcCreateOpeningInventory({ effectiveDate: new Date(date).toISOString(), officeCash, crypto, enteredBy: currentUser?.id ?? null, requestId: reqId });
      setOk(`Введено остатков: ${officeCash.length + crypto.length}`);
      setAmt({}); setReqId(newIdempotencyKey());
      await Promise.all([loadOpenings(), reload?.()]);
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const row = (r, block) => {
    const oo = openingOf(block, r.code);
    return (
      <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-body-sm">
        <span className="text-ink truncate">{r.name} <span className="text-muted">· {r.cur}</span></span>
        {oo ? (
          <span className="text-muted whitespace-nowrap">Введено {fmtD(oo.effective_date)} · {userName(oo.entered_by)}: <span className="font-mono tabular-nums text-ink">{Number(oo.amount).toLocaleString("ru-RU")}</span></span>
        ) : (
          <input type="number" min="0" inputMode="decimal" disabled={!editable}
            value={amt[r.id] ?? ""} onChange={(e) => setAmt((s) => ({ ...s, [r.id]: e.target.value }))}
            placeholder="0" className="w-32 text-right font-mono tabular-nums rounded-[8px] border-[0.5px] border-border bg-surface px-2 py-1" />
        )}
      </div>
    );
  };

  return (
    <div className="bg-bg">
      <div className="mb-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">Казначейство</span>
        <div className="text-[22px] font-semibold text-ink mt-1">Начальные остатки</div>
      </div>

      {!anyEntered && (
        <div className="mb-3 rounded-[12px] border-[0.5px] border-amber-300 bg-amber-50 px-4 py-3 text-body-sm text-amber-900">
          <b>Стартовые остатки не введены.</b> Казначейство пусто до ввода физической инвентаризации 7 касс.
        </div>
      )}

      <div className="mb-3 flex items-end gap-3 flex-wrap rounded-[12px] border-[0.5px] border-border bg-surface px-4 py-3">
        <label className="text-body-sm">
          <div className="text-muted mb-1">Дата инвентаризации <span className="text-danger">*</span></div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!editable}
            className="rounded-[8px] border-[0.5px] border-border bg-surface px-2 py-1" />
        </label>
        <button type="button" onClick={submit} disabled={!editable || busy || !date}
          className="ml-auto rounded-[9px] bg-ink px-4 py-2 text-white text-body-sm font-medium disabled:opacity-40">
          {busy ? "Ввод…" : "Ввести остатки"}
        </button>
      </div>
      {err && <div className="mb-3 rounded-[10px] bg-danger/10 px-3 py-2 text-body-sm text-danger">{err}</div>}
      {ok && <div className="mb-3 rounded-[10px] bg-emerald-50 px-3 py-2 text-body-sm text-emerald-700">{ok}</div>}

      <div className="space-y-4">
        {byOffice.map(([off, g]) => (
          <div key={off} className="rounded-[12px] border-[0.5px] border-border bg-surface overflow-hidden">
            <div className="px-4 py-2 border-b-[0.5px] border-border font-semibold text-ink">{officeName(off)}</div>
            <div className="px-4 py-2">
              {g.cash.length > 0 && (<>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Нал (касса)</div>
                {g.cash.map((r) => row(r, "cash"))}
              </>)}
              {/* Безнал — блок существует, ждёт Этап 2 (нумерация bank-счетов из эталона). */}
              <div className="mt-3 opacity-50">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Безнал (банк)</div>
                <div className="text-body-sm text-muted italic py-1.5">Банковские счета — Этап 2</div>
              </div>
              {g.crypto.length > 0 && (<>
                <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Цифровая (кошельки)</div>
                {g.crypto.map((r) => row(r, "crypto"))}
              </>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
