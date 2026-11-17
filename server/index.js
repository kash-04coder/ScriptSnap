import 'dotenv/config'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT) || 8787

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)

/** Tried in order. A retired or overloaded model just moves on to the next. */
const MODELS = [...new Set([PRIMARY_MODEL, ...FALLBACK_MODELS])]
/** Upstream statuses worth retrying on the next model. */
const RETRYABLE_STATUS = new Set([404, 503])

const SYSTEM_INSTRUCTION =
  'Extract all handwritten text from this image with maximum accuracy. ' +
  'Correct obvious spelling mistakes based on surrounding context, and preserve the exact ' +
  'spatial placement, indentation, bullet points, and line breaks of the original document. ' +
  'Return only the extracted text without conversational filler.'

const app = express()
app.use(express.json({ limit: '25mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, models: MODELS, configured: Boolean(process.env.GEMINI_API_KEY) })
})

app.post('/api/extract', async (req, res) => {
  const image = typeof req.body?.image === 'string' ? req.body.image : ''
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(image)

  if (!match) {
    res.status(400).json({ error: 'Send the cropped image as a base64 data URL.' })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(503).json({
      error:
        'The server has no Gemini API key yet. Add GEMINI_API_KEY to your .env file and restart the server.',
    })
    return
  }

  const mimeType = match[1].toLowerCase()
  const data = match[2].replace(/\s/g, '')

  let response = null
  let payload = null
  let usedModel = MODELS[0]

  for (const model of MODELS) {
    usedModel = model
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data } }] }],
            generationConfig: { temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      )
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      res.status(504).json({
        error: timedOut
          ? 'The extraction took too long. Try a smaller crop or a better lit photo.'
          : 'Could not reach the extraction service. Check your internet connection and try again.',
      })
      return
    }

    payload = await response.json().catch(() => null)
    if (response.ok || !RETRYABLE_STATUS.has(response.status)) break

    console.warn(`Gemini model ${model} unavailable (${response.status}); trying the next model.`)
  }

  if (!response || !response.ok) {
    const status = response ? response.status : 502

    if (status === 503) {
      res.status(503).json({
        error: 'Every extraction model is busy right now. Wait a moment and try again.',
      })
      return
    }

    if (status === 404) {
      res.status(502).json({
        error: `The Gemini model "${usedModel}" is not available for this key. Set GEMINI_MODEL to a supported model.`,
      })
      return
    }

    const rateLimited = status === 429
    res.status(status === 400 ? 400 : rateLimited ? 429 : 502).json({
      error: rateLimited
        ? 'Too many requests right now. Wait a few seconds and try again.'
        : `Extraction failed: ${
            (payload && payload.error && payload.error.message) ||
            `Extraction service returned ${status}.`
          }`,
    })
    return
  }

  const text = (payload?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim()

  if (!text) {
    const blocked = payload?.promptFeedback?.blockReason
    res.status(422).json({
      error: blocked
        ? 'That image was blocked by the safety filter. Try a different photo of your notes.'
        : 'No handwriting could be read in that image. Try a sharper crop with better lighting and the page filling the frame.',
    })
    return
  }

  res.json({ text, model: usedModel })
})

// Serve the built app when running in production.
const dist = path.join(ROOT, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`ScriptSnap API on http://localhost:${PORT}`)
  console.log(`Models in order: ${MODELS.join(' → ')}`)
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not set — /api/extract will return 503.')
  }
})
