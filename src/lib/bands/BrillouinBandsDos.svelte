<script lang="ts">
  import type { Vec3 } from '$lib'
  import { BrillouinZone, reciprocal_lattice } from '$lib/brillouin'
  import type { InternalPoint } from '$lib/plot'
  import type { PymatgenStructure } from '$lib/structure'
  import type { ComponentProps } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import Bands from './Bands.svelte'
  import Dos from './Dos.svelte'
  import * as helpers from './helpers'
  import type { BaseBandStructure, DosData } from './types'

  let {
    structure,
    band_structs,
    doses,
    bands_props = {},
    dos_props = {},
    bz_props = {},
    shared_y_axis = true,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    structure: PymatgenStructure
    band_structs: BaseBandStructure | Record<string, BaseBandStructure>
    doses: DosData | Record<string, DosData>
    bands_props?: Partial<ComponentProps<typeof Bands>>
    dos_props?: Partial<ComponentProps<typeof Dos>>
    bz_props?: Partial<ComponentProps<typeof BrillouinZone>>
    shared_y_axis?: boolean
  } = $props()

  let shared_y_axis_obj = $state<{ range?: [number, number] }>({})

  let first_band_struct = $derived(
    `qpoints` in band_structs
      ? band_structs
      : band_structs[Object.keys(band_structs)[0]],
  ) as BaseBandStructure

  // Convert fractional k-point coordinates to Cartesian reciprocal space
  // using the structure's reciprocal lattice (consistent with BZ computation)
  let k_path_points = $derived.by(() => {
    if (!first_band_struct?.qpoints || !structure?.lattice?.matrix) return []

    const k_lattice = reciprocal_lattice(structure.lattice.matrix)
    return helpers.extract_k_path_points(first_band_struct, k_lattice)
  })

  let hovered_band_point = $state<InternalPoint | null>(null)
  let hovered_qpoint_index = $derived(
    hovered_band_point && first_band_struct
      ? helpers.find_qpoint_at_distance(first_band_struct, hovered_band_point.x)
      : null,
  )
  let hovered_k_point = $derived(
    hovered_qpoint_index !== null
      ? (k_path_points[hovered_qpoint_index] as Vec3)
      : null,
  )
</script>

<div
  {...rest}
  class="bands-dos-brillouin {rest.class ?? ``}"
  style={`display: grid; grid-template-columns: 30% 50% 20%; gap: 8px; ${rest.style ?? ``}`}
>
  <BrillouinZone
    {structure}
    {k_path_points}
    k_path_labels={first_band_struct?.qpoints?.map((q, idx) => ({
      position: k_path_points[idx],
      label: q.label ? helpers.pretty_sym_point(q.label) : null,
    })) ?? []}
    {hovered_k_point}
    {hovered_qpoint_index}
    {...bz_props}
  />

  <Bands
    {band_structs}
    y_axis={shared_y_axis ? shared_y_axis_obj : {}}
    {...bands_props}
    padding={{ r: 15, ...bands_props.padding }}
    on_point_hover={({ point }) => {
      hovered_band_point = point
      bands_props.on_point_hover?.({ point })
    }}
  />

  <Dos
    {doses}
    orientation="horizontal"
    x_axis={{ ticks: 4 }}
    y_axis={shared_y_axis ? { ...shared_y_axis_obj, label: `` } : { label: `` }}
    padding={{ l: 15, ...dos_props.padding }}
    {...dos_props}
  />
</div>

<style>
  .bands-dos-brillouin {
    width: var(--bands-dos-bz-width, 100%);
    height: var(--bands-dos-bz-height, 600px);
    min-height: var(--bands-dos-bz-min-height, 400px);
  }
</style>
