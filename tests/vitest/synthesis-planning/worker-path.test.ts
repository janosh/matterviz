// Exercises the synthesis planner's Web Worker boundary. Numerical correctness and progress are
// covered by synthesis-planning.test.ts; this verifies the cloneable contract and module path.
import type { PhaseData } from '$lib/convex-hull'
import type { plan_synthesis_async as PlanSynthesisAsync } from '$lib/synthesis-planning/plan-synthesis-async.svelte'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type { SynthesisPlanRequest } from '$lib/synthesis-planning/types'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { expect_module_worker, install_stub_worker, read_maybe_gz } from '../setup'

const entries: PhaseData[] = JSON.parse(
  read_maybe_gz(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`),
)
const stub = install_stub_worker<{
  id: number
  input: SynthesisPlanRequest
  options: undefined
}>(({ input }) => plan_synthesis(input))
let plan_synthesis_async: typeof PlanSynthesisAsync

beforeAll(async () => {
  ;({ plan_synthesis_async } = await import(
    `$lib/synthesis-planning/plan-synthesis-async.svelte`
  ))
})
afterEach(stub.reset)

test(`worker result exactly matches the pure kernel and preserves entry ids`, async () => {
  const request: SynthesisPlanRequest = {
    entries,
    target: `agm003129350`,
    conditions: { temperature: 1200, open_species: [`O2`, `CO2`] },
    max_routes: 5,
  }
  const result = await plan_synthesis_async(request)

  expect(result).toEqual(plan_synthesis(request))
  expect(result.target.id).toBe(`agm003129350`)
  expect(stub.posted[0].message.input.entries[0].entry_id).toBe(entries[0].entry_id)
  expect_module_worker(stub.instances, `src/lib/synthesis-planning/plan-synthesis-worker.ts`)
})

test(`worker runtime graph excludes Svelte and browser-only sanitizer modules`, async () => {
  const { existsSync, readFileSync } = await import(`node:fs`)
  const { dirname, resolve } = await import(`node:path`)
  const repo_root = resolve(import.meta.dirname, `../../..`)
  const worker_entry = resolve(
    repo_root,
    `src/lib/synthesis-planning/plan-synthesis-worker.ts`,
  )
  const source_extensions = [`.ts`, `.svelte`, `.js`, `.mjs`]
  const resolve_specifier = (specifier: string, from_file: string): string | null => {
    let base: string
    if (specifier.startsWith(`$lib`)) {
      base = resolve(repo_root, `src/lib`, specifier.slice(`$lib`.length).replace(/^\//, ``))
    } else if (specifier.startsWith(`.`)) {
      base = resolve(dirname(from_file), specifier)
    } else return null
    const candidates = source_extensions.some((extension) => base.endsWith(extension))
      ? [base]
      : source_extensions.flatMap((extension) => [
          `${base}${extension}`,
          resolve(base, `index${extension}`),
        ])
    return candidates.find(existsSync) ?? null
  }
  const strip_type_only = (source: string): string =>
    source.replaceAll(
      /(?:import|export)\s+(?:\{\s*(?:type\s+[^,}]+,?\s*)+\}|type\s+[^;]*?)\s+from\s*['"`][^'"`]+['"`]\s*;?/g,
      ``,
    )
  const import_re = /(?:from|import)\s*\(?\s*['"`](?<specifier>[^'"`]+)['"`]/g
  const queue = [worker_entry]
  const visited = new Set<string>()
  const violations: string[] = []
  while (queue.length) {
    const file = queue.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    const source = strip_type_only(readFileSync(file, `utf-8`))
    for (const match of source.matchAll(import_re)) {
      const specifier = match.groups?.specifier ?? ``
      if (
        specifier === `svelte` ||
        specifier.startsWith(`svelte/`) ||
        specifier.endsWith(`.svelte`) ||
        specifier === `dompurify`
      ) {
        violations.push(`${file} imports "${specifier}"`)
        continue
      }
      const resolved = resolve_specifier(specifier, file)
      if (resolved) queue.push(resolved)
    }
  }

  expect(visited.size).toBeGreaterThan(20)
  expect(visited).toContain(worker_entry)
  expect(violations).toEqual([])
})
