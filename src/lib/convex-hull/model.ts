// Numerical hull snapshots are independent of rendering, category styling, and visibility.
import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { composition_to_simplex_coords } from './barycentric-coords'
import { compute_hull_stability, is_unary_entry } from './entry-stability'
import * as thermo from './thermodynamics'
import type { ConvexHullEntry, PhaseData, PhaseStats } from './types'

type ReadonlyValue<Value> = Value extends string | number | boolean | bigint | symbol
  ? Value
  : Value extends object
    ? { readonly [Key in keyof Value]: ReadonlyValue<Value[Key]> }
    : Value

// Every facet vertex indexes this one enriched entry table, including when entries are
// excluded from hull construction. Geometry work arrays are not part of the public API.
export type HullModel = ReadonlyValue<{
  entries: ConvexHullEntry[]
  elements: ElementSymbol[]
  facets: thermo.HullFacet[]
  phase_stats: PhaseStats | null
}>

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
  const entries: ConvexHullEntry[] = []
  if (elements.length === dim) {
    for (const entry of effective_entries) {
      const e_form = entry.e_form_per_atom
      if (typeof e_form !== `number` || !Number.isFinite(e_form)) continue
      const is_element = is_unary_entry(entry)
      entries.push({ ...entry, ...plot_position(entry.composition, e_form), is_element })
    }
    for (const element of elements) {
      if (entries.some((entry) => entry.is_element && entry.composition[element])) continue
      const composition = { [element]: 1 } as CompositionType
      entries.push({
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
  }

  // Lower hull over the non-excluded entries (always built: 3D/4D draw its faces)
  const hull_indices = entries.flatMap((entry, idx) => (entry.exclude_from_hull ? [] : [idx]))
  const hull_points = hull_indices.map((idx) => hull_point(entries[idx], dim))
  const hull_facets = thermo.compute_lower_hull_nd(hull_points)

  // Entries with e_above_hull/is_stable: from the data when precomputed, else from the hull
  if (energy_mode === `on-the-fly`) {
    // No facets means every hull point sits at E_form = 0 (the corners always do), so the
    // hull is that plane and the distance is E_form itself
    const raw_dists =
      hull_facets.length === 0
        ? entries.map((entry) => entry.e_form_per_atom)
        : thermo.compute_e_above_hull_nd(
            entries.map((entry) => hull_point(entry, dim)),
            hull_facets,
            hull_points,
          )
    // non-finite distance (no covering hull face) → unknown, handled by compute_hull_stability
    for (const [idx, entry] of entries.entries()) {
      Object.assign(entry, compute_hull_stability(raw_dists[idx], entry.exclude_from_hull))
    }
  }

  return {
    entries,
    elements,
    facets: hull_facets.map((facet) => ({
      ...facet,
      vertex_indices: facet.vertex_indices.map((idx) => hull_indices[idx]),
    })),
    phase_stats: thermo.get_convex_hull_stats(entries, elements, dim),
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
