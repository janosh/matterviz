<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import { compute_frequency_range } from './helpers'
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

  // Compute shared frequency/energy range from both bands and DOS data
  let shared_frequency_range = $derived(
    shared_y_axis ? compute_frequency_range(band_structs, doses) : undefined,
  )

  // Extract Fermi level from electronic band structure or DOS data
  let fermi_level = $derived.by((): number | undefined => {
    // Check band structures for efermi
    const bs_source = `efermi` in (band_structs as object)
      ? band_structs
      : Object.values(band_structs)[0]
    const bs_efermi = (bs_source as Record<string, unknown>)?.efermi
    if (typeof bs_efermi === `number`) return bs_efermi

    // Check DOS for efermi
    const dos_source = `efermi` in (doses as object) ? doses : Object.values(doses)[0]
    const dos_efermi = (dos_source as Record<string, unknown>)?.efermi
    return typeof dos_efermi === `number` ? dos_efermi : undefined
  })

  // Shared y-axis configuration
  let bands_y_axis = $derived(
    shared_y_axis ? { range: shared_frequency_range, ...bands_props.y_axis } : {},
  )
  let dos_y_axis = $derived(
    shared_y_axis
      ? { label: ``, range: shared_frequency_range, ...dos_props.y_axis }
      : { label: `` },
  )

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
    {fermi_level}
    {...bands_props}
    y_axis={bands_y_axis}
    reference_frequency={hovered_frequency}
    padding={{ r: 15, ...bands_props.padding }}
  />

  <Dos
    {doses}
    {fermi_level}
    orientation="horizontal"
    {...dos_props}
    y_axis={dos_y_axis}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{ l: 15, ...dos_props.padding }}
  />
</div>
