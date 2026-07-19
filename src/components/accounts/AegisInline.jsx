// src/components/accounts/AegisInline.jsx
// AEGIS-мониторинг в строке криптосчёта: бейдж риска (ok/warning/critical/нет
// данных), он-чейн оценка баланса рядом с учётным + подсветка расхождения,
// кнопки «Подключить»/«Обновить». balance_usd_est — справочный кэш, в деньги
// не входит (итоги офиса считаются по учётному, см. AccountsTree).
import React, { useState } from "react";
import { Link2, RefreshCw, AlertTriangle } from "lucide-react";
import { useToast } from "../../lib/toast.jsx";
import { bumpDataVersion } from "../../lib/dataVersion.jsx";
import { connectMonitoring, refreshMonitoring } from "../../lib/aegisMonitoring.js";
import AegisBadge from "./AegisBadge.jsx";
import { walletDiscrepancy, syncedLabel, isCryptoAccount, canConnectMonitoring } from "../../utils/accountsRisk.js";

export default function AegisInline({ account, ledgerUsd, onChanged, fmtBase }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!isCryptoAccount(account)) return null;

  const disc = walletDiscrepancy({ ledgerUsd, balanceUsdEst: account.balanceUsdEst });
  const canConnect = canConnectMonitoring(account);
  const connected = !!account.aegisWalletId;

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      bumpDataVersion(); // перечитать счета из БД (кэш риск/баланс)
      onChanged && onChanged();
    } catch (e) {
      if (e?.status === 409) toast.error("Адрес уже зарегистрирован в AEGIS (address_unavailable)");
      else if (e?.status === 503) toast.info("AEGIS ещё не подключён (сервис поднимается)");
      else toast.error(e?.message || "Ошибка AEGIS");
    } finally {
      setBusy(false);
    }
  };

  const onchainStr = disc.hasOnchain && fmtBase ? fmtBase(disc.onchainUsd) : null;

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <AegisBadge account={account} />

      {disc.hasOnchain && (
        <span
          title={
            disc.flagged
              ? `Расхождение: учётный ${fmtBase ? fmtBase(ledgerUsd || 0) : ledgerUsd} vs он-чейн ${onchainStr}`
              : `Он-чейн (AEGIS): ${onchainStr}${account.syncedAt ? ` · ${syncedLabel(account.syncedAt)}` : ""}`
          }
          className={`inline-flex items-center gap-1 text-[10.5px] font-mono shrink-0 ${
            disc.flagged ? "text-[#c0392b] font-bold" : "text-muted"
          }`}
        >
          {disc.flagged && <AlertTriangle className="w-3 h-3" strokeWidth={2.2} />}
          ⛓ {onchainStr}
        </span>
      )}

      <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {canConnect && (
          <button
            type="button"
            disabled={busy}
            title="Подключить AEGIS-мониторинг"
            onClick={(e) => {
              e.stopPropagation();
              run(() => connectMonitoring(account.id), "Мониторинг подключён");
            }}
            className="shrink-0 inline-flex items-center gap-1 h-6 rounded-[6px] px-1.5 text-[10.5px] font-semibold text-[#5b6cff] bg-[#eef0ff] hover:bg-[#e0e4ff] disabled:opacity-50"
          >
            <Link2 className="w-3 h-3" strokeWidth={2.2} /> Подключить
          </button>
        )}
        {connected && (
          <button
            type="button"
            disabled={busy}
            title="Обновить сводку из AEGIS"
            onClick={(e) => {
              e.stopPropagation();
              run(() => refreshMonitoring(account.id), "Обновлено");
            }}
            className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-[6px] text-[#5a6072] bg-[#eef0f7] hover:bg-[#e1e4ee] disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} strokeWidth={2.2} />
          </button>
        )}
      </span>
    </span>
  );
}
