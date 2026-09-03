import { type D3InterpolateName, get_d3_interpolator } from '$lib/colors'
import type { ElementSymbol } from '$lib/element'
import { count_atoms_in_composition } from '$lib/composition/reduce'
import { drop_cached_hull_data } from './thermodynamics'
import { element_by_symbol } from '$lib/element/data'
import { format_fractional, format_num } from '$lib/labels'
import { array_extent, array_max } from '$lib/math'
import { scaleSequential } from 'd3-scale'
import type {
  ConvexHullConfig,
  EntryCategoryConfig,
  HighlightStyle,
  MarkerSymbol,
  PhaseData,
} from './types'
import { DEFAULT_HULL_COLORS, MAGNETIC_ORDERING_CATEGORY } from './types'
import { entry_is_stable, is_unary_entry } from './entry-stability'

export {
  compute_hull_stability,
  entry_is_stable,
  get_arity,
  HULL_STABILITY_TOL,
  is_on_hull,
  is_unary_entry,
} from './entry-stability'

type StabilityEntry = { is_stable?: boolean; e_above_hull?: number }

const is_finite = (val: unknown): val is number =>
  typeof val === `number` && Number.isFinite(val)

// Finite hull distances only: NaN/undefined would otherwise poison every range below
const finite_hull_dists = (entries: readonly StabilityEntry[]): number[] =>
  entries.map((entry) => entry.e_above_hull).filter(is_finite)

// [min, max] energy above hull across entries, for ColorBar ranges (max floored at 0.1)
export const hull_distance_range = (entries: PhaseData[]): [number, number] => {
  const dists = finite_hull_dists(entries)
  if (dists.length === 0) return [0, 0.1]
  const [min_dist, max_dist] = array_extent(dists)
  return [min_dist, Math.max(max_dist, 0.1)]
}

// Whether to plot an entry at a given max hull distance: stable, or a finite distance
// within max_dist. Unknown distance (undefined) is excluded, not treated as 0/stable.
export const entry_within_hull_dist = (entry: StabilityEntry, max_dist: number): boolean =>
  entry_is_stable(entry) ||
  (typeof entry.e_above_hull === `number` && entry.e_above_hull <= max_dist)

// === Entry category helpers (generic categorical classification) ===

// Loose entry shape for category resolution (any PhaseData-like object qualifies)
type CategorySource = Pick<PhaseData, `data` | `attributes`>

// Normalize a raw value to a canonical category value: case-insensitive match against
// config.markers keys, then config.aliases. Returns null for unrecognized values.
function normalize_category_value(raw: unknown, config: EntryCategoryConfig): string | null {
  if (typeof raw !== `string`) return null
  const lower = raw.trim().toLowerCase()
  if (!lower) return null
  const canonical = Object.keys(config.markers).find((value) => value.toLowerCase() === lower)
  if (canonical) return canonical
  const alias = config.aliases?.[lower]
  return alias && alias in config.markers ? alias : null
}

// Resolve an entry's category: first *recognized* value wins. Properties are checked in
// config order (property-major), each looked up top-level, then in the pymatgen `data`
// and Materials Project `attributes` dicts — so a `magnetic_ordering` in any source
// beats a generic `ordering`. Unrecognized values (e.g. MP's ordering='Unknown') fall
// through; returns null when none resolve.
export function get_entry_category(
  entry: CategorySource,
  config: EntryCategoryConfig | null | undefined,
): string | null {
  if (!config) return null
  const props = Array.isArray(config.property) ? config.property : [config.property]
  for (const prop of props) {
    for (const source of [entry as Record<string, unknown>, entry.data, entry.attributes]) {
      if (!source) continue
      const value = normalize_category_value(source[prop], config)
      if (value) return value
    }
  }
  return null
}

// Assign default marker shapes by category (per config.markers). Explicit entry.marker
// values win. Returns the input array unchanged when no marker was assigned (e.g. when
// config is null or entries lack category data).
export function apply_category_markers(
  entries: (PhaseData & { marker?: MarkerSymbol })[],
  config: EntryCategoryConfig | null | undefined,
): (PhaseData & { marker?: MarkerSymbol })[] {
  if (!config) return entries
  let any_assigned = false
  const result = entries.map((entry) => {
    const value = entry.marker ? null : get_entry_category(entry, config)
    if (!value) return entry
    any_assigned = true
    return { ...entry, marker: config.markers[value] }
  })
  return any_assigned ? result : entries
}

// Entries shown given the stable/unstable toggles and hidden category values
export const visible_entries = <Entry extends StabilityEntry & CategorySource>(
  entries: readonly Entry[],
  show_stable: boolean,
  show_unstable: boolean,
  category: EntryCategoryConfig | null = null,
  hidden_categories: readonly string[] = [],
): Entry[] =>
  entries.filter((entry) => {
    if (!(entry_is_stable(entry) ? show_stable : show_unstable)) return false
    if (!category || hidden_categories.length === 0) return true
    const value = get_entry_category(entry, category)
    return value === null || !hidden_categories.includes(value)
  })

// Energy color scale factory (shared)
export function get_energy_color_scale(
  color_mode: `stability` | `energy`,
  color_scale: D3InterpolateName,
  plot_entries: { e_above_hull?: number }[],
): ((value: number) => string) | null {
  const dists = color_mode === `energy` ? finite_hull_dists(plot_entries) : []
  if (dists.length === 0) return null
  const [lo, max_dist] = array_extent(dists)
  const hi = Math.max(max_dist, 0.1, lo + 1e-6)
  const interpolator = get_d3_interpolator(color_scale)
  return scaleSequential(interpolator).domain([lo, hi])
}

// Point color resolver (shared)
export function get_point_color_for_entry(
  entry: { is_stable?: boolean; e_above_hull?: number },
  color_mode: `stability` | `energy`,
  colors: ConvexHullConfig[`colors`] | undefined,
  energy_scale: ((value: number) => string) | null,
): string {
  const is_stable = entry_is_stable(entry)
  if (color_mode === `stability`) {
    return (
      colors?.[is_stable ? `stable` : `unstable`] ??
      DEFAULT_HULL_COLORS[is_stable ? `stable` : `unstable`]
    )
  }
  return energy_scale && typeof entry.e_above_hull === `number`
    ? energy_scale(entry.e_above_hull)
    : `#666`
}

// Compute a consistent max energy threshold for controls (shared)
export function calc_max_hull_dist_in_data(processed_entries: PhaseData[]): number {
  if (processed_entries.length === 0) return 0.5
  const max_hull_dist = Math.max(0, array_max(finite_hull_dists(processed_entries)))
  return Math.max(0.1, max_hull_dist + 0.001)
}

// Smart threshold for showing unstable entries based on entry count.
// Few entries (≤25): show all. Many entries (≥100): use static default. Between: interpolate.
export function compute_auto_hull_dist_threshold(
  n_entries: number,
  max_hull_dist_in_data: number,
  static_default: number,
): number {
  const [LOW, HIGH] = [25, 100]
  if (n_entries <= LOW) return max_hull_dist_in_data
  if (n_entries >= HIGH) return static_default
  const frac = (n_entries - LOW) / (HIGH - LOW)
  return max_hull_dist_in_data * (1 - frac) + static_default * frac
}

// Returns the threshold to apply when the data source changes (undefined = leave as is).
// A user adjustment away from the previous auto value is preserved across source changes.
export function auto_threshold_reset(default_threshold: number) {
  let source: unknown
  let auto_threshold = default_threshold
  let initialized = false
  return (next_source: unknown, current_threshold: number, next_auto_threshold: number) => {
    if (initialized && next_source === source) return undefined
    const user_changed = initialized && Math.abs(current_threshold - auto_threshold) > 0.001
    source = next_source
    auto_threshold = next_auto_threshold
    initialized = true
    return user_changed ? undefined : next_auto_threshold
  }
}

// The entry in `entries` that is the same logical entry as `entry` (by id, else identity)
export function current_entry<Entry extends { entry_id?: string }>(
  entry: Entry | null | undefined,
  entries: readonly Entry[],
): Entry | null {
  if (!entry) return null
  if (entry.entry_id) {
    return entries.find((candidate) => candidate.entry_id === entry.entry_id) ?? null
  }
  return entries.includes(entry) ? entry : null
}

// Same logical entry: same object or same entry_id. The id check is proxy-safe — a raw
// plot entry equals its $state-proxied copy, so the selection effect doesn't reassign
// forever (effect_update_depth_exceeded) on identity mismatch.
export function same_entry<Entry extends { entry_id?: string }>(
  entry_a: Entry | null | undefined,
  entry_b: Entry | null | undefined,
): boolean {
  if (entry_a === entry_b) return true
  if (!entry_a || !entry_b) return false
  return entry_a.entry_id != null && entry_a.entry_id === entry_b.entry_id
}

// Normalized composition (fractions summing to 1), dropping non-positive amounts
function get_fractional_composition(
  composition: Record<string, number>,
): Record<string, number> {
  const total = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
  if (total <= 0) return {}
  const fractional: Record<string, number> = {}
  for (const [elem, amt] of Object.entries(composition)) {
    if (amt > 0) fractional[elem] = amt / total
  }
  return fractional
}

// Plain-text summary of an entry (copied to the clipboard on double click)
export function build_entry_tooltip_text(
  entry: PhaseData,
  category: EntryCategoryConfig | null = MAGNETIC_ORDERING_CATEGORY,
): string {
  const is_element = is_unary_entry(entry)
  const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``
  const elem_name = element_by_symbol.get(elem_symbol as ElementSymbol)?.name ?? ``

  let text = is_element
    ? `${elem_symbol}${elem_name ? ` (${elem_name})` : ``}\n`
    : `${entry.name ?? entry.reduced_formula ?? ``}\n`

  if (!is_element) {
    const fractions = Object.entries(get_fractional_composition(entry.composition)).map(
      ([elem, frac]) => `${elem}: ${format_fractional(frac)}`,
    )
    if (fractions.length > 1) text += `Composition: ${fractions.join(`, `)}\n`
  }

  if (entry.e_above_hull !== undefined) {
    text += `E<sub>above hull</sub>: ${format_num(entry.e_above_hull, `.3~`)} eV/atom\n`
  }
  // Fallback to energy_per_atom if e_form_per_atom is absent
  const e_form_display = entry.e_form_per_atom ?? entry.energy_per_atom
  if (e_form_display !== undefined) {
    text += `E<sub>form</sub>: ${format_num(e_form_display, `.3~`)} eV/atom`
  }
  const category_value = get_entry_category(entry, category)
  if (category && category_value) text += `\n${category.label}: ${category_value}`
  if (entry.entry_id) text += `\nID: ${entry.entry_id}`
  return text
}

// Shared CSS custom-property block for hull wrapper styling (2D/3D/4D)
export const hull_style_css = (colors: ConvexHullConfig[`colors`] | undefined): string =>
  `--hull-stable-color: ${colors?.stable ?? DEFAULT_HULL_COLORS.stable}; --hull-unstable-color: ${colors?.unstable ?? DEFAULT_HULL_COLORS.unstable}`

const DEFAULT_HIGHLIGHT_STYLE: Required<HighlightStyle> = {
  effect: `pulse`,
  color: `#ff4444`,
  size_multiplier: 1.8,
  opacity: 0.85,
  pulse_speed: 3,
}

export const merge_highlight_style = (
  custom_style: HighlightStyle | undefined,
): Required<HighlightStyle> => ({ ...DEFAULT_HIGHLIGHT_STYLE, ...custom_style })

// Check if entry matches any item in highlighted_list (by structure_id or entry_id)
export function is_entry_highlighted<T extends { entry_id?: string; structure_id?: string }>(
  entry: T,
  highlighted_list: (string | T)[],
): boolean {
  if (highlighted_list.length === 0) return false
  const { entry_id, structure_id } = entry
  if (!entry_id && !structure_id) return false

  return highlighted_list.some((item) => {
    if (typeof item === `string`) {
      return item === entry_id || item === structure_id
    }
    // Object: match by structure_id if present, else fall back to entry_id
    return item?.structure_id
      ? structure_id === item.structure_id
      : item?.entry_id === entry_id
  })
}

// === Polymorph statistics ===

export interface PolymorphStats {
  total: number
  higher: number
  lower: number
  equal: number
}

// Energy metric types for consistent polymorph comparison
type EnergyMetric = `e_form_per_atom` | `energy_per_atom` | `e_above_hull` | null

// Compute energy_per_atom from total energy and composition
function compute_energy_per_atom(entry: PhaseData): number | null {
  if (!is_finite(entry.energy)) return null
  const total_atoms = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)
  return total_atoms > 0 ? entry.energy / total_atoms : null
}

// Energy value per metric, null when the entry cannot supply it. Key order is the preference
// order a composition group picks from.
// NOTE: We prioritize absolute energies (e_form_per_atom, energy_per_atom) over e_above_hull
// because polymorphs of the same composition on the hull all have e_above_hull=0
const METRIC_ENERGY: Record<
  Exclude<EnergyMetric, null>,
  (entry: PhaseData) => number | null
> = {
  e_form_per_atom: (entry) =>
    is_finite(entry.e_form_per_atom) ? entry.e_form_per_atom : null,
  energy_per_atom: (entry) =>
    is_finite(entry.energy_per_atom) ? entry.energy_per_atom : compute_energy_per_atom(entry),
  e_above_hull: (entry) => (is_finite(entry.e_above_hull) ? entry.e_above_hull : null),
}

function get_label_representative_energy(entry: PhaseData): number {
  if (is_finite(entry.e_form_per_atom)) return entry.e_form_per_atom
  if (is_finite(entry.energy_per_atom)) return entry.energy_per_atom
  const energy_per_atom = compute_energy_per_atom(entry)
  if (energy_per_atom !== null) return energy_per_atom
  if (is_finite(entry.energy)) return entry.energy
  if (is_finite(entry.e_above_hull)) return entry.e_above_hull
  return Number.POSITIVE_INFINITY
}

const get_fractional_composition_key = (composition: Record<string, number>): string =>
  Object.entries(get_fractional_composition(composition))
    .toSorted(([elem_a], [elem_b]) => elem_a.localeCompare(elem_b))
    .map(([elem, frac]) => `${elem}:${frac.toFixed(6)}`)
    .join(`|`)

// Pick one label target per normalized composition. Multiple polymorphs, supercell
// formulas, or same-composition entries often project to the same screen position.
export function get_composition_label_entries<T extends PhaseData>(entries: Iterable<T>): T[] {
  const label_entry_by_composition = new Map<string, T>()

  for (const entry of entries) {
    const comp_key = get_fractional_composition_key(entry.composition)
    if (!comp_key) continue

    const existing = label_entry_by_composition.get(comp_key)
    if (
      !existing ||
      get_label_representative_energy(entry) < get_label_representative_energy(existing)
    ) {
      label_entry_by_composition.set(comp_key, entry)
    }
  }

  return Array.from(label_entry_by_composition.values())
}

// The first metric EVERY entry in a composition group can provide, else null
const select_group_energy_metric = (polymorphs: PhaseData[]): EnergyMetric =>
  (Object.keys(METRIC_ENERGY) as Exclude<EnergyMetric, null>[]).find((metric) =>
    polymorphs.every((entry) => METRIC_ENERGY[metric](entry) !== null),
  ) ?? null

// Pre-compute polymorph statistics for all entries at once (O(n²) but done once)
// Returns a Map keyed by entry_id for O(1) lookups during hover
export function compute_all_polymorph_stats(
  all_entries: PhaseData[],
): Map<string, PolymorphStats> {
  const stats_map = new Map<string, PolymorphStats>()
  const zero_stats = { total: 0, higher: 0, lower: 0, equal: 0 }

  // Calculate stats for each polymorph group (grouped by normalized stoichiometry)
  const composition_groups = Map.groupBy(all_entries, (entry) =>
    get_fractional_composition_key(entry.composition),
  )
  for (const polymorphs of composition_groups.values()) {
    // Select one consistent metric for the entire composition group
    const group_metric = select_group_energy_metric(polymorphs)

    // If no valid metric available, set all entries in group to zero stats
    if (group_metric === null) {
      for (const entry of polymorphs) {
        if (entry.entry_id) stats_map.set(entry.entry_id, zero_stats)
      }
      continue
    }

    // Compare entries using the consistent group metric
    for (const entry of polymorphs) {
      if (!entry.entry_id) continue

      const entry_energy = METRIC_ENERGY[group_metric](entry)
      if (entry_energy === null) {
        stats_map.set(entry.entry_id, zero_stats)
        continue
      }

      let [total, higher, lower, equal] = [0, 0, 0, 0]
      for (const other of polymorphs) {
        if (other === entry || other.entry_id === entry.entry_id) continue

        const other_energy = METRIC_ENERGY[group_metric](other)
        if (other_energy === null) continue

        total++
        if (other_energy > entry_energy) higher++
        else if (other_energy < entry_energy) lower++
        else equal++
      }

      stats_map.set(entry.entry_id, { total, higher, lower, equal })
    }
  }

  return stats_map
}

// === Temperature-dependent free energies (use integer K values for exact matching) ===

// Result of analyzing entries for temperature-dependent data
export interface TemperatureAnalysis {
  has_temp_data: boolean
  available_temperatures: number[] // sorted unique T values (union across all entries)
}

// Analyze entries for temperature-dependent free energy data.
// Returns available temperatures (union of all T values across entries) if any entries have temp data.
export function analyze_temperature_data(entries: PhaseData[]): TemperatureAnalysis {
  const unique_temperatures = new Set<number>()
  for (const entry of entries) {
    if (!entry_has_temp_data(entry)) continue
    for (const temperature of entry.temperatures ?? []) unique_temperatures.add(temperature)
  }
  const available_temperatures = [...unique_temperatures].toSorted((a, b) => a - b)
  return {
    has_temp_data: available_temperatures.length > 0,
    available_temperatures,
  }
}

// Check if an entry has valid temperature-dependent data (matching array lengths, non-empty)
function entry_has_temp_data(entry: PhaseData): boolean {
  const { temperatures, free_energies } = entry
  return Boolean(
    temperatures?.length &&
    free_energies?.length &&
    temperatures.length === free_energies.length,
  )
}

// Linearly interpolated G(T) between the tightest tabulated temperatures bracketing
// `temperature` (below < T < above); null when T is outside the tabulated range or the bracket
// is wider than `max_gap`. Scans every entry: the arrays may be unsorted.
export function interpolate_energy_at_temperature(
  entry: PhaseData,
  temperature: number,
  max_gap: number,
): number | null {
  const temps = entry.temperatures ?? []
  const energies = entry.free_energies ?? []
  if (temps.length < 2) return null
  let [temp_below, temp_above] = [-Infinity, Infinity]
  let [energy_below, energy_above] = [0, 0]
  for (const [idx, temp] of temps.entries()) {
    if (temp < temperature && temp > temp_below) {
      temp_below = temp
      energy_below = energies[idx]
    } else if (temp > temperature && temp < temp_above) {
      temp_above = temp
      energy_above = energies[idx]
    }
  }
  if (!Number.isFinite(temp_below) || !Number.isFinite(temp_above)) return null
  if (temp_above - temp_below > max_gap) return null
  const fraction = (temperature - temp_below) / (temp_above - temp_below)
  return energy_below + (energy_above - energy_below) * fraction
}

// Options for temperature filtering
export interface TemperatureFilterOptions {
  // Enable linear interpolation for missing temperatures (default: true)
  interpolate?: boolean
  // Maximum temperature gap (in Kelvin) allowed for interpolation (default: 500K)
  max_interpolation_gap?: number
}

// Filter entries for temperature T, replacing energy with G(T) where available.
// - Entries WITH temp data at T: use G(T) as energy
// - Entries WITHOUT any temp data: keep with static energy (e.g., pure element refs)
// - Entries WITH temp data but MISSING T: interpolate if enabled and possible, else excluded
export function filter_entries_at_temperature(
  entries: PhaseData[],
  temperature: number,
  { interpolate = true, max_interpolation_gap = 500 }: TemperatureFilterOptions = {},
): PhaseData[] {
  return entries.flatMap((entry) => {
    if (!entry_has_temp_data(entry)) return [entry] // no temp data: keep static energy
    // free_energies stores per-atom G(T) = E_0K/atom + F_vib/atom; `energy` stays a total so
    // downstream formation energies use G(T) under the same contract as 0 K entries
    const exact_idx = entry.temperatures?.indexOf(temperature) ?? -1
    const energy_per_atom =
      exact_idx !== -1
        ? entry.free_energies?.[exact_idx]
        : interpolate
          ? interpolate_energy_at_temperature(entry, temperature, max_interpolation_gap)
          : null
    if (energy_per_atom == null) return []
    const energy = energy_per_atom * count_atoms_in_composition(entry.composition)
    // G(T) already carries the MP correction; keeping it would double-apply. Everything cached
    // from the 0 K energy goes too, or the hull prefers it.
    return [
      drop_cached_hull_data({
        ...entry,
        energy,
        energy_per_atom,
        correction: undefined,
        energy_adjustments: undefined,
      }),
    ]
  })
}

// Copy of `entry` holding only `composition` (cloned) and the listed keys, so worker
// payloads and fingerprints carry the fields the computation reads and never the structures
// or calculation metadata. Undefined fields are left out rather than copied as `undefined`.
export function slim_phase_entry<Key extends keyof PhaseData>(
  entry: PhaseData,
  keys: readonly Key[],
): Pick<PhaseData, Key | `composition`> {
  const slim = { composition: { ...entry.composition } } as Pick<
    PhaseData,
    Key | `composition`
  >
  for (const key of keys) if (entry[key] !== undefined) slim[key] = entry[key]
  return slim
}

// Derive a display label for a convex hull entry, falling back to composition
// when reduced_formula and name are both missing.
export function get_entry_label(
  entry: Pick<PhaseData, `reduced_formula` | `name` | `composition`>,
  elements?: ElementSymbol[],
): string {
  if (entry.reduced_formula) return entry.reduced_formula
  if (entry.name) return entry.name
  type Pairs = [ElementSymbol, number][]
  let pairs = Object.entries(entry.composition).filter(([, amt]) => (amt ?? 0) > 0) as Pairs
  if (elements) {
    pairs = pairs.toSorted(([el1], [el2]) => elements.indexOf(el1) - elements.indexOf(el2))
  }
  return pairs
    .map(([el, amt]) => (Math.abs(amt - 1) < 1e-6 ? el : `${el}${format_num(amt, `.2~`)}`))
    .join(``)
}
