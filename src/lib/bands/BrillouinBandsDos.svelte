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
  const [desktop_width, tablet_width] = [1200, 600]
  let clientWidth = $state(desktop_width)
  let screen = $derived(
    clientWidth >= desktop_width
      ? `desktop`
      : clientWidth >= tablet_width
      ? `tablet`
      : `phone`,
  )
</script>

<div {...rest} class="bands-dos-brillouin {screen} {rest.class ?? ``}" bind:clientWidth>
  <Bands
    style="grid-area: bands; min-width: 0; min-height: 0; overflow: hidden"
    {band_structs}
    {...bands_props}
    y_axis={shared_y_axis ? shared_y_axis_obj : {}}
    padding={{ r: 15, ...bands_props.padding }}
    on_point_hover={({ point }) => {
      hovered_band_point = point
      bands_props.on_point_hover?.({ point })
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
    orientation={screen === `desktop` ? `horizontal` : `vertical`}
    x_axis={{ ticks: 4 }}
    y_axis={shared_y_axis ? { ...shared_y_axis_obj, label: `` } : { label: `` }}
    padding={{ l: 15, ...screen === `desktop` ? { r: 5 } : {}, ...dos_props.padding }}
    {...dos_props}
  />
</div>

<style>
  .bands-dos-brillouin {
    width: var(--bands-dos-bz-width, 100%);
    height: var(--bands-dos-bz-height, 600px);
    min-height: var(--bands-dos-bz-min-height, 400px);
    display: grid;
    gap: var(--bands-dos-bz-gap, 1em);
  }

  /* Desktop: BZ | Bands | DOS side by side */
  .bands-dos-brillouin.desktop {
    grid-template-columns: 30% 55% 15%;
    grid-template-areas: 'bz bands dos';
  }

  /* Tablet: Bands on top, BZ and DOS below */
  .bands-dos-brillouin.tablet {
    grid-template-columns: 40% 60%;
    grid-template-rows: 50% 50%;
    grid-template-areas:
      'bands bands'
      'bz dos';
  }

  /* Phone: All stacked vertically */
  .bands-dos-brillouin.phone {
    grid-template-columns: 1fr;
    grid-template-areas: 'bands' 'dos' 'bz';
  }
</style>
