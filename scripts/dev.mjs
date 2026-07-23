/**
 * Reliable local dev: start API first, wait until /api/health responds, then Vite.
 * Avoids `pnpm -r --parallel` races on Windows where tsx watch may sit without binding
 * while the browser hits Vite → endless ECONNREFUSED on /api.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

if (!existsSync(resolve(root, 'pnpm-workspace.yaml'))) {
  console.error(
    '[dev] Run from monorepo root (where pnpm-workspace.yaml lives).\n' +
      `  Expected: ${root}`,
  )
  process.exit(1)
}

function readEnvPortSync() {
  const fromProcess = process.env.PORT
  if (fromProcess && Number(fromProcess) > 0) return Number(fromProcess)
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*PORT\s*=\s*(\d+)/)
      if (m) return Number(m[1])
    }
  } catch {
    /* no .env */
  }
  return 8787
}

const apiPort = readEnvPortSync()
const children = []
let shuttingDown = false

function spawnPkg(filter, script = 'dev') {
  const child = spawn(
    isWin ? 'pnpm.cmd' : 'pnpm',
    ['--filter', filter, script],
    {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      shell: isWin,
    },
  )
  children.push(child)
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error(
      `[dev] ${filter} exited code=${code} signal=${signal ?? ''} — stopping others`,
    )
    shutdown(code ?? 1)
  })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    try {
      if (!c.killed) {
        if (isWin) c.kill()
        else c.kill('SIGTERM')
      }
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), isWin ? 400 : 100).unref?.()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function waitForHealth(port, timeoutMs = 30_000) {
  const url = `http://127.0.0.1:${port}/api/health`
  const start = Date.now()
  let lastErr = ''
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return
      lastErr = `HTTP ${r.status}`
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(
    `API did not become ready at ${url} within ${timeoutMs}ms (${lastErr})`,
  )
}

console.log(`[dev] monorepo root: ${root}`)
console.log(`[dev] starting @aniku/server (expect :${apiPort})…`)
spawnPkg('@aniku/server')

try {
  await waitForHealth(apiPort)
  console.log(`[dev] API healthy on :${apiPort}`)
} catch (e) {
  console.error(`[dev] ${e instanceof Error ? e.message : e}`)
  console.error(
    '[dev] Tip: free the port, or run `pnpm --filter @aniku/server dev` alone to see errors.',
  )
  shutdown(1)
  process.exit(1)
}

console.log('[dev] starting @aniku/web (Vite)…')
spawnPkg('@aniku/web')
