<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    resolve_slice_cartesian_point,
    sample_hkl_slice,
    sample_plane_slice,
    type SliceResult,
  } from './slice'
  import { create_volume_slice_settings, type VolumeSliceSettings } from './slice-settings'
  import type { VolumetricData } from './types'
  import VolumeSlice from './VolumeSlice.svelte'

  let {
    volume,
    settings = create_volume_slice_settings(),
    canvas = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    volume?: VolumetricData
    settings?: Partial<VolumeSliceSettings>
    canvas?: HTMLCanvasElement
  } = $props()

  let resolved_settings = $derived(create_volume_slice_settings(settings))
  let sampling_settings = $state<VolumeSliceSettings>()

  // Keep controls responsive while coalescing expensive 3D-grid resampling.
  $effect.pre(() => {
    const next_settings = resolved_settings
    if (!untrack(() => sampling_settings)) {
      sampling_settings = next_settings
      return
    }
    const timer = setTimeout(() => (sampling_settings = next_settings), 150)
    return () => clearTimeout(timer)
  })

  let computed_slice = $derived.by((): SliceResult | null => {
    if (!volume || !sampling_settings) return null
    const resolution =
      sampling_settings.resolution > 0 ? sampling_settings.resolution : undefined
    if (sampling_settings.plane_mode === `hkl`) {
      return sample_hkl_slice(
        volume,
        sampling_settings.miller_indices,
        sampling_settings.position,
        resolution,
      )
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
      mode={resolved_settings.render_mode}
      colormap={resolved_settings.colormap}
      color_range={resolved_settings.color_range}
      symmetric={resolved_settings.symmetric}
      contour_levels={resolved_settings.contour_levels}
      colorbar_title={volume?.label ?? `Value`}
      bind:canvas
    />
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
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    --volume-slice-height: 100%;
    --volume-slice-canvas-height: 100%;
  }
</style>
