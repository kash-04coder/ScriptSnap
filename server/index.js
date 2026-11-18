import 'dotenv/config'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LITE_ATTEMPT_TIMEOUT_MS,
  QUALITY_ATTEMPT_TIMEOUT_MS,
  attemptTimeoutFor,
} from './models.js'
import { stripConversationalFiller } from './text.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT) || 8787

/**
 * Quality first: the strongest handwriting model is attempted first but with a
 * short leash, so a temporary outage costs a few seconds instead of the whole
 * request, and the app falls back to the lite tier that currently answers fast.
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite,gemini-3.5-flash,gemini-3.1-flash-lite'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)

const MODELS = [...new Set([PRIMARY_MODEL, ...FALLBACK_MODELS])]
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
  const startedAt = Date.now()
  const deadline = startedAt + TOTAL_BUDGET_MS

  let response = null
  let payload = null
  let usedModel = MODELS[0]
  let failure = null

  for (const model of MODELS) {
    const remaining = deadline - Date.now()
    if (remaining <= 1000) break

    usedModel = model
    const attemptTimeout = attemptTimeoutFor(model, remaining)

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
            contents: [
              {
                role: 'user',
                parts: [{ text: USER_INSTRUCTION }, { inlineData: { mimeType, data } }],
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
      console.warn(
        `Gemini ${model} ${timedOut ? 'timed out' : 'was unreachable'} after ${attemptTimeout}ms; trying the next model.`,
      )
      continue
    }

    payload = await response.json().catch(() => null)
    if (response.ok) break

    failure = { status: response.status, message: payload?.error?.message }
    if (!RETRYABLE_STATUS.has(response.status)) break

    console.warn(`Gemini ${model} returned ${response.status}; trying the next model.`)
  }

  if (!response || !response.ok) {
    const status = response?.status ?? failure?.status ?? null

    if (status === 404) {
      res.status(502).json({
        error: `The Gemini model "${usedModel}" is not available for this key. Set GEMINI_MODEL to a supported model.`,
      })
      return
    }

    if (status === 429) {
      res.status(429).json({
        error: 'Too many requests right now. Wait a few seconds and try again.',
      })
      return
    }

    if (status === 503) {
      res.status(503).json({
        error: 'The extraction service is busy right now. Please try again in a moment.',
      })
      return
    }

    if (!response || failure?.timedOut) {
      res.status(504).json({
        error: 'The extraction service did not respond in time. Please try again in a moment.',
      })
      return
    }

    res.status(502).json({
      error: `Extraction failed: ${failure?.message || `Extraction service returned ${status}.`}`,
    })
    return
  }

  const text = stripConversationalFiller(
    (payload?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join(''),
  )

  if (!text) {
    const blocked = payload?.promptFeedback?.blockReason
    res.status(422).json({
      error: blocked
        ? 'That image was blocked by the safety filter. Try a different photo of your notes.'
        : 'No handwriting could be read in that image. Try a sharper crop with better lighting and the page filling the frame.',
    })
    return
  }

  console.log(
    `Extracted ${text.length} chars via ${usedModel} in ${Date.now() - startedAt}ms (${data.length} b64 chars)`,
  )
  res.json({ text, model: usedModel, ms: Date.now() - startedAt })
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
  console.log(
    `Timeouts: quality models ${QUALITY_ATTEMPT_TIMEOUT_MS}ms, lite models ${LITE_ATTEMPT_TIMEOUT_MS}ms`,
  )
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is not set — /api/extract will return 503.')
  }
})
