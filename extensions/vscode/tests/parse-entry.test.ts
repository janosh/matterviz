// The public parse-only entry stays worker-safe while the extension wrapper
// re-exports the same functions for backward compatibility.
import { describe, expect, test } from 'vitest'
import * as main_entry from '../src/webview/main'
import * as parse_entry from '$lib/file-viewer/parse'

describe(`webview parse entry points`, () => {
  test.each([`parse_file_content`, `parse_large_file_marker`, `base64_to_array_buffer`])(
    `main.ts re-exports %s from parse.ts by identity`,
    (export_name) => {
      const from_main = main_entry[export_name as keyof typeof main_entry]
      const from_parse = parse_entry[export_name as keyof typeof parse_entry]
      expect(typeof from_parse).toBe(`function`)
      expect(from_main).toBe(from_parse)
    },
  )

  test(`parse.ts parses a structure without going through main.ts`, async () => {
    const poscar = `Si2\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n2\ndirect\n0 0 0 Si\n0.25 0.25 0.25 Si\n`
    const result = await parse_entry.parse_file_content(poscar, `POSCAR`, false)
    expect(result.type).toBe(`structure`)
    const structure = result.data as { sites: unknown[] }
    expect(structure.sites).toHaveLength(2)
  })

  test(`parse.ts TRANSITIVE import graph stays free of Svelte (worker-safe)`, async () => {
    // A direct-source scan alone can't catch a parser importing a barrel that
    // re-exports Svelte components — that only explodes at worker runtime
    // ("document is not defined"). Walk the runtime import graph: relative
    // imports and $lib aliases resolve to repo files and are scanned
    // recursively; bare package imports are allowed except svelte itself.
    const { existsSync, readFileSync } = await import(`node:fs`)
    const { dirname, resolve } = await import(`node:path`)
    const repo_root = resolve(import.meta.dirname, `../../..`)
    const entry = resolve(repo_root, `src/lib/file-viewer/parse.ts`)

    const resolve_specifier = (specifier: string, from_file: string): string | null => {
      let base: string
      if (specifier.startsWith(`$lib`)) {
        base = resolve(repo_root, `src/lib`, specifier.slice(`$lib`.length).replace(/^\//, ``))
      } else if (specifier.startsWith(`.`)) {
        base = resolve(dirname(from_file), specifier)
      } else return null // bare package import — not a repo file
      for (const candidate of [base, `${base}.ts`, resolve(base, `index.ts`)]) {
        if (/\.(?:ts|svelte)$/.test(candidate) && existsSync(candidate)) return candidate
      }
      return null
    }

    const import_re = /(?:from|import)\s*\(?\s*['"`](?<specifier>[^'"`]+)['"`]/g
    // Type-only imports/re-exports are erased at runtime and never load the
    // module — scanning them would flag every `import type ... from '$lib/x'`
    // whose barrel also exports components.
    const strip_type_only = (source: string): string =>
      source.replaceAll(/(?:import|export)\s+type\s[^;]*?from\s*['"`][^'"`]+['"`]/g, ``)
    const visited = new Set<string>()
    const queue = [entry]
    const violations: string[] = []
    while (queue.length > 0) {
      const file = queue.pop() as string
      if (visited.has(file)) continue
      visited.add(file)
      const source = strip_type_only(readFileSync(file, `utf-8`))
      for (const match of source.matchAll(import_re)) {
        const specifier = match.groups?.specifier ?? ``
        if (!specifier) continue
        if (specifier === `svelte` || specifier.startsWith(`svelte/`)) {
          violations.push(`${file} imports "${specifier}"`)
          continue
        }
        if (specifier.endsWith(`.svelte`)) {
          violations.push(`${file} imports component "${specifier}"`)
          continue
        }
        const resolved = resolve_specifier(specifier, file)
        if (resolved) queue.push(resolved)
      }
    }
    expect(visited.size).toBeGreaterThan(10) // the walk actually traversed the graph
    expect(violations).toEqual([])
  })
})
