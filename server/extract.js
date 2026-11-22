import { attemptTimeoutFor } from './models.js'
import { stripConversationalFiller } from './text.js'

export const DEFAULT_PRIMARY_MODEL = 'gemini-3.8-flash'
export const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
]

/** Statuses worth retrying on the next model. */
const RETRYABLE_STATUS = new Set([404, 503, 429])
/** Cap on the whole chain. */
const TOTAL_BUDGET_MS = 65_000

const SYSTEM_INSTRUCTION =
  'Extract all handwritten text from this image with maximum accuracy. ' +
  'Correct obvious spelling mistakes based on surrounding context, and preserve the exact ' +
  'spatial placement, indentation, bullet points, and line breaks of the original document. ' +
  'Return only the extracted text without conversational filler.'

/** Reinforces the system instruction on the user turn. */
const USER_INSTRUCTION = 'Return only the extracted text.'

/** A failure with a client-safe message and the HTTP status to answer with. */
export class ExtractionFailure extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ExtractionFailure'
    this.status = status
  }
}

export function resolveModels(primary, fallbacks) {
  const first = (typeof primary === 'string' && primary.trim()) || DEFAULT_PRIMARY_MODEL
  const rest = (
    typeof fallbacks === 'string' ? fallbacks.split(',') : fallbacks ?? DEFAULT_FALLBACK_MODELS
  )
    .map((model) => (typeof model === 'string' ? model.trim() : ''))
    .filter(Boolean)

  return [...new Set([first.trim(), ...rest])]
}

/**
 * Quality first: the strongest handwriting model is attempted first but with a
 * short leash, so a temporary outage costs a few seconds instead of the whole
 * request.
 *
 * Upstream error text is never propagated: it can echo request internals, so the
 * caller only ever receives a generic, actionable message.
 */
export async function extractText({
  apiKey,
  image,
  models,
  fetchImpl = fetch,
  logger = console,
}) {
  const startedAt = Date.now()
  const deadline = startedAt + TOTAL_BUDGET_MS

  let response = null
  let payload = null
  let usedModel = models[0]
  let failure = null

  for (const model of models) {
    const remaining = deadline - Date.now()
    if (remaining <= 1000) break

    usedModel = model
    const attemptTimeout = attemptTimeoutFor(model, remaining)

    try {
      response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents: [
              {
                role: 'user',
                parts: [{ text: USER_INSTRUCTION }, { inlineData: { mimeType: image.mimeType, data: image.data } }],
              },
            ],
            generationConfig: { temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(attemptTimeout),
        },
      )
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      failure = { timedOut }
      response = null
      logger.warn(
        `Gemini ${model} ${timedOut ? 'timed out' : 'was unreachable'} after ${attemptTimeout}ms; trying the next model.`,
      )
      continue
    }

    payload = await response.json().catch(() => null)
    if (response.ok) break

    failure = { status: response.status }
    if (!RETRYABLE_STATUS.has(response.status)) break

    logger.warn(`Gemini ${model} returned ${response.status}; trying the next model.`)
  }

  if (!response || !response.ok) {
    const status = response?.status ?? failure?.status ?? null

    if (status === 404) {
      throw new ExtractionFailure(
        502,
        'The configured Gemini model is not available for this key. Set GEMINI_MODEL to a supported model.',
      )
    }
    if (status === 429) {
      throw new ExtractionFailure(429, 'Too many requests right now. Wait a few seconds and try again.')
    }
    if (status === 503) {
      throw new ExtractionFailure(
        503,
        'The extraction service is busy right now. Please try again in a moment.',
      )
    }
    if (!response && !failure?.timedOut) {
      throw new ExtractionFailure(
        502,
        'The extraction service is unreachable right now. Please try again in a moment.',
      )
    }
    if (!response || failure?.timedOut) {
      throw new ExtractionFailure(
        504,
        'The extraction service did not respond in time. Please try again in a moment.',
      )
    }

    throw new ExtractionFailure(502, 'The extraction service could not read that image. Please try again.')
  }

  const text = stripConversationalFiller(
    (payload?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join(''),
  )

  if (!text) {
    const blocked = payload?.promptFeedback?.blockReason
    throw new ExtractionFailure(
      422,
      blocked
        ? 'That image was blocked by the safety filter. Try a different photo of your notes.'
        : 'No handwriting could be read in that image. Try a sharper crop with better lighting and the page filling the frame.',
    )
  }

  return { text, model: usedModel, ms: Date.now() - startedAt }
}
