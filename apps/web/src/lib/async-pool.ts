/**
 * Run async work over items with a fixed concurrency cap.
 * Preserves result order (index-aligned with `items`).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length
  if (n === 0) return []
  const limit = Math.max(1, Math.min(concurrency, n))
  const results = new Array<R>(n)
  let next = 0

  async function worker() {
    for (;;) {
      const i = next++
      if (i >= n) return
      results[i] = await fn(items[i]!, i)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
