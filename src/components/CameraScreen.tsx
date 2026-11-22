import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertIcon, GalleryIcon, XIcon } from './Icons'

type Props = {
  onCapture: (file: File) => void
  onClose: () => void
  onUseFilePicker: () => void
}

/**
 * `capture="environment"` on a file input is ignored by desktop browsers, which
 * just show a file dialog. A live stream is the only way to actually open the
 * device camera, and it needs a secure context (https, or localhost).
 */
export function cameraIsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    window.isSecureContext
  )
}

function describeCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera for this site in your browser, then try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Choose a photo instead.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your camera is already in use by another app. Close it and try again.'
    default:
      return 'The camera could not be started. Choose a photo instead.'
  }
}

export default function CameraScreen({ onCapture, onClose, onUseFilePicker }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<'starting' | 'live' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      if (!cameraIsSupported()) {
        setStatus('error')
        setError(
          'This browser cannot open the camera directly. Choose a photo instead — or open ScriptSnap over https.',
        )
        return
      }

      try {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 2560 },
              height: { ideal: 1440 },
            },
            audio: false,
          })
        } catch (error) {
          // A device without a rear camera still has a usable one.
          if (error instanceof DOMException && error.name === 'OverconstrainedError') {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          } else {
            throw error
          }
        }

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        const active = stream.getVideoTracks()[0]
        active?.addEventListener('ended', () => stopStream())

        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => undefined)
        }
        setStatus('live')
      } catch (startError) {
        if (cancelled) return
        setStatus('error')
        setError(describeCameraError(startError))
      }
    }

    void start()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [stopStream])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const takeShot = () => {
    const video = videoRef.current
    if (!video || status !== 'live') return

    const { videoWidth: width, videoHeight: height } = video
    if (!width || !height) {
      setError('The camera is still warming up. Try again in a moment.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('Your browser could not capture the photo.')
      return
    }
    ctx.drawImage(video, 0, 0, width, height)

    setFlash(true)
    window.setTimeout(() => setFlash(false), 180)

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Your browser could not capture the photo.')
          return
        }
        stopStream()
        onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-zinc-950 text-white">
      <div className="flex items-center justify-between px-2 py-2">
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-[14px] font-medium text-white/80"
          aria-label="Close camera"
        >
          <XIcon className="h-5 w-5" />
          Close
        </button>
        <p className="text-[13px] font-semibold tracking-tight">Take Photo</p>
        <span className="w-[74px]" aria-hidden="true" />
      </div>

      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="h-full w-full object-contain"
          aria-label="Camera preview"
        />

        {status === 'starting' && (
          <div className="absolute inset-0 grid place-items-center" role="status">
            <div className="flex flex-col items-center gap-3">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
              <p className="text-[13px] text-white/70">Starting camera…</p>
            </div>
          </div>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}

        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center px-6">
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-4">
              <div className="flex items-start gap-3">
                <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <p className="text-[14px] leading-relaxed text-white/90" role="alert">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="safe-bottom border-t border-white/10 px-4 pb-1 pt-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onUseFilePicker}
            className="flex min-h-[44px] items-center gap-2 rounded-xl px-2 text-[13px] font-medium text-white/75"
          >
            <GalleryIcon className="h-[18px] w-[18px]" />
            Choose a photo
          </button>

          <button
            type="button"
            onClick={takeShot}
            disabled={status !== 'live'}
            aria-label="Take photo"
            className="grid h-[68px] w-[68px] place-items-center rounded-full border-4 border-white/85 transition active:scale-95 disabled:opacity-40"
          >
            <span className="block h-[52px] w-[52px] rounded-full bg-white" />
          </button>

          <span className="w-[104px]" aria-hidden="true" />
        </div>
        <p className="pb-1 pt-2 text-center text-[11px] text-white/50">
          Fill the frame with the page, then tap the shutter.
        </p>
      </div>
    </div>
  )
}
