<script lang="ts">
  import VolumeSlice from '$lib/isosurface/VolumeSlice.svelte'
  import { matrix_inverse_3x3, type Vec3 } from '$lib/math'
  import { format_num } from '$lib/labels'
  import {
    hotspot_display_values,
    hotspot_bin,
    hotspot_slice,
    type HotspotMetric,
    type HotspotResult,
  } from './hotspots'

  let {
    result,
    metric = `energy`,
    min_atoms = 1,
    threshold = 1.25,
  }: {
    result: HotspotResult
    metric?: HotspotMetric
    min_atoms?: number
    threshold?: number
  } = $props()
  let axis = $state(2)
  let position = $state(0)
  let selected = $state<number>()
  let only_hot = $state(false)
  const { values, mean } = $derived(hotspot_display_values(result, metric, min_atoms))
  const unit = $derived(metric === `energy` ? `eV/atom` : `K`)
  const layer = $derived(Math.min(position, result.grid.dims[axis] - 1))
  const axes = $derived([0, 1, 2].filter((value) => value !== axis))
  const slice = $derived(
    hotspot_slice(result.grid, values, axis, layer, only_hot ? mean * threshold : -Infinity),
  )
  function inspect(event: MouseEvent): void {
    const canvas = (event.currentTarget as HTMLElement).querySelector(`canvas`)
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX >= rect.right ||
      event.clientY < rect.top ||
      event.clientY >= rect.bottom
    )
      return
    const coord_u =
      slice.u_range[0] +
      ((event.clientX - rect.left) / rect.width) * (slice.u_range[1] - slice.u_range[0])
    const coord_v =
      slice.v_range[1] -
      ((event.clientY - rect.top) / rect.height) * (slice.v_range[1] - slice.v_range[0])
    const xyz = slice.point.map(
      (value, idx) => value + slice.u_axis[idx] * coord_u + slice.v_axis[idx] * coord_v,
    ) as Vec3
    // The displayed parallelogram is a single cell even when its source is periodic.
    const grid = { ...result.grid, pbc: [false, false, false] as const }
    const bin = hotspot_bin(xyz, 0, grid, matrix_inverse_3x3(grid.cell))
    selected = bin < 0 ? undefined : bin
  }
</script>

<div class="hotspot-slice">
  <div class="slice-controls">
    <label
      >Fixed fractional axis <select bind:value={axis} aria-label="Hotspot slice normal"
        ><option value={0}>a</option><option value={1}>b</option><option value={2}>c</option
        ></select
      ></label
    >
    <label
      >Layer {layer + 1}/{result.grid.dims[axis]}
      <input
        type="range"
        min="0"
        max={result.grid.dims[axis] - 1}
        step="1"
        bind:value={position}
        aria-label="Hotspot slice layer"
      /></label
    >
    <label><input type="checkbox" bind:checked={only_hot} /> Only hotspots</label>
  </div>
  <div
    role="button"
    tabindex="0"
    aria-label="Inspect hotspot bin"
    onclick={inspect}
    onkeydown={(event) => {
      if (event.key === `Enter`) {
        const coordinates = [0, 0, 0]
        coordinates[axis] = layer
        selected =
          (coordinates[0] * result.grid.dims[1] + coordinates[1]) * result.grid.dims[2] +
          coordinates[2]
      }
    }}
  >
    <VolumeSlice
      {slice}
      mode="filled"
      colormap="interpolateInferno"
      color_range={[0, Math.max(mean * 2, Number.EPSILON)]}
      colorbar_title={unit}
      symmetric={false}
    />
  </div>
  <p>
    Cell-aligned cross-section ({`abc`[axes[0]]}/{`abc`[axes[1]]}), preserving cell angles.
    Bins are piecewise constant; empty and undersampled bins are transparent. Atom-exposure
    mean {format_num(mean)}
    {unit}.
  </p>
  {#if selected !== undefined && selected < values.length}
    <output
      >Bin {selected}: {Number.isFinite(values[selected])
        ? `${format_num(values[selected])} ${unit}`
        : `insufficient samples`}; average {format_num(
        result.population[selected] / result.time_weight,
      )} atoms; occupied in {result.occupied_frames[selected]}/{result.frames} frames.</output
    >
  {/if}
</div>

<style>
  .hotspot-slice :global(canvas) {
    image-rendering: pixelated;
  }
  .slice-controls {
    display: flex;
    gap: 0.75em;
    flex-wrap: wrap;
    align-items: center;
  }
  p,
  output {
    font-size: 0.85em;
  }
  p {
    margin: 0.25em 0;
  }
</style>
