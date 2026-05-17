// src/components/accounts/TransferModal.jsx
// Перевод между нашими счетами. Два явных поля суммы:
//   • Сколько отправляем (валюта FROM-счёта)
//   • Сколько принимаем (валюта TO-счёта)
//
// Одна валюта → ввод в одно поле автоматически дублируется во второе.
// Разные валюты → оба поля редактируются независимо, между ними мелко
// показывается фактический derived-курс toAmount / fromAmount (для info,
// не для редактирования).
//
// Если to-счёт в другом офисе — обязателен выбор «Ответственного менеджера»
// принимающей стороны (P2P, перевод pending → confirmed после подтверждения).

import React, { useState, useEffect, useMemo } from "react";
import { ArrowDown, AlertCircle, Users } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import GroupedAccountSelect from "../GroupedAccountSelect.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useRates } from "../../store/rates.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { officeName } from "../../store/data.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { withToast } from "../../lib/supabaseWrite.js";
import { createTransfer } from "../../lib/dealOperations.js";

export default function TransferModal({ open, fromAccount, onClose }) {
  const { t } = useTranslation();
  const { accounts, transfer, balanceOf } = useAccounts();
  const { currentUser, users } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { getRate } = useRates();

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  // Какое поле юзер правил последним — чтобы при смене to-счёта (валюта
  // другая) при необходимости подтянуть рыночный курс от него.
  const [lastEdited, setLastEdited] = useState(null); // "from" | "to" | null
  const [note, setNote] = useState("");
  const [toManagerId, setToManagerId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFromId(fromAccount?.id || "");
      setToId("");
      setFromAmount("");
      setToAmount("");
      setLastEdited(null);
      setNote("");
      setToManagerId("");
    }
  }, [open, fromAccount]);

  const from = activeAccounts.find((a) => a.id === fromId);
  const to = activeAccounts.find((a) => a.id === toId);
  const sameCurrency = from && to && from.currency === to.currency;
  const crossCurrency = from && to && from.currency !== to.currency;
  const isInterOffice = from && to && from.officeId !== to.officeId;

  // Ответственный менеджер: only когда меж-офисный перевод
  const recipientCandidates = useMemo(() => {
    if (!isInterOffice || !to) return [];
    const allowedRoles = new Set(["manager", "admin", "owner"]);
    return (users || [])
      .filter((u) => u && u.active !== false && allowedRoles.has(u.role))
      .filter((u) => !u.officeId || u.officeId === to.officeId)
      .map((u) => ({ id: u.id, name: u.name || u.email || u.id }));
  }, [isInterOffice, to, users]);
  useEffect(() => {
    if (!isInterOffice) {
      setToManagerId("");
      return;
    }
    if (toManagerId && recipientCandidates.find((c) => c.id === toManagerId)) return;
    if (recipientCandidates.length > 0) setToManagerId(recipientCandidates[0].id);
  }, [isInterOffice, recipientCandidates, toManagerId]);

  // Когда выбраны оба счёта — для кросс-валютного авто-подтянем курс
  // и заполним то поле которое ещё не трогали юзером. Не перекрываем то
  // что юзер уже набрал руками.
  useEffect(() => {
    if (!crossCurrency || !from || !to) return;
    const fromN = parseFloat(fromAmount) || 0;
    const toN = parseFloat(toAmount) || 0;
    const r = getRate(from.currency, to.currency);
    if (!r || !Number.isFinite(r) || r <= 0) return;
    if (lastEdited === "from" && fromN > 0 && toN === 0) {
      setToAmount(String((fromN * r).toFixed(2)));
    } else if (lastEdited === "to" && toN > 0 && fromN === 0) {
      setFromAmount(String((toN / r).toFixed(2)));
    }
  }, [crossCurrency, from, to, fromAmount, toAmount, lastEdited, getRate]);

  // Same-currency: ввод в одно поле → дублируется во второе.
  const onFromChange = (v) => {
    const cleaned = v.replace(/[^\d.,]/g, "").replace(",", ".");
    setFromAmount(cleaned);
    setLastEdited("from");
    if (sameCurrency) setToAmount(cleaned);
  };
  const onToChange = (v) => {
    const cleaned = v.replace(/[^\d.,]/g, "").replace(",", ".");
    setToAmount(cleaned);
    setLastEdited("to");
    if (sameCurrency) setFromAmount(cleaned);
  };

  const fromAmt = parseFloat(fromAmount) || 0;
  const toAmt = parseFloat(toAmount) || 0;
  const derivedRate = crossCurrency && fromAmt > 0 && toAmt > 0 ? toAmt / fromAmt : null;

  // Validation
  const sameAccount = fromId && toId && fromId === toId;
  const fromBalance = from ? balanceOf(from.id) : 0;
  const insufficient = from && fromAmt > fromBalance;

  const canSubmit =
    from &&
    to &&
    !sameAccount &&
    fromAmt > 0 &&
    toAmt > 0 &&
    (!isInterOffice || !!toManagerId);

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    const rateForPayload = sameCurrency ? null : derivedRate;

    if (isSupabaseConfigured) {
      setBusy(true);
      try {
        const res = await withToast(
          () =>
            createTransfer({
              fromAccountId: from.id,
              toAccountId: to.id,
              fromAmount: fromAmt,
              toAmount: toAmt,
              rate: rateForPayload,
              note: note.trim(),
              toManagerId: isInterOffice ? toManagerId : null,
            }),
          {
            success: isInterOffice
              ? "Перевод отправлен — ждёт подтверждения получателя"
              : "Перевод записан",
            errorPrefix: "Transfer failed",
          }
        );
        if (res.ok) {
          const recipient = recipientCandidates.find((c) => c.id === toManagerId);
          logAudit({
            action: "create",
            entity: "transfer",
            entityId: String(res.result || ""),
            summary:
              `${from.name} → ${to.name}: ${curSymbol(from.currency)}${fmt(fromAmt, from.currency)} ${from.currency}` +
              `${sameCurrency ? "" : ` → ${curSymbol(to.currency)}${fmt(toAmt, to.currency)} ${to.currency}` + (derivedRate ? ` @ ${derivedRate.toFixed(6)}` : "")}` +
              `${isInterOffice && recipient ? ` · ожидает ${recipient.name}` : ""}`,
          });
          onClose();
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    const rec = transfer({
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount: fromAmt,
      toAmount: toAmt,
      fromCurrency: from.currency,
      toCurrency: to.currency,
      rate: rateForPayload,
      note: note.trim(),
      createdBy: currentUser.id,
    });
    logAudit({
      action: "create",
      entity: "transfer",
      entityId: rec.id,
      summary:
        `${from.name} → ${to.name}: ${curSymbol(from.currency)}${fmt(fromAmt, from.currency)} ${from.currency}` +
        `${sameCurrency ? "" : ` → ${curSymbol(to.currency)}${fmt(toAmt, to.currency)} ${to.currency}` + (derivedRate ? ` @ ${derivedRate.toFixed(6)}` : "")}`,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("transfer_title")} width="lg">
      <div className="p-5 space-y-3">
        {/* From account */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Откуда (счёт-источник)
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts}
            value={fromId}
            onChange={setFromId}
            placeholder={t("select_account")}
          />
          {from && (
            <div className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
              {officeName(from.officeId)} · {t("current_balance")}:{" "}
              <span className="font-bold text-slate-700">
                {curSymbol(from.currency)}
                {fmt(fromBalance, from.currency)} {from.currency}
              </span>
            </div>
          )}
        </div>

        {/* Сколько отправляем (OUT) */}
        {from && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Сколько отправляем
            </label>
            <div
              className={`relative flex items-baseline gap-2 bg-rose-50/40 rounded-[12px] border-2 transition-all px-4 py-3 ${
                fromAmount ? (insufficient ? "border-amber-400" : "border-rose-300") : "border-slate-200"
              }`}
            >
              <span className="text-rose-500 text-[18px] font-semibold">{curSymbol(from.currency)}</span>
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) => onFromChange(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0"
              />
              <span className="text-rose-500 text-[12px] font-bold tracking-wider">{from.currency}</span>
            </div>
            {insufficient && (
              <div className="mt-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 inline-flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {t("transfer_insufficient")}
              </div>
            )}
          </div>
        )}

        {/* Arrow indicator + derived rate hint при кросс-валютном */}
        <div className="flex items-center justify-center gap-3 py-1">
          <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
            <ArrowDown className="w-3.5 h-3.5 text-slate-400" strokeWidth={2.5} />
          </div>
          {crossCurrency && derivedRate && (
            <span className="text-[10.5px] text-slate-500 tabular-nums" title="Фактический курс перевода = принимаем / отправляем">
              1 {from.currency} = {derivedRate.toFixed(derivedRate >= 10 ? 2 : 4)} {to.currency}
            </span>
          )}
        </div>

        {/* To account */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Куда (счёт-получатель)
          </label>
          <GroupedAccountSelect
            accounts={activeAccounts.filter((a) => a.id !== fromId)}
            value={toId}
            onChange={setToId}
            placeholder={t("select_account")}
          />
          {to && (
            <div className="mt-1.5 text-[11px] text-slate-500 tabular-nums">
              {officeName(to.officeId)}
            </div>
          )}
        </div>

        {sameAccount && (
          <div className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("transfer_same_account")}
          </div>
        )}

        {/* Сколько принимаем (IN) */}
        {to && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Сколько принимаем
              {sameCurrency && (
                <span className="ml-2 text-[10px] text-slate-400 normal-case tracking-normal font-normal">
                  · одна валюта — синхронится с «отправляем»
                </span>
              )}
            </label>
            <div className="relative flex items-baseline gap-2 bg-emerald-50/60 rounded-[12px] border-2 border-emerald-200 px-4 py-3">
              <span className="text-emerald-600 text-[18px] font-semibold">{curSymbol(to.currency)}</span>
              <input
                type="text"
                inputMode="decimal"
                value={toAmount}
                onChange={(e) => onToChange(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0"
              />
              <span className="text-emerald-600 text-[12px] font-bold tracking-wider">{to.currency}</span>
            </div>
            {crossCurrency && (
              <p className="text-[10.5px] text-slate-500 mt-1">
                Кросс-валютный перевод. Введи обе суммы вручную — это и есть курс по факту.
              </p>
            )}
          </div>
        )}

        {/* Interoffice → ответственный менеджер на принимающей стороне.
            P2P logic (миграция 0052): transfer создаётся как pending,
            подтверждается выбранным менеджером. */}
        {isInterOffice && (
          <div className="bg-indigo-50/60 border border-indigo-200 rounded-[12px] p-3">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 mb-1.5 tracking-wide uppercase">
              <Users className="w-3.5 h-3.5" />
              Ответственный за принятие · {officeName(to.officeId)}
            </label>
            {recipientCandidates.length === 0 ? (
              <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Нет доступных менеджеров в офисе получателе. Назначь
                кого-то на этот офис в настройках.
              </div>
            ) : (
              <>
                <select
                  value={toManagerId}
                  onChange={(e) => setToManagerId(e.target.value)}
                  className="w-full bg-white border border-indigo-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[8px] px-2.5 py-2 text-[13px] font-semibold text-slate-900 outline-none cursor-pointer"
                >
                  {recipientCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.id === currentUser.id ? " (я)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] text-indigo-700/80 mt-1.5">
                  Перевод отправится со статусом <strong>pending</strong>.
                  Получатель увидит уведомление и подтвердит — только
                  после этого деньги зачисляются.
                </p>
              </>
            )}
          </div>
        )}

        {/* Note */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            Комментарий (необязательно)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="—"
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none transition-colors"
          />
        </div>
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
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit && !busy
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? "Processing…" : t("transfer_confirm")}
        </button>
      </div>
    </Modal>
  );
}
