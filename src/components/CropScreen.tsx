import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { cropImage, DEFAULT_CROP } from '../lib/image'
import type { CropRect, CropTransform, LoadedImage } from '../lib/image'
import { AlertIcon, RotateLeftIcon, RotateRightIcon, SparkIcon, XIcon } from './Icons'

type Props = {
  image: LoadedImage
  /** Owned by the parent so the framing survives trips to other screens. */
  transform: CropTransform
  onTransformChange: (next: CropTransform) => void
  onCancel: () => void
  onExtract: (dataUrl: string) => void
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const MIN_SIZE = 0.08

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function resizeCrop(mode: DragMode, start: CropRect, dx: number, dy: number): CropRect {
  if (mode === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    }
  }

  let { x, y, w, h } = start

  if (mode === 'nw' || mode === 'sw') {
    const nextX = clamp(start.x + dx, 0, start.x + start.w - MIN_SIZE)
    w = start.x + start.w - nextX
    x = nextX
  }
  if (mode === 'ne' || mode === 'se') {
    w = clamp(start.w + dx, MIN_SIZE, 1 - start.x)
  }
  if (mode === 'nw' || mode === 'ne') {
    const nextY = clamp(start.y + dy, 0, start.y + start.h - MIN_SIZE)
    h = start.y + start.h - nextY
    y = nextY
  }
  if (mode === 'sw' || mode === 'se') {
    h = clamp(start.h + dy, MIN_SIZE, 1 - start.y)
  }

  return { x, y, w, h }
}

function RoundButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-700 transition active:scale-95"
    >
      {children}
    </button>
  )
}

export default function CropScreen({
  image,
  transform,
  onTransformChange,
  onCancel,
  onExtract,
}: Props) {
  const { rotation, crop } = transform
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [exportError, setExportError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    startY: number
    rect: CropRect
  } | null>(null)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setBox({ w: rect.width, h: rect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const swapped = rotation % 180 !== 0
  const rotatedWidth = swapped ? image.height : image.width
  const rotatedHeight = swapped ? image.width : image.height
  const scale =
    box.w > 0 && box.h > 0 ? Math.min(box.w / rotatedWidth, box.h / rotatedHeight) : 0
  const imgW = rotatedWidth * scale
  const imgH = rotatedHeight * scale
  const offsetX = (box.w - imgW) / 2
  const offsetY = (box.h - imgH) / 2

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !imgW || !imgH) return
      const dx = (event.clientX - drag.startX) / imgW
      const dy = (event.clientY - drag.startY) / imgH
      onTransformChange({
        rotation,
        crop: resizeCrop(drag.mode, drag.rect, dx, dy),
      })
    }
    const end = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [imgW, imgH, rotation, onTransformChange])

  const startDrag = (mode: DragMode) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect: crop }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const rotate = (delta: number) => {
    onTransformChange({
      rotation: (((rotation + delta) % 360) + 360) % 360,
      // A crop framed for the old orientation no longer lines up.
      crop: DEFAULT_CROP,
    })
  }

  const handleExtract = () => {
    if (working) return
    setWorking(true)
    setExportError(null)
    // Give the button its pressed state before the canvas work runs.
    requestAnimationFrame(() => {
      try {
        onExtract(cropImage(image.canvas, rotation, crop))
      } catch (error) {
        setExportError(error instanceof Error ? error.message : 'That crop could not be exported.')
      } finally {
        setWorking(false)
      }
    })
  }

  const handles: { mode: DragMode; position: string }[] = [
    { mode: 'nw', position: '-left-5 -top-5 cursor-nwse-resize items-start justify-start' },
    { mode: 'ne', position: '-right-5 -top-5 cursor-nesw-resize items-start justify-end' },
    { mode: 'sw', position: '-bottom-5 -left-5 cursor-nesw-resize items-end justify-start' },
    { mode: 'se', position: '-bottom-5 -right-5 cursor-nwse-resize items-end justify-end' },
  ]

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-[14px] font-medium text-zinc-600"
        >
          <XIcon className="h-5 w-5" />
          Cancel
        </button>
        <h1 className="text-[14px] font-semibold tracking-tight">Adjust crop</h1>
        <span className="w-[82px]" aria-hidden="true" />
      </header>

      <div ref={containerRef} className="relative min-h-0 flex-1 touch-none bg-zinc-900">
        {scale > 0 && (
          <>
            <img
              src={image.previewUrl}
              alt="Your handwritten notes"
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: image.width * scale,
                height: image.height * scale,
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }}
            />
            <div
              className="absolute touch-none"
              style={{
                left: offsetX + crop.x * imgW,
                top: offsetY + crop.y * imgH,
                width: crop.w * imgW,
                height: crop.h * imgH,
              }}
              onPointerDown={startDrag('move')}
            >
              <div
                className="absolute inset-0 border-2 border-white"
                style={{ boxShadow: '0 0 0 9999px rgba(9, 9, 11, 0.55)' }}
              />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
              </div>
              {handles.map(({ mode, position }) => (
                <div
                  key={mode}
                  role="presentation"
                  onPointerDown={startDrag(mode)}
                  className={`absolute flex h-11 w-11 touch-none ${position}`}
                >
                  <span className="block h-4 w-4 rounded-full border-2 border-zinc-900 bg-white shadow" />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-1.5">
        <div className="flex gap-2">
          <RoundButton label="Rotate left" onClick={() => rotate(-90)}>
            <RotateLeftIcon />
          </RoundButton>
          <RoundButton label="Rotate right" onClick={() => rotate(90)}>
            <RotateRightIcon />
          </RoundButton>
        </div>
        <button
          type="button"
          onClick={() => onTransformChange({ rotation, crop: DEFAULT_CROP })}
          className="min-h-[44px] rounded-xl px-3 text-[13px] font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4"
        >
          Reset
        </button>
        <p className="pr-1 text-[11px] tabular-nums text-zinc-500">
          {Math.round(crop.w * rotatedWidth)} × {Math.round(crop.h * rotatedHeight)} px
        </p>
      </div>

      <div className="safe-bottom border-t border-zinc-200 bg-white px-4 pt-3">
        {exportError && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] leading-relaxed text-red-800"
          >
            <AlertIcon className="mt-px h-4 w-4 shrink-0" />
            <p>{exportError}</p>
          </div>
        )}
        <p className="mb-3 text-center text-[12px] text-zinc-500">
          Drag the corners to frame only your handwriting.
        </p>
        <div className="flex gap-3 pb-1">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[52px] flex-1 rounded-2xl border border-zinc-300 bg-white text-[15px] font-semibold text-zinc-900 transition active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExtract}
            disabled={working}
            className="flex min-h-[52px] flex-[1.5] items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            <SparkIcon />
            {working ? 'Preparing…' : 'Extract Text'}
          </button>
        </div>
      </div>
    </div>
  )
}
