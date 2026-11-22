import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import CameraScreen, { cameraIsSupported } from './CameraScreen'
import { AlertIcon, CameraIcon, GalleryIcon, ScanIcon } from './Icons'

type Props = {
  onFile: (file: File) => void
  error: string | null
  busy: boolean
}

export default function CaptureScreen({ onFile, error, busy }: Props) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  // A live stream is the only way to open the camera; desktop browsers ignore
  // `capture` and would just show a file dialog. Where a stream is impossible
  // (http on a LAN address) the capture input still works on mobile.
  const openCamera = () => {
    if (cameraIsSupported()) setCameraOpen(true)
    else cameraInput.current?.click()
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onFile(file)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2.5 px-5 pt-7">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-900 text-white">
          <ScanIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[17px] font-semibold leading-none tracking-tight">ScriptSnap</p>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Handwriting to text
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-10">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tight text-zinc-900">
          Turn handwritten notes into clean, editable text.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
          Photograph a page or pick one from your gallery. ScriptSnap keeps your indentation,
          bullets and line breaks intact.
        </p>

        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={openCamera}
            disabled={busy}
            className="flex min-h-[60px] w-full items-center justify-center gap-3 rounded-2xl bg-zinc-900 px-5 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60"
          >
            <CameraIcon className="h-5 w-5" />
            Take Photo
          </button>
          <button
            type="button"
            onClick={() => galleryInput.current?.click()}
            disabled={busy}
            className="flex min-h-[60px] w-full items-center justify-center gap-3 rounded-2xl border border-zinc-300 bg-white px-5 text-[15px] font-semibold text-zinc-900 transition active:scale-[0.99] disabled:opacity-60"
          >
            <GalleryIcon className="h-5 w-5" />
            Upload from Gallery
          </button>
          <p className="pt-1 text-center text-[12px] text-zinc-500" role="status">
            {busy ? 'Opening your photo…' : 'JPG, PNG or HEIC · one page at a time'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] leading-relaxed text-red-800"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <section className="mt-9 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <h2 className="text-[13px] font-semibold text-zinc-900">For the sharpest result</h2>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-zinc-600">
            <li>· Lay the page flat in even, bright light.</li>
            <li>· Fill the frame with the handwriting.</li>
            <li>· Crop away the desk, edges and shadows.</li>
          </ul>
        </section>

        <p className="mt-auto pt-8 text-center text-[11px] leading-relaxed text-zinc-400">
          Photos are sent to Google Gemini only to extract your text. Nothing is stored on our
          servers.
        </p>
      </main>

      {cameraOpen && (
        <CameraScreen
          onCapture={(file) => {
            setCameraOpen(false)
            onFile(file)
          }}
          onClose={() => setCameraOpen(false)}
          onUseFilePicker={() => {
            setCameraOpen(false)
            cameraInput.current?.click()
          }}
        />
      )}

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
        aria-label="Take a photo of your notes"
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
        aria-label="Upload a photo from your gallery"
      />
    </div>
  )
}
