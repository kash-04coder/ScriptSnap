import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertIcon, ScanIcon } from './Icons'
import { login } from '../lib/auth'

export default function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !passphrase) return

    setBusy(true)
    setError(null)
    try {
      await login(passphrase)
      setPassphrase('')
      onSuccess()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Sign-in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 pb-10 pt-16">
      <div className="mx-auto w-full max-w-sm">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-zinc-900 text-white">
          <ScanIcon className="h-5 w-5" />
        </span>
        <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-tight">ScriptSnap</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
          Enter your passphrase to unlock the scanner.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-3">
          <label htmlFor="passphrase" className="block text-[13px] font-semibold text-zinc-700">
            Passphrase
          </label>
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={256}
            className="min-h-[52px] w-full rounded-2xl border border-zinc-300 bg-white px-4 text-[15px] text-zinc-900"
          />
          <button
            type="submit"
            disabled={busy || passphrase.length === 0}
            className="min-h-[52px] w-full rounded-2xl bg-zinc-900 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] leading-relaxed text-red-800"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
