// src/components/accounts/AddAccountModal.jsx
// Форма: office (fixed) → currency → channel → name → optional address (для crypto).
// channelId — обязателен. Тип account.type производный от channel.kind:
//   cash → "cash", bank → "bank", sepa/swift → "bank", network → "crypto".
// address, network, isDeposit, isWithdrawal прописываются для crypto.

import React, { useState, useEffect, useMemo } from "react";
import { X, ChevronDown } from "lucide-react";
import Modal from "../ui/Modal.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useRates } from "../../store/rates.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useTranslation } from "../../i18n/translations.jsx";
import { channelShortLabel, resolveAccountChannel } from "../../utils/accountChannel.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { insertAccount, withToast } from "../../lib/supabaseWrite.js";

function deriveType(channelKind) {
  if (channelKind === "network") return "crypto";
  if (channelKind === "sepa" || channelKind === "swift") return "bank";
  if (channelKind === "qr") return "bank"; // QR платежи — тип bank в БД
  return channelKind || "cash";
}

export default function AddAccountModal({ open, officeId, officeName, prefill, onClose }) {
  const { t } = useTranslation();
  const { addAccount, accounts } = useAccounts();
  const { currencies } = useCurrencies();
  const { channels } = useRates();
  const { offices } = useOffices();
  const { addEntry: logAudit } = useAudit();

  const [currency, setCurrency] = useState("USD");
  const [channelId, setChannelId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isDeposit, setIsDeposit] = useState(true);
  const [isWithdrawal, setIsWithdrawal] = useState(true);
  const [error, setError] = useState("");

  // Reset при открытии + применить prefill (из "Add" рядом с каналом).
  useEffect(() => {
    if (!open) return;
    const c = prefill?.currency || currencies[0]?.code || "USD";
    setCurrency(c);
    setName("");
    setAddress("");
    setBankRef("");
    setOpeningBalance("");
    setIsDeposit(true);
    setIsWithdrawal(true);
    setError("");
    // channelId apply после currency (в отдельном эффекте, когда список каналов синхронизируется)
    if (prefill?.channelId) {
      setChannelId(prefill.channelId);
    } else {
      setChannelId(""); // выберем сами ниже
    }
  }, [open, prefill, currencies]);

  const selectedCurrency = currencies.find((c) => c.code === currency);
  const currencyChannels = useMemo(
    () => channels.filter((c) => c.currencyCode === currency),
    [channels, currency]
  );

  // При смене валюты — если выбранный channel больше не принадлежит валюте, переключаемся на default/первый.
  useEffect(() => {
    if (channelId && currencyChannels.some((c) => c.id === channelId)) return;
    const def = currencyChannels.find((c) => c.isDefaultForCurrency) || currencyChannels[0];
    setChannelId(def?.id || "");
  }, [currency, currencyChannels, channelId]);

  const selectedChannel = channels.find((c) => c.id === channelId) || null;
  const isCryptoChannel = selectedChannel?.kind === "network";
  const isQrChannel = selectedChannel?.kind === "qr";
  const isBankChannel =
    selectedChannel?.kind === "bank" ||
    selectedChannel?.kind === "sepa" ||
    selectedChannel?.kind === "swift";
  // Для bankRef / QR reuse field общая метка — показываем в обоих случаях
  const showBankRefField = isBankChannel || isQrChannel;

  // Существующие счета выбранной валюты (все офисы) — для quick-reference и
  // быстрого клонирования. Фильтруем по currency + active. Сортируем:
  // current office сверху, затем остальные по имени.
  const existingSameCurrency = useMemo(() => {
    return accounts
      .filter((a) => a.currency === currency && a.active)
      // Эталон обещает «{валюта} · {канал} уже есть N» — значит и считать надо
      // по паре. Счёт на другом канале той же валюты дубликатом не является:
      // «USD · Cash» и «USD · Банк» — разные вещи, и предлагать второй как
      // основу для первого значило бы копировать чужие реквизиты.
      .filter((a) => {
        if (!channelId) return true;
        const ch = resolveAccountChannel(a, channels);
        return ch?.id === channelId;
      })
      .sort((a, b) => {
        if (a.officeId === officeId && b.officeId !== officeId) return -1;
        if (b.officeId === officeId && a.officeId !== officeId) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [accounts, currency, officeId, channelId, channels]);

  const officeLookup = useMemo(() => {
    const m = new Map();
    (offices || []).forEach((o) => m.set(o.id, o.name || "—"));
    return m;
  }, [offices]);

  const handleClone = (src) => {
    // Клонируем конфиг: channel, name (+ " (copy)"), address, bankRef,
    // deposit/withdrawal. Офис и opening balance не трогаем — они специфичны
    // для нового счёта.
    const srcChannel = resolveAccountChannel(src, channels);
    if (srcChannel) {
      setChannelId(srcChannel.id);
    }
    setName(`${src.name || ""}${src.name ? " (copy)" : ""}`.trim());
    setAddress(src.address || "");
    setBankRef(src.bankRef || "");
    setIsDeposit(src.isDeposit !== false);
    setIsWithdrawal(src.isWithdrawal !== false);
    setError("");
  };

  // Блок дубликатов всегда открывается свёрнутым — и сворачивается заново при
  // смене валюты или канала: раскрытым остался бы список от прошлой пары.
  const [dupOpen, setDupOpen] = useState(false);
  useEffect(() => { setDupOpen(false); }, [currency, channelId, open]);

  const canSubmit = name.trim().length > 0 && currency && channelId && officeId;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError("Name, currency and channel are required");
      return;
    }
    if (isCryptoChannel && isDeposit && !address.trim()) {
      setError("Address is required for a deposit crypto account");
      return;
    }
    const balance = parseFloat(openingBalance) || 0;
    const type = deriveType(selectedChannel.kind);
    const payload = {
      officeId,
      name: name.trim(),
      currency,
      channelId,
      type,
      balance,
      active: true,
    };
    if (isCryptoChannel) {
      payload.address = address.trim();
      payload.network = (selectedChannel.network || "").toUpperCase();
      payload.isDeposit = isDeposit;
      payload.isWithdrawal = isWithdrawal;
      payload.lastCheckedBlock = 0;
      payload.lastCheckedAt = null;
    }
    if (isBankChannel && bankRef.trim()) {
      payload.bankRef = bankRef.trim();
    }

    if (isSupabaseConfigured) {
      const res = await withToast(
        () => insertAccount(payload),
        { success: "Account created", errorPrefix: "Failed to create account" }
      );
      if (!res.ok) return;
    } else {
      addAccount(payload);
    }

    const summaryExtras = [
      `${currency}`,
      channelShortLabel(selectedChannel),
      balance ? `opening ${balance}` : null,
      isCryptoChannel && address ? `addr ${address.slice(0, 10)}…` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    logAudit({
      action: "create",
      entity: "account",
      entityId: name.trim(),
      summary: `Added account "${name.trim()}" (${summaryExtras}) in ${officeName || officeId}`,
    });
    onClose?.();
  };

  // ── Общие классы полей (эталон account-modal-r2) ─────────────────────────
  // Фокус — чернильная рамка плюс мягкое лаймовое свечение. Системное синее
  // кольцо снимаем здесь же (outline-none): глобальный фокус-стиль на этой
  // модалке не должен спорить с эталоном.
  const FIELD =
    "w-full bg-surface border border-line-2 rounded-[16px] px-4 py-3.5 text-[15px] font-medium " +
    "outline-none transition-shadow placeholder:text-muted-soft placeholder:font-normal " +
    "focus:border-ink focus:shadow-[0_0_0_3px_rgba(200,217,111,.45)]";
  const LABEL = "block text-[11.5px] font-medium uppercase tracking-[0.07em] text-muted mb-2.5";
  const HINT = "not-italic normal-case tracking-normal text-muted-soft";

  const selectedCurrencyMeta = currencies.find((c) => c.code === currency);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="2xl"
      panelClassName="min-w-0 !max-w-[660px] !rounded-[24px] sm:!rounded-[30px] !bg-surface !border-line shadow-[0_30px_80px_rgba(23,21,15,.30)]"
    >
      {/* Шапка: название офиса подзаголовком, круглый × на панельном фоне. */}
      <div className="flex items-center gap-3 px-4 sm:px-8 pt-6 sm:pt-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.015em] leading-tight text-ink">
            {t("acc_add_title") || "Новый счёт"}
          </h1>
          {officeName && <span className="text-[13.5px] text-muted">{officeName}</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close") || "Закрыть"}
          className="ml-auto w-[38px] h-[38px] shrink-0 rounded-full bg-cream-2 grid place-items-center text-muted hover:text-ink transition-colors"
        >
          <X className="w-3 h-3" strokeWidth={2.4} />
        </button>
      </div>

      <div className="px-4 sm:px-8 pt-6 pb-1.5">
        {/* Валюта · Канал. На узком экране складываются в столбец. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="min-w-0">
            <label className={LABEL}>{t("acc_currency") || "Валюта"}</label>
            <div className="relative">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={`${FIELD} appearance-none pr-10 cursor-pointer`}
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.type === "crypto" ? "крипто" : "фиат"}
                  </option>
                ))}
              </select>
              <Chevron />
            </div>
          </div>

          <div className="min-w-0">
            <label className={LABEL}>{t("acc_channel") || "Канал"}</label>
            <div className="relative">
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={currencyChannels.length === 0}
                className={`${FIELD} appearance-none pr-10 cursor-pointer disabled:opacity-60`}
              >
                {currencyChannels.length === 0 && <option>— нет каналов —</option>}
                {currencyChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {channelShortLabel(c)}
                    {c.isDefaultForCurrency ? " · по умолчанию" : ""}
                  </option>
                ))}
              </select>
              <Chevron />
            </div>
            {currencyChannels.length === 0 && (
              <p className="text-[11.5px] text-warning mt-1.5">
                Сначала добавь канал для {currency} в Курсы → Изменить.
              </p>
            )}
          </div>
        </div>

        {/* Дубликаты — одной свёрнутой строкой. Нет дубликатов — нет блока:
            пустая рамка «ничего не найдено» занимала бы место и внимание. */}
        {existingSameCurrency.length > 0 && (
          <div className="mt-3.5 border border-line rounded-[14px] overflow-hidden">
            <button
              type="button"
              onClick={() => setDupOpen((v) => !v)}
              aria-expanded={dupOpen}
              className="flex items-center gap-2.5 w-full min-w-0 text-left px-4 py-3 bg-cream-2 text-[13px] font-medium text-ink-soft"
            >
              <span className="truncate">
                {currency} · {channelShortLabel(selectedChannel)} {t("acc_dup_exists") || "уже есть"}
              </span>
              <span className="shrink-0 bg-surface rounded-full px-2 py-[1px] text-[11.5px] font-semibold">
                {existingSameCurrency.length}
              </span>
              <span className="hidden sm:inline font-normal text-muted-soft truncate">{t("acc_dup_tail") || "— можно взять за основу"}</span>
              <ChevronDown
                className={`ml-auto shrink-0 w-3.5 h-3.5 text-muted transition-transform ${dupOpen ? "rotate-180" : ""}`}
                strokeWidth={2.2}
              />
            </button>

            {dupOpen && (
              <div className="max-h-[176px] overflow-y-auto">
                {existingSameCurrency.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2.5 min-w-0 px-4 py-2.5 border-t border-line text-[13.5px]"
                  >
                    <b className="font-semibold truncate">{a.name}</b>
                    <span className="text-muted truncate">
                      {officeLookup.get(a.officeId) || "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleClone(a)}
                      className="ml-auto shrink-0 text-[12px] font-semibold text-ink-soft px-2.5 py-1 rounded-full border border-line-2 hover:bg-cream-2 hover:text-ink transition-colors"
                    >
                      {t("acc_dup_use") || "Взять за основу"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5">
          <label className={LABEL}>{t("acc_name") || "Название"}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCryptoChannel ? "TRC20 Main" : "Cash · Safe A"}
            autoFocus
            className={FIELD}
          />
        </div>

        {/* Крипто-поля эталон не рисует, но без адреса счёт на депозит не
            создаётся — валидация в handleSubmit его требует. Поэтому они
            остаются, приведённые к тому же виду. */}
        {isCryptoChannel && (
          <>
            <div className="mt-5">
              <label className={LABEL}>Адрес кошелька</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
                placeholder={selectedChannel?.network === "ERC20" ? "0x…" : "T…"}
                className={`${FIELD} font-mono text-[14px]`}
              />
              <p className="text-[11.5px] text-muted-soft mt-1.5">
                По нему опрос ловит входящие переводы.
              </p>
            </div>
            <div className="flex items-center gap-3 mt-3.5">
              <Toggle checked={isDeposit} onChange={setIsDeposit} label="Приём (следить за входящими)" />
              <Toggle checked={isWithdrawal} onChange={setIsWithdrawal} label="Выдача" />
            </div>
          </>
        )}

        {showBankRefField && (
          <div className="mt-5">
            <label className={LABEL}>
              {isQrChannel ? "QR payload / ссылка на оплату" : (
                <>Реквизиты банка <em className={HINT}>· опционально</em></>
              )}
            </label>
            <input
              type="text"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder={isQrChannel ? "https://… или строка QR" : "IBAN / номер счёта"}
              className={`${FIELD} ${isQrChannel ? "font-mono text-[14px]" : ""}`}
            />
          </div>
        )}

        {/* Баланс · Номер счёта */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="min-w-0">
            <label className={LABEL}>
              {t("acc_opening_label") || "Начальный баланс"} <em className={HINT}>· {t("acc_opening_optional") || "опционально"}</em>
            </label>
            <div className="relative">
              <input
                type="text"
                value={openingBalance}
                onChange={(e) =>
                  setOpeningBalance(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder="0"
                className={`${FIELD} tabular-nums pr-16`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-medium pointer-events-none">
                {selectedCurrencyMeta?.code || currency}
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <label className={LABEL}>
              {t("acc_number_label") || "Номер счёта"} <em className={HINT}>· {t("acc_number_from_ledger") || "из леджера"}</em>
            </label>
            <div className="relative">
              {/* TODO: показать будущий номер. Его присваивает сервер в
                  create_account_v2 (следующий свободный в диапазоне 19xx), а
                  эндпоинта предпросмотра нет. Считать номер на клиенте нельзя:
                  два кассира, открывшие форму одновременно, увидели бы один и
                  тот же — и один из них неверный. */}
              <input
                type="text"
                value="—"
                readOnly
                tabIndex={-1}
                aria-label="Номер счёта присвоит сервер"
                className={`${FIELD} font-mono text-[14.5px] text-muted-soft pr-14 cursor-default`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
                {t("acc_number_auto") || "авто"}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 text-[13px] font-medium text-danger bg-danger-soft border border-danger/20 rounded-[14px] px-4 py-2.5">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5 px-4 sm:px-8 pt-5 pb-6 sm:pb-7 mt-4 border-t border-line">
        <span className="hidden sm:inline text-[12px] text-muted-soft">{t("acc_add_hint") || "Счёт появится в развороте офиса"}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto shrink-0 px-5 py-3 rounded-full font-medium text-ink-soft hover:bg-cream-2 hover:text-ink transition-colors"
        >
          {t("cancel") || "Отмена"}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`shrink-0 px-6 py-3 rounded-full text-[15px] font-semibold transition-colors ${
            canSubmit
              ? "bg-lime text-lime-ink hover:brightness-[1.04]"
              : "bg-cream-2 text-muted-soft cursor-not-allowed"
          }`}
        >
          {t("acc_add_submit") || "Создать счёт"}
        </button>
      </div>
    </Modal>
  );
}

/** Шеврон селекта — рисуем свой, системный убран через appearance-none. */
function Chevron() {
  return (
    <ChevronDown
      className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none"
      strokeWidth={2.2}
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex-1 flex items-center gap-2 cursor-pointer select-none bg-surface-soft border border-border-soft rounded-card px-3 py-2 hover:border-border transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded-[4px] accent-slate-900"
      />
      <span className="text-caption font-medium text-ink-soft">{label}</span>
    </label>
  );
}
