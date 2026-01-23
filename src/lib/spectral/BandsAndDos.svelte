<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import type { AxisConfig } from '$lib/plot/types'
  import { untrack } from 'svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import {
    compute_frequency_range,
    extract_efermi,
    is_valid_range,
    ranges_equal,
  } from './helpers'
  import type { BaseBandStructure, DosInput, HoveredData } from './types'

  let {
    band_structs,
    doses,
    bands_props = {},
    dos_props = {},
    shared_y_axis = true,
    sync_y_zoom = true,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    doses: DosInput | Record<string, DosInput>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    shared_y_axis?: boolean
    sync_y_zoom?: boolean // Sync frequency/energy axis zoom between plots (default: true)
    class?: string
    children?: Snippet<[HoveredData]>
  } = $props()

  let shared_frequency_range = $derived(
    shared_y_axis ? compute_frequency_range(band_structs, doses) : undefined,
  )
  let fermi_level = $derived(extract_efermi(band_structs) ?? extract_efermi(doses))

  // Synced zoom state (null = use auto-computed range)
  let synced_zoom_range = $state<Vec2 | null>(null)
  let bands_y_axis = $state<AxisConfig>({})
  let dos_y_axis = $state<AxisConfig>({ label: `` })

  // Update y-axis configs when props or shared range changes
  $effect(() => {
    const base_range = synced_zoom_range ?? shared_frequency_range
    bands_y_axis = shared_y_axis
      ? { range: base_range, ...bands_props.y_axis }
      : { ...bands_props.y_axis }
  })

  $effect(() => {
    const base_range = synced_zoom_range ?? shared_frequency_range
    dos_y_axis = shared_y_axis
      ? { label: ``, range: base_range, ...dos_props.y_axis }
      : { label: ``, ...dos_props.y_axis }
  })

  // Detect zoom changes and sync between components
  $effect(() => {
    if (!sync_y_zoom || !shared_frequency_range) return

    const bands_range = bands_y_axis.range
    const dos_range = dos_y_axis.range
    const current_synced = untrack(() => synced_zoom_range)

    const bands_at_shared = is_valid_range(bands_range) &&
      ranges_equal(bands_range, shared_frequency_range)
    const dos_at_shared = is_valid_range(dos_range) &&
      ranges_equal(dos_range, shared_frequency_range)
    const bands_is_new = is_valid_range(bands_range) &&
      !ranges_equal(bands_range, shared_frequency_range) &&
      !ranges_equal(bands_range, current_synced)
    const dos_is_new = is_valid_range(dos_range) &&
      !ranges_equal(dos_range, shared_frequency_range) &&
      !ranges_equal(dos_range, current_synced)

    // Reset if either returns to shared range
    if (current_synced !== null && (bands_at_shared || dos_at_shared)) {
      synced_zoom_range = null
    } else if (bands_is_new && !dos_is_new) {
      synced_zoom_range = bands_range as Vec2
    } else if (dos_is_new && !bands_is_new) {
      synced_zoom_range = dos_range as Vec2
    }
  })

  let hovered_frequency = $state<number | null>(null)
</script>

<div
  {...rest}
  class="bands-and-dos {rest.class ?? ``}"
  style={`display: grid; grid-template-columns: 1fr 200px; gap: 0;` + (rest.style ?? ``)}
>
  {@render children?.({ hovered_frequency })}
  <Bands
    {band_structs}
    {fermi_level}
    {...bands_props}
    bind:y_axis={bands_y_axis}
    reference_frequency={hovered_frequency}
    padding={{ r: 15, ...bands_props.padding }}
  />

  <Dos
    {doses}
    {fermi_level}
    orientation="horizontal"
    {...dos_props}
    bind:y_axis={dos_y_axis}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{ l: 15, ...dos_props.padding }}
  />
</div>
