/**
 * One-shot migrate localStorage keys after product rename (kazumi-web → aniku).
 * Call before creating each Zustand persist store.
 */
export function migrateLocalStorageKey(newKey: string, oldKeys: string[]) {
  try {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(newKey) != null) return
    for (const old of oldKeys) {
      const value = localStorage.getItem(old)
      if (value == null) continue
      localStorage.setItem(newKey, value)
      localStorage.removeItem(old)
      return
    }
  } catch {
    /* private mode / blocked storage */
  }
}
