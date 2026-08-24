<script lang="ts">
  import { axis_with_range, max_side_padding } from '$lib/plot/core/shared-axes'
  import type { AxisConfig } from '$lib/plot/core/types'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import { compute_frequency_range, extract_efermi } from './helpers'
  import { create_synced_y_axes } from './synced-axes.svelte'
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
    sync_y_zoom?: boolean
    children?: Snippet<[HoveredData]>
  } = $props()

  // Below this container width the 200px DOS column would leave the bands too narrow to read,
  // so the DOS turns vertical and stacks underneath. Measured on the wrapper (not the
  // viewport) because the component is embedded at arbitrary sizes in notebooks and IDEs.
  const stack_below_width = 520
  let clientWidth = $state(800)
  let stacked = $derived(clientWidth < stack_below_width)

  let shared_frequency_range = $derived(
    shared_y_axis ? compute_frequency_range(band_structs, doses) : undefined,
  )
  let fermi_level = $derived(extract_efermi(band_structs) ?? extract_efermi(doses))

  // A vertical DOS puts density on y, so the shared frequency range only binds both y axes
  // in the side-by-side layout
  const default_y_axes = (): AxisConfig[] => [
    shared_y_axis
      ? axis_with_range(bands_props.y_axis, shared_frequency_range)
      : { ...bands_props.y_axis },
    shared_y_axis && !stacked
      ? axis_with_range(dos_props.y_axis, shared_frequency_range, ``)
      : { ...(stacked ? {} : { label: `` }), ...dos_props.y_axis },
  ]

  const synced = create_synced_y_axes({
    default_axes: default_y_axes,
    sources: () => [
      band_structs,
      doses,
      shared_y_axis,
      stacked,
      JSON.stringify({ bands: bands_props.y_axis, dos: dos_props.y_axis }),
    ],
    shared_range: () => shared_frequency_range,
    sync_zoom: () => sync_y_zoom,
    linked_count: () => (stacked ? 1 : 2),
  })

  let hovered_frequency = $state<number | null>(null)

  // Side-wise maxima preserve caller padding while keeping y-scale pixel spans identical.
  let shared_tb_padding = $derived(
    max_side_padding([{ t: 20, b: 50 }, bands_props.padding, dos_props.padding], [`t`, `b`]),
  )
  let side_by_side_padding = $derived(stacked ? {} : shared_tb_padding)
</script>

<div
  {...rest}
  class={[`bands-and-dos`, { stacked }, rest.class]}
  style={`display: grid; gap: 0;` + (rest.style ?? ``)}
  bind:clientWidth
>
  {@render children?.({ hovered_frequency })}
  <Bands
    {...bands_props}
    {band_structs}
    {fermi_level}
    bind:y_axis={synced.y_axes[0]}
    reference_frequency={hovered_frequency}
    padding={{ r: 15, ...bands_props.padding, ...side_by_side_padding }}
  />

  <Dos
    {...dos_props}
    {doses}
    {fermi_level}
    orientation={stacked ? `vertical` : `horizontal`}
    x_axis={{
      // a vertical Dos plots frequency along x (density along y), so the shared frequency
      // range belongs on x when stacked and on y (synced above) side by side
      ...axis_with_range(undefined, stacked ? shared_frequency_range : undefined),
      ...dos_props.x_axis,
    }}
    bind:y_axis={synced.y_axes[1]}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{
      ...(stacked ? {} : { l: 15 }),
      ...dos_props.padding,
      ...side_by_side_padding,
    }}
  />
</div>

<style>
  .bands-and-dos {
    grid-template-columns: minmax(0, 1fr) 200px;
  }
  .bands-and-dos.stacked {
    grid-template-columns: minmax(0, 1fr);
  }
</style>
