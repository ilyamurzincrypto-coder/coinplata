// src/components/currencies/CurrencyWizard.jsx
// Слайс 1.5.c — Мастер валют (зеркало CP PAY, Фаза 2). Сидит на общем ui/Modal.jsx
// (липкость приедет в 1.5.g на самом Modal). Заводит валюту через ledger.create_currency:
//   • фиат — ISO-автоподстановка (код/имя/символ/сегмент), сегмент = ISO numeric;
//   • крипта — сеть обязательна; нативная монета (без контракта) или токен (контракт обязателен);
//     код-сегмент 13xx назначается сервером автоматически.
// Итог: валюта + автопозиция в Капитале появляются немедленно (onCreated → refetch).
import React, { useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import { findIso } from "../../data/iso4217.js";
import { rpcCreateCurrency } from "../../lib/newLedger.js";

const NET_HINTS = ["TRC20", "ERC20", "BEP20", "SOL", "TON", "TRON", "ETH", "BTC"];

const field = "w-full px-3 py-2 rounded-button border border-border-soft bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent/30";
const label = "text-caption font-semibold text-muted mb-1 block";

export default function CurrencyWizard({ open, onClose, onCreated }) {
  const [tab, setTab] = useState("fiat"); // fiat | crypto
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [scale, setScale] = useState(2);
  // фиат
  const [isoQuery, setIsoQuery] = useState("");
  const [numSegment, setNumSegment] = useState("");
  // крипта
  const [network, setNetwork] = useState("");
  const [isNative, setIsNative] = useState(false);
  const [isStable, setIsStable] = useState(false);
  const [smartContract, setSmartContract] = useState("");
  // submit
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const isoMatches = useMemo(
    () => (tab === "fiat" && !numSegment ? findIso(isoQuery).slice(0, 7) : []),
    [tab, isoQuery, numSegment]
  );

  const pickIso = (c) => {
    setCode(c.code);
    setName(c.name);
    setSymbol(c.symbol);
    setNumSegment(c.num);
    setScale(2);
    setIsoQuery(`${c.code} · ${c.name}`);
  };
  const clearIso = () => { setCode(""); setName(""); setSymbol(""); setNumSegment(""); setIsoQuery(""); };

  const canSubmit = tab === "fiat"
    ? !!(code && numSegment)
    : !!(code && network && (isNative || smartContract));

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const kind = tab === "fiat" ? "fiat" : (isStable ? "stablecoin" : "crypto");
      const res = await rpcCreateCurrency({
        code,
        name: name || code,
        kind,
        scale: Number(scale) || 0,
        symbol,
        network: tab === "crypto" ? network : null,
        smartContract: tab === "crypto" && !isNative ? smartContract : null,
        numSegment: tab === "fiat" ? numSegment : null,
        isNative: tab === "crypto" && isNative,
      });
      setDone(res);
      onCreated?.(res);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startAnother = () => {
    setCode(""); setName(""); setSymbol(""); setScale(2); setIsoQuery(""); setNumSegment("");
    setNetwork(""); setIsNative(false); setIsStable(false); setSmartContract("");
    setError(""); setDone(null);
  };

  return (
    <Modal open={open} onClose={onClose} title="Добавить валюту" subtitle="Создаётся счёт-позиция в Капитале — сразу и видимо" width="lg">
      <div className="p-5 space-y-4">
        {done ? (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-semibold text-emerald-800">Валюта {done.currencyCode} заведена</div>
              <div className="text-caption text-emerald-700 mt-1">
                Сегмент <b>{done.numSegment}</b> · счёт-позиция в Капитале <b>{done.positionAccountCode}</b> — виден в разделе Капитал.
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={startAnother} className="px-4 py-2 rounded-button border border-border-soft text-sm font-medium hover:bg-surface-sunk">Ещё валюту</button>
              <button onClick={onClose} className="px-4 py-2 rounded-button bg-accent text-white text-sm font-semibold hover:opacity-90">Готово</button>
            </div>
          </div>
        ) : (
          <>
            {/* Тип */}
            <div className="inline-flex rounded-button border border-border-soft p-0.5 bg-surface-sunk">
              {[["fiat", "Фиат"], ["crypto", "Крипта"]].map(([k, t]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-4 py-1.5 rounded-[8px] text-sm font-semibold transition-colors ${tab === k ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >{t}</button>
              ))}
            </div>

            {tab === "fiat" ? (
              <div className="space-y-3">
                <div className="relative">
                  <span className={label}>Валюта (ISO 4217)</span>
                  <input
                    className={field}
                    placeholder="Код или название — USD, евро, тенге…"
                    value={isoQuery}
                    onChange={(e) => { setIsoQuery(e.target.value); if (numSegment) clearIso(); }}
                  />
                  {isoMatches.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-border-soft rounded-button shadow-lg max-h-60 overflow-auto">
                      {isoMatches.map((c) => (
                        <button key={c.code} onClick={() => pickIso(c)} className="w-full text-left px-3 py-2 hover:bg-surface-sunk flex items-center justify-between">
                          <span className="text-sm text-ink"><b>{c.code}</b> · {c.name}</span>
                          <span className="text-caption text-muted">{c.symbol} · {c.num}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {numSegment && (
                  <div className="grid grid-cols-3 gap-3">
                    <div><span className={label}>Код</span><input className={field} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
                    <div><span className={label}>Символ</span><input className={field} value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
                    <div><span className={label}>Сегмент</span><input className={`${field} bg-surface-sunk`} value={numSegment} readOnly title="ISO numeric — сегмент номера счёта" /></div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className={label}>Код валюты</span><input className={field} placeholder="USDT-TRC20" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
                  <div>
                    <span className={label}>Сеть / chain</span>
                    <input className={field} placeholder="TRC20 / ERC20 / TRON…" list="net-hints" value={network} onChange={(e) => setNetwork(e.target.value.toUpperCase())} />
                    <datalist id="net-hints">{NET_HINTS.map((n) => <option key={n} value={n} />)}</datalist>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isNative} onChange={(e) => setIsNative(e.target.checked)} /> Нативная монета сети (без контракта)</label>
                  <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isStable} onChange={(e) => setIsStable(e.target.checked)} /> Стейблкоин</label>
                </div>
                {!isNative && (
                  <div><span className={label}>Смарт-контракт <span className="text-danger">*</span></span><input className={field} placeholder="0x… / T…" value={smartContract} onChange={(e) => setSmartContract(e.target.value)} /></div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div><span className={label}>Имя</span><input className={field} placeholder="Tether TRC20" value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div><span className={label}>Символ</span><input className={field} placeholder="₮" value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
                  <div><span className={label}>Знаков</span><input className={field} type="number" min="0" max="18" value={scale} onChange={(e) => setScale(e.target.value)} /></div>
                </div>
                <p className="text-caption text-muted">Код-сегмент (13xx) назначится автоматически при создании.</p>
              </div>
            )}

            {error && <div className="rounded-[12px] border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 rounded-button border border-border-soft text-sm font-medium hover:bg-surface-sunk">Отмена</button>
              <button
                onClick={submit}
                disabled={!canSubmit || busy}
                className="px-4 py-2 rounded-button bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
              >{busy ? "Создаю…" : "Добавить валюту"}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
