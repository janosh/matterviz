// Guards consumer bundle size: modules every plot and table imports must not statically
// reach heavy modules. A static import keeps a module in the importer's chunk even when
// the importing code path never runs (element/data.ts builds lookup tables at load time,
// so bundlers cannot drop it), which put three.js and the full element dataset into
// every 2D plot page.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const lib_dir = resolve(import.meta.dirname, `../../src/lib`)
const HEAVY_PACKAGES = [`three`, `@threlte/`]

// Runtime import specifiers of a module, parsed (not regex-matched): `import type`,
// `export type` and all-type named imports are erased; dynamic import() is lazy.
function runtime_imports(file: string): string[] {
  const text = readFileSync(file, `utf8`)
  const scripts = file.endsWith(`.svelte`)
    ? [...text.matchAll(/<script\b[^>]*>(?<body>[\s\S]*?)<\/script>/gu)].map(
        (match) => match.groups?.body ?? ``,
      )
    : [text]
  return scripts.flatMap((script) =>
    ts
      .createSourceFile(file, script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
      .statements.flatMap((stmt) => {
        if (ts.isImportDeclaration(stmt)) {
          const clause = stmt.importClause
          const bindings = clause?.namedBindings
          const all_named_type_only =
            clause !== undefined &&
            !clause.name &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)
          const type_only =
            clause?.phaseModifier === ts.SyntaxKind.TypeKeyword || all_named_type_only
          return type_only ? [] : [(stmt.moduleSpecifier as ts.StringLiteral).text]
        }
        if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && !stmt.isTypeOnly)
          return [(stmt.moduleSpecifier as ts.StringLiteral).text]
        return []
      }),
  )
}

// local file for `#lib/…` and relative specifiers, null for packages; throws on a local
// specifier that doesn't resolve, so the walk can't silently skip part of the graph
function resolve_local(spec: string, from_file: string): string | null {
  if (!spec.startsWith(`#`) && !spec.startsWith(`.`)) return null
  if (spec.startsWith(`#`) && !spec.startsWith(`#lib/`))
    throw new Error(`${from_file}: unhandled import alias ${spec}`)
  const base = spec.startsWith(`#lib/`)
    ? resolve(lib_dir, spec.slice(5))
    : resolve(dirname(from_file), spec)
  const stem = base.replace(/\.js$/u, ``)
  const found = [base, `${stem}.ts`, `${stem}.svelte.ts`, `${stem}/index.ts`].find(
    (path) => existsSync(path) && statSync(path).isFile(),
  )
  if (!found) throw new Error(`${from_file}: cannot resolve ${spec}`)
  return found
}

// every module and package specifier statically reachable from `entry`
function static_closure(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [resolve(lib_dir, entry)]
  while (queue.length) {
    const file = queue.pop()
    if (!file || files.has(file)) continue
    files.add(file)
    if (!/\.(?:ts|svelte)$/u.test(file)) continue
    for (const spec of runtime_imports(file)) {
      const local = resolve_local(spec, file)
      if (local) queue.push(local)
      else packages.add(spec)
    }
  }
  return { files, packages }
}

describe(`static import graph`, () => {
  // the two modules every plot and table imports directly. (Plot components themselves
  // reach element data through unused barrel re-exports, which bundlers prune.)
  it.each([`sanitize.ts`, `io/export.ts`])(
    `%s reaches neither three.js nor the element dataset`,
    (entry) => {
      const { files, packages } = static_closure(entry)
      expect(files.size).toBeGreaterThan(1) // the walker followed imports
      const heavy = [...packages].filter((pkg) =>
        HEAVY_PACKAGES.some((prefix) => pkg.startsWith(prefix)),
      )
      expect(heavy).toEqual([])
      expect(files.has(resolve(lib_dir, `element/data.ts`))).toBe(false)
    },
  )

  it(`sees heavy imports where they exist and skips type-only and dynamic ones`, () => {
    expect(static_closure(`composition/format.ts`).files).toContain(
      resolve(lib_dir, `element/data.ts`),
    )
    expect(static_closure(`scene/pan.ts`).packages).toContain(`three/webgpu`)
    // export.ts keeps `import type … from 'three/webgpu'` and dynamic import('three/webgpu')
    expect(runtime_imports(resolve(lib_dir, `io/export.ts`))).not.toContain(`three/webgpu`)
    expect(readFileSync(resolve(lib_dir, `io/export.ts`), `utf8`)).toContain(
      `import type { Camera, Scene, Vector2, WebGPURenderer } from 'three/webgpu'`,
    )
  })
})
