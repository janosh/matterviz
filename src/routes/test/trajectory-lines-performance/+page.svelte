<script lang="ts">
  // Trajectory-trail performance harness. Generates a synthetic MD run of a given
  // atom x frame size, wraps every coordinate into the cell (so the PBC unwrap is exercised,
  // not bypassed), and renders it through the same Structure -> StructureScene ->
  // TrajectoryLines path the trajectory viewer uses.
  //
  // Two numbers are measured here, and they are different things:
  // - "build" is the CPU cost of build_trajectory_lines, i.e. rebuilding the whole trail
  //   buffer from scratch. Playback pays it once per frame.
  // - "frame" is the wall-clock interval between rendered frames while the scene animates.
  //   It is vsync-capped at ~16.7 ms, so a reading pinned there means the layer has headroom
  //   left, not that it costs 16.7 ms.
  import type { Crystal, ElementSymbol, Vec3 } from '$lib'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { format_num } from '$lib/labels'
  import type { Matrix3x3 } from '$lib/math'
  import Structure from '$lib/structure/Structure.svelte'
  import type {
    TrajectoryLineColorMode,
    TrajectoryLinesStats,
    TrajectoryLineWrapMode,
  } from '$lib/structure/trajectory-lines'
  import { build_trajectory_lines } from '$lib/structure/trajectory-lines'
  import type { TrajectoryPositionStream } from '$lib/trajectory'
  import type { ComponentProps } from 'svelte'

  // Mobile species first so the element filter has something meaningful to narrow to
  const SPECIES: ElementSymbol[] = [`Li`, `O`]

  let n_atoms = $state(500)
  let n_frames = $state(5000)
  let trail_frames = $state(0)
  let frame_stride = $state(1)
  let opacity = $state(0.85)
  let color_mode = $state<TrajectoryLineColorMode>(`element`)
  let wrap_mode = $state<TrajectoryLineWrapMode>(`unwrap`)
  let only_lithium = $state(false)
  let show_atoms = $state(true)
  let show_trajectory_lines = $state(true)
  let auto_rotate = $state(0)
  let playing = $state(false)
  let end_frame = $state(0)
  let generating = $state(false)
  let stream = $state<TrajectoryPositionStream | null>(null)
  let build_ms = $state<number | null>(null)
  let frame_ms = $state<number | null>(null)
  let worst_frame_ms = $state<number | null>(null)
  let trajectory_lines_result = $state<TrajectoryLinesStats | null>(null)

  // Cell side scaled so the atom density stays physical (~0.05 atoms/A^3) as the count grows.
  // Read off the generated stream, not the input box, so editing the atom count without
  // regenerating cannot leave the rendered cell disagreeing with the coordinates in it.
  const cell_side_for = (atoms: number) => Math.max(10, Math.cbrt(atoms / 0.05))
  let cell_side = $derived(cell_side_for(stream?.n_atoms ?? n_atoms))

  // Random walk with a per-atom drift, wrapped into the cell. Li steps ~5x further per frame
  // than O, so the two species read very differently once trails are on.
  function generate_stream(atoms: number, frames: number): TrajectoryPositionStream {
    const side = cell_side_for(atoms)
    const lattice: Matrix3x3 = [
      [side, 0, 0],
      [0, side, 0],
      [0, 0, side],
    ]
    const positions = new Float64Array(frames * atoms * 3)
    const elements: ElementSymbol[] = Array.from(
      { length: atoms },
      (_, atom_idx) => SPECIES[atom_idx % SPECIES.length],
    )
    const step_size = Array.from(elements, (element) => (element === `Li` ? 0.25 : 0.05))
    // Frame 0: atoms on a jittered cubic grid
    const per_edge = Math.ceil(Math.cbrt(atoms))
    const spacing = side / per_edge
    for (let atom_idx = 0; atom_idx < atoms; atom_idx++) {
      const grid_z = Math.trunc(atom_idx / (per_edge * per_edge))
      const remainder = atom_idx - grid_z * per_edge * per_edge
      const grid_y = Math.trunc(remainder / per_edge)
      const grid_x = remainder - grid_y * per_edge
      positions.set(
        [grid_x, grid_y, grid_z].map((grid) => (grid + 0.5) * spacing),
        atom_idx * 3,
      )
    }
    for (let frame_idx = 1; frame_idx < frames; frame_idx++) {
      const prev_base = (frame_idx - 1) * atoms * 3
      const base = frame_idx * atoms * 3
      for (let atom_idx = 0; atom_idx < atoms; atom_idx++) {
        const step = step_size[atom_idx]
        for (let axis = 0; axis < 3; axis++) {
          const offset = atom_idx * 3 + axis
          const moved = positions[prev_base + offset] + (Math.random() - 0.5) * 2 * step
          // Wrap back into [0, side) exactly as an MD code writing wrapped coords would
          positions[base + offset] = moved - Math.floor(moved / side) * side
        }
      }
    }
    return {
      positions,
      n_frames: frames,
      n_atoms: atoms,
      elements,
      lattice_matrices: Array.from({ length: frames }, () => lattice),
      pbc: [true, true, true],
      coords_unwrapped: false,
      frame_stride: 1,
      steps: Array.from({ length: frames }, (_, idx) => idx),
    }
  }

  async function regenerate() {
    generating = true
    playing = false
    build_ms = null
    // Yield so the spinner paints before the (synchronous, multi-hundred-ms) generation
    await new Promise((resolve) => setTimeout(resolve, 0))
    stream = generate_stream(n_atoms, n_frames)
    end_frame = n_frames - 1
    generating = false
  }

  // The structure rendered alongside the trails: the atoms at `end_frame`
  let current_structure = $derived.by((): Crystal | undefined => {
    const frames = stream
    if (!frames) return undefined
    const side = cell_side
    const base = end_frame * frames.n_atoms * 3
    return {
      lattice: {
        matrix: [
          [side, 0, 0],
          [0, side, 0],
          [0, 0, side],
        ],
        a: side,
        b: side,
        c: side,
        alpha: 90,
        beta: 90,
        gamma: 90,
        pbc: [true, true, true],
        volume: side ** 3,
      },
      sites: Array.from({ length: frames.n_atoms }, (_, atom_idx) => {
        const offset = base + atom_idx * 3
        const xyz = [
          frames.positions[offset],
          frames.positions[offset + 1],
          frames.positions[offset + 2],
        ] as Vec3
        const element = frames.elements[atom_idx]
        return {
          species: [{ element, occu: 1, oxidation_state: 0 }],
          abc: xyz.map((coord) => coord / side) as Vec3,
          xyz,
          label: `${element}${atom_idx + 1}`,
          properties: {},
        }
      }),
      charge: 0,
    }
  })

  let line_options = $derived({
    end_frame,
    trail_frames: trail_frames || null,
    frame_stride,
    elements: only_lithium ? ([`Li`] as ElementSymbol[]) : null,
    color_mode,
    wrap_mode,
  })

  let scene_props = $derived<ComponentProps<typeof Structure>[`scene_props`]>({
    show_atoms,
    // Bonds and polyhedra off: both are O(n_atoms) recomputes on every structure change and
    // would dominate the numbers this page exists to measure
    show_bonds: `never`,
    show_polyhedra: `never`,
    auto_rotate,
    trajectory_position_stream: stream,
    show_trajectory_lines,
    trajectory_line_end_frame: end_frame,
    trajectory_line_trail_frames: trail_frames,
    trajectory_line_frame_stride: frame_stride,
    trajectory_line_elements: line_options.elements,
    trajectory_line_color_mode: color_mode,
    trajectory_line_wrap_mode: wrap_mode,
    trajectory_line_opacity: opacity,
  })

  // Best of 5, mirroring polyhedra.test.ts: a single cold call measures JIT warm-up and GC,
  // not the algorithm. The unwrap pass is memoized per stream, so the first call after a
  // regenerate is slower — that cost is reported separately below.
  function benchmark_build() {
    if (!stream) return
    let best = Infinity
    for (let rep = 0; rep < 5; rep++) {
      const start = performance.now()
      build_trajectory_lines(stream, line_options)
      best = Math.min(best, performance.now() - start)
    }
    build_ms = best
  }

  // Rolling rAF interval while the scene animates. Threlte renders on demand, so this is
  // only meaningful with auto-rotate on or playback running.
  $effect(() => {
    if (!auto_rotate && !playing) return
    let handle = 0
    let last = performance.now()
    let sum = 0
    let count = 0
    let worst = 0
    const tick = () => {
      const now = performance.now()
      const delta = now - last
      last = now
      // Skip the first interval after (re)starting, which includes the scene's setup work
      if (count > 0 || delta < 200) {
        sum += delta
        count++
        worst = Math.max(worst, delta)
      }
      if (count >= 60) {
        frame_ms = sum / count
        worst_frame_ms = worst
        sum = 0
        count = 0
        worst = 0
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  })

  // Playback advances the playhead one collected frame per rendered frame, which rebuilds
  // the whole trail buffer every frame — the worst case the layer has to survive
  $effect(() => {
    if (!playing || !stream) return
    const total = stream.n_frames
    let handle = requestAnimationFrame(function step() {
      end_frame = (end_frame + 1) % total
      handle = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(handle)
  })

  $effect(() => {
    regenerate()
  })
</script>

<h1>Trajectory Lines Performance Test</h1>

<div class="controls">
  <label>
    Atoms
    <input type="number" bind:value={n_atoms} min="1" max="5000" step="100" />
  </label>
  <label>
    Frames
    <input type="number" bind:value={n_frames} min="2" max="20000" step="500" />
  </label>
  <button type="button" onclick={regenerate} disabled={generating}>Regenerate</button>
  {#each [[100, 500], [500, 5000], [2000, 5000]] as [atoms, frames] (`${atoms}x${frames}`)}
    <button
      type="button"
      onclick={() => {
        n_atoms = atoms
        n_frames = frames
        regenerate()
      }}
    >
      {atoms} x {frames}
    </button>
  {/each}
</div>

<div class="controls">
  <label>
    Trail length
    <input type="number" bind:value={trail_frames} min="0" max={n_frames} step="50" />
    <small>0 = full run</small>
  </label>
  <label>
    Frame stride
    <input type="number" bind:value={frame_stride} min="1" max="500" step="1" />
  </label>
  <label>
    Opacity
    <input type="range" bind:value={opacity} min="0.05" max="1" step="0.05" />
  </label>
  <label>
    Color by
    <select bind:value={color_mode}>
      <option value="element">Element</option>
      <option value="time">Time</option>
    </select>
  </label>
  <label>
    Boundaries
    <select bind:value={wrap_mode}>
      <option value="unwrap">Unwrap</option>
      <option value="break">Break at crossings</option>
    </select>
  </label>
</div>

<div class="controls">
  <label><input type="checkbox" bind:checked={show_trajectory_lines} /> Trails</label>
  <label><input type="checkbox" bind:checked={only_lithium} /> Li trails only</label>
  <label><input type="checkbox" bind:checked={show_atoms} /> Atoms</label>
  <label>
    <input
      type="checkbox"
      checked={auto_rotate > 0}
      onchange={(evt) => (auto_rotate = evt.currentTarget.checked ? 0.5 : 0)}
    />
    Auto-rotate
  </label>
  <label>
    <input type="checkbox" bind:checked={playing} />
    Play (rebuilds the trail every frame)
  </label>
  <label>
    Frame {end_frame}
    <input
      type="range"
      bind:value={end_frame}
      min="0"
      max={Math.max(0, (stream?.n_frames ?? 1) - 1)}
      step="1"
    />
  </label>
  <button type="button" onclick={benchmark_build} disabled={!stream}>Benchmark build</button>
</div>

<div class="readout" data-testid="trajectory-lines-readout">
  {#if trajectory_lines_result}
    {@const { point_count, segment_count, atom_count, max_segment_length } =
      trajectory_lines_result}
    <span>atoms <strong>{format_num(atom_count, `.4~s`)}</strong></span>
    <span>vertices <strong>{format_num(point_count, `.4~s`)}</strong></span>
    <span>segments <strong>{format_num(segment_count, `.4~s`)}</strong></span>
    <span>draw calls <strong>1</strong></span>
    <span>
      GPU bytes
      <strong>{format_num(point_count * 24 + segment_count * 8, `.3~s`)}</strong>
    </span>
    <span>max step <strong>{format_num(max_segment_length, `.3~f`)} Å</strong></span>
  {/if}
  {#if build_ms !== null}
    <span>build <strong>{format_num(build_ms, `.3~f`)} ms</strong></span>
  {/if}
  {#if frame_ms !== null}
    <span>
      frame <strong>{format_num(frame_ms, `.3~f`)} ms</strong>
      ({format_num(1000 / frame_ms, `.3~f`)} fps, worst {format_num(
        worst_frame_ms ?? 0,
        `.3~f`,
      )} ms)
    </span>
  {/if}
</div>

{#if generating}
  <Spinner text="Generating {n_atoms} atoms x {n_frames} frames..." />
{:else if current_structure}
  <Structure
    structure={current_structure}
    {scene_props}
    bind:trajectory_lines_result
    show_controls
    class="full-bleed"
    style="height: min(70vh, 1000px)"
  />
{/if}

<style>
  h1 {
    margin-bottom: 1.5rem;
  }
  .controls {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
    align-items: center;
  }
  label {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }
  .readout {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.85em;
  }
</style>
