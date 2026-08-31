<script lang="ts">
  import { BrillouinZone } from '$lib/brillouin'
  import { reciprocal_lattice } from '$lib/math'
  import type { Vec2, Vec3 } from '$lib/math'
  import type { InternalPoint, ScatterHandlerEvent } from '$lib/plot'
  import { axis_with_range } from '$lib/plot/core/shared-axes'
  import type { Crystal } from '$lib/structure'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import * as helpers from './helpers'
  import { create_bands_dos_sync } from './synced-axes.svelte'
  import type { BaseBandStructure, DosData, HoveredData } from './types'

  let {
    structure,
    band_structs,
    doses,
    bands_props = {},
    dos_props = {},
    bz_props = {},
    sync_y_zoom = true,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure: Crystal
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    doses: DosData | Record<string, DosData>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    bz_props?: Partial<ComponentProps<typeof BrillouinZone>>
    sync_y_zoom?: boolean // Sync frequency/energy axis zoom between plots (default: true)
    children?: Snippet<[HoveredData]>
  } = $props()

  // First normalized band structure, for the k-path. A malformed pymatgen input throws from
  // normalization; the nested Bands reports it, so the k-path just stays empty here.
  let first_band_struct = $derived.by((): BaseBandStructure | null => {
    try {
      return helpers.normalize_band_structure(
        helpers.band_struct_entries(band_structs)[0]?.[1],
      )
    } catch {
      return null
    }
  })

  // Convert fractional k-point coordinates to Cartesian reciprocal space
  // using the structure's reciprocal lattice (consistent with BZ computation)
  let k_path_points = $derived.by(() => {
    if (!first_band_struct?.qpoints || !structure?.lattice?.matrix) return []

    const k_lattice = reciprocal_lattice(structure.lattice.matrix, { two_pi: true })
    return helpers.extract_k_path_points(first_band_struct, k_lattice)
  })

  let hovered_band_point = $state<InternalPoint | null>(null)
  let bands_x_positions = $state<Record<string, Vec2>>({})
  let hovered_qpoint_index = $derived(
    hovered_band_point && first_band_struct && Object.keys(bands_x_positions).length > 0
      ? helpers.find_qpoint_at_rescaled_x(
          first_band_struct,
          hovered_band_point.x,
          bands_x_positions,
        )
      : null,
  )
  // Q-point hovered directly on the BZ k-path (reverse direction: BZ -> bands/DOS)
  let bz_hovered_qpoint_index = $state<number | null>(null)
  // Unified hovered q-point: a band-point hover takes priority, else a BZ k-path hover
  let active_qpoint_index = $derived(hovered_qpoint_index ?? bz_hovered_qpoint_index)
  let hovered_k_point = $derived(
    active_qpoint_index !== null ? (k_path_points[active_qpoint_index] as Vec3) : null,
  )
  const [desktop_width, tablet_width] = [1200, 600]
  let clientWidth = $state(desktop_width)
  let is_desktop = $derived(clientWidth >= desktop_width)
  let is_mobile = $derived(clientWidth < tablet_width)
  let screen_class = $derived(is_desktop ? `desktop` : is_mobile ? `phone` : `tablet`)

  // Only the desktop layout puts the DOS horizontal beside the bands, sharing the vertical
  // frequency/energy dimension
  const sync = create_bands_dos_sync({
    band_structs: () => band_structs,
    doses: () => doses,
    bands_y_axis: () => bands_props.y_axis,
    dos_y_axis: () => dos_props.y_axis,
    bands_padding: () => bands_props.padding,
    dos_padding: () => dos_props.padding,
    side_by_side: () => is_desktop,
    sync_zoom: () => sync_y_zoom,
    base_padding: { t: 5, b: 50 },
  })

  let hovered_frequency = $state<number | null>(null)
</script>

<div {...rest} class={[`bands-dos-brillouin`, screen_class, rest.class]} bind:clientWidth>
  {@render children?.({
    hovered_frequency,
    hovered_band_point,
    hovered_qpoint_index: active_qpoint_index,
  })}
  <Bands
    style="grid-area: bands; min-width: 0; min-height: 0; overflow: visible"
    {band_structs}
    fermi_level={sync.fermi_level}
    {...bands_props}
    padding={{ r: is_desktop ? 10 : 5, ...bands_props.padding, ...sync.shared_padding }}
    bind:y_axis={sync.y_axes[0]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:x_positions={bands_x_positions}
    reference_frequency={hovered_frequency}
    highlighted_qpoint_index={active_qpoint_index}
    on_point_hover={(event: ScatterHandlerEvent | null) => {
      hovered_band_point = event?.point ?? null
      bands_props.on_point_hover?.(event)
    }}
  />

  <BrillouinZone
    style="grid-area: bz; min-width: 0; min-height: 0; overflow: hidden; height: 100%"
    {structure}
    {k_path_points}
    k_path_labels={first_band_struct
      ? helpers.k_path_labels(first_band_struct, k_path_points)
      : []}
    {hovered_k_point}
    hovered_qpoint_index={active_qpoint_index}
    on_kpath_hover={(idx) => (bz_hovered_qpoint_index = idx)}
    {...bz_props}
  />

  <Dos
    style="grid-area: dos; min-width: 0; min-height: 0; overflow: visible"
    {doses}
    fermi_level={sync.fermi_level}
    {...dos_props}
    orientation={is_desktop ? `horizontal` : `vertical`}
    x_axis={{
      ...axis_with_range(undefined, is_desktop ? undefined : sync.shared_range),
      ...dos_props.x_axis,
    }}
    bind:y_axis={sync.y_axes[1]}
    bind:resolved_padding={() => undefined, sync.raise_padding}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{
      l: is_desktop ? 20 : undefined,
      r: is_mobile ? 0 : undefined,
      ...dos_props.padding,
      ...sync.shared_padding,
    }}
  />
</div>

<style>
  .bands-dos-brillouin {
    width: var(--bz-bands-dos-width, 100%);
    height: var(--bz-bands-dos-height, 600px);
    min-height: var(--bz-bands-dos-min-height, 400px);
    display: grid;
    gap: var(--bz-bands-dos-gap, 1em);
  }
  /* Tracks are fr-based (not percentages) so the gaps come out of the tracks instead of
     pushing the last panel past the container edge, and minmax(0, …) lets the SVG plots shrink
     below their intrinsic width */
  .bands-dos-brillouin.desktop {
    /* layout: BZ | bands | DOS side by side */
    grid-template-columns: minmax(0, 6fr) minmax(0, 11fr) minmax(0, 3fr);
    grid-template-areas: 'bz bands dos';
  }
  .bands-dos-brillouin.tablet {
    /* layout: bands on top, BZ and DOS below */
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      'bands bands'
      'bz dos';
  }
  .bands-dos-brillouin.phone {
    /* layout: all stacked vertically. The shared height budget would squeeze three panels
       into ~200px each, so the stack grows past it and each panel keeps a readable height */
    height: auto;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(
      --bz-bands-dos-phone-rows,
      minmax(340px, auto) minmax(260px, auto) minmax(320px, auto)
    );
    grid-template-areas: 'bands' 'dos' 'bz';
  }
</style>
