// src/utils/legStatus.js
// Единая точка определения статуса лега сделки.
//
// Модель:
//   plannedAmount  — сколько должно быть
//   actualAmount   — сколько уже реально произошло (накапливается для partial)
//   plannedAt      — когда ожидалось (timestamp или ISO string)
//   completedAt    — когда полностью закрыто (null пока не закрыто)
//
// Правила:
//   completedAt & actual >= planned     → completed
//   actual > 0 & actual < planned       → partial
//   !completedAt & planned_at < now-24h → delayed
//   иначе                               → pending
//
// Возвращаемый объект: { status, progress (0..1), delayDays?, planned, actual }

const DELAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 день льготы

export function computeLegStatus({ plannedAmount, actualAmount, plannedAt, completedAt }) {
  const planned = Number(plannedAmount) || 0;
  const actual = Number(actualAmount) || 0;

  if (completedAt && actual >= planned && planned > 0) {
    return { status: "completed", progress: 1, planned, actual };
  }
  if (actual > 0 && actual < planned) {
    return {
      status: "partial",
      progress: planned > 0 ? actual / planned : 0,
      planned,
      actual,
    };
  }
  if (!completedAt && plannedAt) {
    const plannedMs = new Date(plannedAt).getTime();
    if (Number.isFinite(plannedMs)) {
      const diff = Date.now() - plannedMs;
      if (diff > DELAY_THRESHOLD_MS) {
        return {
          status: "delayed",
          progress: 0,
          planned,
          actual: 0,
          delayDays: Math.floor(diff / (24 * 60 * 60 * 1000)),
        };
      }
    }
  }
  return { status: "pending", progress: 0, planned, actual };
}

// Статусный стиль для UI — используется в TransactionsTable.
export function legStatusStyle(status) {
  switch (status) {
    case "completed":
      return { label: "Completed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
    case "partial":
      return { label: "Partial", cls: "bg-violet-50 text-violet-700 ring-violet-200" };
    case "delayed":
      return { label: "Delayed", cls: "bg-rose-50 text-rose-700 ring-rose-200" };
    case "pending":
    default:
      return { label: "Pending", cls: "bg-amber-50 text-amber-700 ring-amber-200" };
  }
}

// Короткий date-format для UI.
export function formatShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const monthName = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  return sameYear ? `${day} ${monthName}` : `${day} ${monthName} ${d.getFullYear()}`;
}
