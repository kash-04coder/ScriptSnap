export class ExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/** Give up slightly after the server's own 60s chain budget. */
const CLIENT_TIMEOUT_MS = 75_000

/**
 * API service layer for handwriting extraction.
 *
 * The browser only ever talks to our own endpoint; the Gemini key stays on the
 * server (`server/index.js`), which forwards the image to Gemini and walks a
 * fallback list of models when one is overloaded.
 */
export async function extractTextFromImage(image: string): Promise<string> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      signal: controller.signal,
    })
  } catch {
    throw new ExtractionError(
      controller.signal.aborted
        ? 'The extraction took too long and was stopped. Please try again.'
        : 'Could not reach the server. Check your connection and try again.',
    )
  } finally {
    window.clearTimeout(timer)
  }

  let payload: { text?: string; error?: string } | null = null
  try {
    payload = (await response.json()) as { text?: string; error?: string }
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new ExtractionError(
      payload?.error || `Extraction failed (${response.status}). Please try again.`,
    )
  }

  if (!payload?.text) {
    throw new ExtractionError(
      'No handwriting could be read in that image. Try a sharper crop with better lighting.',
    )
  }

  return payload.text
}
