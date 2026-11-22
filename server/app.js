import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SESSION_COOKIE,
  deriveSessionSecret,
  passphraseMatches,
  readCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
} from './auth.js'
import { DEFAULT_FALLBACK_MODELS, DEFAULT_PRIMARY_MODEL, ExtractionFailure, extractText, resolveModels } from './extract.js'
import { LITE_ATTEMPT_TIMEOUT_MS, QUALITY_ATTEMPT_TIMEOUT_MS } from './models.js'
import {
  ValidationError,
  decodeImageDataUrl,
  extractSchema,
  loginSchema,
  parseOrThrow,
} from './validation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/** API paths that do not require a session. */
const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/session', '/health'])

/** Any credential-shaped string that must never reach a log line. */
const SECRET_PATTERN = /(AIza[0-9A-Za-z_-]{20,}|x-goog-api-key[=:\s]+\S+)/gi

function safeLog(logger, level, message) {
  const fn = logger?.[level] ?? logger?.log
  if (typeof fn === 'function') fn.call(logger, String(message).replace(SECRET_PATTERN, '[redacted]'))
}

function parseOrigins(raw) {
  return String(raw ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

function requestHost(origin) {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

export const DEFAULT_LIMITS = {
  windowMs: 10 * 60_000,
  global: 200,
  unauthenticated: 60,
  login: 5,
  extract: 10,
  extractDailyWindowMs: 24 * 60 * 60_000,
  extractDaily: 80,
}

function limiter({ windowMs, limit, message, options = {} }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    ...options,
  })
}

/**
 * Builds the Express app. Kept separate from `index.js` so tests can exercise
 * auth, rate limiting and validation without a real Gemini key or network.
 */
export function createApp({
  apiKey = process.env.GEMINI_API_KEY,
  passphrase = process.env.AUTH_PASSPHRASE,
  sessionSecret: explicitSecret = process.env.AUTH_SESSION_SECRET,
  allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS),
  models = resolveModels(process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS),
  staticDir = path.join(ROOT, 'dist'),
  isProduction = process.env.NODE_ENV === 'production',
  sessionTtlMs = 7 * 24 * 60 * 60 * 1000,
  limits = {},
  logger = console,
  fetchImpl = fetch,
} = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits }
  const secret = passphrase ? deriveSessionSecret(passphrase, explicitSecret) : null
  const authConfigured = Boolean(passphrase && secret)

  const app = express()

  app.disable('x-powered-by')
  // One proxy hop in front of the app (a PaaS/router terminating TLS).
  app.set('trust proxy', 1)

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          // React sets inline `style` attributes on the crop overlay, so style
          // attributes must be allowed; no remote stylesheets are.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  )

  // --- HTTPS in production ---------------------------------------------------
  app.use((req, res, next) => {
    if (!isProduction) return next()
    const proto = req.headers['x-forwarded-proto']
    const secure = req.secure || proto === 'https'
    if (secure) return next()
    res.redirect(308, `https://${req.headers.host}${req.originalUrl}`)
  })

  // --- CORS: only the operator's own frontend origin -------------------------
  app.use((req, res, next) => {
    const origin = req.headers.origin
    res.setHeader('Vary', 'Origin')

    if (origin) {
      const ok = allowedOrigins.length
        ? allowedOrigins.includes(origin.replace(/\/+$/, ''))
        : Boolean(req.headers.host) && requestHost(origin) === req.headers.host

      if (!ok) {
        res.status(403).json({ error: 'This origin is not allowed to use the API.' })
        return
      }

      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Max-Age', '600')
      res.status(204).end()
      return
    }

    next()
  })

  // --- Body parsing ----------------------------------------------------------
  // 8 MB is just above the largest data URL that validation accepts, so honest
  // payloads fit and everything else is rejected before touching Gemini.
  app.use(express.json({ limit: '8mb', strict: true }))

  // --- API response hygiene --------------------------------------------------
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex')
    next()
  })

  const globalLimiter = limiter({
    windowMs: config.windowMs,
    limit: config.global,
    message: 'Too many requests. Wait a minute and try again.',
  })
  const unauthLimiter = limiter({
    windowMs: config.windowMs,
    limit: config.unauthenticated,
    message: 'Too many failed attempts. Wait a while and try again.',
    options: { skipSuccessfulRequests: true },
  })
  const loginLimiter = limiter({
    windowMs: config.windowMs,
    limit: config.login,
    message: 'Too many sign-in attempts. Wait a few minutes and try again.',
  })
  const extractLimiter = limiter({
    windowMs: config.windowMs,
    limit: config.extract,
    message: 'That is a lot of scans at once. Wait a few minutes and try again.',
  })
  const extractDailyLimiter = limiter({
    windowMs: config.extractDailyWindowMs,
    limit: config.extractDaily,
    message: 'The daily scan limit has been reached. Try again tomorrow.',
  })

  app.use('/api', globalLimiter)
  app.use('/api', unauthLimiter)

  // --- Session guard ---------------------------------------------------------
  app.use('/api', (req, res, next) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next()

    if (!authConfigured) {
      res.status(503).json({
        error:
          'This server has no AUTH_PASSPHRASE set, so it refuses every request. Set AUTH_PASSPHRASE on the host and restart.',
      })
      return
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE)
    if (verifySession(token, { secret })) return next()

    res.status(401).json({ error: 'Sign in to use ScriptSnap.' })
  })

  // --- Routes ----------------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/auth/session', (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE)
    const authenticated = authConfigured && verifySession(token, { secret })
    res.json({ authenticated, authConfigured })
  })

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    if (!authConfigured) {
      res.status(503).json({
        error: 'This server has no AUTH_PASSPHRASE set. Add it on the host and restart.',
      })
      return
    }

    let body
    try {
      body = parseOrThrow(loginSchema, req.body)
    } catch (error) {
      res.status(400).json({ error: error instanceof ValidationError ? error.message : 'That request was not valid.' })
      return
    }

    if (!passphraseMatches(body.passphrase, passphrase)) {
      // Deliberately identical to a malformed request's timing class: no hints.
      res.status(401).json({ error: 'That passphrase is not correct.' })
      return
    }

    const { token, expiresAt } = signSession({ secret, ttlMs: sessionTtlMs })
    res.setHeader(
      'Set-Cookie',
      serializeSessionCookie(SESSION_COOKIE, token, {
        maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
        secure: isProduction,
      }),
    )
    res.json({ authenticated: true, expiresAt: expiresAt.toISOString() })
  })

  app.post('/api/extract', extractLimiter, extractDailyLimiter, async (req, res) => {
    try {
      const body = parseOrThrow(extractSchema, req.body)
      const image = decodeImageDataUrl(body.image)

      if (!apiKey) {
        res.status(503).json({
          error: 'The server has no Gemini API key configured. Set GEMINI_API_KEY on the host.',
        })
        return
      }

      const result = await extractText({
        apiKey,
        image,
        models,
        fetchImpl,
        logger: { warn: (message) => safeLog(logger, 'warn', message) },
      })

      safeLog(
        logger,
        'log',
        `Extracted ${result.text.length} chars via ${result.model} in ${result.ms}ms (${image.bytes} bytes)`,
      )
      res.json({ text: result.text, model: result.model, ms: result.ms })
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(error.status).json({ error: error.message })
        return
      }
      if (error instanceof ExtractionFailure) {
        // Statuses only: upstream messages can echo request internals.
        safeLog(logger, 'warn', `Extraction failed: status ${error.status}`)
        res.status(error.status).json({ error: error.message })
        return
      }
      safeLog(logger, 'error', `Extraction failed: ${error?.name ?? 'Error'}: ${error?.message ?? ''}`)
      res.status(500).json({ error: 'Something went wrong on the server. Please try again.' })
    }
  })

  // Unknown API routes are JSON 404s, never the SPA shell.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' })
  })

  // --- Built frontend, same origin as the API --------------------------------
  if (fs.existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        index: false,
        etag: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache')
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          }
        },
      }),
    )

    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  // --- Errors: logged server-side, generic to the client ---------------------
  app.use((error, _req, res, _next) => {
    const status = Number(error?.status) || Number(error?.statusCode) || 500

    if (status === 413) {
      res.status(413).json({ error: 'That upload is too large. Crop the image and try again.' })
      return
    }
    if (status === 400) {
      res.status(400).json({ error: 'Send a JSON body.' })
      return
    }

    safeLog(logger, 'error', `Unhandled error: ${error?.name ?? 'Error'}: ${error?.message ?? ''}`)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Something went wrong on the server. Please try again.' })
    }
  })

  return app
}

export const SERVER_METADATA = {
  primaryModel: DEFAULT_PRIMARY_MODEL,
  fallbackModels: DEFAULT_FALLBACK_MODELS,
  qualityTimeoutMs: QUALITY_ATTEMPT_TIMEOUT_MS,
  liteTimeoutMs: LITE_ATTEMPT_TIMEOUT_MS,
}
