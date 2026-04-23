// src/lib/dataVersion.jsx
// Глобальный signal "данные в БД изменились — перезагрузите". Каждый store
// подписан на version через useEffect; bump() триггерит реhydrate во всех
// подписанных stores одновременно.
//
// Использование в writer'ах:
//   import { bumpDataVersion } from "./dataVersion.jsx";
//   await supabase.rpc(...);
//   bumpDataVersion();
//
// В store:
//   const { version } = useDataVersion();
//   useEffect(() => { loadXxx().then(setState) }, [version]);

import { createContext, useContext, useState, useCallback, useMemo } from "react";

const DataVersionContext = createContext({ version: 0, bump: () => {} });

// Модульный emitter чтобы write-хелперы могли триггерить bump без useContext.
// Provider при mount подписывается на это событие и инкрементит version.
const BUMP_EVENT = "coinplata:data-bump";

export function bumpDataVersion() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BUMP_EVENT));
  }
}

// Утилита для stores: подписка на reload-событие. Возвращает unsubscribe.
export function onDataBump(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(BUMP_EVENT, handler);
  return () => window.removeEventListener(BUMP_EVENT, handler);
}

export function DataVersionProvider({ children }) {
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  // Привязываем модульный bumpDataVersion() к нашему state.
  useMemo(() => {
    if (typeof window === "undefined") return;
    const handler = () => setVersion((v) => v + 1);
    window.addEventListener(BUMP_EVENT, handler);
    // Чистим только при unmount — но т.к. Provider глобальный, это never.
    // Сохраним ссылку в window для idempotency при HMR.
    if (window.__coinplataBumpHandler) {
      window.removeEventListener(BUMP_EVENT, window.__coinplataBumpHandler);
    }
    window.__coinplataBumpHandler = handler;
  }, []);

  const value = useMemo(() => ({ version, bump }), [version, bump]);
  return (
    <DataVersionContext.Provider value={value}>{children}</DataVersionContext.Provider>
  );
}

export function useDataVersion() {
  return useContext(DataVersionContext);
}
