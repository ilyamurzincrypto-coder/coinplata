// src/components/accounts/ShareLinksModal.jsx
// Управление публичными read-only ссылками на раздел «Счета».
// Открывается из вкладки разреза (Все/Фиат/Крипто). Позволяет создать ссылку
// для текущего разреза, скопировать URL, увидеть все активные ссылки и отозвать.
// Ссылка открывается без логина; после отзыва отдаёт 404 (энфорсмент на бэке).
import React, { useEffect, useState } from "react";
import { X, Link2, Copy, Check, Trash2, Plus } from "lucide-react";
import {
  listShareLinks,
  createShareLink,
  revokeShareLink,
  shareUrl,
} from "../../lib/shareLinks.js";
import { SCOPE_LABEL } from "../../lib/shareAccounts.js";

export default function ShareLinksModal({ scope, onClose }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [allowDetails, setAllowDetails] = useState(false);
  const canDetails = scope === "crypto" || scope === "all"; // детали только там, где есть крипта

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await listShareLinks());
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createShareLink(scope, canDetails && allowDetails);
      await copy(created.token, created.id);
      await reload();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (id) => {
    setBusy(true);
    setError(null);
    try {
      await revokeShareLink(id);
      setLinks((ls) => ls.filter((l) => l.id !== id));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (token, id) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard недоступен — URL всё равно виден в поле */
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-card border border-border-soft shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-[#5b6cff]" strokeWidth={2} />
            <span className="text-body font-bold text-ink">Публичные ссылки · Счета</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-soft text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-button bg-ink text-white text-body-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" strokeWidth={2.4} /> Создать ссылку · {SCOPE_LABEL[scope] || scope}
          </button>
          {canDetails && (
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowDetails}
                onChange={(e) => setAllowDetails(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-[#5b6cff]"
              />
              <span className="text-[12.5px] text-ink-soft leading-snug">
                Показывать движения и контрагентов по кошелькам
                <span className="block text-[11px] text-muted">По ссылке будут видны детали крипто-кошелька (транзакции «откуда/куда», риск) — read-only, из кэша.</span>
              </span>
            </label>
          )}
          <p className="text-[12px] text-muted">
            Кто откроет ссылку — увидит раздел в режиме «только просмотр», без логина. Данные живые.
          </p>

          {error && <div className="text-[12.5px] text-rose-600">{error}</div>}

          <div className="border-t border-border-soft pt-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">
              Активные ссылки
            </div>
            {loading ? (
              <div className="text-[12.5px] text-muted">Загрузка…</div>
            ) : links.length === 0 ? (
              <div className="text-[12.5px] text-muted">Пока нет активных ссылок.</div>
            ) : (
              <ul className="space-y-2">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center h-6 px-2 rounded-[7px] bg-[#eef0ff] text-[#5b6cff] text-[11px] font-bold shrink-0">
                      {SCOPE_LABEL[l.scope] || l.scope}
                    </span>
                    {l.allowDetails && (
                      <span className="inline-flex items-center h-6 px-2 rounded-[7px] bg-emerald-50 text-emerald-700 text-[11px] font-bold shrink-0" title="По ссылке доступны детали кошельков">
                        детали
                      </span>
                    )}
                    <input
                      readOnly
                      value={shareUrl(l.token)}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 text-[12px] font-mono text-ink-soft bg-surface-soft rounded-[7px] px-2 py-1 border border-border-soft"
                    />
                    <button
                      type="button"
                      title="Скопировать"
                      onClick={() => copy(l.token, l.id)}
                      className="p-1.5 rounded hover:bg-surface-soft text-muted shrink-0"
                    >
                      {copiedId === l.id ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Отозвать"
                      disabled={busy}
                      onClick={() => onRevoke(l.id)}
                      className="p-1.5 rounded hover:bg-rose-50 text-rose-500 shrink-0 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
