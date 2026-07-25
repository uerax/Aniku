export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (init.token) {
    headers.set('Authorization', `Bearer ${init.token}`)
  }
  const { token: _t, ...rest } = init
  // `signal` from React Query / caller is preserved via rest — abort on navigate.
  const res = await fetch(path, { ...rest, headers })
  // If aborted mid-body, text() throws — surface as ApiError-friendly abort
  let text: string
  try {
    text = await res.text()
  } catch (e) {
    if (rest.signal?.aborted) {
      throw new ApiError(0, '请求已取消')
    }
    throw e
  }
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'message' in data
        ? String((data as { message: string }).message)
        : null) || res.statusText || '请求失败'
    throw new ApiError(res.status, msg, data)
  }
  return data as T
}
