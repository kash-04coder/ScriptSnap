import { useState } from 'react'
import type { ReactNode } from 'react'
import { noteLanguageTag } from '../lib/language'
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  GalleryIcon,
  PlusIcon,
  ScanIcon,
} from './Icons'

type Props = {
  text: string
  onChange: (value: string) => void
  originalUrl: string | null
  onCopy: () => void
  onDownload: () => void
  onNewScan: () => void
}

function ActionButton({
  label,
  icon,
  onClick,
  primary = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? 'flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-2 text-[11px] font-semibold leading-none text-white transition active:scale-[0.98]'
          : 'flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2 text-[11px] font-semibold leading-none text-zinc-800 transition active:scale-[0.98]'
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

export default function EditorScreen({
  text,
  onChange,
  originalUrl,
  onCopy,
  onDownload,
  onNewScan,
}: Props) {
  const [showOriginal, setShowOriginal] = useState(false)
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const noteLang = noteLanguageTag(text)

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="flex items-center justify-between px-5 pb-3 pt-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-900 text-white">
            <ScanIcon className="h-4 w-4" />
          </span>
          <h1 className="text-[16px] font-semibold tracking-tight">Your text</h1>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          Extracted
        </span>
      </header>

      <section className="border-y border-zinc-200">
        <button
          type="button"
          onClick={() => setShowOriginal((current) => !current)}
          aria-expanded={showOriginal}
          aria-controls="original-image"
          className="flex min-h-[52px] w-full items-center justify-between px-5 text-[13px] font-semibold text-zinc-700"
        >
          <span className="flex items-center gap-2">
            <GalleryIcon className="h-4 w-4" />
            View Original Image
          </span>
          <ChevronDownIcon
            className={`h-4 w-4 text-zinc-400 transition-transform ${showOriginal ? 'rotate-180' : ''}`}
          />
        </button>
        {showOriginal && (
          <div id="original-image" className="px-5 pb-4">
            {originalUrl ? (
              <img
                src={originalUrl}
                alt="Original photo of your handwritten notes"
                className="max-h-80 w-full rounded-xl border border-zinc-200 bg-zinc-50 object-contain"
              />
            ) : (
              <p className="rounded-xl bg-zinc-50 p-4 text-[13px] text-zinc-500">
                The original photo is no longer available.
              </p>
            )}
          </div>
        )}
      </section>

      <main className="flex flex-1 flex-col px-4 pb-4 pt-4">
        <label htmlFor="extracted-text" className="sr-only">
          Extracted text — edit as needed
        </label>
        <textarea
          id="extracted-text"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          spellCheck
          lang={noteLang || undefined}
          placeholder="Your extracted text will appear here…"
          className="min-h-[46vh] w-full flex-1 resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-[15px] leading-8 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus-visible:ring-1 focus-visible:ring-zinc-300 focus-visible:ring-offset-0"
        />
        <p className="mt-2 px-1 text-[11px] tabular-nums text-zinc-400">
          {words} {words === 1 ? 'word' : 'words'} · tap the text to edit
        </p>
      </main>

      <div className="safe-bottom sticky bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-3 pt-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-2 pb-1">
          <ActionButton
            label="Copy Text"
            onClick={onCopy}
            primary
            icon={<CopyIcon className="h-5 w-5" />}
          />
          <ActionButton
            label="Download .TXT"
            onClick={onDownload}
            icon={<DownloadIcon className="h-5 w-5" />}
          />
          <ActionButton
            label="New Scan"
            onClick={onNewScan}
            icon={<PlusIcon className="h-5 w-5" />}
          />
        </div>
      </div>
    </div>
  )
}
