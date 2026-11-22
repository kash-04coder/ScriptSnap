import { useCallback, useEffect, useRef, useState } from 'react'
import CaptureScreen from './components/CaptureScreen'
import CropScreen from './components/CropScreen'
import EditorScreen from './components/EditorScreen'
import LoginScreen from './components/LoginScreen'
import ProcessingScreen from './components/ProcessingScreen'
import { AlertIcon, CheckIcon } from './components/Icons'
import { AuthRequiredError, checkSession } from './lib/auth'
import { copyToClipboard, downloadTextFile } from './lib/export'
import { extractTextFromImage } from './lib/gemini'
import { DEFAULT_CROP, loadImageFile } from './lib/image'
import type { CropTransform, LoadedImage } from './lib/image'

type Screen = 'capture' | 'crop' | 'processing' | 'editor' | 'error'
type AuthState = 'checking' | 'required' | 'ready'

function ErrorScreen({
  message,
  onRetry,
  onAdjust,
  onHome,
}: {
  message: string
  onRetry: () => void
  onAdjust: () => void
  onHome: () => void
}) {
  return (
    <div className="flex min-h-dvh flex-col px-5 pb-10 pt-16">
      <div className="mx-auto w-full max-w-md">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600">
          <AlertIcon className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-tight">
          We couldn&rsquo;t read that page
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">{message}</p>

        <div className="mt-7 space-y-3">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[52px] w-full rounded-2xl bg-zinc-900 text-[15px] font-semibold text-white transition active:scale-[0.99]"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={onAdjust}
            className="min-h-[52px] w-full rounded-2xl border border-zinc-300 bg-white text-[15px] font-semibold text-zinc-900 transition active:scale-[0.99]"
          >
            Adjust Crop
          </button>
          <button
            type="button"
            onClick={onHome}
            className="mx-auto flex min-h-[44px] w-full items-center justify-center rounded-xl text-[13px] font-medium text-zinc-500"
          >
            Start a new scan
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [screen, setScreen] = useState<Screen>('capture')
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [transform, setTransform] = useState<CropTransform>({
    rotation: 0,
    crop: DEFAULT_CROP,
  })
  const [cropped, setCropped] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void checkSession().then((ok) => {
      if (!cancelled) setAuth(ok ? 'ready' : 'required')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  const handleTransformChange = useCallback((next: CropTransform) => {
    setTransform(next)
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setLoadingFile(true)
    setCaptureError(null)
    try {
      const loaded = await loadImageFile(file)
      setImage(loaded)
      setTransform({ rotation: 0, crop: DEFAULT_CROP })
      setScreen('crop')
    } catch (error) {
      setCaptureError(
        error instanceof Error ? error.message : 'That image could not be opened.',
      )
    } finally {
      setLoadingFile(false)
    }
  }, [])

  const runExtraction = useCallback(async (dataUrl: string) => {
    setCropped(dataUrl)
    setExtractionError(null)
    setScreen('processing')
    try {
      const extracted = await extractTextFromImage(dataUrl)
      setText(extracted)
      setScreen('editor')
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuth('required')
        setScreen('capture')
        return
      }
      setExtractionError(
        error instanceof Error ? error.message : 'Something went wrong while reading your notes.',
      )
      setScreen('error')
    }
  }, [])

  const handleNewScan = () => {
    setText('')
    setImage(null)
    setTransform({ rotation: 0, crop: DEFAULT_CROP })
    setCropped(null)
    setExtractionError(null)
    setCaptureError(null)
    setScreen('capture')
  }

  const handleCopy = async () => {
    if (!text.trim()) {
      showToast('Nothing to copy yet')
      return
    }
    const ok = await copyToClipboard(text)
    showToast(ok ? 'Copied!' : 'Copy failed — select the text manually')
  }

  const handleDownload = () => {
    if (!text.trim()) {
      showToast('Nothing to download yet')
      return
    }
    const filename = downloadTextFile(text)
    showToast(`Saved ${filename}`)
  }

  if (auth === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center bg-white" role="status">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
      </div>
    )
  }

  if (auth === 'required') {
    return <LoginScreen onSuccess={() => setAuth('ready')} />
  }

  return (
    <div className="min-h-dvh bg-white">
      {screen === 'capture' && (
        <CaptureScreen onFile={handleFile} error={captureError} busy={loadingFile} />
      )}

      {screen === 'crop' && image && (
        <CropScreen
          image={image}
          transform={transform}
          onTransformChange={handleTransformChange}
          onCancel={() => setScreen('capture')}
          onExtract={(dataUrl) => void runExtraction(dataUrl)}
        />
      )}

      {screen === 'processing' && <ProcessingScreen thumbnail={cropped} />}

      {screen === 'editor' && (
        <EditorScreen
          text={text}
          onChange={setText}
          originalUrl={image?.previewUrl ?? null}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onNewScan={handleNewScan}
        />
      )}

      {screen === 'error' && (
        <ErrorScreen
          message={extractionError ?? 'The extraction failed. Please try again.'}
          onRetry={() => {
            if (cropped) void runExtraction(cropped)
            else setScreen('capture')
          }}
          onAdjust={() => setScreen(image ? 'crop' : 'capture')}
          onHome={handleNewScan}
        />
      )}

      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4"
      >
        {toast && (
          <div className="animate-toast-in flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg">
            <CheckIcon className="h-4 w-4" />
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
