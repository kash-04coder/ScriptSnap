import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { createApp } from '../server/app.js'
import {
  SESSION_COOKIE,
  deriveSessionSecret,
  passphraseMatches,
  signSession,
  verifySession,
} from '../server/auth.js'
import { decodeImageDataUrl, MAX_IMAGE_BYTES } from '../server/validation.js'

const PASSPHRASE = 'correct horse battery staple'
const silentLogger = { log() {}, warn() {}, error() {} }

/** A 1x1 JPEG data URL; valid shape and MIME, tiny payload. */
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

async function startApp(overrides = {}) {
  const app = createApp({
    apiKey: 'test-key',
    passphrase: PASSPHRASE,
    models: ['gemini-3.8-flash'],
    logger: silentLogger,
    isProduction: false,
    fetchImpl: async () => {
      throw new Error('network disabled in tests')
    },
    ...overrides,
  })

  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function post(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function signIn(base) {
  const response = await post(base, '/api/auth/login', { passphrase: PASSPHRASE })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie, 'login must set a cookie')
  return cookie.split(';')[0]
}

// --- auth tokens ----------------------------------------------------------

test('a signed session verifies and an expired one does not', () => {
  const secret = deriveSessionSecret(PASSPHRASE)
  const { token } = signSession({ secret, ttlMs: 60_000, now: 1_000_000 })
  assert.equal(verifySession(token, { secret, now: 1_030_000 }), true)
  assert.equal(verifySession(token, { secret, now: 1_070_000 }), false)
})

test('a tampered or foreign-signed session is rejected', () => {
  const secret = deriveSessionSecret(PASSPHRASE)
  const other = deriveSessionSecret('a different passphrase')
  const { token } = signSession({ secret, ttlMs: 60_000 })

  assert.equal(verifySession(token, { secret: other }), false)
  assert.equal(verifySession(`x${token}`, { secret }), false)
  assert.equal(verifySession(token.replace(/.$/, 'A'), { secret }), false)
  assert.equal(verifySession('', { secret }), false)
  assert.equal(verifySession('not-a-token', { secret }), false)
})

test('passphrase comparison rejects near misses and empty input', () => {
  assert.equal(passphraseMatches(PASSPHRASE, PASSPHRASE), true)
  assert.equal(passphraseMatches(`${PASSPHRASE} `, PASSPHRASE), false)
  assert.equal(passphraseMatches('', PASSPHRASE), false)
  assert.equal(passphraseMatches(PASSPHRASE, ''), false)
})

// --- unauthenticated access ----------------------------------------------

test('unauthenticated API requests are rejected', async () => {
  const app = await startApp()
  try {
    const extract = await post(app.base, '/api/extract', { image: TINY_JPEG })
    assert.equal(extract.status, 401)
    assert.deepEqual(await extract.json(), { error: 'Sign in to use ScriptSnap.' })

    const unknown = await fetch(`${app.base}/api/anything`)
    assert.equal(unknown.status, 401)

    const session = await fetch(`${app.base}/api/auth/session`)
    assert.equal(session.status, 200)
    assert.equal((await session.json()).authenticated, false)
  } finally {
    await app.close()
  }
})

test('a valid session unlocks the API', async () => {
  const app = await startApp()
  try {
    const cookie = await signIn(app.base)

    const session = await fetch(`${app.base}/api/auth/session`, { headers: { cookie } })
    assert.equal((await session.json()).authenticated, true)

    // Reaches validation (400), which proves auth passed.
    const extract = await post(app.base, '/api/extract', { nope: true }, { cookie })
    assert.equal(extract.status, 400)
  } finally {
    await app.close()
  }
})

test('a wrong passphrase is rejected and sets no cookie', async () => {
  const app = await startApp()
  try {
    const response = await post(app.base, '/api/auth/login', { passphrase: 'wrong' })
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('set-cookie'), null)
  } finally {
    await app.close()
  }
})

test('a forged session cookie is rejected', async () => {
  const app = await startApp()
  try {
    const forged = signSession({ secret: deriveSessionSecret('guessed') }).token
    const response = await post(
      app.base,
      '/api/extract',
      { image: TINY_JPEG },
      { cookie: `${SESSION_COOKIE}=${forged}` },
    )
    assert.equal(response.status, 401)
  } finally {
    await app.close()
  }
})

test('with no passphrase configured, protected routes fail closed', async () => {
  const app = await startApp({ passphrase: undefined })
  try {
    const extract = await post(app.base, '/api/extract', { image: TINY_JPEG })
    assert.equal(extract.status, 503)
    const login = await post(app.base, '/api/auth/login', { passphrase: 'anything' })
    assert.equal(login.status, 503)
  } finally {
    await app.close()
  }
})

// --- rate limiting --------------------------------------------------------

test('sign-in attempts are rate limited', async () => {
  const app = await startApp({ limits: { login: 2 } })
  try {
    assert.equal((await post(app.base, '/api/auth/login', { passphrase: 'nope' })).status, 401)
    assert.equal((await post(app.base, '/api/auth/login', { passphrase: 'nope' })).status, 401)
    const limited = await post(app.base, '/api/auth/login', { passphrase: 'nope' })
    assert.equal(limited.status, 429)
    assert.match((await limited.json()).error, /Too many/)
  } finally {
    await app.close()
  }
})

test('extraction is rate limited per window', async () => {
  const app = await startApp({ limits: { extract: 2 } })
  try {
    const cookie = await signIn(app.base)
    for (let i = 0; i < 2; i += 1) {
      const response = await post(app.base, '/api/extract', { image: TINY_JPEG }, { cookie })
      // Upstream is disabled in tests, so this is the generic 5xx, not a 429.
      assert.notEqual(response.status, 429)
    }
    const limited = await post(app.base, '/api/extract', { image: TINY_JPEG }, { cookie })
    assert.equal(limited.status, 429)
  } finally {
    await app.close()
  }
})

test('every API request counts toward the global limiter', async () => {
  const app = await startApp({ limits: { global: 3 } })
  try {
    await fetch(`${app.base}/api/health`)
    await fetch(`${app.base}/api/health`)
    await fetch(`${app.base}/api/health`)
    const limited = await fetch(`${app.base}/api/health`)
    assert.equal(limited.status, 429)
  } finally {
    await app.close()
  }
})

// --- input validation -----------------------------------------------------

test('rejects unknown fields, missing images and wrong types', async () => {
  const app = await startApp()
  try {
    const cookie = await signIn(app.base)

    const cases = [
      {},
      { image: TINY_JPEG, extra: 'x' },
      { image: 42 },
      { image: '' },
      { image: 'not a data url' },
      { image: 'data:text/plain;base64,aGVsbG8=' },
      { image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { image: `data:image/jpeg;base64,${'A'.repeat(4)}!!!!` },
    ]

    for (const body of cases) {
      const response = await post(app.base, '/api/extract', body, { cookie })
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 60)}`)
      const payload = await response.json()
      assert.equal(typeof payload.error, 'string')
      assert.ok(!('stack' in payload))
    }
  } finally {
    await app.close()
  }
})

test('accepts only allowlisted image MIME types', () => {
  assert.deepEqual(decodeImageDataUrl(TINY_JPEG).mimeType, 'image/jpeg')
  assert.equal(decodeImageDataUrl('data:image/png;base64,aGVsbG8=').mimeType, 'image/png')
  assert.throws(() => decodeImageDataUrl('data:image/gif;base64,aGVsbG8='), /Unsupported image type/)
})

test('rejects oversized payloads and malformed base64', () => {
  const oversized = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`
  assert.throws(() => decodeImageDataUrl(oversized), /too large/)

  assert.throws(() => decodeImageDataUrl('data:image/jpeg;base64,abc'), /malformed/)
  assert.throws(() => decodeImageDataUrl('data:image/jpeg;base64,'), /base64 data URL/)
  assert.throws(() => decodeImageDataUrl('data:image/jpeg;base64,aGVsbG8'), /malformed/)
})

test('a wrong body type is a clean 400, not a crash', async () => {
  const app = await startApp()
  try {
    const cookie = await signIn(app.base)
    const response = await fetch(`${app.base}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: '{"image":',
    })
    assert.equal(response.status, 400)
    const text = await response.text()
    assert.ok(!/SyntaxError|at JSON\.parse/.test(text))
  } finally {
    await app.close()
  }
})

test('login validates its body too', async () => {
  const app = await startApp()
  try {
    const response = await post(app.base, '/api/auth/login', { passphrase: '', extra: 1 })
    assert.equal(response.status, 400)
  } finally {
    await app.close()
  }
})

// --- error handling and headers ------------------------------------------

test('internal errors are logged but never leaked to the client', async () => {
  const messages = []
  const app = await startApp({
    logger: { log() {}, warn: (m) => messages.push(String(m)), error: (m) => messages.push(String(m)) },
    fetchImpl: async () => {
      throw new Error('upstream exploded: secret detail')
    },
  })
  try {
    const cookie = await signIn(app.base)
    const response = await post(app.base, '/api/extract', { image: TINY_JPEG }, { cookie })
    const body = await response.text()

    assert.ok(response.status >= 500)
    assert.ok(!body.includes('upstream exploded'))
    assert.ok(!body.includes('at '))
    assert.ok(!('stack' in JSON.parse(body)))
    assert.ok(messages.some((m) => m.includes('Extraction failed')))
    assert.ok(messages.every((m) => !m.includes('upstream exploded')))
  } finally {
    await app.close()
  }
})

test('the API key never appears in logs', async () => {
  const messages = []
  const app = await startApp({
    apiKey: 'AIzaSyTESTKEY0123456789abcdefghijklmno',
    logger: { log: (m) => messages.push(String(m)), warn: (m) => messages.push(String(m)), error: (m) => messages.push(String(m)) },
    fetchImpl: async () => {
      throw new Error('boom AIzaSyTESTKEY0123456789abcdefghijklmno')
    },
  })
  try {
    const cookie = await signIn(app.base)
    await post(app.base, '/api/extract', { image: TINY_JPEG }, { cookie })
    assert.ok(messages.length > 0)
    assert.ok(messages.every((m) => !m.includes('AIzaSy')))
  } finally {
    await app.close()
  }
})

test('security headers and no x-powered-by on responses', async () => {
  const app = await startApp()
  try {
    const response = await fetch(`${app.base}/api/health`)
    const csp = response.headers.get('content-security-policy') ?? ''

    assert.equal(response.headers.get('x-powered-by'), null)
    assert.match(csp, /default-src 'self'/)
    assert.match(csp, /object-src 'none'/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally {
    await app.close()
  }
})

test('foreign origins are refused and the app origin is allowed', async () => {
  const app = await startApp({ allowedOrigins: ['https://notes.example.com'] })
  try {
    const foreign = await fetch(`${app.base}/api/health`, {
      headers: { Origin: 'https://evil.example.net' },
    })
    assert.equal(foreign.status, 403)

    const allowed = await fetch(`${app.base}/api/health`, {
      headers: { Origin: 'https://notes.example.com' },
    })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://notes.example.com')
  } finally {
    await app.close()
  }
})
