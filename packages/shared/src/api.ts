export interface ApiErrorBody {
  error: string
  message?: string
  details?: unknown
}

export interface Paginated<T> {
  data: T[]
  total?: number
  limit?: number
  offset?: number
}
