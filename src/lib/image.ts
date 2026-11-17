export type LoadedImage = {
  /** Correctly oriented source bitmap drawn onto a canvas. */
  canvas: HTMLCanvasElement
  /** JPEG data URL used for on-screen previews. */
  previewUrl: string
  width: number
  height: number
}

export type CropRect = { x: number; y: number; w: number; h: number }

/** Rotation (0/90/180/270) plus a crop rect in the rotated image's space. */
export type CropTransform = { rotation: number; crop: CropRect }

/** Default frame: the whole page with a small inset. */
export const DEFAULT_CROP: CropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }

/** Longest edge used when reading the photo, to keep memory and uploads sane. */
const DECODE_MAX_EDGE = 4096
/** Longest edge of the cropped image sent to Gemini. */
const UPLOAD_MAX_EDGE = 1600

export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image. Choose a JPG, PNG or HEIC photo.')
  }

  let bitmap: ImageBitmap
  try {
    // `from-image` bakes in EXIF rotation so the preview and the crop agree.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That image could not be read. Try a different photo.')
  }

  const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Your browser could not process this image.')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return {
    canvas,
    previewUrl: canvas.toDataURL('image/jpeg', 0.92),
    width,
    height,
  }
}

/** Crop a rotated image. `crop` is normalised in the rotated image's space. */
export function cropImage(
  source: HTMLCanvasElement,
  rotation: number,
  crop: CropRect,
  maxEdge = UPLOAD_MAX_EDGE,
): string {
  const w0 = source.width
  const h0 = source.height
  const rotated = ((rotation % 360) + 360) % 360
  const swap = rotated === 90 || rotated === 270
  const w1 = swap ? h0 : w0
  const h1 = swap ? w0 : h0

  const cx = Math.round(crop.x * w1)
  const cy = Math.round(crop.y * h1)
  const cw = Math.max(1, Math.round(crop.w * w1))
  const ch = Math.max(1, Math.round(crop.h * h1))

  const scale = Math.min(1, maxEdge / Math.max(cw, ch))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cw * scale))
  canvas.height = Math.max(1, Math.round(ch * scale))

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not process this crop.')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)

  if (rotated === 90) {
    ctx.translate(h0, 0)
    ctx.rotate(Math.PI / 2)
  } else if (rotated === 180) {
    ctx.translate(w0, h0)
    ctx.rotate(Math.PI)
  } else if (rotated === 270) {
    ctx.translate(0, w0)
    ctx.rotate(-Math.PI / 2)
  }

  ctx.drawImage(source, 0, 0)
  ctx.restore()

  return canvas.toDataURL('image/jpeg', 0.92)
}
