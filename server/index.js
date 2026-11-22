import 'dotenv/config'

import { createApp } from './app.js'
import { resolveModels } from './extract.js'
import { LITE_ATTEMPT_TIMEOUT_MS, QUALITY_ATTEMPT_TIMEOUT_MS } from './models.js'

const PORT = Number(process.env.PORT) || 8787
const isProduction = process.env.NODE_ENV === 'production'
const models = resolveModels(process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS)

if (isProduction && !process.env.AUTH_PASSPHRASE) {
  console.error(
    'Refusing to start: AUTH_PASSPHRASE must be set in production, otherwise the API is open to anyone.',
  )
  process.exit(1)
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not set — /api/extract will answer 503.')
}

if (!process.env.AUTH_PASSPHRASE) {
  console.warn(
    'AUTH_PASSPHRASE is not set — every /api route except health and session will answer 503. Add it to .env to use the app.',
  )
}

const app = createApp({ isProduction })
const server = app.listen(PORT, () => {
  console.log(`ScriptSnap on http://localhost:${PORT} (${isProduction ? 'production' : 'development'})`)
  console.log(`Models in order: ${models.join(' → ')}`)
  console.log(
    `Timeouts: quality models ${QUALITY_ATTEMPT_TIMEOUT_MS}ms, lite models ${LITE_ATTEMPT_TIMEOUT_MS}ms`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
