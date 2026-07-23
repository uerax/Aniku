/**
 * Bundle @aniku/server (+ workspace shared) to a single Node ESM file.
 * Dev still uses tsx; production / Docker use `node dist/index.js`.
 *
 * Run from apps/server via: pnpm --filter @aniku/server build
 * (esbuild is a server package devDependency)
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const serverRoot = path.join(root, 'apps/server')

// Resolve esbuild from apps/server/node_modules (pnpm workspace layout)
const require = createRequire(path.join(serverRoot, 'package.json'))
const esbuild = require('esbuild')

await esbuild.build({
  entryPoints: [path.join(serverRoot, 'src/index.ts')],
  outfile: path.join(serverRoot, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'bundle',
  minify: true,
  legalComments: 'none',
  // CJS deps (cheerio etc.) call require("buffer"/…) at runtime. ESM output has no
  // require unless we inject createRequire; without this Node throws:
  //   Dynamic require of "buffer" is not supported
  banner: {
    js: "import { createRequire as __anikuCreateRequire } from 'node:module';const require = __anikuCreateRequire(import.meta.url);",
  },
  alias: {
    '@aniku/shared': path.join(root, 'packages/shared/src/index.ts'),
  },
  logLevel: 'info',
  sourcemap: true,
})

console.log('server bundle → apps/server/dist/index.js')
