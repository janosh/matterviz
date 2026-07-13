<script lang="ts">
  import Isosurface from '$lib/isosurface/Isosurface.svelte'
  import type { IsosurfaceProfileEvent, IsosurfaceProfiler } from '$lib/isosurface/profile'
  import type {
    IsosurfaceLayer,
    IsosurfaceSettings,
    VolumetricData,
  } from '$lib/isosurface/types'
  import { DEFAULT_ISOSURFACE_SETTINGS, grid_data_range } from '$lib/isosurface/types'
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import { Canvas, T } from '@threlte/core'
  import { onMount } from 'svelte'

  const lattice: Matrix3x3 = [
    [4, 0, 0],
    [0.6, 3.8, 0],
    [0.2, 0.3, 4.2],
  ]
  type RangeMode = `fractional` | `integer` | `unit`
  const display_ranges = {
    fractional: [
      [-0.15, 1.2],
      [-0.1, 1.1],
      [0, 1],
    ],
    integer: [
      [0, 2],
      [0, 1],
      [0, 1],
    ],
    unit: undefined,
  } satisfies Record<RangeMode, IsosurfaceSettings[`display_range`]>

  let grid_size = $state(48)
  let layer_count = $state(1)
  let range_mode = $state<RangeMode>(`unit`)
  let color_mode = $state<`cross_grid` | `same_grid`>(`cross_grid`)
  let volumes = $state.raw<VolumetricData[]>([])
  let settings = $state<IsosurfaceSettings>({ ...DEFAULT_ISOSURFACE_SETTINGS, layers: [] })
  let profile_events: IsosurfaceProfileEvent[] = []
  let event_count = $state(0)
  let fps = $state<number | undefined>()
  let heap_bytes = $state<number | undefined>()
  let animation_angle = $state(0)

  function make_volume(size: number, kind: `density` | `color`): VolumetricData {
    const grid: number[][][] = Array(size)
    for (let x_idx = 0; x_idx < size; x_idx++) {
      const x_frac = x_idx / size
      const x_delta = Math.min(Math.abs(x_frac - 0.5), 1 - Math.abs(x_frac - 0.5))
      const plane: number[][] = Array(size)
      for (let y_idx = 0; y_idx < size; y_idx++) {
        const y_frac = y_idx / size
        const y_delta = Math.min(Math.abs(y_frac - 0.5), 1 - Math.abs(y_frac - 0.5))
        const row: number[] = Array(size)
        for (let z_idx = 0; z_idx < size; z_idx++) {
          const z_frac = z_idx / size
          const z_delta = Math.min(Math.abs(z_frac - 0.5), 1 - Math.abs(z_frac - 0.5))
          row[z_idx] =
            kind === `density`
              ? Math.exp(-(x_delta ** 2 + y_delta ** 2 + z_delta ** 2) / 0.045)
              : Math.sin(2 * Math.PI * x_frac) -
                0.7 * Math.cos(2 * Math.PI * y_frac) +
                0.35 * Math.sin(4 * Math.PI * z_frac)
        }
        plane[y_idx] = row
      }
      grid[x_idx] = plane
    }
    return {
      grid,
      grid_dims: [size, size, size],
      lattice,
      origin: [0, 0, 0],
      data_range: grid_data_range(grid),
      periodic: true,
      label: kind,
    }
  }

  function make_layers(count: number): IsosurfaceLayer[] {
    return Array.from({ length: count }, (_, layer_idx) => ({
      isovalue: 0.16 + layer_idx * (0.55 / count),
      color: `#3b82f6`,
      negative_color: `#ef4444`,
      opacity: Math.max(0.25, 0.8 - layer_idx * 0.08),
      visible: true,
      show_negative: false,
      volume_idx: 0,
      color_volume_idx: color_mode === `same_grid` ? 0 : 1,
      colormap: `interpolateRdBu`,
    }))
  }

  function rebuild_scenario(): void {
    profile_events = []
    event_count = 0
    const color_grid_size =
      color_mode === `cross_grid` ? Math.max(8, grid_size - 11) : grid_size
    volumes = [make_volume(grid_size, `density`), make_volume(color_grid_size, `color`)]
    settings = {
      ...DEFAULT_ISOSURFACE_SETTINGS,
      layers: make_layers(layer_count),
      display_range: display_ranges[range_mode],
    }
  }

  const profiler: IsosurfaceProfiler = (event) => {
    profile_events.push(event)
    event_count = profile_events.length
    if (event.stage === `rebuild_total` || event.stage === `recolor_total`) {
      heap_bytes = (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize
    }
  }

  function change_isovalue(): void {
    const layers = settings.layers ?? []
    if (!layers[0]) return
    layers[0].isovalue = layers[0].isovalue >= 0.24 ? 0.18 : layers[0].isovalue + 0.01
  }

  function recolor(): void {
    const layers = settings.layers ?? []
    if (!layers[0]) return
    layers[0].colormap =
      layers[0].colormap === `interpolateRdBu` ? `interpolateViridis` : `interpolateRdBu`
  }

  async function measure_fps(): Promise<void> {
    fps = undefined
    const duration_ms = 1000
    let frames = 0
    const start_time = performance.now()
    await new Promise<void>((resolve) => {
      const frame = (timestamp: number): void => {
        frames++
        animation_angle += 0.03
        if (timestamp - start_time >= duration_ms) resolve()
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    fps = (frames * 1000) / (performance.now() - start_time)
  }

  onMount(() => {
    const params = new URLSearchParams(globalThis.location.search)
    const requested_size = Math.round(Number(params.get(`size`)) || grid_size)
    const requested_layers = Math.round(Number(params.get(`layers`)) || layer_count)
    grid_size = Math.min(160, Math.max(8, requested_size))
    layer_count = Math.min(12, Math.max(1, requested_layers))
    const requested_range = params.get(`range`)
    const requested_color = params.get(`color`)
    if ([`unit`, `integer`, `fractional`].includes(requested_range ?? ``)) {
      range_mode = requested_range as typeof range_mode
    }
    if ([`same_grid`, `cross_grid`].includes(requested_color ?? ``)) {
      color_mode = requested_color as typeof color_mode
    }
    rebuild_scenario()
  })
</script>

<button data-testid="change-isovalue" onclick={change_isovalue}>Change isovalue</button>
<button data-testid="recolor" onclick={recolor}>Recolor only</button>
<button data-testid="measure-fps" onclick={measure_fps}>Measure FPS</button>

<div class="benchmark-canvas" data-testid="isosurface-benchmark-canvas">
  {#if volumes.length}
    <Canvas>
      <T.PerspectiveCamera makeDefault position={[2, 2, 12] satisfies Vec3} />
      <T.AmbientLight intensity={1.4} />
      <T.DirectionalLight position={[5, 8, 10]} intensity={2} />
      <T.Group rotation={[0, animation_angle, 0]}>
        <Isosurface {volumes} {settings} {profiler} />
      </T.Group>
    </Canvas>
  {/if}
</div>

<span hidden data-testid="profile-fps">{fps?.toFixed(2) ?? `pending`}</span>
<span hidden data-testid="profile-heap">{heap_bytes ?? `unsupported`}</span>
<pre hidden data-testid="profile-events">{JSON.stringify(
    profile_events.slice(0, event_count),
  )}</pre>

<style>
  .benchmark-canvas {
    width: min(800px, 100%);
    height: 500px;
    margin-block: 1rem;
    background: #111827;
  }
</style>
