/**
 * Per-model time budgets.
 *
 * Quality-tier models (gemini-3.8-flash and friends) have been stalling on
 * image input, so they get a short leash and the chain moves on quickly instead
 * of downgrading accuracy permanently. Lite-tier models are the ones that
 * actually answer, and they sometimes need 20s+ for a dense page, so they get
 * the full window — even when one is pinned as GEMINI_MODEL and therefore runs
 * first.
 */

export const QUALITY_ATTEMPT_TIMEOUT_MS = 12_000
export const LITE_ATTEMPT_TIMEOUT_MS = 25_000

const LITE_TIER = /flash[-_]?lite|lite[-_]?latest/i

export function isLiteTier(model) {
  return LITE_TIER.test(model)
}

/** The attempt's timeout, capped by whatever is left of the overall budget. */
export function attemptTimeoutFor(model, remainingMs) {
  const ceiling = isLiteTier(model) ? LITE_ATTEMPT_TIMEOUT_MS : QUALITY_ATTEMPT_TIMEOUT_MS
  return Math.min(ceiling, Math.max(0, remainingMs))
}
