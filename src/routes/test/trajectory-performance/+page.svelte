<script lang="ts">
  // Playwright perf harness: a seeded synthetic MD run built in-page from URL params
  // (?frames=300&atoms=64), so the spec needs no fixture file. Mount and per-frame timings
  // are published in the DOM for the test to read.
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import type { Pbc } from '$lib/structure/pbc'
  import { Trajectory, type TrajectoryFrame, trajectory_from_frames } from '$lib/trajectory'
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { onMount } from 'svelte'

  // url.searchParams is off-limits during prerender (it would 500 the static build) and the
  // run is only meaningful in a browser anyway, so the defaults stand until the client runs
  const n_frames = browser ? Number(page.url.searchParams.get(`frames`) ?? 300) : 300
  const n_atoms = browser ? Number(page.url.searchParams.get(`atoms`) ?? 64) : 64

  // mulberry32 so every run sees identical coordinates
  const make_rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }

  const build_frames = (): TrajectoryFrame[] => {
    const rng = make_rng(7)
    const cell = 2.2 * Math.cbrt(n_atoms)
    const matrix: math.Matrix3x3 = [
      [cell, 0, 0],
      [0, cell, 0],
      [0, 0, cell],
    ]
    const pbc: Pbc = [true, true, true]
    const lattice = { matrix, pbc, ...math.calc_lattice_params(matrix) }
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
          return {
            species: [
              {
                element: atom_idx % 4 === 0 ? `Zn` : atom_idx % 4 === 1 ? `O` : `C`,
                occu: 1,
                oxidation_state: 0,
              },
            ],
            abc,
            xyz: abc.map((coord) => coord * cell) as Vec3,
            label: `site${atom_idx}`,
            properties: {},
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

  let mount_ms = $state<number | null>(null)
  let current_step_idx = $state(0)
  onMount(() => {
    mount_ms = performance.now() - build_start - (build_ms ?? 0)
  })
</script>

{#if run}
  <Trajectory
    trajectory={run}
    bind:current_step_idx
    auto_play
    fps={30}
    show_controls="always"
  />
{/if}

<pre data-testid="perf-metrics">{JSON.stringify({
    frames: n_frames,
    atoms: n_atoms,
    build_ms,
    mount_ms,
    current_step_idx,
  })}</pre>
