<script lang="ts">
  import { StatusMessage } from 'svelte-widgets'
  import { format_num } from '$lib/labels'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { resolve_slice_cartesian_point, sample_hkl_slice, sample_plane_slice } from './slice'
  import { create_volume_slice_settings, type VolumeSliceSettings } from './slice-settings'
  import type { VolumetricData } from './types'
  import VolumeSlice from './VolumeSlice.svelte'

  let {
    volume,
    settings = $bindable(create_volume_slice_settings()),
    canvas = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    volume?: VolumetricData
    settings?: Partial<VolumeSliceSettings>
    canvas?: HTMLCanvasElement
  } = $props()

  let resolved_settings = $derived(create_volume_slice_settings(settings))
  let sampling_settings = $state<VolumeSliceSettings>()

  function update_position(position: number): void {
    const next_settings = create_volume_slice_settings({ ...resolved_settings, position })
    settings = next_settings
    sampling_settings = next_settings
  }

  // Render from the sampled snapshot so the canvas only repaints when the slice itself
  // changes. Reading resolved_settings here would repaint on every unrelated keystroke,
  // which costs milliseconds proportional to resolution.
  let render_settings = $derived(sampling_settings ?? resolved_settings)

  // Coalesce settings-pane edits; the canvas position slider samples directly while dragging.
  $effect.pre(() => {
    const next_settings = resolved_settings
    if (!untrack(() => sampling_settings)) {
      sampling_settings = next_settings
      return
    }
    const timer = setTimeout(() => (sampling_settings = next_settings), 150)
    return () => clearTimeout(timer)
  })

  let computed_slice = $derived.by(() => {
    if (!volume || !sampling_settings) return null
    const resolution =
      sampling_settings.resolution > 0 ? sampling_settings.resolution : undefined
    if (sampling_settings.plane_mode === `hkl`) {
      const { miller_indices, position } = sampling_settings
      return sample_hkl_slice(volume, miller_indices, position, resolution)
    }
    return sample_plane_slice(
      volume,
      {
        point: resolve_slice_cartesian_point(sampling_settings.cartesian_point, volume),
        normal: sampling_settings.cartesian_normal,
        up: sampling_settings.cartesian_up,
      },
      { resolution },
    )
  })
</script>

<div
  {...rest}
  class={[`volume-slice-view`, rest.class]}
  role="region"
  aria-label="Volumetric cross-section"
  data-testid="volume-slice"
>
  {#if computed_slice}
    <VolumeSlice
      slice={computed_slice}
      mode={render_settings.render_mode}
      colormap={render_settings.colormap}
      color_range={render_settings.color_range}
      symmetric={render_settings.symmetric}
      contour_levels={render_settings.contour_levels}
      colorbar_title={volume?.label ?? `Value`}
      bind:canvas
    />
    {#if resolved_settings.plane_mode === `hkl`}
      <label class="slice-position-control">
        <span>d = {format_num(resolved_settings.position, `.2f`)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          aria-label="Slice position on canvas"
          bind:value={() => resolved_settings.position, update_position}
        />
      </label>
    {/if}
  {:else}
    <StatusMessage
      message={volume
        ? `The selected plane does not intersect the volume.`
        : `No volumetric data available.`}
      type={volume ? `warning` : `info`}
    />
  {/if}
</div>

<style>
  .volume-slice-view {
    display: grid;
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    --volume-slice-height: 100%;
    --volume-slice-canvas-height: 100%;
    --volume-slice-object-fit: fill;
  }
  .slice-position-control {
    position: absolute;
    z-index: 2;
    bottom: 0.75rem;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: min(18rem, calc(100% - 2rem));
    box-sizing: border-box;
    padding: 0.35em 0.6em;
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--page-bg, Canvas) 85%, transparent);
    box-shadow: 0 1px 4px color-mix(in srgb, currentColor 15%, transparent);
    font-size: 0.8em;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%);
    transition: opacity 0.2s ease;
  }
  .volume-slice-view:is(:hover, :focus-within) .slice-position-control {
    opacity: 1;
    pointer-events: auto;
  }
  .slice-position-control span {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .slice-position-control input {
    flex: 1;
    min-width: 0;
  }
</style>
