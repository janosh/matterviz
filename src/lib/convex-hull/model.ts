// Numerical hull snapshots are independent of rendering, category styling, and visibility.
import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { composition_to_simplex_coords } from './barycentric-coords'
import { compute_hull_stability, is_unary_entry } from './entry-stability'
import * as thermo from './thermodynamics'
import type { ConvexHullEntry, PhaseData } from './types'

type ReadonlyValue<Value> = Value extends string | number | boolean | bigint | symbol
  ? Value
  : Value extends object
    ? { readonly [Key in keyof Value]: ReadonlyValue<Value[Key]> }
    : Value

export type HullModel = ReadonlyValue<ReturnType<typeof build_hull_model>>

export type EnergySourceMode = `precomputed` | `on-the-fly`

// Which energies the hull can be built from. The user toggle only applies when the data
// carries both E_form and E_above_hull and nothing has shifted the energies since they were
// computed; temperature-dependent free energies and gas-pressure corrections change `energy`
// only, so the hull must be rebuilt on the fly for them to have any effect. Without unary
// references nothing can be recomputed and the precomputed values are all there is.
export interface EnergyModeInfo {
  has_precomputed_e_form: boolean
  has_precomputed_hull: boolean
  can_compute: boolean // unary references exist for every element (E_form and hull alike)
  // Temperature or gas-pressure corrections are active, so the energy mode is forced on the fly
  corrections_active: boolean
  energy_mode: EnergySourceMode
  unary_refs: Record<string, PhaseData>
}

export function compute_energy_mode_info(
  entries: PhaseData[],
  energy_source_mode: EnergySourceMode,
  corrections_active: boolean,
): EnergyModeInfo {
  const has_precomputed_e_form =
    entries.length > 0 && entries.every((entry) => typeof entry.e_form_per_atom === `number`)
  const has_precomputed_hull =
    entries.length > 0 && entries.every((entry) => typeof entry.e_above_hull === `number`)
  const unary_refs = thermo.find_lowest_energy_unary_refs(entries)
  const can_compute = entries.every((entry) =>
    Object.keys(entry.composition).every((el) => el in unary_refs),
  )
  let energy_mode: EnergySourceMode = energy_source_mode
  if (!can_compute) energy_mode = `precomputed`
  else if (corrections_active || !has_precomputed_e_form || !has_precomputed_hull) {
    energy_mode = `on-the-fly`
  }
  return {
    has_precomputed_e_form,
    has_precomputed_hull,
    can_compute,
    corrections_active,
    energy_mode,
    unary_refs,
  }
}

export const apply_formation_energies = (
  entries: PhaseData[],
  { energy_mode, unary_refs }: EnergyModeInfo,
): PhaseData[] =>
  energy_mode === `precomputed`
    ? entries
    : entries.map((entry) => {
        const e_form = thermo.compute_e_form_per_atom(entry, unary_refs)
        return e_form === null ? entry : { ...entry, e_form_per_atom: e_form }
      })

const hull_point = (entry: ConvexHullEntry, dim: number): number[] =>
  [entry.x, entry.y, entry.z, entry.e_form_per_atom ?? NaN].slice(0, dim)

// Reactive callers already normalize compositions and apply temperature/gas corrections.
export function build_hull_model(
  effective_entries: PhaseData[],
  elements: ElementSymbol[],
  dim: 2 | 3 | 4,
  energy_mode: EnergySourceMode,
) {
  // Simplex position of a composition with E_form on the last plotted axis (y in 2D, z in 3D)
  const plot_position = (composition: CompositionType, e_form: number) => {
    const [x, y = e_form, z = dim === 3 ? e_form : 0] = composition_to_simplex_coords(
      composition,
      elements,
    )
    return { x, y, z }
  }

  // Plot coordinates: entries with a finite formation energy placed in the simplex, plus
  // synthetic E_form = 0 corners for elements without a reference entry (closes the hull)
  const coords_entries = (() => {
    if (elements.length !== dim) return []
    const coords: ConvexHullEntry[] = []
    for (const entry of effective_entries) {
      const e_form = entry.e_form_per_atom
      if (typeof e_form !== `number` || !Number.isFinite(e_form)) continue
      const is_element = is_unary_entry(entry)
      coords.push({ ...entry, ...plot_position(entry.composition, e_form), is_element })
    }
    for (const element of elements) {
      if (coords.some((entry) => entry.is_element && entry.composition[element])) continue
      const composition = { [element]: 1 } as CompositionType
      coords.push({
        composition,
        energy: 0,
        e_form_per_atom: 0,
        e_above_hull: 0,
        is_stable: true,
        entry_id: `synthetic-element:${element}`,
        ...plot_position(composition, 0),
        is_element: true,
      })
    }
    return coords
  })()

  // Lower hull over the non-excluded entries (always built: 3D/4D draw its faces)
  const hull = (() => {
    const entries = coords_entries.filter((entry) => !entry.exclude_from_hull)
    const points = entries.map((entry) => hull_point(entry, dim))
    const facets = thermo.compute_lower_hull_nd(points)
    const facet_entries = facets.map((facet) =>
      facet.vertex_indices.map((idx) => entries[idx]),
    )
    return { entries, points, facets, facet_entries }
  })()

  // Entries with e_above_hull/is_stable: from the data when precomputed, else from the hull
  const enriched_entries = (() => {
    if (energy_mode !== `on-the-fly`) return coords_entries
    // No facets means every hull point sits at E_form = 0 (the corners always do), so the
    // hull is that plane and the distance is E_form itself
    const raw_dists =
      hull.facets.length === 0
        ? coords_entries.map((entry) => entry.e_form_per_atom)
        : thermo.compute_e_above_hull_nd(
            coords_entries.map((entry) => hull_point(entry, dim)),
            hull.facets,
            hull.points,
          )
    // non-finite distance (no covering hull face) → unknown, handled by compute_hull_stability
    return coords_entries.map((entry, idx) => ({
      ...entry,
      ...compute_hull_stability(raw_dists[idx], entry.exclude_from_hull),
    }))
  })()

  return {
    entries: enriched_entries,
    elements,
    hull,
    phase_stats: thermo.get_convex_hull_stats(enriched_entries, elements, dim),
  }
}

// Headless model construction uses the same numerical path as every hull renderer.
export function compute_hull_model(
  entries: readonly PhaseData[],
  {
    components,
    energy_source_mode = `precomputed`,
  }: {
    components?: readonly string[]
    energy_source_mode?: EnergySourceMode
  } = {},
): HullModel {
  const processed = thermo.process_hull_entries(entries, components)
  const dim = processed.elements.length
  if (dim !== 2 && dim !== 3 && dim !== 4) {
    throw new Error(`Convex hull models require 2, 3 or 4 components, found ${dim}`)
  }
  const energy_info = compute_energy_mode_info(processed.entries, energy_source_mode, false)
  return build_hull_model(
    apply_formation_energies(processed.entries, energy_info),
    processed.elements,
    dim,
    energy_info.energy_mode,
  )
}
