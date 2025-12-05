<script lang="ts">
  import type { Vec3 } from '$lib'
  import { BrillouinZone, reciprocal_lattice } from '$lib/brillouin'
  import type { InternalPoint } from '$lib/plot'
  import type { PymatgenStructure } from '$lib/structure'
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
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure: PymatgenStructure
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    doses: DosData | Record<string, DosData>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    bz_props?: Partial<ComponentProps<typeof BrillouinZone>>
    children?: Snippet<[HoveredData]>
  } = $props()

  // Get the first band structure (raw input)
  let raw_first_band_struct = $derived(
    `qpoints` in band_structs
      ? band_structs
      : band_structs[Object.keys(band_structs)[0]],
  )

  // Normalize the first band structure (handles both matterviz and pymatgen formats)
  let first_band_struct = $derived(
    helpers.normalize_band_structure(raw_first_band_struct),
  ) as BaseBandStructure | null

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
  let y_axis_dos = $derived({
    ...(is_desktop ? { label: `` } : {}),
    ...dos_props.y_axis,
  })
  // Track hovered frequency from DOS to show reference line in Bands
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
    padding={{ r: is_desktop ? 10 : 5, ...bands_props.padding }}
    bind:x_positions={bands_x_positions}
    reference_frequency={hovered_frequency}
    on_point_hover={(event) => {
      hovered_band_point = event?.point ?? null
      bands_props.on_point_hover?.(event)
    }}
    {...bands_props}
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
    orientation={is_desktop ? `horizontal` : `vertical`}
    x_axis={{ ticks: 4 }}
    y_axis={y_axis_dos}
    bind:hovered_frequency
    reference_frequency={hovered_frequency}
    padding={{
      l: is_desktop ? 20 : undefined,
      r: is_mobile ? 0 : undefined,
      ...dos_props.padding,
    }}
    {...dos_props}
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
