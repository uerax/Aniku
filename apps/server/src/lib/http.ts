import { config } from '../config'

export async function bangumiFetch(
  url: string,
  init: RequestInit & { token?: string } = {},
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
  const { token: _t, ...rest } = init
  return fetch(url, { ...rest, headers })
}

export function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}
