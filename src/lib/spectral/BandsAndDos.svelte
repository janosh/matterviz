<script lang="ts">
  import { axis_with_range } from '$lib/plot/core/shared-axes'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import { create_bands_dos_sync } from './synced-axes.svelte'
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

  const sync = create_bands_dos_sync({
    band_structs: () => band_structs,
    doses: () => doses,
    bands_y_axis: () => bands_props.y_axis,
    dos_y_axis: () => dos_props.y_axis,
    bands_padding: () => bands_props.padding,
    dos_padding: () => dos_props.padding,
    side_by_side: () => !stacked,
    shared_axis: () => shared_y_axis,
    sync_zoom: () => sync_y_zoom,
    base_padding: { t: 20, b: 50 },
  })

  let hovered_frequency = $state<number | null>(null)
</script>

<div {...rest} class={[`bands-and-dos`, { stacked }, rest.class]} bind:clientWidth>
  {@render children?.({ hovered_frequency })}
  <Bands
    {...bands_props}
    {band_structs}
    fermi_level={sync.fermi_level}
    y_axis={sync.y_axes[0]}
    bind:view={sync.views[0]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    reference_frequency={hovered_frequency}
    padding={{ r: 15, ...bands_props.padding, ...sync.shared_padding }}
  />

  <Dos
    {...dos_props}
    {doses}
    fermi_level={sync.fermi_level}
    orientation={stacked ? `vertical` : `horizontal`}
    x_axis={{
      // a vertical Dos plots frequency along x (density along y), so the shared frequency
      // range belongs on x when stacked and on y (synced above) side by side
      ...axis_with_range(undefined, stacked ? sync.shared_range : undefined),
      ...dos_props.x_axis,
    }}
    y_axis={sync.y_axes[1]}
    bind:view={sync.views[1]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{ l: stacked ? undefined : 15, ...dos_props.padding, ...sync.shared_padding }}
  />
</div>

<style>
  .bands-and-dos {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 200px;
  }
  .bands-and-dos.stacked {
    grid-template-columns: minmax(0, 1fr);
  }
</style>
