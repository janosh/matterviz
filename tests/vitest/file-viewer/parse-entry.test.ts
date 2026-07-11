// The public parse-only entry stays worker-safe.
import { describe, expect, test } from 'vitest'

describe(`file-viewer worker safety`, () => {
  test(`worker-safe entry graphs stay free of Svelte`, async () => {
    // A direct-source scan alone can't catch a parser importing a barrel that
    // re-exports Svelte components — that only explodes at worker runtime
    // ("document is not defined"). Walk the runtime import graph: relative
    // imports and $lib aliases resolve to repo files and are scanned
    // recursively; bare package imports are allowed except svelte itself.
    const { existsSync, readFileSync } = await import(`node:fs`)
    const { dirname, resolve } = await import(`node:path`)
    const repo_root = resolve(import.meta.dirname, `../../..`)
    const entries = [`parse.ts`, `eligibility.ts`, `host-transfer.ts`].map((filename) =>
      resolve(repo_root, `src/lib/file-viewer/${filename}`),
    )
    const source_extensions = [`.ts`, `.svelte`, `.js`, `.mjs`]

    const resolve_specifier = (specifier: string, from_file: string): string | null => {
      let base: string
      if (specifier.startsWith(`$lib`)) {
        base = resolve(repo_root, `src/lib`, specifier.slice(`$lib`.length).replace(/^\//, ``))
      } else if (specifier.startsWith(`.`)) {
        base = resolve(dirname(from_file), specifier)
      } else return null // bare package import — not a repo file
      const candidates = source_extensions.some((extension) => base.endsWith(extension))
        ? [base]
        : source_extensions.flatMap((extension) => [
            `${base}${extension}`,
            resolve(base, `index${extension}`),
          ])
      return candidates.find(existsSync) ?? null
    }

    const import_re = /(?:from|import)\s*\(?\s*['"`](?<specifier>[^'"`]+)['"`]/g
    // Type-only imports/re-exports are erased at runtime and never load the
    // module — scanning them would flag every `import type ... from '$lib/x'`
    // whose barrel also exports components.
    const strip_type_only = (source: string): string =>
      source.replaceAll(
        /(?:import|export)\s+(?:\{\s*(?:type\s+[^,}]+,?\s*)+\}|type\s+[^;]*?)\s+from\s*['"`][^'"`]+['"`]\s*;?/g,
        ``,
      )
    const visited = new Set<string>()
    const queue = [...entries]
    const violations: string[] = []
    while (queue.length > 0) {
      const file = queue.pop() as string
      if (visited.has(file)) continue
      visited.add(file)
      const source = strip_type_only(readFileSync(file, `utf-8`))
      for (const match of source.matchAll(import_re)) {
        const specifier = match.groups?.specifier ?? ``
        if (
          specifier === `svelte` ||
          specifier.startsWith(`svelte/`) ||
          specifier.endsWith(`.svelte`)
        ) {
          violations.push(`${file} imports "${specifier}"`)
          continue
        }
        const resolved = resolve_specifier(specifier, file)
        if (resolved) queue.push(resolved)
      }
    }
    expect(visited.size).toBeGreaterThan(10) // the walk actually traversed the graphs
    expect(entries.every((entry) => visited.has(entry))).toBe(true)
    expect(violations).toEqual([])
  })
})
