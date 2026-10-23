<script lang="ts">
  // Band structure and DOS on one shared frequency/energy axis. Given a `structure`, a
  // Brillouin zone joins them, drawing the first band structure's k-path linked to the bands:
  // hovering either marks the other.
  import PanelsFullscreenButton from '#lib/layout/PanelsFullscreenButton.svelte'
  import type { BandsOptions, DosOptions } from './index'
  import type { BrillouinZoneOptions } from '#lib/brillouin/index.js'
  import { BrillouinZone } from '#lib/brillouin/index.js'
  import { reciprocal_lattice } from '#lib/math.js'
  import type { Vec2 } from '#lib/math.js'
  import type { InternalPoint } from '#lib/plot/index.js'
  import type { Crystal } from '#lib/structure/index.js'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import { create_band_path_link } from './band-path-link.svelte'
  import { create_bands_dos_sync, MIN_SIDE_BY_SIDE_WIDTH } from './synced-axes.svelte'
  import type { BaseBandStructure, DosData, FrequencyUnit, HoveredData } from './types'

  let {
    band_structs,
    doses,
    structure,
    units = $bindable(`THz`),
    fermi_level,
    bands_props = {},
    dos_props = {},
    bz_props = {},
    shared_y_axis = true,
    sync_y_zoom = true,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_structs: Record<string, BaseBandStructure>
    doses: Record<string, DosData>
    structure?: Crystal // adds its Brillouin zone with the bands' k-path
    units?: FrequencyUnit
    fermi_level?: number // Shared electronic reference; omitted uses dataset metadata
    bands_props?: BandsOptions
    dos_props?: DosOptions
    bz_props?: BrillouinZoneOptions
    shared_y_axis?: boolean
    sync_y_zoom?: boolean
    fullscreen?: boolean // all panels fullscreen together (one button, top-right plot's header)
    fullscreen_toggle?: boolean // also hidden by the top-right plot's show_controls
    children?: Snippet<[HoveredData]>
  } = $props()

  let hovered_band_point = $state<InternalPoint | null>(null)
  let bands_x_positions = $state<Record<string, Vec2>>({})
  // The k-path is the first structure's, in the structure's reciprocal lattice (as the BZ);
  // points of further structures map onto it by x
  const link = create_band_path_link({
    band_struct: () => Object.values(band_structs)[0],
    k_lattice: () =>
      structure && reciprocal_lattice(structure.lattice.matrix, { two_pi: true }),
    x_positions: () => bands_x_positions,
  })

  // Layout by container width (not the viewport: embedded at arbitrary sizes in notebooks and
  // IDEs). Without a zone the 200px DOS column stacks below the bands in narrow rows; with
  // one, the three panels sit side by side from 1200px, else the bands span the BZ and DOS
  // (tablet) or all stack (phone). Only side by side do the DOS and bands share the vertical axis.
  let clientWidth = $state(1200)
  const layout = $derived(
    structure
      ? clientWidth >= 1200
        ? `desktop`
        : clientWidth >= 600
          ? `tablet`
          : `phone`
      : clientWidth >= MIN_SIDE_BY_SIDE_WIDTH
        ? `side`
        : `stacked`,
  )
  const side_by_side = $derived(layout === `side` || layout === `desktop`)
  let wrapper = $state<HTMLDivElement>()

  const sync = create_bands_dos_sync({
    band_structs: () => band_structs,
    doses: () => doses,
    units: () => units,
    fermi_level: () => fermi_level,
    bands_props: () => bands_props,
    dos_props: () => dos_props,
    side_by_side: () => side_by_side,
    shared_axis: () => shared_y_axis,
    sync_zoom: () => sync_y_zoom,
    base_padding: {
      get t() {
        return structure ? 5 : 20
      },
      b: 50,
    },
  })
</script>

<!-- the top-right plot's: the DOS side by side, else the bands -->
{#snippet fullscreen_button(host: boolean)}
  {#if host}<PanelsFullscreenButton
      bind:fullscreen
      toggle={fullscreen_toggle}
      controls={(side_by_side ? dos_props : bands_props).show_controls}
      {wrapper}
    />{/if}
{/snippet}

<div
  {...rest}
  class={[`bands-and-dos mv-panels`, layout, rest.class]}
  bind:clientWidth
  bind:this={wrapper}
>
  {@render children?.({
    hovered_frequency: sync.hovered_frequency,
    hovered_band_point,
    hovered_qpoint_index: link.active_qpoint,
  })}
  <Bands
    {...bands_props}
    style="grid-area: bands; {bands_props.style ?? ``}"
    {band_structs}
    bind:units
    {structure}
    fermi_level={sync.fermi_level}
    padding={{ r: side_by_side ? 15 : 5, ...bands_props.padding, ...sync.shared_padding }}
    y_axis={sync.y_axes[0]}
    bind:view={sync.views[0]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:x_positions={bands_x_positions}
    bind:hovered_frequency={sync.hovered.bands}
    reference_frequency={sync.hovered_frequency}
    highlighted_qpoint_index={structure && link.active_qpoint}
    highlighted_qpoint_range={structure && link.highlighted_qpoint_range}
    on_point_hover={(event) => {
      hovered_band_point = event?.point ?? null
      link.hover_band(event)
      bands_props.on_point_hover?.(event)
    }}
    fullscreen_toggle={false}
  >
    {#snippet header_controls(dims)}
      {@render bands_props.header_controls?.(dims)}
      {@render fullscreen_button(!side_by_side)}
    {/snippet}
  </Bands>

  {#if structure}
    <BrillouinZone
      {...bz_props}
      style="grid-area: bz; height: 100%; overflow: hidden; {bz_props.style ?? ``}"
      {structure}
      k_path={link.k_path}
      hovered_k_point={link.hovered_k_point}
      hovered_qpoint_index={link.active_qpoint}
      highlighted_qpoint_range={link.highlighted_qpoint_range}
      on_kpath_hover={link.hover_path}
      fullscreen_toggle={false}
    />
  {/if}

  <Dos
    {...dos_props}
    style="grid-area: dos; {dos_props.style ?? ``}"
    {doses}
    bind:units
    fermi_level={sync.fermi_level}
    orientation={side_by_side ? `horizontal` : `vertical`}
    x_axis={sync.dos_x_axis}
    y_axis={sync.y_axes[1]}
    bind:view={sync.views[1]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:hovered_frequency={sync.hovered.dos}
    reference_frequency={sync.hovered_frequency}
    padding={{
      l: side_by_side ? 15 : undefined,
      r: layout === `phone` ? 0 : undefined,
      ...dos_props.padding,
      ...sync.shared_padding,
    }}
    fullscreen_toggle={false}
  >
    {#snippet header_controls(dims)}
      {@render dos_props.header_controls?.(dims)}
      {@render fullscreen_button(side_by_side)}
    {/snippet}
  </Dos>
</div>

<style>
  /* Tracks are fr-based (not percentages) so the gaps come out of the tracks instead of
     pushing the last panel past the container edge, and minmax(0, …) lets the SVG plots shrink
     below their intrinsic width */
  .bands-and-dos {
    display: grid;
    &.side {
      grid-template-columns: minmax(0, 1fr) 200px;
      grid-template-areas: 'bands dos';
    }
    &.stacked {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'bands' 'dos';
    }
    &:is(.desktop, .tablet, .phone) {
      width: var(--bz-bands-dos-width, 100%);
      height: var(--bz-bands-dos-height, 600px);
      min-height: var(--bz-bands-dos-min-height, 400px);
      gap: var(--bz-bands-dos-gap, 1em);
      > :global(*) {
        min-width: 0;
        min-height: 0;
      }
    }
    &.desktop {
      grid-template-columns: minmax(0, 6fr) minmax(0, 11fr) minmax(0, 3fr);
      grid-template-areas: 'bz bands dos';
    }
    &.tablet {
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas: 'bands bands' 'bz dos';
    }
    /* The shared height budget would squeeze three stacked panels into ~200px each, so the
       stack grows past it and each panel keeps a readable height */
    &.phone {
      height: auto;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: var(
        --bz-bands-dos-phone-rows,
        minmax(340px, auto) minmax(260px, auto) minmax(320px, auto)
      );
      grid-template-areas: 'bands' 'dos' 'bz';
    }
  }
</style>
