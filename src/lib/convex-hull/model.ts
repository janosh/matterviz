// Numerical hull snapshots are independent of rendering, category styling, and visibility.
import type { CompositionType } from '#lib/composition/index'
import { get_electro_neg_formula } from '#lib/composition/format'
import { parse_composition } from '#lib/composition/parse'
import { count_atoms_in_composition, get_reduced_formula } from '#lib/composition/reduce'
import type { ElementSymbol } from '#lib/element/index'
import { solve_linear_program } from '#lib/math'
import { to_error } from 'svelte-widgets/utils'
import { composition_to_simplex_coords } from './barycentric-coords'
import { compute_hull_stability, is_unary_entry } from './entry-stability'
import * as thermo from './thermodynamics'
import type { ConvexHullEntry, PhaseData, PhaseStats, ProcessedPhaseData } from './types'

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
// carries E_form and nothing has shifted the energies since it was computed; temperature-
// dependent free energies and gas-pressure corrections change `energy` only, so the hull must
// be rebuilt on the fly for them to have any effect. Without absolute-energy unary references
// nothing can be recomputed and the precomputed values are all there is.
export interface EnergyModeInfo {
  has_precomputed_e_form: boolean
  can_compute: boolean // absolute-energy unary references exist for every element
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
  const unary_refs = thermo.find_lowest_energy_unary_refs(entries)
  // E_form is recomputed from absolute energies, so E_form-only references can't anchor it
  const can_compute = entries.every((entry) =>
    Object.keys(entry.composition).every(
      (element) => element in unary_refs && thermo.has_absolute_energy(unary_refs[element]),
    ),
  )
  // Missing hull distances alone don't force recomputing E_form: build_hull_model fills them
  // from the precomputed E_form
  const energy_mode: EnergySourceMode = !can_compute
    ? `precomputed`
    : corrections_active || !has_precomputed_e_form
      ? `on-the-fly`
      : energy_source_mode
  return { has_precomputed_e_form, can_compute, corrections_active, energy_mode, unary_refs }
}

// Precomputed mode keeps the data's E_form but still computes it for entries that lack one
// and whose elements all have absolute-energy references: temperature filtering drops the 0 K
// E_form of entries with free energies, which vanished from the hull whenever another element
// had only E_form-only unaries
export function apply_formation_energies(
  entries: PhaseData[],
  { energy_mode, unary_refs }: EnergyModeInfo,
): PhaseData[] {
  // an E_form-only reference has no energy to subtract
  const absolute_refs = Object.fromEntries(
    Object.entries(unary_refs).filter(([, ref]) => thermo.has_absolute_energy(ref)),
  )
  return entries.map((entry) => {
    if (energy_mode === `precomputed` && Number.isFinite(entry.e_form_per_atom)) return entry
    // E_form-only entries have nothing to recompute their E_form from
    if (!thermo.has_absolute_energy(entry)) return entry
    const e_form = thermo.compute_e_form_per_atom(entry, absolute_refs)
    return e_form === null ? entry : { ...entry, e_form_per_atom: e_form }
  })
}

// Simplex position with E_form on the last plotted axis (y in 2D, z in 3D, none in 4D)
export function hull_plot_position(
  composition: CompositionType,
  e_form: number,
  elements: ElementSymbol[],
  dim: 2 | 3 | 4,
): { x: number; y: number; z: number } {
  const [coord_x, coord_y = e_form, coord_z = dim === 3 ? e_form : 0] =
    composition_to_simplex_coords(composition, elements)
  return { x: coord_x, y: coord_y, z: coord_z }
}

const hull_point = (entry: ConvexHullEntry, dim: number): number[] =>
  [entry.x, entry.y, entry.z, entry.e_form_per_atom ?? NaN].slice(0, dim)

// Reactive callers already normalize compositions and apply temperature/gas corrections.
export function build_hull_model(
  effective_entries: PhaseData[],
  elements: ElementSymbol[],
  dim: 2 | 3 | 4,
  energy_mode: EnergySourceMode,
) {
  // Plot coordinates: entries with a finite formation energy placed in the simplex, plus
  // synthetic E_form = 0 corners for elements without a reference entry (closes the hull)
  const entries: ConvexHullEntry[] = []
  if (elements.length === dim) {
    for (const entry of effective_entries) {
      const e_form = entry.e_form_per_atom
      if (typeof e_form !== `number` || !Number.isFinite(e_form)) continue
      entries.push({
        ...entry,
        ...hull_plot_position(entry.composition, e_form, elements, dim),
        is_element: is_unary_entry(entry),
      })
    }
    for (const element of elements) {
      // An excluded unary is drawn but cannot anchor the hull, so it still needs the corner
      const anchors = (entry: ConvexHullEntry) =>
        entry.is_element && entry.composition[element] && !entry.exclude_from_hull
      if (entries.some(anchors)) continue
      const composition = { [element]: 1 } as CompositionType
      entries.push({
        composition,
        e_form_per_atom: 0,
        e_above_hull: 0,
        is_stable: true,
        entry_id: `synthetic-element:${element}`,
        ...hull_plot_position(composition, 0, elements, dim),
        is_element: true,
        is_synthetic: true,
      })
    }
  }

  // Lower hull over the non-excluded entries (always built: 3D/4D draw its faces)
  const hull_indices = entries.flatMap((entry, idx) => (entry.exclude_from_hull ? [] : [idx]))
  const hull_points = hull_indices.map((idx) => hull_point(entries[idx], dim))
  const hull_facets = thermo.compute_lower_hull_nd(hull_points)

  // Entries with e_above_hull/is_stable: from the data when precomputed and present, else
  // from the hull (e.g. precomputed E_form without E_above_hull when unary refs are missing)
  const needs_hull_distance = (entry: ConvexHullEntry): boolean =>
    energy_mode === `on-the-fly` || !Number.isFinite(entry.e_above_hull)
  if (entries.some(needs_hull_distance)) {
    const raw_dists =
      hull_facets.length === 0
        ? // flat hull: plane through corners; `elements` are the components of a pseudo-hull
          thermo.e_above_hull_distances(entries, entries, elements)
        : thermo.compute_e_above_hull_nd(
            entries.map((entry) => hull_point(entry, dim)),
            hull_facets,
            hull_points,
          )
    // non-finite distance (no covering hull face) → unknown, handled by compute_hull_stability
    for (const [idx, entry] of entries.entries()) {
      if (!needs_hull_distance(entry)) continue
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

// Chemical potentials (absolute, eV/atom) of elements exchanged with a reservoir
export type OpenElements = Readonly<Partial<Record<ElementSymbol, number>>>

// Normalized composition keys, then (with open elements) the grand-potential projection
// (pymatgen's GrandPotentialPhaseDiagram): Φ = E − Σ μ_el N_el in total eV over the composition
// without the open elements, so the hull is drawn per non-open atom on fewer axes. Entries made
// only of open elements leave the system; closed-system E_form, hull distance and stability are
// dropped (`is_open` forces recomputing them); names keep the full formula (LiCoO2 on Li-Co).
// G(T) data is projected alike.
export function process_model_entries(
  entries: readonly PhaseData[],
  components: readonly string[] | undefined,
  open_elements: OpenElements | undefined,
): ProcessedPhaseData & { is_open: boolean } {
  const processed = thermo.process_hull_entries(entries, components)
  const open = Object.entries(open_elements ?? {}) as [ElementSymbol, number][]
  const open_set = new Set<string>(open.map(([element]) => element))
  if (open.length === 0) return { ...processed, is_open: false }
  if (components) throw new Error(`open_elements cannot be combined with components`)
  for (const [element, chem_pot] of open) {
    if (!Number.isFinite(chem_pot)) {
      throw new TypeError(`open_elements: μ of ${element} must be finite, got ${chem_pot}`)
    }
    if (!processed.elements.includes(element)) {
      throw new Error(
        `open element ${element} is in no entry of the ${processed.elements.join(`-`)} system`,
      )
    }
  }
  const grand = processed.entries.flatMap((entry) => {
    const composition = Object.fromEntries(
      Object.entries(entry.composition).filter(([el]) => !open_set.has(el)),
    ) as CompositionType
    if (!(count_atoms_in_composition(composition) > 0)) return []
    if (!thermo.has_absolute_energy(entry)) {
      throw new Error(
        `open_elements needs absolute energies, entry ${entry.entry_id ?? JSON.stringify(entry.composition)} has none`,
      )
    }
    const open_energy = open.reduce(
      (energy, [element, chem_pot]) => energy + chem_pot * (entry.composition[element] ?? 0),
      0,
    )
    const n_atoms = count_atoms_in_composition(entry.composition)
    const grand_energy = thermo.get_energy_per_atom(entry) * n_atoms - open_energy
    const {
      e_form_per_atom: _e_form,
      e_above_hull: _hull,
      is_stable: _stable,
      energy_per_atom: _per_atom,
      correction: _correction,
      energy_adjustments: _adjustments,
      free_energies,
      ...rest
    } = entry
    const name =
      entry.reduced_formula ??
      entry.name ??
      get_electro_neg_formula(get_reduced_formula(entry.composition), {
        plain_text: true,
        delim: ``,
      })
    // G(T) per atom projects like the energy, per non-open atom, so a temperature still applies
    const n_closed = count_atoms_in_composition(composition)
    const grand_free_energies = free_energies?.map(
      (free_energy) => (free_energy * n_atoms - open_energy) / n_closed,
    )
    return [
      {
        ...rest,
        composition,
        full_composition: entry.composition,
        energy: grand_energy,
        name,
        ...(grand_free_energies && { free_energies: grand_free_energies }),
      },
    ]
  })
  const projected = thermo.process_hull_entries(grand)
  const missing = missing_open_reference(projected.entries, projected.elements)
  if (missing) throw new Error(missing)
  return { ...projected, is_open: true }
}

// Why grand-potential entries can't be drawn: an element without a unary reference (every grand
// entry has an absolute energy, so that is all each element needs). Rechecked after the
// temperature filter, which can drop a reference tabulated at other temperatures only.
export function missing_open_reference(
  entries: PhaseData[],
  elements: readonly ElementSymbol[],
  temperature?: number,
): string | null {
  const refs = thermo.find_lowest_energy_unary_refs(entries)
  const missing = elements.filter((element) => !(element in refs))
  if (missing.length === 0) return null
  const at_temp = temperature === undefined ? `` : ` at ${temperature} K`
  return `open_elements needs an elemental reference for ${missing.join(`, `)}${at_temp}`
}

// The last submitted probe formula, the probe it set (as read back from the binding, so a host
// replacement is told apart by identity) and why it failed, if it did
export type ProbeSubmission = {
  text: string
  probe: CompositionType | null
  error: string | null
}

// A probe formula in model coordinates (null when empty or outside the system) and the error to
// show; `probe` is absent when the formula can't be read, so the current probe stays
export function probe_from_text(
  text: string,
  components: readonly string[] | undefined,
  open_elements: OpenElements | undefined,
  elements: readonly string[],
): { probe?: CompositionType | null; error: string | null } {
  try {
    const parsed = text ? parse_composition(text) : null
    const probe = parsed && to_model_composition(parsed, components, open_elements)
    const outside = parsed && !probe
    return {
      probe,
      error: outside ? `${text} is outside the ${elements.join(`-`)} system` : null,
    }
  } catch (err) {
    return {
      error: `Can't parse ${text}: ${to_error(err).message}`,
    }
  }
}

// An element composition (e.g. a probed formula) in the model's composition keys: without
// the open elements, or with components the non-negative amount of each whose elements sum
// to it (A x = b, x >= 0). Null when the system can't make it. Throws for linearly dependent
// components, which give a formula several amount vectors, each a different hull point.
export function to_model_composition(
  composition: CompositionType,
  components: readonly string[] | undefined,
  open_elements: OpenElements | undefined,
): CompositionType | null {
  const open_set = new Set(Object.keys(open_elements ?? {}))
  let model: Record<string, number> = Object.fromEntries(
    Object.entries(composition).filter(([el, amt]) => amt > 0 && !open_set.has(el)),
  )
  if (components) {
    const component_comps = components.map((component) => parse_composition(component))
    const keys = [...new Set([model, ...component_comps].flatMap(Object.keys))]
    const column = (comp: CompositionType) => keys.map((el) => comp[el as ElementSymbol] ?? 0)
    // the first component that is a signed combination of those before it (x = x⁺ − x⁻)
    for (let idx = 1; idx < components.length; idx++) {
      const before = component_comps.slice(0, idx).map(column)
      const { status, solution } = solve_linear_program(
        before.flatMap(() => [0, 0]),
        keys.map((_, row) => before.flatMap((col) => [col[row], -col[row]])),
        column(component_comps[idx]),
      )
      if (status !== `optimal`) continue
      const terms = before.flatMap((_, col_idx) => {
        const amount = solution[2 * col_idx] - solution[2 * col_idx + 1]
        return Math.abs(amount) > 1e-9
          ? [`${Number(amount.toPrecision(6))} ${components[col_idx]}`]
          : []
      })
      throw new Error(
        `components ${components.join(`, `)} are linearly dependent: ${components[idx]} = ${terms.join(` + `)}`,
      )
    }
    const { status, solution } = solve_linear_program(
      components.map(() => 0),
      keys.map((_, row) => component_comps.map((comp) => column(comp)[row])),
      column(model),
    )
    if (status !== `optimal`) return null
    model = Object.fromEntries(
      components.flatMap((component, idx) =>
        solution[idx] > 0 ? [[component, solution[idx]]] : [],
      ),
    )
  }
  return Object.keys(model).length > 0 ? model : null
}

// Headless model construction uses the same numerical path as every hull renderer.
export function compute_hull_model(
  entries: readonly PhaseData[],
  {
    components,
    energy_source_mode = `precomputed`,
    open_elements,
  }: {
    components?: readonly string[]
    energy_source_mode?: EnergySourceMode
    open_elements?: OpenElements
  } = {},
): HullModel {
  const { is_open, ...processed } = process_model_entries(entries, components, open_elements)
  const dim = processed.elements.length
  if (dim !== 2 && dim !== 3 && dim !== 4) {
    throw new Error(`Convex hull models require 2, 3 or 4 components, found ${dim}`)
  }
  // Grand potentials replace every energy, so formation energies must be recomputed from them
  const energy_info = compute_energy_mode_info(processed.entries, energy_source_mode, is_open)
  return build_hull_model(
    apply_formation_energies(processed.entries, energy_info),
    processed.elements,
    dim,
    energy_info.energy_mode,
  )
}
