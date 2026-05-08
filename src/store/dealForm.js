// src/store/dealForm.js
// UI этап 2 — unified legs[] state для DealForm v2.
//
// useReducer-based state. Один shape для IN и OUT legs (side discriminator).
// buildTx (src/lib/dealForm/buildTx.js) конвертирует это в v2 RPC payload.

import { useReducer, useCallback, useMemo } from "react";

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
 * @typedef {Object} DealFormState
 * @property {Leg[]} legs
 * @property {CommissionEntry[]} commission
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
  RESET: "RESET",
  HYDRATE: "HYDRATE",
};

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
 * useDealForm — combo hook для DealForm.
 * Возвращает state, селекторы и action creators.
 */
export function useDealForm(initial) {
  const [state, dispatch] = useReducer(
    dealFormReducer,
    initial,
    initial ? () => initial : initialState
  );

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
  const reset = useCallback(() => {
    dispatch({ type: ACTIONS.RESET });
  }, []);
  const hydrate = useCallback((s) => {
    dispatch({ type: ACTIONS.HYDRATE, state: s });
  }, []);

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
    addLeg,
    removeLeg,
    updateLeg,
    reorderLegs,
    setCommission,
    reset,
    hydrate,
    dispatch,
  };
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
        l.id === target.id ? { ...l, amount: formatNumber(inAmt * rate) } : l
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
        return { ...l, amount: formatNumber(newInAmt * r) };
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
