<script lang="ts">
  // Playwright perf harness: a seeded synthetic MD run built in-page from URL params
  // (?frames=300&atoms=64), so the spec needs no fixture file. Mount and per-frame timings
  // are published in the DOM for the test to read. `prepare=worker` prepares frames in the
  // pool host-served (VS Code) runs use, so playback exercises their main-thread path.
  import type { ElementSymbol } from '#lib/element/index'
  import type { Vec3 } from '#lib/math'
  import * as math from '#lib/math'
  import type { Pbc } from '#lib/structure/pbc'
  import type { TrajectoryFrame } from '#lib/trajectory/index'
  import { Trajectory, trajectory_from_frames } from '#lib/trajectory/index'
  import { browser } from '$app/env'
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import TestSection from '../TestSection.svelte'
  import TestStatus from '../TestStatus.svelte'
  import { host_prepare_transfers, type HostPrepareInput } from '#lib/file-viewer/host-bridge'
  import { create_prepare_pool } from '#lib/trajectory/prepare-pool'
  import type { TrajectoryRun } from '#lib/trajectory/run'
  import { host_read_concurrency } from '#lib/trajectory/runs/host'

  // url.searchParams is off-limits during prerender (it would 500 the static build) and the
  // run is only meaningful in a browser anyway, so the defaults stand until the client runs
  const n_frames = browser ? Number(page.url.searchParams.get(`frames`) ?? 300) : 300
  const n_atoms = browser ? Number(page.url.searchParams.get(`atoms`) ?? 64) : 64
  const fps = browser ? Number(page.url.searchParams.get(`fps`) ?? 30) : 30
  const worker_prepare = browser && page.url.searchParams.get(`prepare`) === `worker`
  // `elements=Cu` makes a one-element run (uniform bond colors, no polyhedra)
  const elements = ((browser && page.url.searchParams.get(`elements`)) || `Zn,O,C,C`).split(
    `,`,
  ) as ElementSymbol[]
  // `vectors=1` gives every site a force, drawn as one arrow per atom
  const with_vectors = browser && page.url.searchParams.has(`vectors`)
  // Structure props as JSON, e.g. ?structure={"show_image_atoms":true,"scene_props":{...}}
  // an empty ?structure= counts as absent; invalid JSON fails loudly
  const structure_param = browser ? page.url.searchParams.get(`structure`) : null
  const structure_props = structure_param ? JSON.parse(structure_param) : {}

  const build_frames = (): TrajectoryFrame[] => {
    const rng = math.mulberry32(7) // seeded so every run sees identical coordinates
    const cell = 2.2 * Math.cbrt(n_atoms)
    const matrix: math.Matrix3x3 = [
      [cell, 0, 0],
      [0, cell, 0],
      [0, 0, cell],
    ]
    const pbc: Pbc = [true, true, true]
    const lattice = { matrix, pbc, ...math.compute_lattice_params(matrix) }
    const base = Array.from({ length: n_atoms }, () => [rng(), rng(), rng()] as Vec3)
    return Array.from({ length: n_frames }, (_, frame_idx) => ({
      step: frame_idx,
      metadata: { energy: -4 * n_atoms - Math.sin(frame_idx / 20), force_max: 0.5 + rng() },
      structure: {
        lattice,
        sites: base.map((abc_0, atom_idx) => {
          const abc = abc_0.map(
            (coord) => (coord + 0.002 * frame_idx + 0.01 * (rng() - 0.5) + 1) % 1,
          ) as Vec3
          const element = elements[atom_idx % elements.length]
          return {
            species: [{ element, occu: 1 }],
            abc,
            xyz: abc.map((coord) => coord * cell) as Vec3,
            // standard labels keep frames numeric (atomic numbers, no per-site records), as
            // file readers and host-served frames produce them
            label: `${element}${atom_idx + 1}`,
            properties: with_vectors
              ? { forces: [rng() - 0.5, rng() - 0.5, rng() - 0.5] }
              : {},
          }
        }),
      },
    }))
  }

  // Built on the client only: the prerendered HTML is just the empty harness shell
  const build_start = browser ? performance.now() : 0
  const run = browser
    ? trajectory_from_frames(build_frames(), {
        provenance: { filename: `synthetic-${n_frames}x${n_atoms}.extxyz`, format: `xyz` },
        time_step: { value: 1, unit: `fs` },
      })
    : null
  const build_ms = browser ? performance.now() - build_start : null
  // its workers end with the page, not after idling past a navigation away
  const pool =
    run && worker_prepare
      ? create_prepare_pool<HostPrepareInput>({
          create_worker: () =>
            new Worker(
              new URL(`../../../lib/file-viewer/host-prepare-worker.ts`, import.meta.url),
              { type: `module` },
            ),
          transfers: host_prepare_transfers,
        })
      : undefined
  // memory frames are borrowed, so the pool gets a copy to take; reads ahead like a host run
  if (run && pool)
    Object.assign(run, {
      read_concurrency: host_read_concurrency(n_atoms),
      prepare_frame: async (idx, preparation, signal) =>
        pool.prepare(
          { frame: structuredClone(await run.read_frame(idx)) },
          preparation,
          signal,
        ),
    } satisfies Partial<TrajectoryRun>)

  let mount_ms = $state<number | null>(null)
  let current_step_idx = $state(0)
  onMount(() => {
    mount_ms = performance.now() - build_start - (build_ms ?? 0)
    return () => pool?.dispose()
  })
</script>

<h1>Trajectory performance test page</h1>

<TestSection
  title="Synthetic run"
  description="{n_frames} frames × {n_atoms} atoms, auto-playing"
>
  {#if run}
    <Trajectory
      trajectory={run}
      bind:current_step_idx
      auto_play
      {fps}
      {structure_props}
      show_controls="always"
    />
  {/if}
</TestSection>

<TestStatus
  values={{
    'perf-metrics': JSON.stringify({
      frames: n_frames,
      atoms: n_atoms,
      build_ms,
      mount_ms,
      current_step_idx,
    }),
  }}
/>
