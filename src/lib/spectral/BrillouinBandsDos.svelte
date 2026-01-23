<script lang="ts">
  import { BrillouinZone, reciprocal_lattice } from '$lib/brillouin'
  import type { Vec2, Vec3 } from '$lib/math'
  import type { InternalPoint } from '$lib/plot'
  import type { AxisConfig } from '$lib/plot/types'
  import type { Crystal } from '$lib/structure'
  import { untrack } from 'svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import * as helpers from './helpers'
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

  // Get the first normalized band structure for path calculations
  // Support both qpoints (phonon) and kpoints (electronic) to detect single vs dict
  let first_band_struct = $derived(
    helpers.normalize_band_structure(
      `qpoints` in (band_structs as object) || `kpoints` in (band_structs as object)
        ? band_structs
        : Object.values(band_structs)[0],
    ),
  ) as BaseBandStructure | null

  // Compute shared frequency/energy range from both bands and DOS data
  let shared_frequency_range = $derived(
    helpers.compute_frequency_range(band_structs, doses),
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

  // Convert fractional k-point coordinates to Cartesian reciprocal space
  // using the structure's reciprocal lattice (consistent with BZ computation)
  let k_path_points = $derived.by(() => {
    if (!first_band_struct?.qpoints || !structure?.lattice?.matrix) return []

    const k_lattice = reciprocal_lattice(structure.lattice.matrix)
    return helpers.extract_k_path_points(first_band_struct, k_lattice)
  })

  let hovered_band_point = $state<InternalPoint | null>(null)
  let bands_x_positions = $state<Record<string, [number, number]>>({})
  let hovered_qpoint_index = $derived(
    hovered_band_point && first_band_struct &&
      Object.keys(bands_x_positions).length > 0
      ? helpers.find_qpoint_at_rescaled_x(
        first_band_struct,
        hovered_band_point.x,
        bands_x_positions,
      )
      : null,
  )
  let hovered_k_point = $derived(
    hovered_qpoint_index !== null
      ? (k_path_points[hovered_qpoint_index] as Vec3)
      : null,
  )
  const [desktop_width, tablet_width] = [1200, 600]
  let clientWidth = $state(desktop_width)
  let is_desktop = $derived(clientWidth >= desktop_width)
  let is_mobile = $derived(clientWidth < tablet_width)
  let screen_class = $derived(
    clientWidth >= desktop_width
      ? `desktop`
      : clientWidth >= tablet_width
      ? `tablet`
      : `phone`,
  )

  // Synced zoom state (null = use auto-computed range)
  let synced_zoom_range = $state<Vec2 | null>(null)
  let bands_y_axis = $state<AxisConfig>({})
  let dos_y_axis = $state<AxisConfig>({})

  // Update y-axis configs when props or shared range changes
  $effect(() => {
    const base_range = synced_zoom_range ?? shared_frequency_range
    bands_y_axis = { range: base_range, ...bands_props.y_axis }
  })

  $effect(() => {
    const base_range = synced_zoom_range ?? shared_frequency_range
    dos_y_axis = is_desktop
      ? { label: ``, range: base_range, ...dos_props.y_axis }
      : { ...dos_props.y_axis }
  })

  // Detect zoom changes and sync between components
  $effect(() => {
    if (!sync_y_zoom || !shared_frequency_range) return

    const bands_range = bands_y_axis.range
    const dos_range = dos_y_axis.range
    const current_synced = untrack(() => synced_zoom_range)

    const bands_at_shared = helpers.is_valid_range(bands_range) &&
      helpers.ranges_equal(bands_range, shared_frequency_range)
    const dos_at_shared = is_desktop && helpers.is_valid_range(dos_range) &&
      helpers.ranges_equal(dos_range, shared_frequency_range)
    const bands_is_new = helpers.is_valid_range(bands_range) &&
      !helpers.ranges_equal(bands_range, shared_frequency_range) &&
      !helpers.ranges_equal(bands_range, current_synced)
    const dos_is_new = is_desktop && helpers.is_valid_range(dos_range) &&
      !helpers.ranges_equal(dos_range, shared_frequency_range) &&
      !helpers.ranges_equal(dos_range, current_synced)

    // Reset if either returns to shared range
    if (current_synced !== null && (bands_at_shared || dos_at_shared)) {
      synced_zoom_range = null
    } else if (bands_is_new && !dos_is_new) {
      synced_zoom_range = bands_range as Vec2
    } else if (dos_is_new && !bands_is_new) {
      synced_zoom_range = dos_range as Vec2
    }
  })

  let hovered_frequency = $state<number | null>(null)
</script>

<div
  {...rest}
  class="bands-dos-brillouin {screen_class} {rest.class ?? ``}"
  bind:clientWidth
>
  {@render children?.({ hovered_frequency, hovered_band_point, hovered_qpoint_index })}
  <Bands
    style="grid-area: bands; min-width: 0; min-height: 0; overflow: hidden"
    {band_structs}
    {fermi_level}
    {...bands_props}
    padding={{ r: is_desktop ? 10 : 5, ...bands_props.padding }}
    bind:y_axis={bands_y_axis}
    bind:x_positions={bands_x_positions}
    reference_frequency={hovered_frequency}
    on_point_hover={(event) => {
      hovered_band_point = event?.point ?? null
      bands_props.on_point_hover?.(event)
    }}
  />

  <BrillouinZone
    style="grid-area: bz; min-width: 0; min-height: 0; overflow: hidden; height: 100%"
    {structure}
    {k_path_points}
    k_path_labels={first_band_struct?.qpoints?.flatMap((q, idx) =>
      k_path_points[idx]
        ? [{
          position: k_path_points[idx],
          label: q.label ? helpers.pretty_sym_point(q.label) : null,
        }]
        : []
    ) ?? []}
    {hovered_k_point}
    {hovered_qpoint_index}
    {...bz_props}
  />

  <Dos
    style="grid-area: dos; min-width: 0; min-height: 0; overflow: hidden"
    {doses}
    {fermi_level}
    {...dos_props}
    orientation={is_desktop ? `horizontal` : `vertical`}
    x_axis={{
      ticks: is_desktop ? 4 : undefined,
      range: is_desktop ? undefined : shared_frequency_range,
      ...dos_props.x_axis,
    }}
    bind:y_axis={dos_y_axis}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{
      l: is_desktop ? 20 : undefined,
      r: is_mobile ? 0 : undefined,
      ...dos_props.padding,
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
  .bands-dos-brillouin.desktop {
    /* layout: BZ | bands | DOS side by side */
    grid-template-columns: 30% 55% 15%;
    grid-template-areas: 'bz bands dos';
  }
  .bands-dos-brillouin.tablet {
    /* layout: bands on top, BZ and DOS below */
    grid-template-columns: 40% 60%;
    grid-template-rows: 50% 50%;
    grid-template-areas:
      'bands bands'
      'bz dos';
  }
  .bands-dos-brillouin.phone {
    /* layout: all stacked vertically */
    grid-template-columns: 1fr;
    grid-template-areas: 'bands' 'dos' 'bz';
  }
</style>
