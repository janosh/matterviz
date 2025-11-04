<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import type { BaseBandStructure, DosData, HoveredData } from './types'

  let {
    band_structs,
    doses,
    bands_props = {},
    dos_props = {},
    shared_y_axis = true,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    doses: DosData | Record<string, DosData>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    shared_y_axis?: boolean
    class?: string
    children?: Snippet<[HoveredData]>
  } = $props()

  // Shared y-axis configuration - use single object when shared_y_axis is true
  let shared_y_axis_obj = $state<{ range?: [number, number] }>({})
  let bands_y_axis = $derived(shared_y_axis ? shared_y_axis_obj : {})
  let dos_y_axis = $derived(shared_y_axis ? shared_y_axis_obj : {})

  // Track hovered frequency from DOS to show reference line in Bands
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
    y_axis={bands_y_axis}
    reference_frequency={hovered_frequency}
    {...bands_props}
    padding={{ r: 15 }}
  />

  <Dos
    {doses}
    orientation="horizontal"
    y_axis={{ ...dos_y_axis, label: `` }}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{ l: 15 }}
    {...dos_props}
  />
</div>
