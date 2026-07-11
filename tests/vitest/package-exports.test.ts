import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const repo_root = resolve(import.meta.dirname, `../..`)
const lib_dir = join(repo_root, `src/lib`)
const pkg = JSON.parse(readFileSync(join(repo_root, `package.json`), `utf8`)) as {
  exports: Record<string, string | Record<string, string>>
  sideEffects: string[]
}

// Extensions svelte-package compiles (.ts/.svelte -> .js/.svelte) or copies verbatim into ./dist
const source_extensions = [`.ts`, `.svelte`, `.js`, `.mjs`]

// Map a built ./dist/* target back to candidate source files in src/lib, preserving the path
// structure exactly: ./dist/foo.js must originate from src/lib/foo.ts, NOT src/lib/foo/index.ts.
// This way an export pointing at a flat file when the source is a directory (or vice versa) fails.
function source_candidates(dist_target: string): string[] {
  const rel = dist_target.replace(/^\.\/dist\//, ``).replace(/\.d\.ts$/, ``)
  if (/\.(?:css|json)$/.test(rel)) return [join(lib_dir, rel)] // assets copied verbatim
  const base = rel.replace(/\.(?:js|mjs|cjs)$/, ``)
  // Subpath-pattern export (e.g. plot/*/index): expand the single `*` segment against the
  // real subdirectories so the wildcard is validated to point at >= 1 source file.
  if (base.includes(`*`)) {
    const [prefix, suffix] = base.split(`*`)
    const parent = join(lib_dir, prefix)
    if (!existsSync(parent)) return []
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        source_extensions.map((ext) => join(lib_dir, `${prefix}${entry.name}${suffix}${ext}`)),
      )
  }
  return source_extensions.map((ext) => join(lib_dir, `${base}${ext}`))
}

// Flatten every path-valued target across all export conditions (types/svelte/default/...)
const export_targets = Object.entries(pkg.exports).flatMap(([subpath, value]) =>
  (typeof value === `string` ? [value] : Object.values(value)).map((target) => ({
    subpath,
    target,
  })),
)

// Public module directories = any src/lib subfolder with an index.ts entry point
const module_dirs = readdirSync(lib_dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(lib_dir, entry.name, `index.ts`)))
  .map((entry) => entry.name)

describe(`package.json exports`, () => {
  test(`reusable file-viewer barrel excludes the side-effectful webview bootstrap`, () => {
    const source = readFileSync(join(lib_dir, `file-viewer/index.ts`), `utf8`)
    expect(source).not.toMatch(/from\s+['"]\.\/main['"]/)
    expect(pkg.exports[`./file-viewer/webview`]).toBeDefined()
  })

  test.each([
    `./file-viewer/eligibility`,
    `./file-viewer/host-protocol`,
    `./file-viewer/host-transfer`,
    `./theme/embedded`,
  ])(`publishes dedicated subpath %s`, (subpath) => {
    expect(pkg.exports[subpath]).toBeDefined()
  })

  test(`embedded theme side effects stay isolated from the normal theme barrel`, () => {
    const source = readFileSync(join(lib_dir, `theme/index.ts`), `utf8`)
    expect(source).not.toContain(`./embedded`)
    expect(pkg.sideEffects).toEqual(
      expect.arrayContaining([`**/theme/embedded.*`, `**/theme/themes.*`]),
    )
  })

  test(`every export target points into ./dist`, () => {
    const stray = export_targets.filter(({ target }) => !target.startsWith(`./dist/`))
    expect(stray, `targets must be published from ./dist`).toEqual([])
  })

  // Nothing exported that doesn't exist: every target maps back to a real source file
  test.each(export_targets)(`"$subpath" -> $target has a source file`, ({ target }) => {
    const candidates = source_candidates(target)
    const found = candidates.some((path) => existsSync(path))
    const tried = candidates.map((path) => path.slice(repo_root.length + 1)).join(`, `)
    expect(found, `no source file for ${target} (tried ${tried})`).toBe(true)
  })

  // No folder missing: every src/lib/<dir>/index.ts module has a matching subpath export
  test.each(module_dirs)(`src/lib/%s/ is exposed via a subpath export`, (dir) => {
    expect(
      pkg.exports[`./${dir}`],
      `src/lib/${dir}/index.ts exists but "./${dir}" is missing from package.json exports`,
    ).toBeDefined()
  })
})
