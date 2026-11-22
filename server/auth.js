import crypto from 'node:crypto'

/**
 * Single-operator session auth.
 *
 * There is one shared passphrase (AUTH_PASSPHRASE). Posting it to
 * /api/auth/login mints a signed, HttpOnly, SameSite=Strict cookie; every other
 * /api route requires a valid cookie. Nothing derived from the passphrase is
 * stored on the client beyond that HMAC-signed expiry stamp.
 */

export const SESSION_COOKIE = 'scriptsnap_session'
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const MIN_SECRET_LENGTH = 32

function b64url(buffer) {
  return buffer.toString('base64url')
}

/** Hashing first makes timingSafeEqual length-safe for arbitrary inputs. */
function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest()
}

export function passphraseMatches(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string' || expected.length === 0) {
    return false
  }
  return crypto.timingSafeEqual(digest(input), digest(expected))
}

/**
 * A dedicated secret is preferred; without one, derive a stable secret from the
 * passphrase with a domain separator so tokens cannot be forged from the
 * passphrase alone without knowing it (which the client never has).
 */
export function deriveSessionSecret(passphrase, explicitSecret) {
  if (typeof explicitSecret === 'string' && explicitSecret.length >= MIN_SECRET_LENGTH) {
    return explicitSecret
  }
  return crypto.createHmac('sha256', passphrase).update('scriptsnap/session/v1').digest('hex')
}

export function signSession({ secret, ttlMs = DEFAULT_SESSION_TTL_MS, now = Date.now() }) {
  const expiresAt = now + ttlMs
  const body = b64url(Buffer.from(JSON.stringify({ exp: expiresAt }), 'utf8'))
  const signature = b64url(crypto.createHmac('sha256', secret).update(body).digest())
  return { token: `${body}.${signature}`, expiresAt: new Date(expiresAt) }
}

export function verifySession(token, { secret, now = Date.now() }) {
  if (typeof token !== 'string' || !secret) return false

  const dot = token.indexOf('.')
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return false

  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!body || !signature) return false

  const expected = crypto.createHmac('sha256', secret).update(body).digest()
  let provided
  try {
    provided = Buffer.from(signature, 'base64url')
  } catch {
    return false
  }
  if (provided.length !== expected.length) return false
  if (!crypto.timingSafeEqual(provided, expected)) return false

  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return false
  }

  return typeof payload?.exp === 'number' && payload.exp > now
}

export function readCookie(header, name) {
  if (typeof header !== 'string' || !header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export function serializeSessionCookie(name, value, { maxAgeSeconds, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}
