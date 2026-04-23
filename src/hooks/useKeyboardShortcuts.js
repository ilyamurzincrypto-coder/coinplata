// src/hooks/useKeyboardShortcuts.js
// Глобальные хоткеи. Игнорирует ввод внутри input/textarea/contenteditable.
//
// Поддерживает одиночные клавиши ("n", "/", "?") и последовательности через
// префикс "G" (G C = capital, G A = accounts и т.п.).

import { useEffect, useRef } from "react";

const isTypingTarget = (target) => {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
};

/**
 * Usage: useKeyboardShortcuts({
 *   "n": () => openNewDeal(),
 *   "/": () => focusSearch(),
 *   "g c": () => navigate("capital"),
 * });
 *
 * Handlers вызываются если:
 *   - клавиша не в input/textarea
 *   - не нажаты modifier'ы (Ctrl/Meta/Alt) — shift для ? считается ok
 */
export function useKeyboardShortcuts(map) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    const state = { prefix: null, prefixTimer: null };

    const clearPrefix = () => {
      state.prefix = null;
      if (state.prefixTimer) {
        clearTimeout(state.prefixTimer);
        state.prefixTimer = null;
      }
    };

    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = e.key.toLowerCase();
      const current = mapRef.current || {};

      // Prefix mode: ждём вторую клавишу.
      if (state.prefix) {
        const combo = `${state.prefix} ${k}`;
        clearPrefix();
        const h = current[combo];
        if (h) {
          e.preventDefault();
          h(e);
        }
        return;
      }

      // G — start prefix.
      if (k === "g") {
        // Если есть хоть один handler с префиксом g — встаём в режим.
        const hasPrefixed = Object.keys(current).some((key) => key.startsWith("g "));
        if (hasPrefixed) {
          e.preventDefault();
          state.prefix = "g";
          state.prefixTimer = setTimeout(clearPrefix, 1200);
          return;
        }
      }

      const h = current[k];
      if (h) {
        e.preventDefault();
        h(e);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      clearPrefix();
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
