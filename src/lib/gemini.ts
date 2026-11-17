export class ExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionError'
  }
}

/**
 * API service layer for handwriting extraction.
 *
 * The browser only ever talks to our own endpoint; the Gemini key stays on the
 * server (`server/index.js`), which forwards the image to `gemini-2.5-flash`.
 */
export async function extractTextFromImage(image: string): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    })
  } catch {
    throw new ExtractionError('Could not reach the server. Check your connection and try again.')
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
