// src/store/dealForm.js
// UI этап 2 — unified legs[] state для DealForm v2.
//
// useReducer-based state. Один shape для IN и OUT legs (side discriminator).
// buildTx (src/lib/dealForm/buildTx.js) конвертирует это в v2 RPC payload.

import { useReducer, useCallback, useMemo, useEffect } from "react";
import { multiplyAmount } from "../utils/money.js"; // деньги — только через money.js (B7)

const HISTORY_MAX = 20;
const DRAFT_KEY = "dealForm.draft.v1";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Leg
 * @property {string} id              — local UUID, stable across rerenders
 * @property {'in'|'out'} side
 * @property {string} currency        — 'USD' | 'TRY' | ...
 * @property {string} amount          — string (raw input, не number — чтобы не терять trailing zeros)
 * @property {string|null} accountId  — public.accounts.id (UUID) или null
 * @property {string} rate            — string; only meaningful для OUT legs
 * @property {boolean} rateManual     — true = rate manually edited, false = market default
 * @property {boolean} deferred       — true = ours_later/partner_later (no immediate movement)
 * @property {'fresh'|'from_balance'} source       — IN-only
 * @property {'physical'|'to_balance'} destination — OUT-only
 * @property {string|null} address    — wallet address (crypto OUT only)
 * @property {string|null} network    — TRC20/ERC20/BEP20 (crypto OUT only)
 * @property {string|null} note       — optional per-leg note
 */

/**
 * @typedef {Object} CommissionEntry
 * @property {string} currency
 * @property {string} amount
 * @property {'commission'|'spread'} kind
 */

/**
 * @typedef {Object} ConditionsState
 * @property {'pro_rata'|'single_leg'|'manual'} margin_strategy
 * @property {string[]} flags          — ['referral','vip','partner','otc']
 * @property {string[]} fees           — ['network_fee_exchange','network_fee_client',
 *                                        'bank_fee','no_commission']
 * @property {Object}   on_demand
 * @property {string|null} on_demand.backdate     — ISO timestamp
 * @property {string|null} on_demand.scheduled_at — ISO timestamp
 * @property {string|null} on_demand.comment
 * @property {string|null} on_demand.tx_hash
 */

/**
 * @typedef {Object} DealFormState
 * @property {Leg[]} legs
 * @property {CommissionEntry[]} commission
 * @property {ConditionsState} conditions
 */

// ─────────────────────────────────────────────────────────────────────
// Action types
// ─────────────────────────────────────────────────────────────────────

export const ACTIONS = {
  ADD_LEG: "ADD_LEG",
  REMOVE_LEG: "REMOVE_LEG",
  UPDATE_LEG: "UPDATE_LEG",
  REORDER_LEGS: "REORDER_LEGS",
  SET_COMMISSION: "SET_COMMISSION",
  SET_CONDITION: "SET_CONDITION",
  RESET: "RESET",
  HYDRATE: "HYDRATE",
  UNDO: "UNDO",
  REDO: "REDO",
};

export function defaultConditions() {
  return {
    margin_strategy: "pro_rata",
    flags: [],
    fees: ["network_fee_exchange"],
    on_demand: {
      backdate: null,
      scheduled_at: null,
      comment: null,
      tx_hash: null,
    },
  };
}

// Действия которые попадают в undo-stack. UPDATE_LEG объединяется по
// throttle — multiple keystrokes в один cell = один undo-step (см. ниже).
const UNDOABLE = new Set([
  ACTIONS.ADD_LEG,
  ACTIONS.REMOVE_LEG,
  ACTIONS.UPDATE_LEG,
  ACTIONS.REORDER_LEGS,
  ACTIONS.SET_COMMISSION,
  ACTIONS.SET_CONDITION,
  ACTIONS.RESET,
]);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextLegId() {
  // Не используем crypto.randomUUID() здесь — UI legs нужны короткие ID.
  // Stable инкремент достаточен для refs[][] и React keys.
  _idCounter += 1;
  return `leg_${_idCounter}_${Date.now().toString(36).slice(-4)}`;
}

/**
 * Empty leg — defaults для new row.
 * @param {'in'|'out'} side
 * @returns {Leg}
 */
export function makeEmptyLeg(side) {
  return {
    id: nextLegId(),
    side,
    currency: "",
    amount: "",
    accountId: null,
    rate: "",
    rateManual: false,
    deferred: false,
    source: side === "in" ? "fresh" : null,
    destination: side === "out" ? "physical" : null,
    address: null,
    network: null,
    note: null,
  };
}

/**
 * Initial state — один auto-IN, пустой OUT collection.
 * @returns {DealFormState}
 */
export function initialState() {
  return {
    legs: [makeEmptyLeg("in")],
    commission: [],
    conditions: defaultConditions(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────

export function dealFormReducer(state, action) {
  switch (action.type) {
    case ACTIONS.ADD_LEG: {
      const side = action.side === "out" ? "out" : "in";
      const newLeg = action.leg
        ? { ...makeEmptyLeg(side), ...action.leg, id: action.leg.id || nextLegId(), side }
        : makeEmptyLeg(side);
      return { ...state, legs: [...state.legs, newLeg] };
    }
    case ACTIONS.REMOVE_LEG: {
      const filtered = state.legs.filter((l) => l.id !== action.id);
      // Гарантируем хотя бы один IN leg всегда
      const hasIn = filtered.some((l) => l.side === "in");
      return {
        ...state,
        legs: hasIn ? filtered : [makeEmptyLeg("in"), ...filtered],
      };
    }
    case ACTIONS.UPDATE_LEG: {
      const target = state.legs.find((l) => l.id === action.id);
      if (!target) return state;

      // Apply user patch первым шагом
      let nextLegs = state.legs.map((l) =>
        l.id === action.id ? { ...l, ...action.patch } : l
      );

      // Auto-calc rules — bidirectional rate ↔ amount sync.
      // Bypass через `_skipAutoCalc: true` в action (для programmatic updates,
      // которые не должны триггерить sync — e.g. account select).
      if (!action._skipAutoCalc) {
        nextLegs = applyAutoCalc(nextLegs, target, action.patch);
      }

      return { ...state, legs: nextLegs };
    }
    case ACTIONS.REORDER_LEGS: {
      const idOrder = action.ids;
      const byId = new Map(state.legs.map((l) => [l.id, l]));
      const reordered = idOrder.map((id) => byId.get(id)).filter(Boolean);
      // Append legs которые не были упомянуты (защита от потери)
      const mentioned = new Set(idOrder);
      const orphans = state.legs.filter((l) => !mentioned.has(l.id));
      return { ...state, legs: [...reordered, ...orphans] };
    }
    case ACTIONS.SET_COMMISSION: {
      return { ...state, commission: action.entries || [] };
    }
    case ACTIONS.SET_CONDITION: {
      const conditions = state.conditions || defaultConditions();
      const f = action.field;
      // Top-level fields: margin_strategy, flags, fees
      if (f === "margin_strategy" || f === "flags" || f === "fees") {
        return { ...state, conditions: { ...conditions, [f]: action.value } };
      }
      // Nested on_demand.*
      if (typeof f === "string" && f.startsWith("on_demand.")) {
        const key = f.slice("on_demand.".length);
        return {
          ...state,
          conditions: {
            ...conditions,
            on_demand: { ...(conditions.on_demand || {}), [key]: action.value },
          },
        };
      }
      return state;
    }
    case ACTIONS.HYDRATE: {
      return action.state || state;
    }
    case ACTIONS.RESET: {
      return initialState();
    }
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────

/**
 * historyReducer — wrapper над dealFormReducer для undo/redo.
 * State shape: { past: State[], present: State, future: State[] }.
 * Только UNDOABLE actions попадают в past stack. Stack ограничен HISTORY_MAX.
 */
export function historyReducer(state, action) {
  if (action.type === ACTIONS.UNDO) {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future].slice(0, HISTORY_MAX),
    };
  }
  if (action.type === ACTIONS.REDO) {
    if (state.future.length === 0) return state;
    const [next, ...rest] = state.future;
    return {
      past: [...state.past, state.present].slice(-HISTORY_MAX),
      present: next,
      future: rest,
    };
  }

  const newPresent = dealFormReducer(state.present, action);
  if (newPresent === state.present) return state;
  if (!UNDOABLE.has(action.type)) {
    return { ...state, present: newPresent };
  }

  // Throttle UPDATE_LEG: если последняя undo-entry для того же leg+key —
  // не плодим новые stack frames на каждое нажатие клавиши.
  const last = state.past[state.past.length - 1];
  const isUpdateContinuation =
    action.type === ACTIONS.UPDATE_LEG &&
    last && last.__lastUpdate &&
    last.__lastUpdate.id === action.id &&
    last.__lastUpdate.keys === Object.keys(action.patch || {}).join(",");

  if (isUpdateContinuation) {
    return { ...state, present: newPresent, future: [] };
  }

  // Mark present с metadata для throttle detection
  const presentMarked =
    action.type === ACTIONS.UPDATE_LEG
      ? {
          ...state.present,
          __lastUpdate: {
            id: action.id,
            keys: Object.keys(action.patch || {}).join(","),
          },
        }
      : state.present;
  return {
    past: [...state.past, presentMarked].slice(-HISTORY_MAX),
    present: newPresent,
    future: [],
  };
}

/**
 * useDealForm — combo hook для DealForm.
 * Возвращает state, селекторы и action creators (включая undo/redo).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.initial]   — initial state override (skip default)
 * @param {boolean} [opts.persist]  — auto-save в localStorage (default true)
 */
export function useDealForm(opts) {
  const initial = opts && opts.initial;
  const persist = !opts || opts.persist !== false;

  const init = () => {
    const presentState = initial || tryLoadDraft() || initialState();
    return { past: [], present: presentState, future: [] };
  };

  const [hist, dispatchInner] = useReducer(historyReducer, undefined, init);
  const state = hist.present;
  const dispatch = dispatchInner;

  const addLeg = useCallback((side, leg) => {
    dispatch({ type: ACTIONS.ADD_LEG, side, leg });
  }, []);
  const removeLeg = useCallback((id) => {
    dispatch({ type: ACTIONS.REMOVE_LEG, id });
  }, []);
  const updateLeg = useCallback((id, patch) => {
    dispatch({ type: ACTIONS.UPDATE_LEG, id, patch });
  }, []);
  const reorderLegs = useCallback((ids) => {
    dispatch({ type: ACTIONS.REORDER_LEGS, ids });
  }, []);
  const setCommission = useCallback((entries) => {
    dispatch({ type: ACTIONS.SET_COMMISSION, entries });
  }, []);
  const setCondition = useCallback((field, value) => {
    dispatch({ type: ACTIONS.SET_CONDITION, field, value });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: ACTIONS.RESET });
  }, []);
  const hydrate = useCallback((s) => {
    dispatch({ type: ACTIONS.HYDRATE, state: s });
  }, []);
  const undo = useCallback(() => dispatch({ type: ACTIONS.UNDO }), []);
  const redo = useCallback(() => dispatch({ type: ACTIONS.REDO }), []);

  // ── Auto-save draft в localStorage ──
  useEffect(() => {
    if (!persist) return;
    try {
      const payload = {
        state: {
          legs: state.legs,
          commission: state.commission,
          conditions: state.conditions,
        },
        savedAt: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // localStorage может быть недоступен (private mode, quota) — игнорируем
    }
  }, [state.legs, state.commission, state.conditions, persist]);

  // ── Keyboard shortcuts: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z ──
  useEffect(() => {
    const handler = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = (e.key || "").toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ── Selectors ──
  const inLegs = useMemo(
    () => state.legs.filter((l) => l.side === "in"),
    [state.legs]
  );
  const outLegs = useMemo(
    () => state.legs.filter((l) => l.side === "out"),
    [state.legs]
  );
  const totalIn = useMemo(
    () => sumByCurrency(inLegs),
    [inLegs]
  );
  const totalOut = useMemo(
    () => sumByCurrency(outLegs),
    [outLegs]
  );
  const commissionByCurrency = useMemo(() => {
    const m = {};
    state.commission.forEach((c) => {
      const cur = c.currency;
      const amt = Number(c.amount) || 0;
      m[cur] = (m[cur] || 0) + amt;
    });
    return m;
  }, [state.commission]);

  return {
    state,
    legs: state.legs,
    inLegs,
    outLegs,
    totalIn,
    totalOut,
    commission: state.commission,
    commissionByCurrency,
    conditions: state.conditions || defaultConditions(),
    addLeg,
    removeLeg,
    updateLeg,
    reorderLegs,
    setCommission,
    setCondition,
    reset,
    hydrate,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    dispatch,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Draft persistence (localStorage)
// ─────────────────────────────────────────────────────────────────────

export function tryLoadDraft() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.state || !Array.isArray(parsed.state.legs)) return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    // Skip empty drafts (только дефолтная пустая IN row)
    const meaningful = parsed.state.legs.some(
      (l) => l.amount || l.currency || l.accountId || l.rate
    );
    if (!meaningful) return null;
    return {
      legs: parsed.state.legs,
      commission: parsed.state.commission || [],
      conditions: parsed.state.conditions || defaultConditions(),
    };
  } catch {
    return null;
  }
}

export function clearDraft() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* noop */
  }
}

// ─────────────────────────────────────────────────────────────────────
// Auto-calc rate ↔ amount sync (BUG 1 fix)
// ─────────────────────────────────────────────────────────────────────
//
// Правила:
//   R1. OUT.rate edited      → OUT.amount = first_IN.amount × OUT.rate
//   R2. OUT.amount edited    → OUT.rate   = OUT.amount / first_IN.amount
//   R3. IN.amount edited     → for each OUT с rate>0: OUT.amount = IN × rate
//
// Multi-IN: используем первую IN-leg как reference (single-currency сделки).
// Cross-currency (multi-IN с разными currencies) — оставляем без auto-calc,
// менеджер вводит manually.

const SAFE_DECIMALS = 8;

function formatNumber(num) {
  if (!Number.isFinite(num)) return "";
  // Trim trailing zeros, max 8 decimals для intermediate
  return parseFloat(num.toFixed(SAFE_DECIMALS)).toString();
}

export function applyAutoCalc(legs, target, patch) {
  if (!patch) return legs;

  const firstIn = legs.find((l) => l.side === "in");
  if (!firstIn) return legs;
  const inAmt = Number(firstIn.amount);
  const inAmtValid = Number.isFinite(inAmt) && inAmt > 0;

  // R1. OUT.rate edited → recalc OUT.amount
  if (target.side === "out" && "rate" in patch) {
    const rate = Number(patch.rate);
    if (Number.isFinite(rate) && rate > 0 && inAmtValid) {
      legs = legs.map((l) =>
        l.id === target.id
          ? { ...l, amount: formatNumber(multiplyAmount(inAmt, rate, SAFE_DECIMALS)) }
          : l
      );
    }
  }

  // R2. OUT.amount edited (но НЕ через rate-derived) → recalc OUT.rate
  // Условие: amount изменилось user-driven, rate не менялся в этом patch.
  if (target.side === "out" && "amount" in patch && !("rate" in patch)) {
    const newAmount = Number(patch.amount);
    if (Number.isFinite(newAmount) && newAmount > 0 && inAmtValid) {
      const newRate = newAmount / inAmt;
      legs = legs.map((l) =>
        l.id === target.id ? { ...l, rate: formatNumber(newRate), rateManual: true } : l
      );
    }
  }

  // R3. IN.amount edited → for each OUT с rate>0: OUT.amount = IN × rate
  if (target.side === "in" && "amount" in patch) {
    const newInAmt = Number(patch.amount);
    if (Number.isFinite(newInAmt) && newInAmt > 0) {
      legs = legs.map((l) => {
        if (l.side !== "out") return l;
        const r = Number(l.rate);
        if (!Number.isFinite(r) || r <= 0) return l;
        return { ...l, amount: formatNumber(multiplyAmount(newInAmt, r, SAFE_DECIMALS)) };
      });
    }
  }

  return legs;
}

// ─────────────────────────────────────────────────────────────────────
// Pure selectors (для buildTx и тестов)
// ─────────────────────────────────────────────────────────────────────

export function sumByCurrency(legs) {
  const m = {};
  legs.forEach((l) => {
    const cur = (l.currency || "").trim();
    if (!cur) return;
    const v = Number(l.amount) || 0;
    m[cur] = (m[cur] || 0) + v;
  });
  return m;
}

export function legsBySide(legs, side) {
  return legs.filter((l) => l.side === side);
}
