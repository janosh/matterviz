<script lang="ts">
  // A Fermi surface beside the band structure of the same calculation, bands matched by their
  // absolute index (a band grid's band_indices, e.g. BXSF `BAND: n` → n − 1, is the band
  // structure's row). Hovering a band point previews the surface at its energy and marks its
  // k-point and branch on the k-path drawn in 3D; hovering that path marks the bands. A click
  // pins the energy as mu and isolates the band's sheet (click it again for all).
  import Bands from '#lib/spectral/Bands.svelte'
  import {
    branch_qpoint_range,
    extract_k_path_points,
    k_path_labels as path_labels,
  } from '#lib/spectral/helpers.js'
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
    fermi_props = {},
    bands_props = {},
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    band_data: BandGridData | BandGridJson
    band_struct: BaseBandStructure
    mu?: number
    selected_bands?: number[] // bands whose Fermi sheets are shown (all when unset)
    fermi_props?: Omit<
      ComponentProps<typeof FermiSurface>,
      `band_data` | `fermi_data` | `mu` | `selected_bands` | `k_marker` | `k_path`
    >
    bands_props?: Omit<
      ComponentProps<typeof Bands>,
      | `band_structs`
      | `highlighted_band_index`
      | `highlighted_qpoint_index`
      | `highlighted_qpoint_range`
      | `reference_frequency`
    >
  } = $props()

  // the band structure's k-path in the grid's reciprocal space (same calculation, same lattice)
  const k_path_points = $derived(extract_k_path_points(band_struct, band_data.k_lattice))
  const k_path_labels = $derived(path_labels(band_struct, k_path_points))
  // bands the grid holds: only these have a Fermi surface to preview, pin or isolate
  const grid_bands = $derived(
    new Set(band_data.band_indices ?? band_data.energies[0].map((_, band_idx) => band_idx)),
  )

  let hovered_band = $state<number | null>(null)
  // band point under the pointer, previewed until the pointer leaves the bands
  let hovered_point = $state<{ energy: number; qpoint_idx: number } | null>(null)
  let path_hovered_qpoint = $state<number | null>(null)
  const active_qpoint = $derived(hovered_point?.qpoint_idx ?? path_hovered_qpoint)
  const hovered_qpoint_range = $derived(
    active_qpoint === null ? null : branch_qpoint_range(band_struct, active_qpoint),
  )
  const shown_mu = $derived(hovered_point ? hovered_point.energy - band_data.fermi_energy : mu)
  // The isolated band overrides the shown bands while set, so the controls' band syncing (on
  // every mu change) cannot end it; new data resets it
  let clicked_band = $derived.by((): number | null => {
    void band_data
    return null
  })
  let surface = $state.raw<FermiSurfaceData>()

  const band_point = (metadata: Record<string, unknown> | undefined) => {
    const { band_idx, qpoint_idx } = metadata ?? {}
    return typeof band_idx === `number` && typeof qpoint_idx === `number`
      ? { band_idx, qpoint_idx }
      : null
  }
</script>

<div {...rest} class={[`fermi-surface-bands`, rest.class]}>
  <!-- caller props first: the link's handlers chain the caller's instead of being replaced -->
  <FermiSurface
    {...fermi_props}
    {band_data}
    bind:fermi_data={surface}
    bind:mu={() => shown_mu, (value) => (mu = value)}
    bind:selected_bands={
      () => (clicked_band === null ? selected_bands : [clicked_band]),
      (bands) => (selected_bands = bands)
    }
    k_marker={active_qpoint === null ? null : (k_path_points[active_qpoint] ?? null)}
    k_path={{
      k_path_points,
      k_path_labels,
      hovered_qpoint_index: active_qpoint,
      highlighted_qpoint_range: hovered_qpoint_range,
      on_kpath_hover: (qpoint_idx) => (path_hovered_qpoint = qpoint_idx),
    }}
    on_point_hover={(hover) => {
      hovered_band = hover?.band_index ?? null
      fermi_props.on_point_hover?.(hover)
    }}
  />
  <Bands
    {...bands_props}
    band_structs={{ bands: band_struct }}
    highlighted_band_index={hovered_band ?? clicked_band}
    highlighted_qpoint_index={active_qpoint}
    highlighted_qpoint_range={hovered_qpoint_range}
    reference_frequency={shown_mu === 0 ? null : band_data.fermi_energy + shown_mu}
    hover_config={{ threshold_px: 50, click_threshold_px: 50, ...bands_props.hover_config }}
    on_point_hover={(event) => {
      const point = band_point(event?.point.metadata)
      hovered_band = point?.band_idx ?? null
      hovered_point =
        event && point && grid_bands.has(point.band_idx)
          ? { energy: event.point.y, qpoint_idx: point.qpoint_idx }
          : null
      bands_props.on_point_hover?.(event)
    }}
    on_plot_click={(event) => {
      // plot clicks reach the nearest band point within the tooltip's radius, so Bands keeps
      // plain lines (on_point_click would draw a marker per k-point)
      const point = band_point(event.point.metadata)
      if (point && grid_bands.has(point.band_idx)) {
        const sheets = new Set(surface?.isosurfaces.map((iso) => iso.band_index))
        const isolate = clicked_band !== point.band_idx && sheets.has(point.band_idx)
        clicked_band = isolate ? point.band_idx : null
        mu = event.point.y - band_data.fermi_energy
      }
      bands_props.on_plot_click?.(event)
    }}
  />
</div>

<style>
  .fermi-surface-bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: var(--fermi-bands-gap, 1em);
    align-items: stretch;
  }
</style>
