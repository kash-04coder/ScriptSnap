// Vercel build step for the Express preset.
//
// Vercel only serves static files from `public/**` when the app is an Express
// server (`express.static()` is ignored on Vercel), while Vite writes its build
// to `dist/`. So: build with Vite exactly as usual, then publish `dist/` as
// `public/`.
//
// The previous copy is deleted *before* the build, because Vite copies
// `public/**` into `dist/` — leaving it in place would push stale hashed assets
// (and a stale index.html) into the new build.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const distDir = path.join(root, 'dist')

rmSync(publicDir, { recursive: true, force: true })

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true })
if (build.status !== 0) {
  console.error('[vercel-build] `npm run build` failed')
  process.exit(build.status ?? 1)
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('[vercel-build] dist/index.html was not produced')
  process.exit(1)
}

cpSync(distDir, publicDir, { recursive: true })
console.log('[vercel-build] copied dist/ -> public/ for Vercel static serving')
