import { config } from '../config'

const DEFAULT_TIMEOUT_MS = 15_000

function withTimeoutSignal(
  init: RequestInit,
  timeoutMs: number,
): { signal: AbortSignal; clear: () => void } {
  if (init.signal) {
    // Caller owns abort — still bound wall time with a linked timeout when possible
    const ac = new AbortController()
    const onAbort = () => {
      try {
        ac.abort(init.signal?.reason)
      } catch {
        ac.abort()
      }
    }
    if (init.signal.aborted) onAbort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      try {
        ac.abort(
          new DOMException(`请求超时 (${Math.round(timeoutMs / 1000)}s)`, 'TimeoutError'),
        )
      } catch {
        ac.abort()
      }
    }, timeoutMs)
    timer.unref?.()
    return {
      signal: ac.signal,
      clear: () => {
        clearTimeout(timer)
        init.signal?.removeEventListener('abort', onAbort)
      },
    }
  }
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      clear: () => {},
    }
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  timer.unref?.()
  return { signal: ac.signal, clear: () => clearTimeout(timer) }
}

export async function bangumiFetch(
  url: string,
  init: RequestInit & { token?: string; timeoutMs?: number } = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', config.bangumiUserAgent)
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  if (init.token) {
    headers.set('Authorization', `Bearer ${init.token}`)
  }
  const { token: _t, timeoutMs, ...rest } = init
  const ms = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const { signal, clear } = withTimeoutSignal(rest, ms)
  try {
    return await fetch(url, { ...rest, headers, signal })
  } finally {
    clear()
  }
}

export function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}
