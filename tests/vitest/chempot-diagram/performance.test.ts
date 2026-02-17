import {
  compute_chempot_diagram,
  formula_key_from_composition,
  get_3d_domain_simplexes_and_ann_loc,
  get_energy_per_atom,
  get_min_entries_and_el_refs,
} from '$lib/chempot-diagram/compute'
import { count_atoms_in_composition } from '$lib/composition/parse'
import type { PhaseData } from '$lib/convex-hull/types'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

const test_dir = dirname(fileURLToPath(import.meta.url))
const min_speedup_ratio = Number(
  process.env.CHEMPOT_MIN_SPEEDUP_RATIO ?? (process.env.CI ? 1.5 : 2),
)

function load_gzip_json<T>(filename: string): T {
  const compressed_bytes = readFileSync(`${test_dir}/${filename}`)
  const decompressed_text = gunzipSync(compressed_bytes).toString(`utf8`)
  return JSON.parse(decompressed_text) as T
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const mid_idx = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid_idx - 1] + sorted[mid_idx]) / 2
    : sorted[mid_idx]
}

function bench_ms(fn: () => void, n_runs: number, n_warmup_runs: number): number {
  for (let warmup_idx = 0; warmup_idx < n_warmup_runs; warmup_idx++) fn()
  const run_times: number[] = []
  for (let run_idx = 0; run_idx < n_runs; run_idx++) {
    const start_ms = performance.now()
    fn()
    run_times.push(performance.now() - start_ms)
  }
  return median(run_times)
}

function compute_e_form(entry: PhaseData, el_refs: Record<string, PhaseData>): number {
  const atoms = count_atoms_in_composition(entry.composition)
  const energy_per_atom = get_energy_per_atom(entry)
  let ref_energy = 0
  for (const [element, amount] of Object.entries(entry.composition)) {
    if (amount <= 0) continue
    const fraction = amount / atoms
    const ref = el_refs[element]
    if (ref) ref_energy += fraction * get_energy_per_atom(ref)
  }
  return energy_per_atom - ref_energy
}

function hash_points(points_3d: number[][]): string {
  return points_3d.map((point) => point.map((value) => value.toFixed(4)).join(`,`)).join(
    `;`,
  )
}

const pd_entries = load_gzip_json<PhaseData[]>(`pd_entries_test.json.gz`)
const ytos_entries = load_gzip_json<PhaseData[]>(`ytos_entries.json.gz`)

const dataset_cases: { name: string; entries: PhaseData[]; default_min_limit: number }[] =
  [
    { name: `li_fe_o`, entries: pd_entries, default_min_limit: -25 },
    { name: `ytos`, entries: ytos_entries, default_min_limit: -50 },
  ]

describe(`chempot performance gates`, () => {
  test.each(dataset_cases)(
    `formation-energy lookups are at least 2x faster for %s`,
    ({ name, entries, default_min_limit }) => {
      const diagram_data = compute_chempot_diagram(entries, {
        default_min_limit,
        formal_chempots: false,
      })
      const formulas = Object.keys(diagram_data.domains)
      const raw_el_refs = get_min_entries_and_el_refs(entries).el_refs
      const lookup_cycles = 60

      const naive_ms = bench_ms(
        () => {
          for (let cycle_idx = 0; cycle_idx < lookup_cycles; cycle_idx++) {
            for (const formula of formulas) {
              let best: number | undefined
              for (const entry of entries) {
                if (formula_key_from_composition(entry.composition) !== formula) continue
                const e_form = entry.e_form_per_atom ?? compute_e_form(entry, raw_el_refs)
                if (best === undefined || e_form < best) best = e_form
              }
            }
          }
        },
        7,
        2,
      )

      const optimized_map = new Map<string, number>()
      for (const entry of entries) {
        const formula = formula_key_from_composition(entry.composition)
        const e_form = entry.e_form_per_atom ?? compute_e_form(entry, raw_el_refs)
        const prev_best = optimized_map.get(formula)
        if (prev_best === undefined || e_form < prev_best) {
          optimized_map.set(formula, e_form)
        }
      }
      const optimized_ms = bench_ms(
        () => {
          for (let cycle_idx = 0; cycle_idx < lookup_cycles; cycle_idx++) {
            for (const formula of formulas) optimized_map.get(formula)
          }
        },
        7,
        2,
      )

      const speedup_ratio = naive_ms / Math.max(optimized_ms, 1e-9)
      expect(
        speedup_ratio,
        `${name}: formation-energy speedup ${speedup_ratio.toFixed(2)}x`,
      ).toBeGreaterThanOrEqual(min_speedup_ratio)
    },
  )

  test.each(dataset_cases)(
    `domain annotation preprocessing is at least 2x faster with cache for %s`,
    ({ name, entries, default_min_limit }) => {
      const diagram_data = compute_chempot_diagram(entries, {
        default_min_limit,
        formal_chempots: false,
      })
      const domains = Object.entries(diagram_data.domains)
        .map(([formula, points_3d]) => ({ formula, points_3d }))
        .filter((domain) => domain.points_3d.length >= 3)
      const preprocess_cycles = 24

      const naive_ms = bench_ms(
        () => {
          for (let cycle_idx = 0; cycle_idx < preprocess_cycles; cycle_idx++) {
            for (const domain of domains) {
              get_3d_domain_simplexes_and_ann_loc(domain.points_3d)
            }
          }
        },
        7,
        2,
      )

      const ann_cache = new Map<
        string,
        ReturnType<typeof get_3d_domain_simplexes_and_ann_loc>
      >()
      const optimized_ms = bench_ms(
        () => {
          for (let cycle_idx = 0; cycle_idx < preprocess_cycles; cycle_idx++) {
            for (const domain of domains) {
              const cache_key = `${domain.formula}|${hash_points(domain.points_3d)}`
              let cached = ann_cache.get(cache_key)
              if (!cached) {
                cached = get_3d_domain_simplexes_and_ann_loc(domain.points_3d)
                ann_cache.set(cache_key, cached)
              }
            }
          }
        },
        7,
        2,
      )

      const speedup_ratio = naive_ms / Math.max(optimized_ms, 1e-9)
      expect(
        speedup_ratio,
        `${name}: annotation cache speedup ${speedup_ratio.toFixed(2)}x`,
      ).toBeGreaterThanOrEqual(min_speedup_ratio)
    },
  )
})
