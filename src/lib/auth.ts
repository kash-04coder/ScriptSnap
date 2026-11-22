/** Raised when the server says the session is missing or expired. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Your session has ended. Enter your passphrase to continue.')
    this.name = 'AuthRequiredError'
  }
}

export async function checkSession(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/session', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (!response.ok) return false
    const payload = (await response.json()) as { authenticated?: boolean }
    return payload.authenticated === true
  } catch {
    return false
  }
}

/** Throws with a message safe to show when the passphrase is rejected. */
export async function login(passphrase: string): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ passphrase }),
      credentials: 'same-origin',
    })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }

  if (response.ok) return

  let message = 'Sign-in failed. Please try again.'
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload?.error) message = payload.error
  } catch {
    // Keep the generic message.
  }
  throw new Error(message)
}
