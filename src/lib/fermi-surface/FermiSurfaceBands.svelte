<script lang="ts">
  // A Fermi surface beside the band structure of the same calculation, linked by FermiBandsLink:
  // hovering a band point previews the surface at its energy and marks its k-point and branch
  // on the 3D k-path (and vice versa); a click pins the energy as mu and isolates the band's
  // sheet. Band lines take their sheet's colour, E_F crossings are dotted on bands and path.
  import PanelsFullscreenButton from '#lib/layout/PanelsFullscreenButton.svelte'
  import Bands from '#lib/spectral/Bands.svelte'
  import type { BaseBandStructure } from '#lib/spectral/types.js'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import BandCrossings from './BandCrossings.svelte'
  import { FermiBandsLink, LINK_HOVER_CONFIG } from './fermi-bands-link.svelte'
  import { chain_callbacks } from '#lib/plot/core/interactions.js'
  import FermiSurface from './FermiSurface.svelte'
  import type { BandGridJson } from './parse'
  import type { BandGridData, FermiSurfaceData } from './types'

  let {
    band_data,
    band_struct,
    mu = $bindable(0),
    selected_bands = $bindable(),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    fermi_props = {},
    bands_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_data: BandGridData | BandGridJson
    band_struct: BaseBandStructure
    mu?: number
    selected_bands?: number[] // bands whose Fermi sheets are shown (all when unset)
    fullscreen?: boolean // both views fullscreen together (one button, in the bands' header)
    fullscreen_toggle?: boolean // also hidden by bands_props.show_controls
    // per-view extras; linked props (bands, mu, fermi_level, highlights, k-path) override them
    fermi_props?: ComponentProps<typeof FermiSurface>
    bands_props?: Partial<ComponentProps<typeof Bands>>
  } = $props()

  let surface = $state.raw<FermiSurfaceData>()
  // the band structure's k-path in the grid's reciprocal space (same calculation and lattice)
  const link = new FermiBandsLink({
    band_data: () => band_data,
    surface: () => surface,
    band_struct: () => band_struct,
    k_lattice: () => band_data.k_lattice,
    mu: { get: () => mu, set: (value) => (mu = value) },
    selected_bands: { get: () => selected_bands, set: (bands) => (selected_bands = bands) },
    band_spin_mode: () => bands_props.band_spin_mode,
    color_property: () => fermi_props.color_property,
    line_kwargs: () => bands_props.line_kwargs,
  })
  let wrapper = $state<HTMLDivElement>()
</script>

<div {...rest} bind:this={wrapper} class={[`fermi-surface-bands mv-panels`, rest.class]}>
  <!-- caller props first: the link's handlers chain the caller's instead of being replaced -->
  <FermiSurface
    {...fermi_props}
    {band_data}
    fullscreen_toggle={false}
    bind:fermi_data={surface}
    bind:color_property={link.color_property}
    selected_spins={link.selected_spins}
    wigner_seitz
    previewing={link.hovered_energy !== null}
    bind:mu={link.mu}
    bind:selected_bands={link.selected_bands}
    k_marker={link.path.hovered_k_point}
    k_path={link.k_path}
    on_point_hover={chain_callbacks(link.fermi_hover, fermi_props.on_point_hover)}
  />
  <Bands
    {...bands_props}
    band_structs={{ bands: band_struct }}
    fullscreen_toggle={false}
    fermi_level={band_data.fermi_energy}
    line_kwargs={link.line_kwargs}
    bind:band_spin_mode={link.band_spin_mode}
    bind:x_positions={link.x_positions}
    highlighted_band_index={link.highlighted_band}
    highlighted_qpoint_index={link.path.active_qpoint}
    highlighted_qpoint_range={link.path.highlighted_qpoint_range}
    reference_frequency={link.reference_frequency}
    hover_config={{ ...LINK_HOVER_CONFIG, ...bands_props.hover_config }}
    on_point_hover={chain_callbacks(link.band_hover, bands_props.on_point_hover)}
    on_plot_click={chain_callbacks(link.band_click, bands_props.on_plot_click)}
  >
    {#snippet children(ctx)}
      {@render bands_props.children?.(ctx)}
      <BandCrossings {ctx} crossings={link.crossings} bind:node={link.crossings_svg} />
    {/snippet}
    {#snippet header_controls(dims)}
      {@render bands_props.header_controls?.(dims)}
      <PanelsFullscreenButton
        bind:fullscreen
        toggle={fullscreen_toggle}
        controls={bands_props.show_controls}
        {wrapper}
      />
    {/snippet}
  </Bands>
</div>

<style>
  .fermi-surface-bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: var(--fermi-bands-gap, 1em);
  }
</style>
