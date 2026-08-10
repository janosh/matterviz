import {
  resolve_plot_title,
  type DecorationSide,
  type FreeAnnotationDecorationItem,
  type PlotTitleLineKind,
} from '$lib/plot'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, expectTypeOf, test } from 'vitest'

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
    `./constants`,
    `./controls`,
    `./file-viewer/host-protocol`,
    `./file-viewer/host-transfer`,
    `./file-viewer/parse-in-worker`,
    `./isosurface/parse-vaspwave`,
    `./optimade`,
    `./sanitize`,
    `./settings`,
    `./structure/export`,
    `./structure/measure`,
    `./theme/embedded`,
    `./trajectory/parse`,
    `./url-params`,
  ])(`publishes dedicated subpath %s`, (subpath) => {
    expect(pkg.exports[subpath]).toBeDefined()
  })

  test(`plot publishes a curated core surface, never all of plot/core`, () => {
    // A blanket re-export would make tick math, layout solvers, pan/zoom internals and
    // decoration plumbing public API. Only the prop-facing types and standalone components
    // named in plot/index.ts are published.
    const source = readFileSync(join(lib_dir, `plot/index.ts`), `utf8`)
    // Whole-core and single-module wildcards both leak, declarations added later included.
    // Only chart prop types and plot titles are sanctioned; adding a third needs a decision.
    const wildcard = /export (?:type )?\*(?: as \w+)? from ['"](?<mod>\.\/core[\w/-]*)['"]/g
    const core_wildcards = [...source.matchAll(wildcard)].map((match) => match.groups?.mod)
    expect(core_wildcards).toEqual([`./core/types`, `./core/plot-title`])
    expect(existsSync(join(lib_dir, `plot/core/index.ts`))).toBe(false)
    // and no subpath may reach plot/core the other way round
    expect(Object.keys(pkg.exports).filter((sub) => sub.startsWith(`./plot`))).toEqual([
      `./plot`,
    ])
  })

  test(`plot keeps selected title and decoration compatibility exports`, () => {
    expectTypeOf<DecorationSide>().toEqualTypeOf<`top` | `right` | `bottom` | `left`>()
    expectTypeOf<FreeAnnotationDecorationItem[`kind`]>().toEqualTypeOf<`free-annotation`>()
    expectTypeOf<PlotTitleLineKind>().toEqualTypeOf<`title` | `subtitle`>()
    expect(resolve_plot_title({ text: `Title` }, { width: 100 }).lines[0]?.kind).toBe(`title`)
  })

  test(`worker-backed parser ships its sibling worker entry`, () => {
    expect(existsSync(join(repo_root, `dist/file-viewer/parse-worker.js`))).toBe(true)
  })

  test(
    `built structure and element entry points retain strict public exports`,
    { timeout: 15_000 },
    async () => {
      const structure_export = await import(`../../dist/structure/serialize.js`)
      expect(pkg.exports[`./structure/export`]).toEqual({
        types: `./dist/structure/serialize.d.ts`,
        default: `./dist/structure/serialize.js`,
      })
      expect(Object.keys(structure_export).toSorted()).toEqual(
        [
          `create_structure_filename`,
          `export_structure_as`,
          `STRUCT_TEXT_FORMATS`,
          `structure_to_cif_str`,
          `structure_to_json_str`,
          `structure_to_poscar_str`,
          `structure_to_xyz_str`,
        ].toSorted(),
      )

      const element_data = await import(`../../dist/element/data.js`)
      const expected_group_keys = [
        `all`,
        `alkali`,
        `alkaline_earth`,
        `transition`,
        `post_transition`,
        `metalloid`,
        `nonmetal`,
        `halogen`,
        `noble_gas`,
        `lanthanide`,
        `actinide`,
      ]
      expect(element_data.element_group_keys).toEqual(new Set(expected_group_keys))
      expect(element_data.element_groups.map((group) => group.value)).toEqual(
        expected_group_keys,
      )
    },
  )

  test(`symmetry builds retain default and overridable WASM resolution`, () => {
    const source = readFileSync(join(repo_root, `dist/symmetry/index.js`), `utf8`)
    expect(source).toContain(`init(wasm_url ? { module_or_path: wasm_url } : undefined)`)
    expect(source).not.toContain(`moyo_wasm_bg.wasm`)
    const widget_config = readFileSync(
      `${repo_root}/extensions/anywidget/vite.config.ts`,
      `utf8`,
    )
    expect(widget_config).toContain(`globalThis.matterviz_moyo_wasm_url ??`)
    expect(widget_config).toContain(`code.replace(moyo_glue_url, moyo_wasm_source)`)
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
