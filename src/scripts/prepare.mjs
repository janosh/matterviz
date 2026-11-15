// Root `prepare` lifecycle hook (runs on every `pnpm install` of this package, including the
// install pnpm/npm perform inside a clone when a consumer depends on `github:janosh/matterviz#main`).
// `svelte-kit sync` always runs: tsconfig.json extends the file it generates. The svelte-package
// build only runs when dist/ is absent (gitignored, so always the case in a fresh git-dependency
// clone) and MATTERVIZ_SKIP_PREPARE is unset, so dev-checkout installs stay fast: CI sets the
// variable in .github/actions/setup and builds dist/ explicitly where a job needs it.
// `--dry-run` prints the commands that would run, one per line, without running them.
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, `../..`)
const dry_run = process.argv.includes(`--dry-run`)
const skip_build =
  Boolean(process.env.MATTERVIZ_SKIP_PREPARE) || existsSync(resolve(root, `dist/index.js`))

// Mirrors the `package:dist` script, which stays the explicit rebuild entry point
const package_dist = [
  `svelte-package`,
  `node src/scripts/package-dist-assets.mjs`,
  `vp build --config src/elements/vite.config.ts`,
  `node src/scripts/check-dist-imports.mjs`,
]
const commands = [`svelte-kit sync`, ...(skip_build ? [] : package_dist)]

// A linked consumer (matbench's site) imports dist/, not src/, so a dist/ older than the last
// source edit silently serves stale code there. Warn rather than rebuild: dev installs stay fast.
const dist_entry = resolve(root, `dist/index.js`)
const src_dir = resolve(root, `src/lib`)
if (existsSync(dist_entry) && existsSync(src_dir)) {
  const built = statSync(dist_entry).mtimeMs
  const stale = readdirSync(src_dir, { recursive: true, withFileTypes: true }).some(
    (entry) =>
      entry.isFile() && statSync(resolve(entry.parentPath, entry.name)).mtimeMs > built,
  )
  if (stale)
    console.warn(
      `dist/ is older than src/lib: run \`pnpm package:dist\` (or \`pnpm package:watch\`) before using it from a linked consumer`,
    )
}

for (const cmd of commands) {
  if (dry_run) console.log(cmd)
  else execSync(cmd, { cwd: root, stdio: `inherit` })
}
