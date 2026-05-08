// src/lib/dealForm/errorMapper.js
// Map PostgreSQL/Supabase error codes → friendly toast payload.
//
// Используется в этап 4 handleSubmit для перевода raw RPC errors в
// i18n-aware toast notifications.
//
// Известные коды (от ledger backend и common Postgres):
//   P0001 — RAISE EXCEPTION (insufficient balance, business rule)
//   P0002 — not found (account, currency, etc.)
//   P0422 — idempotency conflict (different request_hash for same key)
//   22000 — invalid_parameter_value (validation)
//   23502 — not_null_violation (dim_required)
//   42501 — insufficient_privilege (RLS)

/**
 * Извлекает PG ERRCODE из supabase error object.
 * Supabase JS client возвращает { code, message, details, hint }.
 * Если code отсутствует — пытаемся parse из message.
 */
export function extractErrCode(error) {
  if (!error) return null;
  if (typeof error.code === "string" && error.code.length > 0) return error.code;
  const msg = error.message || "";
  const m = msg.match(/^(P\d{4}|22\d{3}|23\d{3}|42\d{3})/);
  return m ? m[1] : null;
}

/**
 * Try to extract field name from validation error message.
 * RPC validation throws типа "IN leg X: amount must be > 0" или
 * "Account % not found". Без structured field — best-effort regex.
 */
export function extractFieldFromError(error) {
  if (!error || !error.message) return null;
  // "IN leg X: ..." или "OUT leg Y: ..."
  const legM = error.message.match(/(IN|OUT) leg (\S+):/);
  if (legM) return { side: legM[1].toLowerCase(), legId: legM[2] };
  // "Account % not found"
  const accM = error.message.match(/Account (\S+) not found/);
  if (accM) return { accountCode: accM[1] };
  return null;
}

/**
 * Map error → toast payload {severity, messageKey, detailsKey?, retry?, field?}.
 *
 * Используется как:
 *   const toast = mapErrorToToast(error, t);
 *   showToast({ ...toast, message: t(toast.messageKey, toast.values) });
 *
 * @param {Error|Object} error — Supabase error или Error
 * @param {Function} t — translation function (для message resolution)
 * @returns {Object} toast payload
 */
export function mapErrorToToast(error, t) {
  const code = extractErrCode(error);
  const rawMessage = error?.message || "";
  const detail = error?.details || error?.detail || "";
  const hint = error?.hint || "";

  switch (code) {
    case "P0001":
      return {
        severity: "error",
        message: t("error_insufficient_balance"),
        details: detail || rawMessage,
        code,
      };
    case "P0422":
      return {
        severity: "error",
        message: t("error_idempotency_conflict"),
        details: hint || rawMessage,
        retry: true,
        code,
      };
    case "P0002":
      return {
        severity: "error",
        message: t("error_not_found"),
        details: detail || rawMessage,
        code,
      };
    case "22000":
      return {
        severity: "error",
        message: t("error_validation"),
        details: rawMessage,
        field: extractFieldFromError(error),
        code,
      };
    case "23502":
      return {
        severity: "error",
        message: t("error_required_field"),
        details: rawMessage,
        field: extractFieldFromError(error),
        code,
      };
    case "42501":
      return {
        severity: "error",
        message: t("error_forbidden"),
        details: t("error_forbidden_hint"),
        code,
      };
    default:
      return {
        severity: "error",
        message: t("error_unknown"),
        details: rawMessage || detail || "Unknown error",
        code: code || null,
      };
  }
}
