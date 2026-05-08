// src/lib/dealForm/submitFlow.js
// Pure handleSubmit flow для DealForm — извлечён ради testability.
// Принимает все dependencies как параметры.

import { mapErrorToToast } from "./errorMapper.js";

/**
 * Submit flow:
 *   buildPayload() → createDeal(payload) → onSuccess(result)
 *   На любую ошибку → mapErrorToToast → onError(toast)
 *
 * @param {Object} args
 * @param {Function} args.buildPayload   — () → payload (может бросить validation error)
 * @param {Function} args.createDeal     — async payload → result
 * @param {Function} args.t              — translation
 * @param {Function} args.onSuccess      — (result) => void
 * @param {Function} args.onError        — (toastPayload) => void
 * @returns {Promise<{ok, result?, toast?}>}
 */
export async function runSubmitFlow({
  buildPayload,
  createDeal,
  t,
  onSuccess,
  onError,
}) {
  let payload;
  try {
    payload = buildPayload();
  } catch (buildErr) {
    const toast = mapErrorToToast(
      { code: "22000", message: buildErr.message },
      t
    );
    onError?.(toast);
    return { ok: false, toast };
  }

  try {
    const result = await createDeal(payload);
    onSuccess?.(result);
    return { ok: true, result };
  } catch (error) {
    const toast = mapErrorToToast(error, t);
    onError?.(toast);
    return { ok: false, toast };
  }
}
