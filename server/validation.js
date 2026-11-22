import { z } from 'zod'

/** Public-facing validation failure; the message is safe to return to a client. */
export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'ValidationError'
    this.status = status
  }
}

/**
 * The browser crops to 1600px and re-encodes as JPEG, so a legitimate payload is
 * ~200-600 KB. 6 MB decoded leaves generous headroom while bounding what one
 * request can make us forward to Gemini.
 */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_DATA_URL_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128

/** Formats the browser can produce and Gemini accepts. */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

/** Rejects unknown keys so nothing unexpected is silently accepted. */
export const extractSchema = z
  .object({
    image: z
      .string()
      .min(1, 'Send the cropped image as a base64 data URL.')
      .max(MAX_DATA_URL_CHARS, 'That image is too large. Crop it and try again.'),
  })
  .strict()

export const loginSchema = z
  .object({
    passphrase: z
      .string()
      .min(1, 'Enter your passphrase.')
      .max(256, 'That passphrase is too long.'),
  })
  .strict()

/**
 * Turns the validated string into `{ mimeType, data, bytes }`, enforcing the MIME
 * allowlist, base64 shape and decoded size. Throws ValidationError on failure.
 */
export function decodeImageDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value)
  if (!match) {
    throw new ValidationError(
      'Send the cropped image as a base64 data URL, for example data:image/jpeg;base64,...',
    )
  }

  const mimeType = match[1].toLowerCase()
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new ValidationError('Unsupported image type. Use a JPG, PNG, WebP or HEIC photo.')
  }

  const data = match[2].replace(/\s/g, '')
  if (data.length === 0 || data.length % 4 !== 0) {
    throw new ValidationError('That image data is malformed. Take the photo again.')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new ValidationError('That image data is malformed. Take the photo again.')
  }

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const bytes = (data.length / 4) * 3 - padding
  if (bytes === 0) {
    throw new ValidationError('That image is empty. Take the photo again.')
  }
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ValidationError('That image is too large. Crop it and try again.', 413)
  }

  return { mimeType, data, bytes }
}

/** Runs a schema and turns the first issue into a safe 400. */
export function parseOrThrow(schema, body) {
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ValidationError(issue?.message || 'That request was not valid.')
  }
  return result.data
}
