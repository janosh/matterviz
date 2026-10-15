<script lang="ts">
  // A Fermi surface beside the band structure of the same calculation, bands matched by absolute
  // index (band_indices, e.g. BXSF `BAND: n` → n − 1). Hovering a band point previews the surface
  // at its energy and marks its k-point and branch on the 3D k-path (and vice versa); a click
  // pins the energy as mu and isolates the band's sheet (click again for all).
  import { normalize_show_controls, shows_fullscreen_toggle } from '#lib/controls.js'
  import { FullscreenButton } from '#lib/layout/index.js'
  import Bands from '#lib/spectral/Bands.svelte'
  import {
    band_point_meta,
    create_band_path_link,
  } from '#lib/spectral/band-path-link.svelte.js'
  import type { BaseBandStructure } from '#lib/spectral/types.js'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
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
    // extra props of each view; the linked ones (band data, mu, fermi_level, highlights, k-path)
    // override them
    fermi_props?: ComponentProps<typeof FermiSurface>
    bands_props?: Partial<ComponentProps<typeof Bands>>
  } = $props()

  // the band structure's k-path in the grid's reciprocal space (same calculation and lattice)
  const link = create_band_path_link({
    band_struct: () => band_struct,
    k_lattice: () => band_data.k_lattice,
  })
  // bands the grid holds: only these have a Fermi surface to preview, pin or isolate
  const grid_bands = $derived(
    new Set(band_data.band_indices ?? band_data.energies[0].map((_, band_idx) => band_idx)),
  )

  let hovered_band = $state<number | null>(null)
  // energy of the band point under the pointer, previewed until the pointer leaves the bands
  let hovered_energy = $state<number | null>(null)
  const shown_mu = $derived(
    hovered_energy === null ? mu : hovered_energy - band_data.fermi_energy,
  )
  // The isolated band overrides the shown bands while set, so the controls' band syncing (on
  // every mu change) can neither end it nor write it into selected_bands; new data resets it
  let clicked_band = $derived.by((): number | null => {
    void band_data
    return null
  })
  let surface = $state.raw<FermiSurfaceData>()
  let wrapper = $state<HTMLDivElement>()
  const show_toggle = $derived(
    shows_fullscreen_toggle(
      fullscreen_toggle,
      normalize_show_controls(bands_props.show_controls),
    ),
  )
</script>

<div {...rest} bind:this={wrapper} class={[`fermi-surface-bands`, rest.class]}>
  <!-- caller props first: the link's handlers chain the caller's instead of being replaced -->
  <FermiSurface
    {...fermi_props}
    {band_data}
    fullscreen_toggle={false}
    bind:fermi_data={surface}
    wigner_seitz
    previewing={hovered_energy !== null}
    bind:mu={() => shown_mu, (value) => (mu = value)}
    bind:selected_bands={
      () => (clicked_band === null ? selected_bands : [clicked_band]),
      (bands) => {
        if (clicked_band === null) selected_bands = bands
      }
    }
    k_marker={link.hovered_k_point}
    k_path={link.k_path && {
      path: link.k_path,
      hovered_qpoint_index: link.active_qpoint,
      highlighted_qpoint_range: link.highlighted_qpoint_range,
      on_kpath_hover: link.hover_path,
    }}
    on_point_hover={(hover) => {
      hovered_band = hover?.band_index ?? null
      fermi_props.on_point_hover?.(hover)
    }}
  />
  <Bands
    {...bands_props}
    band_structs={{ bands: band_struct }}
    fullscreen_toggle={false}
    fermi_level={band_data.fermi_energy}
    highlighted_band_index={hovered_band ?? clicked_band}
    highlighted_qpoint_index={link.active_qpoint}
    highlighted_qpoint_range={link.highlighted_qpoint_range}
    reference_frequency={shown_mu === 0 ? null : band_data.fermi_energy + shown_mu}
    hover_config={{ threshold_px: 50, click_threshold_px: 50, ...bands_props.hover_config }}
    on_point_hover={(event) => {
      const point = band_point_meta(event?.point.metadata)
      hovered_band = point?.band_idx ?? null
      // only bands the grid holds have a surface to preview
      const in_grid = event && point && grid_bands.has(point.band_idx) ? event : null
      link.hover_band(in_grid)
      hovered_energy = in_grid ? in_grid.point.y : null
      bands_props.on_point_hover?.(event)
    }}
    on_plot_click={(event) => {
      // plot clicks reach the nearest band point within the tooltip's radius, so Bands keeps
      // plain lines (on_point_click would draw a marker per k-point)
      const point = band_point_meta(event.point.metadata)
      if (point && grid_bands.has(point.band_idx)) {
        const has_sheet = surface?.isosurfaces.some((iso) => iso.band_index === point.band_idx)
        const isolate = clicked_band !== point.band_idx && has_sheet
        clicked_band = isolate ? point.band_idx : null
        mu = event.point.y - band_data.fermi_energy
      }
      bands_props.on_plot_click?.(event)
    }}
  >
    {#snippet header_controls(dims)}
      {@render bands_props.header_controls?.(dims)}
      {#if fullscreen || show_toggle}
        <FullscreenButton
          bind:fullscreen
          hidden={!show_toggle}
          {wrapper}
          bg_css_var="--fermi-bands-fullscreen-bg"
        />
      {/if}
    {/snippet}
  </Bands>
</div>

<style>
  .fermi-surface-bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: var(--fermi-bands-gap, 1em);
    &:fullscreen {
      padding: 1em;
      background: var(--fermi-bands-fullscreen-bg, var(--page-bg, Canvas));
      > :global(*) {
        height: 100%;
        min-height: 0;
      }
    }
  }
</style>
