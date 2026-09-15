<script lang="ts">
  import { Canvas } from '@threlte/core'
  import { create_renderer, webgpu_available } from '$lib/scene'
  import { StatusMessage } from 'svelte-widgets'
  import { matrix_inverse_3x3 } from '$lib/math'
  import type { TrajectoryRun } from './run'
  import { ATOM_BATCH_SIZE } from './atom-batches'
  import {
    hotspot_bin,
    hotspot_mean,
    hotspot_values,
    type HotspotMetric,
    type HotspotResult,
    type HotspotGrid,
  } from './hotspots'
  import ParticleScene from './ParticleScene.svelte'

  let {
    run,
    frame_idx,
    result,
    metric = `energy`,
    min_atoms = 10,
    threshold = 1.25,
  }: {
    run: TrajectoryRun
    frame_idx: number
    result: HotspotResult
    metric?: HotspotMetric
    min_atoms?: number
    threshold?: number
  } = $props()
  let positions = $state.raw<Float64Array>()
  let error = $state(``)
  let loading = $state(false)
  let only_hot = $state(false)
  let current_grid = $state.raw<HotspotGrid>()
  let pending = Promise.resolve()
  let loaded_frame = -1
  // Export calls after the playhead update has flushed, then waits for numeric reads too.
  export async function wait_for_frame(idx: number, signal: AbortSignal): Promise<void> {
    await pending
    signal.throwIfAborted()
    if (error) throw new Error(error)
    if (!positions || loaded_frame !== idx)
      throw new Error(`Particle frame ${idx} is unavailable`)
  }
  $effect(() => {
    const active = run
    const idx = frame_idx
    const controller = new AbortController()
    loading = true
    error = ``
    pending = (async () => {
      if (!active.read_atoms)
        throw new Error(`Numeric particle rendering is unavailable for this source`)
      const first = await active.read_atoms(
        { frame_idx: idx, start: 0, count: ATOM_BATCH_SIZE },
        controller.signal,
      )
      controller.signal.throwIfAborted()
      const count = first.total_atoms
      const xyz = new Float64Array(count * 3)
      for (let offset = 0; offset < count; offset += ATOM_BATCH_SIZE) {
        const batch =
          offset === 0
            ? first
            : await active.read_atoms(
                {
                  frame_idx: idx,
                  start: offset,
                  count: Math.min(ATOM_BATCH_SIZE, count - offset),
                },
                controller.signal,
              )
        controller.signal.throwIfAborted()
        xyz.set(batch.positions, offset * 3)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (controller.signal.aborted) return
      current_grid = first.cell
        ? { dims: [1, 1, 1], cell: first.cell, origin: first.origin, pbc: first.pbc }
        : undefined
      positions = xyz
      loaded_frame = idx
      loading = false
    })().catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        positions = undefined
        current_grid = undefined
        error = failure instanceof Error ? failure.message : String(failure)
        loading = false
      }
    })
    return () => controller.abort()
  })
  const mean = $derived(hotspot_mean(result, metric))
  const values = $derived(
    hotspot_values(
      result,
      metric,
      Number.isFinite(min_atoms) && min_atoms >= 0 ? min_atoms : 0,
    ),
  )
  const scalars = $derived.by(() => {
    const xyz = positions
    if (!xyz) return new Float32Array()
    const bin_values = values
    const data = new Float32Array(xyz.length / 3)
    const grid =
      result.options.coordinates === `cell` && current_grid
        ? { ...current_grid, dims: result.grid.dims }
        : result.grid
    const inverse = matrix_inverse_3x3(grid.cell)
    for (let idx = 0; idx < data.length; idx++) {
      const bin = hotspot_bin(xyz, idx * 3, grid, inverse)
      data[idx] = bin >= 0 && Number.isFinite(bin_values[bin]) ? bin_values[bin] : -1
    }
    return data
  })
</script>

<div class="particle-view">
  <div class="particle-controls">
    <label><input type="checkbox" bind:checked={only_hot} /> Highlight hotspots</label>
    <span
      >{positions ? positions.length / 3 : 0} atoms{loading ? ` · loading frame…` : ``}</span
    >
  </div>
  {#if error}<StatusMessage message={error} type="error" />{/if}
  {#if !webgpu_available()}<StatusMessage
      message="The particle view requires WebGPU. Hotspot slices remain available."
    />
  {:else if positions}
    <Canvas createRenderer={create_renderer}
      ><ParticleScene {positions} {scalars} {mean} {threshold} {only_hot} /></Canvas
    >
  {/if}
</div>

<style>
  .particle-view {
    position: relative;
    height: 100%;
    min-height: 0;
  }
  .particle-controls {
    position: absolute;
    top: 0.5em;
    left: 0.5em;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75em;
    background: var(--pane-bg, #8882);
    padding: 0.35em;
    font-size: 0.8em;
  }
</style>
