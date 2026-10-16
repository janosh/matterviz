import type { ElementSymbol } from '#lib/element/index.js'
import { count_atoms_in_composition } from '#lib/composition/reduce.js'
import {
  drop_cached_hull_data,
  entry_has_temp_data,
  get_hull_decomposition,
  system_fractions,
} from './thermodynamics'
import { hull_plot_position } from './model'
import { element_by_symbol } from '#lib/element/data.js'
import { format_fractional, format_num } from '#lib/labels.js'
import { array_extent, array_max, type Point3D } from '#lib/math.js'
import { bisectLeft, bisectRight } from 'd3-array'
import { resolve_color_scale } from '#lib/plot/core/scales.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import type {
  ConvexHullConfig,
  ConvexHullEntry,
  EntryCategoryConfig,
  HighlightStyle,
  HullAnnotations,
  HullMark,
  HullOverlay,
  MarkerSymbol,
  PhaseData,
} from './types'
import { DEFAULT_HULL_COLORS } from './types'
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
export const hull_distance_range = (entries: readonly StabilityEntry[]): [number, number] => {
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

// Canonical category value: case-insensitive match on config.markers keys, then aliases
function normalize_category_value(raw: unknown, config: EntryCategoryConfig): string | null {
  if (typeof raw !== `string`) return null
  const lower = raw.trim().toLowerCase()
  if (!lower) return null
  const canonical = Object.keys(config.markers).find((value) => value.toLowerCase() === lower)
  if (canonical) return canonical
  const alias = config.aliases?.[lower]
  return alias && alias in config.markers ? alias : null
}

// An entry's category: the first *recognized* value of config properties in order, each looked
// up top-level, then in pymatgen `data` and MP `attributes` (so `magnetic_ordering` anywhere
// beats a generic `ordering`). Unrecognized values (MP's ordering='Unknown') fall through.
export function get_entry_category(
  entry: CategorySource,
  config: EntryCategoryConfig | null,
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

// Default marker shapes by category (explicit entry.marker wins). Returns the input array
// unchanged when no marker was assigned.
export function apply_category_markers<Entry extends PhaseData & { marker?: MarkerSymbol }>(
  entries: Entry[],
  config: EntryCategoryConfig | null,
): (Entry & { marker?: MarkerSymbol })[] {
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
  category: EntryCategoryConfig | null,
  hidden_categories: readonly string[],
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
  color_scale: ColorScale, // unset value_range ends fit the entries' hull distances
  plot_entries: { e_above_hull?: number }[],
): ((value: number) => string) | null {
  if (color_mode !== `energy` || finite_hull_dists(plot_entries).length === 0) return null
  return resolve_color_scale(color_scale, hull_distance_range(plot_entries)).color_fn
}

// Point color resolver (shared)
export function get_point_color_for_entry(
  entry: { is_stable?: boolean; e_above_hull?: number },
  color_mode: `stability` | `energy`,
  colors: ConvexHullConfig[`colors`] | undefined,
  energy_scale: ((value: number) => string) | null,
): string {
  if (color_mode === `stability`) {
    const key = entry_is_stable(entry) ? `stable` : `unstable`
    return colors?.[key] ?? DEFAULT_HULL_COLORS[key]
  }
  return energy_scale && typeof entry.e_above_hull === `number`
    ? energy_scale(entry.e_above_hull)
    : `#666`
}

// Compute a consistent max energy threshold for controls (shared)
export function calc_max_hull_dist_in_data(processed_entries: readonly PhaseData[]): number {
  if (processed_entries.length === 0) return 0.5
  const max_hull_dist = Math.max(0, array_max(finite_hull_dists(processed_entries)))
  return Math.max(0.1, max_hull_dist + 0.001)
}

// Hull distance threshold by entry count: all for ≤25, static default for ≥100, else blended
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

// Threshold to apply when the data source changes (undefined = leave as is), preserving a
// user adjustment away from the previous auto value
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
  entry: { entry_id?: string } | null | undefined,
  entries: readonly Entry[],
): Entry | null {
  if (!entry) return null
  if (entry.entry_id) {
    return entries.find((candidate) => candidate.entry_id === entry.entry_id) ?? null
  }
  return entries.find((candidate) => candidate === entry) ?? null
}

// Same object or same entry_id. The id check is proxy-safe: a raw entry equals its $state
// proxy, else the selection effect reassigns forever (effect_update_depth_exceeded).
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
  category: EntryCategoryConfig | null,
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

  // Plain text for the clipboard: no markup, and no absolute energy passed off as E_form
  if (entry.e_above_hull !== undefined) {
    text += `E_above_hull: ${format_num(entry.e_above_hull, `.3~`)} eV/atom\n`
  }
  if (entry.e_form_per_atom !== undefined) {
    text += `E_form: ${format_num(entry.e_form_per_atom, `.3~`)} eV/atom`
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
    if (typeof item === `string`) return item === entry_id || item === structure_id
    // Object: match by structure_id if present, else by a defined entry_id
    if (item?.structure_id) return structure_id === item.structure_id
    return item?.entry_id !== undefined && item.entry_id === entry_id
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

// Energy per metric (null if unavailable), keys in preference order. Absolute energies come
// before e_above_hull since same-composition polymorphs on the hull all have e_above_hull=0.
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

// The first metric an entry can supply, in METRIC_ENERGY's preference order
function get_label_representative_energy(entry: PhaseData): number {
  for (const metric_energy of Object.values(METRIC_ENERGY)) {
    const energy = metric_energy(entry)
    if (energy !== null) return energy
  }
  return Number.POSITIVE_INFINITY
}

const get_fractional_composition_key = (composition: Record<string, number>): string =>
  Object.entries(get_fractional_composition(composition))
    .toSorted(([elem_a], [elem_b]) => elem_a.localeCompare(elem_b))
    .map(([elem, frac]) => `${elem}:${frac.toFixed(6)}`)
    .join(`|`)

// One label target per normalized composition (polymorphs and supercell formulas share a spot)
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

// Polymorph stats keyed by entry_id: rank each composition's energies once, then exclude
// same-ID entries by their ranks
export function compute_all_polymorph_stats(
  all_entries: PhaseData[],
): Map<string, PolymorphStats> {
  const stats_map = new Map<string, PolymorphStats>()
  const zero_stats = { total: 0, higher: 0, lower: 0, equal: 0 }
  const composition_groups = Map.groupBy(all_entries, (entry) =>
    get_fractional_composition_key(entry.composition),
  )
  for (const polymorphs of composition_groups.values()) {
    const group_metric = select_group_energy_metric(polymorphs)
    if (group_metric === null) {
      for (const entry of polymorphs) {
        if (entry.entry_id) stats_map.set(entry.entry_id, zero_stats)
      }
      continue
    }

    // The selected metric is finite for every entry, including anonymous competitors.
    const ranked = polymorphs.map((entry) => ({
      id: entry.entry_id,
      energy: METRIC_ENERGY[group_metric](entry) as number,
    }))
    const ascending = (left: number, right: number) => left - right
    const energies = ranked.map(({ energy }) => energy).toSorted(ascending)
    for (const [identifier, same_id] of Map.groupBy(ranked, (entry) => entry.id)) {
      if (!identifier) continue
      // Duplicate IDs retain the last entry's result, excluding every copy of that ID.
      const energy = same_id[same_id.length - 1].energy
      const own = same_id.map((entry) => entry.energy).toSorted(ascending)
      const total = energies.length - own.length
      const lower = bisectLeft(energies, energy) - bisectLeft(own, energy)
      const higher = total - (bisectRight(energies, energy) - bisectRight(own, energy))
      stats_map.set(identifier, { total, higher, lower, equal: total - higher - lower })
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

// Snap an unset temperature to the lowest available one, an out-of-range or (without
// interpolation) untabulated one to the nearest (lower on ties)
export function get_valid_temperature(
  temperature: number | undefined,
  temps: readonly number[],
  interpolate: boolean,
): number | undefined {
  const [min_temp, max_temp] = [temps[0], temps.at(-1)]
  if (min_temp === undefined || max_temp === undefined || temperature === undefined)
    return min_temp ?? temperature
  const in_range = temperature >= min_temp && temperature <= max_temp
  if (interpolate ? in_range : temps.includes(temperature)) return temperature
  // snap to the nearest available temperature (lower one on ties)
  return temps.reduce((best, temp) =>
    Math.abs(temp - temperature) < Math.abs(best - temperature) ? temp : best,
  )
}

// Union of tabulated temperatures across entries with temperature-dependent free energies
export function analyze_temperature_data(entries: PhaseData[]): TemperatureAnalysis {
  const unique_temperatures = new Set<number>()
  for (const entry of entries) {
    if (!entry_has_temp_data(entry)) continue
    for (const temperature of entry.temperatures ?? []) unique_temperatures.add(temperature)
  }
  const available_temperatures = [...unique_temperatures].toSorted(
    (left_value, right_value) => left_value - right_value,
  )
  return { has_temp_data: available_temperatures.length > 0, available_temperatures }
}

// G(T) interpolated between the tightest bracketing tabulated temperatures (arrays may be
// unsorted); null outside the tabulated range or when the bracket exceeds `max_gap`
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

// Entries at temperature T with energy G(T). Entries without temp data keep their static
// energy; ones lacking T are interpolated if enabled and possible, else excluded.
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

// Copy of `entry` with only `composition` (cloned) and the listed defined keys, so worker
// payloads and fingerprints never carry structures or calculation metadata
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

// Derive a display label for a convex hull entry, falling back to the composition in
// `elements` order when reduced_formula and name are both missing.
export function get_entry_label(
  entry: Pick<PhaseData, `reduced_formula` | `name` | `composition`>,
  elements: ElementSymbol[],
): string {
  if (entry.reduced_formula) return entry.reduced_formula
  if (entry.name) return entry.name
  type Pairs = [ElementSymbol, number][]
  return (Object.entries(entry.composition).filter(([, amt]) => (amt ?? 0) > 0) as Pairs)
    .toSorted(([el1], [el2]) => elements.indexOf(el1) - elements.indexOf(el2))
    .map(([element, amt]) =>
      Math.abs(amt - 1) < 1e-6 ? element : `${element}${format_num(amt, `.2~`)}`,
    )
    .join(``)
}

const [TIE_LINE_COLOR, ANNOTATION_COLOR] = [`#e8590c`, `#c026d3`]

// Linked-view overlay in plot coords: dashed tie-lines from an above-hull `focus` to its ringed
// products (atom fractions), plus host annotations (skipped with a warning outside the system)
export function build_hull_overlay(
  { entries, elements }: { entries: readonly ConvexHullEntry[]; elements: ElementSymbol[] },
  focus: ConvexHullEntry | null,
  annotations: HullAnnotations | undefined,
): HullOverlay {
  const dim = elements.length
  const overlay: HullOverlay = { segments: [], rings: [] }
  if (dim !== 2 && dim !== 3 && dim !== 4) return overlay
  if (focus) {
    const products = get_hull_decomposition(focus, entries, elements)?.decomposition ?? []
    for (const { phase, atom_fraction } of products) {
      overlay.segments.push({ from: focus, to: phase, color: TIE_LINE_COLOR, dashed: true })
      const label = format_num(atom_fraction, `.0%`)
      overlay.rings.push({ at: phase, color: TIE_LINE_COLOR, label })
    }
  }
  const position = (mark: HullMark): Point3D | null => {
    if (!system_fractions(mark.composition, elements)) {
      console.warn(
        `ConvexHull: annotation composition ${JSON.stringify(mark.composition)} is outside the ${elements.join(`-`)} system`,
      )
      return null
    }
    return hull_plot_position(mark.composition, mark.e_form, elements, dim)
  }
  for (const { from, to, color = ANNOTATION_COLOR } of annotations?.lines ?? []) {
    const [start, end] = [position(from), position(to)]
    if (start && end) overlay.segments.push({ from: start, to: end, color, dashed: false })
  }
  for (const mark of annotations?.marks ?? []) {
    const at = position(mark)
    if (at)
      overlay.rings.push({ at, color: mark.color ?? ANNOTATION_COLOR, label: mark.label })
  }
  return overlay
}
