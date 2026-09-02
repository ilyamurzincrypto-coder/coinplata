// src/components/rates/RatesVersionsScreen.jsx
// Экран 3 эталона: публикация — один снапшот, все каналы, история версий.
//
// ЧЕСТНОСТЬ ПЛИТОК. Каналов на картинке пять, но доставка ОДНА: касса
// отправляет прайс в CoinPoint, а сайт, миниапп, оба бота и админка читают
// его оттуда. Поэтому у плиток общий источник состояния — время приёма
// версии. Рисовать пять независимых галочек значило бы обещать пять
// независимых проверок, которых нет.
//
// И ГЛАВНОЕ: галочка ставится, только если версия ДОШЛА ЦЕЛИКОМ. Если часть
// строк не легла (нет направления в справочнике, выключена валюта), плитки
// показывают «частично» и число. Зелёная галочка над наполовину доехавшим
// прайсом — это ровно тот случай, когда витрина выглядит рабочей, а половины
// курсов на ней нет.

import React from "react";
import { Loader2, RotateCcw } from "lucide-react";

const CHANNELS = [
  { key: "site", letter: "S", name: "Сайт" },
  { key: "mini", letter: "M", name: "Миниапп" },
  { key: "client", letter: "К", name: "Клиентский бот" },
  { key: "manager", letter: "Б", name: "Бот менеджеров" },
  { key: "admin", letter: "А", name: "Админка" },
];

const hhmm = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : "";
};

const dayLabel = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
};

/** Состояние доставки последней версии, приведённое к языку плиток. */
function channelState(delivery, pricesCount) {
  const s = delivery?.state;
  if (s === "sent") {
    const applied = Number(delivery.applied);
    const partial = Number.isFinite(applied) && applied > 0 && applied < pricesCount;
    return {
      tone: partial ? "warn" : "ok",
      time: hhmm(delivery.delivered_at),
      label: partial ? `частично · ${applied} из ${pricesCount}` : hhmm(delivery.delivered_at),
    };
  }
  if (s === "failed") return { tone: "bad", label: "не дошло" };
  if (s === "skipped") return { tone: "muted", label: "мост выключен" };
  return { tone: "muted", label: "ожидает" };
}

export default function RatesVersionsScreen({ versions, loading, onRollback, rollingBack, onClose }) {
  const list = versions || [];
  const current = list[0] || null;
  const delivery = current?.delivery;
  const ch = channelState(delivery, current?.prices_count || 0);
  const skipped = delivery?.skipped_reasons && typeof delivery.skipped_reasons === "object"
    ? Object.entries(delivery.skipped_reasons)
    : [];

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr" }}>
      {/* ── Версии ─────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-card-2 px-[22px] py-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[14px]">Версии</span>
          {onClose && (
            <button type="button" onClick={onClose} className="text-[12px] text-faint hover:text-ink">
              к редактору
            </button>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> загрузка
          </div>
        )}

        {!loading && list.length === 0 && (
          <div className="text-[12.5px] text-muted py-2">публикаций ещё нет</div>
        )}

        {list.map((v, i) => (
          <div key={v.version} className="flex gap-3 items-baseline py-2.5 border-t border-line first:border-t-0 first:pt-0">
            <span className={`font-light text-[19px] w-[64px] shrink-0 ${i === 0 ? "text-ink" : "text-faint"}`}>
              v. {v.version}
            </span>
            <span className="text-[11.5px] text-faint leading-relaxed min-w-0">
              {i === 0 && <b className="text-ink font-normal">текущая</b>}
              {i === 0 && " · "}
              {dayLabel(v.published_at)} {hhmm(v.published_at)}
              {v.author && ` · ${v.author}`}
              {v.note && <><br />{v.note}</>}
              <br />
              <span className="opacity-80">{v.prices_count} цен</span>
              {/* Откат имеет смысл только для НЕ текущей версии: вернуться
                  к тому, что и так стоит, нечего. */}
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => onRollback(v.version)}
                  disabled={rollingBack}
                  className="ml-2 inline-flex items-center gap-1 text-[11px] text-[#6B675C] hover:text-ink disabled:opacity-40"
                  title={`Опубликовать цены v. ${v.version} как новую версию`}
                >
                  <RotateCcw className="w-3 h-3" /> откатить
                </button>
              )}
            </span>
          </div>
        ))}

        {list.length > 0 && (
          <div className="border-t border-line pt-2.5 mt-1 text-[11.5px] text-faint leading-relaxed">
            откат не переписывает историю: цены старой версии уходят наверх
            <b className="text-ink font-normal"> новой версией</b>, и в ленте видно, что был откат
          </div>
        )}
      </div>

      {/* ── Каналы ─────────────────────────────────────────────────────── */}
      <div className="bg-dark rounded-card-2 px-[22px] py-5 text-cream">
        <div className="text-[14px] mb-1.5">
          {current ? `Каналы получили v. ${current.version}` : "Каналы"}
        </div>
        <div className="text-[12px] text-[#7A7565] mb-4">
          касса считает конечные цифры один раз — наружу уходит готовый прайс, без формул
        </div>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}>
          {CHANNELS.map((c) => (
            <div key={c.key} className="bg-dark-2 rounded-[18px] p-3.5">
              <span className="w-8 h-8 rounded-full border border-[#3A372C] text-[#A39D8C] flex items-center justify-center mb-3 text-[13px]">
                {c.letter}
              </span>
              <div className="text-[12.5px] leading-snug">{c.name}</div>
              <div className={`flex items-center gap-1.5 text-[11px] mt-2 ${
                ch.tone === "ok" ? "text-lime"
                  : ch.tone === "warn" ? "text-orange"
                  : ch.tone === "bad" ? "text-danger"
                  : "text-[#7A7565]"
              }`}>
                {ch.tone === "ok" && (
                  <span className="w-3.5 h-3.5 rounded-full bg-lime text-lime-ink flex items-center justify-center text-[10px] shrink-0">✓</span>
                )}
                <span className="truncate">{ch.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Что не доехало — поимённо. Без этого «частично» превращается в
            загадку, а курс, которого нет на витрине, ищут вручную. */}
        {skipped.length > 0 && (
          <div className="mt-4 bg-dark-3 rounded-[16px] px-4 py-3">
            <div className="text-[12px] text-[#A39D8C] mb-1.5">
              не доехало {delivery.skipped_count} строк:
            </div>
            <ul className="text-[11.5px] text-[#8B8676] space-y-0.5">
              {skipped.map(([reason, n]) => (
                <li key={reason}>· {reason} — {n}</li>
              ))}
            </ul>
          </div>
        )}

        {delivery?.state === "failed" && delivery.error && (
          <div className="mt-4 text-[12px] text-danger">{delivery.error}</div>
        )}

        <div className="flex items-center gap-2.5 mt-4 text-[12px] text-[#A39D8C]">
          <span className="w-[18px] h-[18px] rounded-[6px] bg-lime text-lime-ink text-[11px] flex items-center justify-center shrink-0">✓</span>
          «Зафиксировать курс» в заявке = привязка к номеру версии, а не к плавающему числу
        </div>
      </div>
    </div>
  );
}
