<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import type { BaseBandStructure, DosData } from './types'

  let {
    band_structs,
    doses,
    bands_props = {},
    dos_props = {},
    shared_y_axis = true,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    doses: DosData | Record<string, DosData>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    shared_y_axis?: boolean
    class?: string
  } = $props()

  // Shared y-axis configuration - use single object when shared_y_axis is true
  let shared_y_axis_obj = $state<{ range?: [number, number] }>({})
  let bands_y_axis = $derived(shared_y_axis ? shared_y_axis_obj : {})
  let dos_y_axis = $derived(shared_y_axis ? shared_y_axis_obj : {})
</script>

<div
  {...rest}
  class="bands-and-dos {rest.class ?? ``}"
  style={`display: grid; grid-template-columns: 1fr 200px; gap: 0;` + (rest.style ?? ``)}
>
  <Bands
    {band_structs}
    y_axis={bands_y_axis}
    {...bands_props}
    padding={{ r: 15 }}
  />

  <Dos
    {doses}
    orientation="horizontal"
    y_axis={{ ...dos_y_axis, label: `` }}
    padding={{ l: 15 }}
    {...dos_props}
  />
</div>
