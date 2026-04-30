import { useEffect, useState } from "react";

// Тикер для UI-таймеров типа "updated Xm ago". Без него timeAgo()
// вычисляется только в момент рендера и строка зависает — юзер видит
// "0s ago" и считает что курсы не обновляются. С хуком компонент
// принудительно перерендеривается каждые intervalMs.
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
