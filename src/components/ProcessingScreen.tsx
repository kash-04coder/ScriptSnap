const SKELETON_LINES = [100, 92, 97, 78, 88, 95, 64, 100, 90, 72, 86, 58]

export default function ProcessingScreen({ thumbnail }: { thumbnail: string | null }) {
  return (
    <div className="flex min-h-dvh flex-col px-5 pb-10 pt-16">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900"
            aria-hidden="true"
          />
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight">Reading your handwriting…</h1>
            <p className="mt-1 text-[13px] text-zinc-500">
              Transcribing every line and keeping your layout. This usually takes a few seconds.
            </p>
          </div>
        </div>

        {thumbnail && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
            <img
              src={thumbnail}
              alt="The cropped notes being processed"
              className="max-h-52 w-full object-contain opacity-70"
            />
          </div>
        )}

        <div className="mt-6 space-y-3 rounded-2xl border border-zinc-200 p-5" aria-hidden="true">
          {SKELETON_LINES.map((width, index) => (
            <div
              key={index}
              className="relative h-3 overflow-hidden rounded-full bg-zinc-100"
              style={{ width: `${width}%` }}
            >
              <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/90 to-transparent" />
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-400">
          This can take up to 30 seconds when the service is busy.
        </p>
        <p className="sr-only" role="status" aria-live="polite">
          Extracting text from your notes
        </p>
      </div>
    </div>
  )
}
