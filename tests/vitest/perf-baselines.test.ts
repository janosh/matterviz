// Blow-up tripwires (2x) for the subsystems reworked in #438. Each gets one seeded synthetic
// generator (nothing on disk), a median-of-N timing and a stored baseline; a run fails only
// above 2x that baseline, after scaling by how much slower than the baseline machine this one
// proves on a fixed reference workload. That keeps 2x meaningful on a throttled CI runner
// without loosening it into a band no real regression would ever hit. Sub-2x slowdowns pass.
// Opt in locally with MATTERVIZ_PERF=1; CI runs it in its own job (see ci.yml). The file is
// excluded from the default run in vite.config.ts, so it never pays its import cost there.
import { composition_to_barycentric_nd } from '$lib/convex-hull/barycentric-coords'
import { calculate_e_above_hull, compute_lower_hull_nd } from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'
import { parse_chgcar } from '$lib/isosurface/parse'
import { JsonTree } from 'svelte-widgets/json-tree'
import { marching_cubes } from '$lib/marching-cubes'
import type { Vec3 } from '$lib/math'
import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
import { bin_points } from '$lib/plot/scatter/adaptive-density'
import { get_coordination_colors } from '$lib/structure/atom-properties'
import { electroneg_ratio, neighbor_query } from '$lib/structure/bonding'
import { compute_polyhedra, merge_polyhedra_buffers } from '$lib/structure/polyhedra'
import { make_supercell } from '$lib/structure/supercell'
import { HeatmapTable, type RowData } from '$lib/table'
import { Trajectory, type TrajectoryController, trajectory_from_frames } from '$lib/trajectory'
import { compute_xrd_pattern } from '$lib/xrd/calc-xrd'
import process from 'node:process'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { make_rng } from './numeric-helpers'
import {
  IDENTITY_MATRIX3,
  make_crystal,
  make_molecule,
  make_rocksalt,
  make_struct,
  mount_sized,
} from './setup'
import { make_fcc, with_random_displacements } from './structure-id/lattices'

// Medians over 5 suite runs on the baseline machine: Apple M3 Max, macOS 26.5, Node 24.19,
// vitest 4.1.11, happy-dom 20.11 (2026-08-21), with other vitest workers sharing the CPU
// (run-to-run spread was up to 1.9x, which is what the 2x band and the machine factor
// absorb). Re-measure when you speed a path up; never raise a baseline to pass a slow run.
const REFERENCE_MS = 41
const BASELINES = {
  'ScatterPlot 100k points canvas mount': 310,
  'Trajectory 100x64 mount': 190,
  'Trajectory 100 frame switches': 200,
  'JsonTree 2k keys mount': 730,
  'HeatmapTable 10k x 30 virtual mount': 730,
  'e_above_hull 10k ternary entries': 26,
  'CHGCAR 80x80x96 parse': 39,
  'marching cubes 64^3': 6.3,
  'neighbor_query 1792 sites': 4.6,
  'XRD 444 sites': 86,
  // Wall-clock guards moved here from the default suite (they failed under CPU contention)
  'polyhedra 8000-site detect': 55,
  'polyhedra 8000-site buffer merge': 14,
  'quickhull 4D 775 entries': 14,
  'density binning 1M points': 17,
  'neighbor_query 39304 sites + flyaway atom': 45,
  'coordination colors 27000 atoms': 8,
  'make_supercell 1000 sites x 3x3x3': 25,
} as const
type Case = keyof typeof BASELINES
const BAND = 2

const median = (values: number[]): number =>
  values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)]

const time_once = async (run: () => unknown): Promise<number> => {
  const start = performance.now()
  await run()
  return performance.now() - start
}

// === one seeded generator per subsystem ===

const make_series = (n_points: number) => {
  const rng = make_rng(1)
  return {
    x: Array.from({ length: n_points }, (_, idx) => idx + rng()),
    y: Array.from({ length: n_points }, () => rng() * 100),
  }
}

const make_frames = (n_frames: number, n_atoms: number) => {
  const rng = make_rng(2)
  const cell = 12
  const base = Array.from({ length: n_atoms }, () => [rng(), rng(), rng()] as Vec3)
  return Array.from({ length: n_frames }, (_, frame_idx) => ({
    step: frame_idx,
    metadata: { energy: -100 - rng(), force_max: rng(), volume: cell ** 3 },
    structure: make_crystal(
      cell,
      base.map((abc, atom_idx) => ({
        element: atom_idx % 3 === 0 ? `Fe` : `O`,
        abc: abc.map((coord) => (coord + 0.01 * frame_idx * rng()) % 1) as Vec3,
      })),
    ),
  }))
}

const make_json = (n_keys: number): Record<string, unknown> => {
  const rng = make_rng(3)
  const value: Record<string, unknown> = {}
  for (let idx = 0; idx < n_keys; idx++) {
    const kind = idx % 4
    value[`key_${idx}`] =
      kind === 0
        ? rng() * 1e3
        : kind === 1
          ? `text ${idx}`
          : kind === 2
            ? rng() > 0.5
            : { nested: rng(), list: [rng(), rng()] }
  }
  return value
}

const make_table = (n_rows: number, n_cols: number) => {
  const rng = make_rng(4)
  const columns = Array.from({ length: n_cols }, (_, idx) => ({
    label: `col_${idx}`,
    color_scale: idx % 3 === 0 ? (`interpolateViridis` as const) : undefined,
    sticky: idx === 0,
  }))
  const data: RowData[] = Array.from({ length: n_rows }, (_, row_idx) =>
    Object.fromEntries(
      columns.map((col, col_idx) => [
        col.label,
        col_idx === 1 ? `name_${row_idx}` : Math.round(rng() * 1e4) / 10,
      ]),
    ),
  )
  return { columns, data }
}

const make_entries = (
  n_entries: number,
  elements: ElementSymbol[] = [`Li`, `Fe`, `O`],
): PhaseData[] => {
  const rng = make_rng(5)
  const entries: PhaseData[] = elements.map((element) => ({
    composition: { [element]: 1 },
    energy: -2 - rng(),
    entry_id: element,
  }))
  while (entries.length < n_entries) {
    const counts = elements.map(() => Math.floor(rng() * 6))
    const n_atoms = counts.reduce((sum, count) => sum + count, 0)
    if (n_atoms === 0) continue
    entries.push({
      composition: Object.fromEntries(
        elements.flatMap((element, idx) => (counts[idx] ? [[element, counts[idx]]] : [])),
      ),
      energy: n_atoms * (-2.5 + 0.8 * rng()),
      entry_id: `entry-${entries.length}`,
    })
  }
  return entries
}

const make_chgcar = (dims: Vec3): string => {
  const rng = make_rng(6)
  const [n_x, n_y, n_z] = dims
  const lines = [
    `synthetic`,
    `1.0`,
    `  8.0 0.0 0.0`,
    `  0.0 8.0 0.0`,
    `  0.0 0.0 8.0`,
    `  Si`,
    `  8`,
    `Direct`,
    ...Array.from(
      { length: 8 },
      () => `  ${rng().toFixed(6)} ${rng().toFixed(6)} ${rng().toFixed(6)}`,
    ),
    ``,
    `  ${n_x} ${n_y} ${n_z}`,
  ]
  const n_values = n_x * n_y * n_z
  for (let start = 0; start < n_values; start += 5) {
    lines.push(
      Array.from({ length: Math.min(5, n_values - start) }, () =>
        (rng() * 10).toExponential(11).replace(`e`, `E`),
      ).join(` `),
    )
  }
  return `${lines.join(`\n`)}\n`
}

// Gyroid-like field: a single connected surface through the whole grid, so every cube
// row does real work instead of the empty-cell fast path.
const make_grid = (size: number) => {
  const values = new Float32Array(size ** 3)
  const two_pi = (2 * Math.PI) / size
  for (let x_idx = 0; x_idx < size; x_idx++) {
    for (let y_idx = 0; y_idx < size; y_idx++) {
      for (let z_idx = 0; z_idx < size; z_idx++) {
        values[(x_idx * size + y_idx) * size + z_idx] =
          Math.sin(two_pi * x_idx) * Math.cos(two_pi * y_idx) +
          Math.sin(two_pi * y_idx) * Math.cos(two_pi * z_idx) +
          Math.sin(two_pi * z_idx) * Math.cos(two_pi * x_idx)
      }
    }
  }
  return { values, dims: [size, size, size] as Vec3, order: `z_fastest` as const }
}

// Disordered three-element cell at a metallic density, so XRD sees many weak reflections
// rather than a handful of sharp ones
const make_disordered_cell = (n_sites: number) => {
  const rng = make_rng(9)
  const elements = [`Ti`, `Ni`, `Sn`]
  return make_crystal(
    (n_sites / 0.06) ** (1 / 3),
    Array.from({ length: n_sites }, (_, idx) => ({
      element: elements[idx % elements.length],
      abc: [rng(), rng(), rng()] as Vec3,
    })),
  )
}

// 4D hull input: barycentric composition (3 free coordinates) plus energy per atom. The
// energy is a bowl (deepest at equal mixing) plus noise, so the lower hull has many facets
// rather than the single simplex a random cloud above the elements would give.
const make_hull_points = (n_entries: number): number[][] => {
  const elements: ElementSymbol[] = [`Li`, `Co`, `Ni`, `O`]
  const rng = make_rng(7)
  return make_entries(n_entries, elements).map((entry) => {
    const fractions = composition_to_barycentric_nd(entry.composition, elements)
    const bowl = 1 - fractions.reduce((sum, frac) => sum + frac ** 2, 0)
    return [...fractions.slice(1), -2.5 - 1.5 * bowl + 0.2 * rng()]
  })
}

// 1M points spread over a 512x512 bin grid: every bin row sees traffic
const make_dense_series = (n_points: number) => {
  const x = new Float32Array(n_points)
  const y = new Float32Array(n_points)
  for (let idx = 0; idx < n_points; idx++) {
    x[idx] = (idx % 10_000) / 10_000
    y[idx] = ((idx * 48_271) % 1_000_000) / 1_000_000
  }
  return [{ x, y }]
}

// Cartesian positions of an `edge`^3 cubic grid with the given spacing
const cubic_grid = (edge: number, spacing: number): Vec3[] =>
  Array.from({ length: edge ** 3 }, (_, idx) => [
    (idx % edge) * spacing,
    (Math.floor(idx / edge) % edge) * spacing,
    Math.floor(idx / edge ** 2) * spacing,
  ])

// A cubic cluster of `edge`^3 atoms at 1.1 A plus one atom ejected `far` A away along x (an
// MD blow-up frame). The stretched bounding box must not degrade the neighbour grid: a
// cubic bin widened until the grid fits put the whole cluster in one bin and made the sweep
// O(n^2) (50k atoms: 0.1 -> 4 s).
const make_flyaway_cloud = (edge: number, far: number) =>
  make_molecule([...cubic_grid(edge, 1.1), [far, 0, 0] as Vec3].map((xyz) => [`C`, xyz]))

// === harness ===

const mounted: ReturnType<typeof mount>[] = []
const target = () => {
  const element = document.createElement(`div`)
  document.body.append(element)
  return element
}
const cleanup = async () => {
  for (const component of mounted.splice(0)) await unmount(component)
  document.body.innerHTML = ``
}

// Pure-JS mix of arithmetic and allocation. Its ratio to REFERENCE_MS scales every
// threshold, so a 1.5x slower box trips at 1.5 * 2x of the stored medians.
const reference_workload = () => {
  let acc = 0
  for (let idx = 1; idx < 3e6; idx++) acc += Math.sqrt(idx) / (1 + (idx % 7))
  const objects = Array.from({ length: 2e5 }, (_, idx) => ({ key: (idx * 7919) % 1009, acc }))
  objects.sort((left, right) => left.key - right.key)
  return acc + objects[0].key
}

const results: { name: Case; median_ms: number; limit_ms: number }[] = []
let reference_ms = REFERENCE_MS
let machine_factor = 1

// 5 reps of a ~1 s mount plus cleanup can exceed vitest's 5 s default on a loaded runner
describe(`perf baselines`, { timeout: 120_000 }, () => {
  beforeAll(async () => {
    reference_workload() // JIT warm-up: the first call runs unoptimized and would skew the median
    const reference_timings: number[] = []
    for (let rep = 0; rep < 7; rep++)
      reference_timings.push(await time_once(reference_workload))
    reference_ms = median(reference_timings)
    machine_factor = Math.max(1, reference_ms / REFERENCE_MS)
    // happy-dom has no 2D context; canvas markers and tick-label measurement both need one
    const stubs =
      `save restore setTransform clearRect scale beginPath rect clip moveTo lineTo arc fill stroke`.split(
        ` `,
      )
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
      font: ``,
      measureText: (text: string) => ({ width: 6 * text.length }),
      ...Object.fromEntries(stubs.map((name) => [name, () => undefined])),
    } as unknown as CanvasRenderingContext2D)
  })
  afterEach(cleanup)
  afterAll(() => {
    vi.restoreAllMocks()
    const rows = results.map(
      ({ name, median_ms, limit_ms }) =>
        `${name.padEnd(40)} ${median_ms.toFixed(1).padStart(8)} ms  (baseline ${
          BASELINES[name]
        } ms, limit ${limit_ms.toFixed(0)} ms)`,
    )
    console.info(
      `perf baselines (reference ${reference_ms.toFixed(1)} ms vs ${REFERENCE_MS} ms stored, machine factor ${machine_factor.toFixed(
        2,
      )}):\n${rows.join(`\n`)}`,
    )
  })

  const assert_within_band = (name: Case, timings: number[]) => {
    const median_ms = median(timings)
    const limit_ms = BAND * BASELINES[name] * machine_factor
    results.push({ name, median_ms, limit_ms })
    expect(
      median_ms,
      `${name}: median ${median_ms.toFixed(1)} ms over ${timings.length} runs exceeds ${limit_ms.toFixed(
        0,
      )} ms (${BAND}x baseline ${BASELINES[name]} ms x machine factor ${machine_factor.toFixed(
        2,
      )})`,
    ).toBeLessThanOrEqual(limit_ms)
  }

  // `reps` trades runtime for noise rejection: heavy mounts get 5, sub-50 ms paths 15.
  const measure = async (
    name: Case,
    run: () => unknown,
    reps = BASELINES[name] > 50 ? 5 : 15,
  ) => {
    const timings: number[] = []
    for (let rep = 0; rep < reps; rep++) {
      timings.push(await time_once(run))
      await cleanup()
    }
    // Per-rep timings for re-baselining: MATTERVIZ_PERF_DEBUG=1
    if (process.env.MATTERVIZ_PERF_DEBUG) {
      console.info(name, timings.map((timing) => timing.toFixed(1)).join(` `))
    }
    assert_within_band(name, timings)
  }

  test(`ScatterPlot 100k points canvas mount`, async () => {
    const series = [make_series(100_000)]
    await measure(`ScatterPlot 100k points canvas mount`, async () => {
      const plot = await mount_sized(
        ScatterPlot,
        { series, marker_renderer: `canvas` },
        { selector: `.scatter`, on_mount: (component) => mounted.push(component) },
      )
      expect(plot.querySelector(`canvas.marker-canvas`)).not.toBeNull()
    })
  })

  test(`Trajectory mount and frame switches`, async () => {
    const frames = make_frames(100, 64)
    const run = trajectory_from_frames(frames, {
      provenance: { filename: `synthetic.extxyz`, format: `xyz`, source_bytes: 0 },
    })
    const held: { controller: TrajectoryController | null } = { controller: null }
    const mount_trajectory = () => {
      mounted.push(
        mount(Trajectory, {
          target: target(),
          props: {
            trajectory: run,
            show_controls: `always`,
            on_controller: (next: TrajectoryController | null) => (held.controller = next),
          },
        }),
      )
      flushSync()
      expect(held.controller?.state().total_frames).toBe(frames.length)
    }
    await measure(`Trajectory 100x64 mount`, mount_trajectory)

    const switch_timings: number[] = []
    for (let rep = 0; rep < 5; rep++) {
      mount_trajectory()
      await tick()
      switch_timings.push(
        await time_once(async () => {
          for (let step = 1; step <= 100; step++) {
            held.controller?.set_step(step % frames.length)
            flushSync()
            await tick()
          }
        }),
      )
      expect(held.controller?.state().current_step_idx).toBe(100 % frames.length)
      await cleanup()
    }
    assert_within_band(`Trajectory 100 frame switches`, switch_timings)
  })

  // #438 timed 10k keys in a browser; happy-dom spends ~30 KB of heap per rendered element
  // (7 per key), so 10k keys would blow the 4 GB worker heap. 2k keys is the same code path.
  test(`JsonTree 2k keys mount`, async () => {
    // JsonNode pages children 100 at a time, so spread the 2k keys over 20 expanded groups
    const value = Object.fromEntries(
      Array.from({ length: 20 }, (_, idx) => [`group_${idx}`, make_json(100)]),
    )
    await measure(`JsonTree 2k keys mount`, () => {
      // default auto_fold_objects (20) would collapse the groups and render one node each
      mounted.push(
        mount(JsonTree, {
          target: target(),
          props: { value, default_fold_level: 2, auto_fold_objects: Infinity },
        }),
      )
      flushSync()
      expect(document.querySelectorAll(`.json-node`).length).toBeGreaterThanOrEqual(2000)
    })
  })

  test(`HeatmapTable 10k x 30 virtual mount`, async () => {
    const { columns, data } = make_table(10_000, 30)
    await measure(`HeatmapTable 10k x 30 virtual mount`, async () => {
      mounted.push(
        mount(HeatmapTable, {
          target: target(),
          props: { data, columns, virtual: true, show_row_numbers: true },
        }),
      )
      flushSync()
      await tick()
      // data rows, not the virtual spacers (which also render as <tr>)
      expect(document.querySelectorAll(`tbody tr[data-row-idx]`).length).toBeGreaterThan(0)
    })
  })

  // Large enough that the median is work, not GC noise: a ~3 ms unit sat at 1.3-1.4x its
  // scaled baseline on CI while every other case sat near 1x. Baseline measured in suite
  // order (after the mounts above, which leave the heap fuller than an isolated run: 26 vs 20 ms)
  test(`e_above_hull 10k ternary entries`, async () => {
    const entries = make_entries(10_000)
    await measure(`e_above_hull 10k ternary entries`, () => {
      const distances = calculate_e_above_hull(entries, entries)
      expect(Object.keys(distances)).toHaveLength(10_000)
      expect(Object.values(distances).every((dist) => dist >= 0)).toBe(true)
    })
  })

  test(`CHGCAR 80x80x96 parse`, async () => {
    const text = make_chgcar([80, 80, 96])
    await measure(`CHGCAR 80x80x96 parse`, () => {
      const parsed = parse_chgcar(text)
      expect(parsed?.volumes[0].dims).toEqual([80, 80, 96])
    })
  })

  test(`marching cubes 64^3`, async () => {
    const grid = make_grid(64)
    await measure(`marching cubes 64^3`, () => {
      const { positions, indices } = marching_cubes(grid, 0, IDENTITY_MATRIX3)
      expect(positions.length).toBeGreaterThan(3 * 10_000)
      expect(indices.length % 3).toBe(0)
    })
  })

  test(`neighbor_query 1792 sites`, async () => {
    // jittered 8x8x7 fcc supercell (4 atoms per conventional cell, a = 4.05 A)
    const structure = with_random_displacements(make_fcc([8, 8, 7], 4.05), 0.04, 8)
    expect(structure.sites).toHaveLength(1792)
    await measure(`neighbor_query 1792 sites`, () => {
      const list = neighbor_query(structure, { cutoff: 3.2 })
      // fcc first shell: 12 neighbours per site inside 3.2 A for a = 4.05 A
      expect(list.offsets[1792]).toBe(12 * 1792)
    })
  })

  test(`XRD 444 sites`, async () => {
    const structure = make_disordered_cell(444)
    await measure(`XRD 444 sites`, () => {
      const pattern = compute_xrd_pattern(structure, { wavelength: `CuKa` })
      expect(pattern.x.length).toBeGreaterThan(0)
    })
  })

  // Detection is linear in site count; an accidental O(N^2) over sites or bonds lands near
  // 8x the 1000-site cost per site, far outside the 2x band
  test(`polyhedra 10x10x10 rocksalt supercell (8000 sites)`, async () => {
    const supercell = make_supercell(make_rocksalt(), [10, 10, 10])
    const bonds = electroneg_ratio(supercell)
    const polyhedra = compute_polyhedra(supercell, bonds)
    expect(polyhedra.length).toBeGreaterThan(500) // most interior Na render
    await measure(`polyhedra 8000-site detect`, () => {
      expect(compute_polyhedra(supercell, bonds)).toHaveLength(polyhedra.length)
    })
    await measure(`polyhedra 8000-site buffer merge`, () => {
      expect(
        merge_polyhedra_buffers(polyhedra, () => `#ff0000`).triangle_count,
      ).toBeGreaterThan(0)
    })
  })

  test(`quickhull 4D 775 entries`, async () => {
    const points = make_hull_points(775)
    await measure(`quickhull 4D 775 entries`, () => {
      expect(compute_lower_hull_nd(points).length).toBeGreaterThan(20)
    })
  })

  test(`density binning 1M points`, async () => {
    const series = make_dense_series(1_000_000)
    await measure(`density binning 1M points`, () => {
      const result = bin_points(series, [0, 1], [0, 1], 512, 512)
      expect(result.visible_count).toBe(1_000_000)
    })
  })

  test(`neighbor_query 39304 sites + flyaway atom`, async () => {
    const edge = 34
    const cloud = make_flyaway_cloud(edge, 1e9)
    await measure(`neighbor_query 39304 sites + flyaway atom`, () => {
      const list = neighbor_query(cloud, { cutoff: 1.2 })
      // cubic grid at 1.1 A: 3 edge^2 (edge - 1) axis-adjacent pairs, each listed from both ends
      expect(list.neighbors).toHaveLength(6 * edge ** 2 * (edge - 1))
    })
  })

  // 1000 atoms took 60 s before the coordination rewrite and ~0.4 ms after, too little to
  // time above GC noise; a 30^3 grid keeps the same code path measurable. The first calls
  // run unoptimized (measured 217, 26, 9.5, 162, 41 ... 6 ms), so two warm-ups precede timing.
  test(`coordination colors 27000 atoms`, async () => {
    const edge = 30
    const structure = make_struct(
      cubic_grid(edge, 1.5).map((xyz, idx) => ({ xyz, element: idx % 2 ? `O` : `C` })),
      edge * 1.5,
    )
    for (let warm_up = 0; warm_up < 2; warm_up++) get_coordination_colors(structure)
    await measure(`coordination colors 27000 atoms`, () => {
      expect(get_coordination_colors(structure).colors).toHaveLength(edge ** 3)
    })
  })

  // 3x3x3 of 1000 sites: 4x4x4 (64k sites) spent most reps in major GC (18 ms to 2.9 s)
  test(`make_supercell 1000 sites x 3x3x3`, async () => {
    const structure = make_crystal(
      1,
      Array.from({ length: 1000 }, (_, idx) => ({
        element: `H`,
        abc: [(idx % 10) / 10, (idx % 100) / 100, idx / 1000] as Vec3,
      })),
    )
    await measure(`make_supercell 1000 sites x 3x3x3`, () => {
      expect(make_supercell(structure, `3x3x3`).sites).toHaveLength(27_000)
    })
  })
})
