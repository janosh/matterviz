<script lang="ts">
  import PanelsFullscreenButton from '#lib/layout/PanelsFullscreenButton.svelte'
  import type { BandsOptions, DosOptions } from './index'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import { create_bands_dos_sync } from './synced-axes.svelte'
  import type { BaseBandStructure, DosData, FrequencyUnit, HoveredData } from './types'

  let {
    band_structs,
    doses,
    units = $bindable(`THz`),
    fermi_level,
    bands_props = {},
    dos_props = {},
    shared_y_axis = true,
    sync_y_zoom = true,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_structs: Record<string, BaseBandStructure>
    doses: Record<string, DosData>
    units?: FrequencyUnit
    fermi_level?: number // Shared electronic reference; omitted uses dataset metadata
    bands_props?: BandsOptions
    dos_props?: DosOptions
    shared_y_axis?: boolean
    sync_y_zoom?: boolean
    fullscreen?: boolean // both plots fullscreen together (one button, top-right plot's header)
    fullscreen_toggle?: boolean // also hidden by the top-right plot's show_controls
    children?: Snippet<[HoveredData]>
  } = $props()

  // Below this container width the 200px DOS column would leave the bands too narrow to read,
  // so the DOS turns vertical and stacks underneath. Measured on the wrapper (not the
  // viewport) because the component is embedded at arbitrary sizes in notebooks and IDEs.
  const stack_below_width = 520
  let clientWidth = $state(800)
  let stacked = $derived(clientWidth < stack_below_width)
  let wrapper = $state<HTMLDivElement>()

  const sync = create_bands_dos_sync({
    band_structs: () => band_structs,
    doses: () => doses,
    units: () => units,
    fermi_level: () => fermi_level,
    bands_props: () => bands_props,
    dos_props: () => dos_props,
    side_by_side: () => !stacked,
    shared_axis: () => shared_y_axis,
    sync_zoom: () => sync_y_zoom,
    base_padding: { t: 20, b: 50 },
  })
</script>

{#snippet fullscreen_button()}
  <PanelsFullscreenButton
    bind:fullscreen
    toggle={fullscreen_toggle}
    controls={(stacked ? bands_props : dos_props).show_controls}
    {wrapper}
  />
{/snippet}

<div
  {...rest}
  class={[`bands-and-dos`, { stacked }, rest.class]}
  bind:clientWidth
  bind:this={wrapper}
>
  {@render children?.({ hovered_frequency: sync.hovered_frequency })}
  <Bands
    {...bands_props}
    {band_structs}
    bind:units
    fermi_level={sync.fermi_level}
    y_axis={sync.y_axes[0]}
    bind:view={sync.views[0]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:hovered_frequency={sync.hovered.bands}
    reference_frequency={sync.hovered_frequency}
    padding={{ r: 15, ...bands_props.padding, ...sync.shared_padding }}
    fullscreen_toggle={false}
  >
    {#snippet header_controls(dims)}
      {@render bands_props.header_controls?.(dims)}
      {#if stacked}{@render fullscreen_button()}{/if}
    {/snippet}
  </Bands>

  <Dos
    {...dos_props}
    {doses}
    bind:units
    fermi_level={sync.fermi_level}
    orientation={stacked ? `vertical` : `horizontal`}
    x_axis={sync.dos_x_axis}
    y_axis={sync.y_axes[1]}
    bind:view={sync.views[1]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:hovered_frequency={sync.hovered.dos}
    reference_frequency={sync.hovered_frequency}
    padding={{ l: stacked ? undefined : 15, ...dos_props.padding, ...sync.shared_padding }}
    fullscreen_toggle={false}
  >
    {#snippet header_controls(dims)}
      {@render dos_props.header_controls?.(dims)}
      {#if !stacked}{@render fullscreen_button()}{/if}
    {/snippet}
  </Dos>
</div>

<style>
  .bands-and-dos {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 200px;
  }
  .bands-and-dos.stacked {
    grid-template-columns: minmax(0, 1fr);
  }
  .bands-and-dos:fullscreen {
    padding: 1em;
    grid-auto-rows: minmax(0, 1fr);
    background: var(--fullscreen-bg, var(--page-bg, Canvas));
    > :global(*) {
      height: 100%;
      min-height: 0;
    }
  }
</style>
