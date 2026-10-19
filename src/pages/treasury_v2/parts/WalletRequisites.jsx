// src/pages/treasury_v2/parts/WalletRequisites.jsx
//
// Реквизиты криптокошелька в карточке счёта — перенос канона CoinPay.
//
// 🔴 КОШЕЛЁК — ЭТО СЧЁТ, А НЕ ОТДЕЛЬНАЯ СУЩНОСТЬ. В CoinPay криптокошелёк живёт как обычный
// счёт-ностро в валюте токена, а адрес, сеть и тип хранения — его РЕКВИЗИТЫ, ровно как
// банковские у фиатного ностро. У нас адреса уже лежат в ledger.wallet_addresses и привязаны
// к счетам 13xx, но в Казначействе их не было видно: кассир видел «Hot · USDT TRC20 · Mark
// Antalya» и не мог сказать, какой это адрес, не уходя в раздел «Счета».
//
// 🔴 ОСТАТОК СЧИТАЕТ КНИГА, А НЕ ЦЕПЬ. Он-чейн баланс и риск — справочная витрина (AEGIS),
// деньги остаются за проводками. Поэтому здесь только реквизиты: адрес, сеть, хранение.
// Показывать рядом два числа, одно из которых «почти правда», — способ однажды поверить не
// тому.

import React, { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { loadWalletAddresses } from "../../../lib/ledgerReaders.js";

const CUSTODY_LABEL = {
  hot: "Горячий",
  cold: "Холодный",
  exchange: "Биржа",
  custodial: "Кастодиальный",
};

/** Адрес целиком не влезает и не читается — показываем голову и хвост, копируем полный. */
export function shortAddress(addr, head = 10, tail = 8) {
  const s = String(addr || "");
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export default function WalletRequisites({ account }) {
  const [rows, setRows] = useState([]);
  const [copied, setCopied] = useState(null);

  const accountId = account?.id || null;
  const isCrypto =
    !!account &&
    (account.custodyType != null ||
      /^crypto/.test(String(account.subtype || "")) ||
      String(account.currency || "").startsWith("USDT"));

  useEffect(() => {
    if (!accountId || !isCrypto) {
      setRows([]);
      return undefined;
    }
    let alive = true;
    loadWalletAddresses(accountId)
      .then((r) => alive && setRows(r))
      // Реквизиты — справка. Не отдались — карточка счёта всё равно обязана открыться.
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [accountId, isCrypto]);

  if (!isCrypto) return null;

  const custody = account.custodyType ? CUSTODY_LABEL[account.custodyType] || account.custodyType : null;
  const meta = [custody, account.provider].filter(Boolean).join(" · ");

  const copy = async (addr) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1500);
    } catch {
      /* буфер недоступен — адрес виден целиком в подсказке */
    }
  };

  return (
    <div className="bg-surface border border-line rounded-[18px] px-[18px] py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.07em] text-muted font-medium">
        Реквизиты кошелька
        {meta && <span className="normal-case tracking-normal text-[12px] text-ink-soft">· {meta}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="text-[12.5px] text-muted-soft mt-1.5">
          Адрес не привязан — счёт ведётся только книгой
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {rows.map((w) => (
            <div key={w.id} className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[11.5px] text-muted font-medium">{w.network || "—"}</span>
              <span className="font-mono text-[12.5px] text-ink" title={w.address}>
                {shortAddress(w.address)}
              </span>
              <button
                type="button"
                onClick={() => copy(w.address)}
                title="Скопировать адрес"
                className="w-[22px] h-[22px] rounded-full grid place-items-center bg-[rgba(26,25,21,.045)] hover:bg-[rgba(26,25,21,.09)] transition-colors"
              >
                {copied === w.address
                  ? <Check className="w-3 h-3 text-success" strokeWidth={2.4} />
                  : <Copy className="w-3 h-3 text-ink" strokeWidth={2} />}
              </button>
              {w.label && <span className="text-[11.5px] text-muted-soft truncate">{w.label}</span>}
              {!w.active && <span className="text-[11px] text-warning">неактивен</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
