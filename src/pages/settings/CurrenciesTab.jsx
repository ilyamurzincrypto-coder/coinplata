// src/pages/settings/CurrenciesTab.jsx
// Единый таб: Currencies + Channels.
// Верхняя секция — список валют + добавление.
// Нижняя — channels для выбранной валюты + добавление.

import React, { useState, useMemo } from "react";
import { Coins, Plus, Pencil, Trash2, Zap, Network as NetworkIcon } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useRates } from "../../store/rates.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { CHANNEL_KINDS, NETWORKS } from "../../store/data.js";

// -------- Currency Add Modal --------
function AddCurrencyModal({ open, onClose }) {
  const { t } = useTranslation();
  const { addCurrency } = useCurrencies();
  const { addEntry: logAudit } = useAudit();

  const [code, setCode] = useState("");
  const [type, setType] = useState("fiat");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [decimals, setDecimals] = useState(2);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (open) {
      setCode("");
      setType("fiat");
      setSymbol("");
      setName("");
      setDecimals(2);
      setError("");
    }
  }, [open]);

  const canSubmit = code.trim().length > 0;

  const handleSubmit = () => {
    setError("");
    const res = addCurrency({
      code: code.trim().toUpperCase(),
      type,
      symbol: symbol.trim(),
      name: name.trim() || code.trim().toUpperCase(),
      decimals: parseInt(decimals, 10) || 2,
    });
    if (!res.ok) {
      setError(res.warning);
      return;
    }
    logAudit({
      action: "create",
      entity: "currency",
      entityId: res.currency.code,
      summary: `Added currency ${res.currency.code} (${res.currency.type})`,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("currency_add_title")} width="md">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("currency_code")}
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="USDC"
              autoFocus
              maxLength={6}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-bold outline-none tracking-wider"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("currency_type")}
            </label>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[10px] w-full">
              <button
                type="button"
                onClick={() => setType("fiat")}
                className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] transition-all ${
                  type === "fiat" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                {t("currency_type_fiat")}
              </button>
              <button
                type="button"
                onClick={() => setType("crypto")}
                className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] transition-all ${
                  type === "crypto" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                {t("currency_type_crypto")}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("currency_symbol")}
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="$"
              maxLength={3}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              {t("currency_decimals")}
            </label>
            <input
              type="number"
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              min={0}
              max={8}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("currency_name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="USD Coin"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>

        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("currency_add")}
        </button>
      </div>
    </Modal>
  );
}

// -------- Channel Add Modal --------
function AddChannelModal({ open, currency, onClose }) {
  const { t } = useTranslation();
  const { addChannel } = useRates();
  const { addEntry: logAudit } = useAudit();

  const isCrypto = currency?.type === "crypto";
  const availableKinds = CHANNEL_KINDS.filter(
    (k) => k.forCurrencyType === currency?.type
  );

  const [kind, setKind] = useState(isCrypto ? "network" : "bank");
  const [network, setNetwork] = useState(isCrypto ? "TRC20" : "");
  const [gasFee, setGasFee] = useState("");

  React.useEffect(() => {
    if (open) {
      setKind(isCrypto ? "network" : availableKinds[0]?.id || "bank");
      setNetwork(isCrypto ? "TRC20" : "");
      setGasFee("");
    }
  }, [open, isCrypto, availableKinds]);

  if (!currency) return null;

  const canSubmit = kind && (!isCrypto || network);

  const handleSubmit = () => {
    const channel = {
      currencyCode: currency.code,
      kind,
    };
    if (isCrypto) {
      channel.network = network;
      if (gasFee) channel.gasFee = parseFloat(gasFee);
    }
    const id = addChannel(channel);
    logAudit({
      action: "create",
      entity: "channel",
      entityId: id,
      summary: `Added channel for ${currency.code}: ${kind}${isCrypto ? ` (${network})` : ""}`,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("channel_add_title")}
      subtitle={`${currency.code} · ${currency.type}`}
      width="md"
    >
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
            {t("channel_kind")}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {availableKinds.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`px-3 py-2 rounded-[8px] text-[12px] font-semibold border transition-colors ${
                  kind === k.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {isCrypto && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                {t("channel_network")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {NETWORKS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className={`px-3 py-2 rounded-[8px] text-[12px] font-semibold border transition-colors ${
                      network === n
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                {t("channel_gas")}
              </label>
              <input
                type="text"
                value={gasFee}
                onChange={(e) => setGasFee(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="1.0"
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
              />
            </div>
          </>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {t("channel_add")}
        </button>
      </div>
    </Modal>
  );
}

// -------- Main Tab --------
export default function CurrenciesTab() {
  const { t } = useTranslation();
  const { currencies, removeCurrency } = useCurrencies();
  const { channels } = useRates();
  const { addEntry: logAudit } = useAudit();
  const { isAdmin } = useAuth();

  const [addCurrencyOpen, setAddCurrencyOpen] = useState(false);
  const [addChannelFor, setAddChannelFor] = useState(null);
  const [expandedCode, setExpandedCode] = useState(null);

  const channelsByCurrency = useMemo(() => {
    const map = new Map();
    channels.forEach((ch) => {
      if (!map.has(ch.currencyCode)) map.set(ch.currencyCode, []);
      map.get(ch.currencyCode).push(ch);
    });
    return map;
  }, [channels]);

  const handleRemove = (currency) => {
    if (!confirm(`Remove currency ${currency.code}?`)) return;
    removeCurrency(currency.code);
    logAudit({
      action: "delete",
      entity: "currency",
      entityId: currency.code,
      summary: `Removed currency ${currency.code}`,
    });
  };

  const toggleExpand = (code) => {
    setExpandedCode(expandedCode === code ? null : code);
  };

  return (
    <div>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">{t("currencies_title")}</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">{t("currencies_subtitle")}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setAddCurrencyOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("currency_add")}
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {currencies.map((c) => {
          const chs = channelsByCurrency.get(c.code) || [];
          const isExpanded = expandedCode === c.code;
          return (
            <div key={c.code}>
              <div
                className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer"
                onClick={() => toggleExpand(c.code)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-[10px] flex items-center justify-center text-[14px] font-bold ${
                      c.type === "crypto"
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {c.symbol || c.code[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 tracking-wide">{c.code}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.name} · {c.type === "crypto" ? t("currency_type_crypto") : t("currency_type_fiat")}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-[11px] text-slate-500">
                    {chs.length} {chs.length === 1 ? "channel" : "channels"}
                  </div>
                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(c);
                      }}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title={t("remove")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Channels expanded */}
              {isExpanded && (
                <div className="bg-slate-50/60 px-5 py-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      {t("channels")} · {c.code}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={() => setAddChannelFor(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-white border border-slate-200 hover:border-slate-300 text-[11px] font-semibold text-slate-700 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        {t("channel_add")}
                      </button>
                    )}
                  </div>
                  {chs.length === 0 ? (
                    <div className="text-[12px] text-slate-400 italic">{t("no_channels")}</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {chs.map((ch) => (
                        <div
                          key={ch.id}
                          className="bg-white border border-slate-200 rounded-[8px] px-3 py-2 flex items-center gap-2"
                        >
                          {ch.kind === "network" ? (
                            <NetworkIcon className="w-3.5 h-3.5 text-indigo-500" />
                          ) : (
                            <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[10px]">
                              {ch.kind === "cash" ? "💵" : "🏦"}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-semibold text-slate-900">
                              {ch.network || ch.kind.toUpperCase()}
                            </div>
                            {ch.gasFee != null && (
                              <div className="text-[10px] text-slate-500 tabular-nums">
                                gas {ch.gasFee}
                              </div>
                            )}
                          </div>
                          {ch.isDefaultForCurrency && (
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">
                              {t("pair_default")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {currencies.length === 0 && (
          <div className="px-5 py-12 text-center text-[13px] text-slate-400">
            No currencies yet
          </div>
        )}
      </div>

      <AddCurrencyModal
        open={addCurrencyOpen}
        onClose={() => setAddCurrencyOpen(false)}
      />
      <AddChannelModal
        open={!!addChannelFor}
        currency={addChannelFor}
        onClose={() => setAddChannelFor(null)}
      />
    </div>
  );
}
