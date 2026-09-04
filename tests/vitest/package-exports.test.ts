import * as lib from '$lib'
import type {
  VacfInput,
  VacfOptions,
  VacfResult,
  WorkerClient,
  WorkerRequestOptions,
} from '$lib'
import type {
  DecorationSide,
  FreeAnnotationDecorationItem,
  PlotTitleLineKind,
} from '$lib/plot'
import { resolve_plot_title } from '$lib/plot'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, expectTypeOf, test } from 'vitest'
import svelte_config from '../../svelte.config'

const repo_root = resolve(import.meta.dirname, `../..`)
const lib_dir = join(repo_root, `src/lib`)
const dist_dir = join(repo_root, `dist`)
// `prepare` skips the svelte-package build whenever dist/ already exists (and always under
// MATTERVIZ_SKIP_PREPARE, which CI sets), so dist/ is an explicit build step there. Locally the
// built-output checks skip; CI builds dist first, so a missing dist there means the checks
// would silently stop running
const has_dist = existsSync(join(dist_dir, `index.js`))
if (!has_dist) {
  if (process.env.CI)
    throw new Error(`dist/ missing — run pnpm package:dist before the unit tests`)
  console.warn(`dist/ not built: skipping built-output checks (run \`pnpm package:dist\`)`)
}
const pkg = JSON.parse(readFileSync(join(repo_root, `package.json`), `utf8`)) as {
  exports: Record<string, string | Record<string, string>>
  sideEffects: string[]
  scripts: Record<string, string>
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

  test(`plot keeps its selected public title and decoration exports`, () => {
    expectTypeOf<DecorationSide>().toEqualTypeOf<`top` | `right` | `bottom` | `left`>()
    expectTypeOf<FreeAnnotationDecorationItem[`kind`]>().toEqualTypeOf<`free-annotation`>()
    expectTypeOf<PlotTitleLineKind>().toEqualTypeOf<`title` | `subtitle`>()
    expect(resolve_plot_title({ text: `Title` }, { width: 100 }).title?.kind).toBe(`title`)
  })

  // The changelog promises the three worker clients and their shared `WorkerClient` type on
  // the root barrel; a client missing from its module barrel would only be reachable by
  // deep-importing a .svelte.ts file
  test(`root barrel publishes every compute_*_async worker client and the WorkerClient type`, () => {
    for (const client of [
      lib.compute_msd_async,
      lib.compute_vacf_async,
      lib.compute_trajectory_spectroscopy_async,
    ]) {
      expect(client).toBeTypeOf(`function`)
      expect(client.cancel).toBeTypeOf(`function`)
      expect(client.release).toBeTypeOf(`function`)
    }
    expectTypeOf(lib.compute_vacf_async).toExtend<
      WorkerClient<VacfInput, VacfOptions, VacfResult>
    >()
    expectTypeOf<WorkerRequestOptions>().toHaveProperty(`signal`)
    expectTypeOf<WorkerRequestOptions>().toHaveProperty(`on_progress`)
  })

  test.skipIf(!has_dist)(`worker-backed parser ships its sibling worker entry`, () => {
    expect(existsSync(join(dist_dir, `file-viewer/parse-worker.js`))).toBe(true)
  })

  // svelte-package copies whatever sits in src/lib, gitignored or not: an ignored local dir
  // must never reach dist/ (and from there the npm tarball).
  // Untracked-but-not-ignored sources (new files awaiting a commit) count as sources.
  test.skipIf(!has_dist)(`every dist/ top-level entry comes from a src/lib source`, () => {
    const git_args = [
      `ls-files`,
      `--cached`,
      `--others`,
      `--exclude-standard`,
      `--`,
      `src/lib`,
    ]
    const source_stems = new Set(
      execFileSync(`git`, git_args, { cwd: repo_root, encoding: `utf8` })
        .split(`\n`)
        .filter(Boolean)
        // `utils.ts` -> utils, `effects.svelte.ts` -> effects.svelte, `Foo.svelte` -> Foo.svelte
        .map((file) =>
          file
            .slice(`src/lib/`.length)
            .split(`/`)[0]
            .replace(/\.(?:ts|js|mjs)$/, ``),
        ),
    )
    const orphans = readdirSync(dist_dir).filter(
      (entry) =>
        !entry.startsWith(`.`) && !source_stems.has(entry.replace(/\.d\.ts$|\.js$/, ``)),
    )
    expect(orphans, `dist/ entries without a src/lib source`).toEqual([])
  })

  // I/O-bound, not logic: dynamically importing the svelte-package output in dist/ (the
  // structure export pulls in three.js) shares disk and CPU with every other worker under a
  // full-suite run, where 15 s was not always enough.
  test.skipIf(!has_dist)(
    `built structure export entry point retains strict public exports`,
    { timeout: 60_000 },
    async () => {
      const structure_export = await import(`../../dist/structure/export.js`)
      expect(pkg.exports[`./structure/export`]).toEqual({
        types: `./dist/structure/export.d.ts`,
        default: `./dist/structure/export.js`,
      })
      expect(Object.keys(structure_export).toSorted()).toEqual(
        [
          `create_structure_filename`,
          `export_structure_as`,
          `fractional_export_unavailable_reason`,
          `STRUCT_TEXT_FORMATS`,
          `structure_to_cif_str`,
          `structure_to_json_str`,
          `structure_to_poscar_str`,
          `structure_to_xyz_str`,
        ].toSorted(),
      )
    },
  )

  test.skipIf(!has_dist)(
    `symmetry builds retain default and overridable WASM resolution`,
    () => {
      const source = readFileSync(join(dist_dir, `symmetry/analyze.js`), `utf8`)
      // undefined must reach init() untouched so wasm-bindgen resolves the .wasm next to its
      // glue module; the anywidget build rewrites that resolution to a CDN/host URL via the
      // shared moyo plugin in src/vite-plugins.ts
      expect(source).toMatch(
        /init\(source === undefined \? undefined : \{ module_or_path: source \}\)/,
      )
      expect(source).not.toContain(`moyo_wasm_bg.wasm`)
      const widget_config = readFileSync(
        `${repo_root}/extensions/anywidget/vite.config.ts`,
        `utf8`,
      )
      expect(widget_config).toContain(`globalThis.matterviz_moyo_wasm_url ??`)
      expect(widget_config).toContain(`vite_plugin_moyo_wasm_source(`)
    },
  )

  test(`embedded theme side effects stay isolated from the normal theme barrel`, () => {
    const source = readFileSync(join(lib_dir, `theme/index.ts`), `utf8`)
    expect(source).not.toContain(`./embedded`)
    // the exact list: the old themes.mjs side effect must not creep back in
    expect(pkg.sideEffects).toEqual([
      `**/*.css`,
      `**/file-viewer/main.*`,
      `**/theme/embedded.*`,
    ])
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

// Preprocessors run over src/lib as well as the site, so whatever they inject ships in the
// package. heading_ids is scoped to site files in svelte.config.ts: its slugs are never
// referenced from library components, and a heading inside an {#each} (ChemPotDiagram's
// per-projection <h4>) would repeat one id per iteration in a consumer's DOM.
describe(`svelte.config preprocessors`, () => {
  const { markup } = svelte_config.preprocess.find((pre) => pre.name === `heading-ids`) ?? {}
  if (!markup) throw new Error(`no heading-ids preprocessor in svelte.config preprocess`)
  const content = `<h3>Drop Structure File</h3>`

  test.each([
    [`src/lib/brillouin/BrillouinZone.svelte`, false],
    [`src/routes/acknowledgements/+page.md`, true],
    [`src/routes/(demos)/structure/+page.md`, true],
    // Windows hands the preprocessor a back-slashed absolute path, which a `/`-only pattern
    // reads as a site file — the packaged components would then ship injected ids
    [String.raw`C:\repo\src\lib\brillouin\BrillouinZone.svelte`, false],
  ])(`%s gets injected heading ids: %s`, async (path, expected) => {
    const filename = path.startsWith(`src/`) ? join(repo_root, path) : path
    const result = await markup({ content, filename })
    expect(result?.code.includes(`id="drop-structure-file"`) ?? false).toBe(expected)
  })

  test.skipIf(!has_dist)(`packaged components carry no injected heading ids`, () => {
    const with_ids = readdirSync(dist_dir, { recursive: true, encoding: `utf8` })
      .filter((entry) => entry.endsWith(`.svelte`))
      .filter((entry) => /<h[1-6][^>]*\bid=/.test(readFileSync(join(dist_dir, entry), `utf8`)))
    expect(with_ids, `heading ids leaked into the published package`).toEqual([])
  })
})

// A `github:janosh/matterviz#main` dependency has no dist/ (gitignored), so the root `prepare`
// hook must build it there, while dev-checkout and CI installs (dist present or
// MATTERVIZ_SKIP_PREPARE set) must stay at a bare `svelte-kit sync`. The script resolves the
// repo root from its own location, so a copy in a scratch tree exercises both dist states
// without touching the real dist/; `--dry-run` prints the commands instead of running them.
describe(`prepare hook`, () => {
  const scratch_root = mkdtempSync(join(tmpdir(), `matterviz-prepare-`))
  const script = join(scratch_root, `src/scripts/prepare.mjs`)
  cpSync(join(repo_root, `src/scripts/prepare.mjs`), script)
  afterAll(() => rmSync(scratch_root, { recursive: true, force: true }))

  const dry_run = (env: Record<string, string> = {}) => {
    const base_env = { ...process.env }
    delete base_env.MATTERVIZ_SKIP_PREPARE // the outer shell may set it
    return execFileSync(process.execPath, [script, `--dry-run`], {
      encoding: `utf8`,
      env: { ...base_env, ...env },
    })
      .trim()
      .split(`\n`)
  }
  const build_cmds = [`svelte-package`, `node src/scripts/package-dist-assets.mjs`]

  test(`package.json runs the script as its prepare hook`, () => {
    expect(pkg.scripts.prepare).toBe(`node src/scripts/prepare.mjs`)
    // the hook's build half must stay in lockstep with the explicit rebuild script
    expect(pkg.scripts[`package:dist`]).toBe(build_cmds.join(` && `))
  })

  test.each([
    [`dist/ missing`, {}, false, [`svelte-kit sync`, ...build_cmds]],
    [`dist/index.js present`, {}, true, [`svelte-kit sync`]],
    [
      `MATTERVIZ_SKIP_PREPARE=1 (CI setup action)`,
      { MATTERVIZ_SKIP_PREPARE: `1` },
      false,
      [`svelte-kit sync`],
    ],
  ])(`runs only what %s needs`, (_label, env, seed_dist, expected_cmds) => {
    const dist_entry = join(scratch_root, `dist/index.js`)
    if (seed_dist) {
      mkdirSync(join(scratch_root, `dist`), { recursive: true })
      writeFileSync(dist_entry, `export {}\n`)
    }
    try {
      expect(dry_run(env)).toEqual(expected_cmds)
    } finally {
      rmSync(dist_entry, { force: true })
    }
  })
})

// A directory sharing its name with a sibling `.ts` file is a trap for the packaged types:
// svelte-package rewrites a `$lib/...` alias to a relative specifier, and from inside that
// directory the specifier becomes `./` - the directory itself, which has no index - so the
// import does not resolve. `plot/core/types/plot-3d.ts` did exactly this, and it broke
// `import type` from the root entry and most subpaths with TS2307 for every consumer of the
// published package. Two such pairs remain (`settings`, `plot/core/utils`), so keep the rule.
describe(`packaged type declarations resolve`, () => {
  // every directory under src/lib that has a sibling file of the same name
  const shadowed_dirs = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      if (existsSync(`${full}.ts`)) out.push(full)
      shadowed_dirs(full, out)
    }
    return out
  }

  test(`no file imports the $lib alias of the directory it lives in`, () => {
    const dirs = shadowed_dirs(lib_dir)
    expect(dirs.length).toBeGreaterThan(0) // the rule is worth nothing if it scans nothing
    const offenders: string[] = []
    for (const dir of dirs) {
      const alias = `$lib/${dir.slice(lib_dir.length + 1).replaceAll(`\\`, `/`)}`
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(`.ts`) && !file.endsWith(`.svelte`)) continue
        const source = readFileSync(join(dir, file), `utf8`)
        // the alias as a whole specifier, in either quote style, not as a prefix of a deeper path
        for (const quote of [`'`, `\``]) {
          if (source.includes(`from ${quote}${alias}${quote}`))
            offenders.push(`${file} -> ${alias}`)
        }
      }
    }
    // import the sibling file relatively instead, e.g. `../types` rather than the alias
    expect(offenders).toEqual([])
  })
})
