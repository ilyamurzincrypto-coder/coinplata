// src/lib/authStorage.js
// Хранилище сессии Supabase, переживающее браузеры, которые не дают писать
// в localStorage (Safari с его политикой хранилища, приватные окна, режимы
// «блокировать все cookie»).
//
// ЧТО ПРОИЗОШЛО В ЖИЗНИ: 27.08 сессия владельца рефрешилась штатно каждые
// ~2 часа весь день, последний токен выдан успешно (200) — и пропал. Сервер
// его не отзывал: Safari вычистил хранилище. Приложение при этом показывало
// бесконечное «Signing in…», потому что вход на сервере проходил, а сохранить
// сессию было некуда.
//
// ГАРДРЕЙЛ: ключ и формат НЕ меняются. Supabase сам вычисляет storageKey
// (sb-<ref>-auth-token) и сам решает, что в нём лежит — мы подменяем только
// БЭКЕНД хранения. Поэтому живые сессии одиннадцати пользователей переживают
// деплой: после обновления клиент читает тот же ключ из того же localStorage.
//
// Cookie-storage сознательно НЕ трогаем — это миграция живых сессий, отдельная
// работа с планом (в бэклоге).

/** Сессия в памяти вкладки — когда localStorage недоступен. */
const memory = new Map();

let probed = null; // null — ещё не проверяли

/**
 * Доступна ли запись в localStorage. Проверяется РЕАЛЬНОЙ записью: наличие
 * объекта window.localStorage ничего не значит — Safari отдаёт объект, а на
 * setItem бросает. Результат кэшируется: проба на каждый вызов дорога.
 */
export function isPersistentStorageAvailable() {
  if (probed !== null) return probed;
  try {
    const k = "__cp_storage_probe__";
    localStorage.setItem(k, "1");
    const ok = localStorage.getItem(k) === "1";
    localStorage.removeItem(k);
    probed = ok;
  } catch {
    probed = false;
  }
  return probed;
}

/** Только для тестов: сбросить кэш пробы и память. */
export function __resetStorageProbe() {
  probed = null;
  memory.clear();
}

/**
 * Адаптер для supabase-js. Всегда пробует localStorage (там могла остаться
 * живая сессия), при исключении — память вкладки. Ключ приходит снаружи от
 * supabase и не меняется.
 */
export const authStorage = {
  getItem(key) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v;
    } catch {
      /* хранилище недоступно — читаем из памяти */
    }
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, value); // память — всегда, как страховка
    try {
      localStorage.setItem(key, value);
    } catch {
      /* не сохранилось на диск: сессия живёт до перезагрузки вкладки */
    }
  },
  removeItem(key) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};
