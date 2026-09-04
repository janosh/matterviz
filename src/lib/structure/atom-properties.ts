// Utility functions for computing atom properties and applying color scales

import type { ColorScaleType, D3InterpolateName } from '$lib/colors'
import { COLOR_SCALE_TYPES, get_d3_interpolator, is_d3_interpolate_name } from '$lib/colors'
import { calc_coordination_nums } from '$lib/coordination/calc-coordination'
import { array_extent } from '$lib/math'
import {
  ATOM_COLOR_MODE_OPTIONS,
  DEFAULTS,
  SETTINGS_CONFIG,
  type AtomColorMode,
} from '$lib/settings'
import type { AnyStructure, Site } from '$lib/structure'
import type { BondingStrategy } from '$lib/structure/bonding'
import { get_orig_site_idx } from '$lib/structure/site'
import { CNA_TYPE_COLORS, CNA_TYPE_NAMES } from '$lib/structure-id/calc-cna'
import { CNA_TYPE_PROPERTY } from '$lib/structure-id/calc-structure-id'
import type { WyckoffPos } from '$lib/symmetry/wyckoff'
import { rgb } from 'd3-color'

type SimpleAtomColorMode = Exclude<AtomColorMode, `property` | `custom`>
type AtomColorFn = (site: Site, idx: number) => number | string

interface AtomColorBase {
  scale: D3InterpolateName
  scale_type: ColorScaleType
}

// Keyed on `mode` so the fields a mode depends on cannot go missing. `property_key` and
// `color_fn` used to be optional on a flat interface, so `{ mode: 'property' }` type-checked
// and then quietly painted every atom the same color.
export type AtomColorConfig =
  | (AtomColorBase & { mode: SimpleAtomColorMode })
  // Site property to color by (OVITO's Color Coding). Vec3 values (force, velocity, ...)
  // are reduced to their magnitude.
  | (AtomColorBase & { mode: `property`; property_key: string })
  | (AtomColorBase & { mode: `custom`; color_fn: AtomColorFn })

export interface AtomPropertyColors {
  colors: string[] // Color for each site index
  values: (number | string)[] // Property value for each site index
  min_value?: number // For continuous scales
  max_value?: number // For continuous scales
  unique_values?: (number | string)[] // For categorical scales
}

const GRAY = `#808080`
const DEFAULT_COLOR_SCALE = DEFAULTS.structure.atom_color_scale

const to_hex = (interp_fn: (t: number) => string, frac: number) =>
  rgb(interp_fn(frac)).formatHex()
const make_categorical = <T>(
  vals: T[],
  scale: D3InterpolateName,
  sort_fn?: (a: T, b: T) => number,
): { colors: string[]; unique_values: T[] } => {
  const interp_fn = get_d3_interpolator(scale)
  const uniq = sort_fn
    ? [...new Set(vals)].toSorted(sort_fn)
    : [...new Set(vals)].toSorted((val_a, val_b) => String(val_a).localeCompare(String(val_b)))
  const colors = uniq.map((_, idx) =>
    to_hex(interp_fn, uniq.length === 1 ? 0.5 : idx / (uniq.length - 1)),
  )
  const map = new Map(uniq.map((val, idx) => [val, colors[idx]]))
  return {
    colors: vals.map((val) => map.get(val) ?? GRAY),
    unique_values: uniq,
  }
}

const build_prop_colors = (
  vals: number[],
  colors: string[],
  unique_values?: number[],
): AtomPropertyColors => {
  const uniq = unique_values ?? [...new Set(vals)].toSorted((val_a, val_b) => val_a - val_b)
  const min_value = uniq[0]
  const max_value = uniq.at(-1)
  return { colors, values: vals, min_value, max_value, unique_values: uniq }
}

export function apply_color_scale(
  vals: number[],
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): { colors: string[]; unique_values?: number[] } {
  if (vals.length === 0) return { colors: [] }
  if (type === `categorical`) {
    const result = make_categorical(vals, scale, (val_a, val_b) => val_a - val_b)
    return { colors: result.colors, unique_values: result.unique_values }
  }

  const interp_fn = get_d3_interpolator(scale)
  // array_extent skips NaN: a vals[0] seed of NaN left min = max = NaN, defeating the
  // max === min guard (NaN !== NaN) and painting every atom at t = NaN. Non-finite values and
  // an all-NaN or empty extent fall back to the scale midpoint.
  const [min, max] = array_extent(vals)
  const constant_scale = !Number.isFinite(min) || !Number.isFinite(max) || max === min
  return {
    colors: vals.map((val) =>
      to_hex(
        interp_fn,
        constant_scale || !Number.isFinite(val) ? 0.5 : (val - min) / (max - min),
      ),
    ),
  }
}

export const apply_categorical_color_scale = (
  vals: string[],
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
): { colors: string[]; unique_values: string[] } =>
  vals.length > 0 ? make_categorical(vals, scale) : { colors: [], unique_values: [] }

export function get_coordination_colors(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  const coord_nums = calc_coordination_nums(structure, { strategy }).coordination_nums

  const { colors, unique_values } = apply_color_scale(coord_nums, scale, type)
  return build_prop_colors(coord_nums, colors, unique_values)
}

// Color sites by Wyckoff orbit. `wyckoff_rows` must already be mapped onto `structure`'s site
// indices (map_wyckoff_to_all_atoms for anything but the analyzed cell itself), so a
// conventional/primitive/supercell view colors by where each displayed atom actually sits
// rather than by whatever site shared its index in the analyzed cell. Orbit ids are
// `${multiplicity}${letter}|${element}` (e.g. `4a|Fe`); sites no row claims are `unknown`.
export function get_wyckoff_colors(
  structure: AnyStructure,
  wyckoff_rows: readonly WyckoffPos[],
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
): AtomPropertyColors {
  const orbit_ids: (string | null)[] = Array(structure.sites.length).fill(null)
  for (const { wyckoff, elem, site_indices } of wyckoff_rows) {
    for (const site_idx of site_indices) {
      if (site_idx < orbit_ids.length) orbit_ids[site_idx] = `${wyckoff}|${elem}`
    }
  }
  // Ramp over the claimed orbits only, then gray-fill unclaimed sites (as property mode does)
  const known = orbit_ids.filter((orbit_id) => orbit_id !== null)
  const { colors: known_colors, unique_values } = apply_categorical_color_scale(known, scale)
  let known_idx = 0
  const colors = orbit_ids.map((orbit_id) =>
    orbit_id === null ? GRAY : known_colors[known_idx++],
  )
  const values = orbit_ids.map((orbit_id) => orbit_id ?? `unknown`)
  return {
    colors,
    values,
    unique_values:
      known.length < orbit_ids.length ? [...unique_values, `unknown`] : unique_values,
  }
}

// POSCAR selective dynamics is a PER-AXIS flag triple (`T`/`F` per lattice direction), so an
// atom can be frozen along some axes only. Collapsing to a binary free/fixed split would hide
// that, hence the separate `partially fixed` category. `unknown` = site never declared the
// property, which the POSCAR parser emits for coordinate lines too short to carry flags.
const SELECTIVE_DYNAMICS_CATEGORIES = [`free`, `partially fixed`, `fixed`, `unknown`] as const
type SelectiveDynamicsCategory = (typeof SELECTIVE_DYNAMICS_CATEGORIES)[number]

// `true` means the atom may relax along that axis (POSCAR `T`), `false` means frozen (`F`).
// Every parser MatterViz ships writes three booleans, but hand-authored and third-party
// structures spell the same triple as `T`/`F` (the POSCAR literal) or 0/1, so those are
// coerced too. Anything else lands in `unknown`: this runs per site while rendering, where
// throwing would blank the whole structure over one malformed property.
const to_relax_flag = (flag: unknown): boolean | undefined => {
  if (typeof flag === `boolean`) return flag
  if (typeof flag !== `string` && typeof flag !== `number`) return undefined
  const key = String(flag).trim().toLowerCase()
  if ([`t`, `true`, `1`].includes(key)) return true
  if ([`f`, `false`, `0`].includes(key)) return false
  return undefined
}

// Array.isArray also rejects the undefined/null of a site that never declared the property
export function categorize_selective_dynamics(value: unknown): SelectiveDynamicsCategory {
  if (!Array.isArray(value) || value.length !== 3) return `unknown`
  const flags = value.map(to_relax_flag)
  if (flags.includes(undefined)) return `unknown`
  if (flags.every(Boolean)) return `free`
  if (flags.some(Boolean)) return `partially fixed`
  return `fixed`
}

export const structure_has_selective_dynamics = (
  structure: AnyStructure | undefined | null,
): boolean =>
  structure?.sites.some((site) => site.properties?.selective_dynamics !== undefined) ?? false

export function get_selective_dynamics_colors(
  structure: AnyStructure,
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
): AtomPropertyColors {
  if (structure.sites.length === 0) return { colors: [], values: [] }
  const categories = structure.sites.map((site) =>
    categorize_selective_dynamics(site.properties?.selective_dynamics),
  )
  // Order the legend free → partially fixed → fixed (mobility descending) instead of
  // alphabetically, so the color ramp reads as a constraint gradient
  const { colors, unique_values } = make_categorical(
    categories,
    scale,
    (cat_a, cat_b) =>
      SELECTIVE_DYNAMICS_CATEGORIES.indexOf(cat_a) -
      SELECTIVE_DYNAMICS_CATEGORIES.indexOf(cat_b),
  )
  return { colors, values: categories, unique_values }
}

// Bookkeeping properties the viewer attaches to sites itself (supercell / periodic-image
// provenance). They are numeric but carry no physics, so they stay out of the picker.
const INTERNAL_SITE_PROPS = new Set([`orig_site_idx`, `orig_unit_cell_idx`])

// Read one site property as a color-coding scalar: numbers pass through, vec3s (force,
// velocity, ...) contribute their magnitude. null = this site has nothing colorable under
// that key (absent, non-numeric, or non-finite).
function site_property_scalar(site: Site, property_key: string): number | null {
  const value = site.properties?.[property_key]
  if (typeof value === `number`) return Number.isFinite(value) ? value : null
  const is_vec3 =
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((comp) => typeof comp === `number` && Number.isFinite(comp))
  return is_vec3 ? Math.hypot(value[0], value[1], value[2]) : null
}

// Union of the site property keys that `property` color mode can actually use, i.e. those
// carrying a finite number or vec3 on at least one site. Sorted for a stable picker order.
export function get_colorable_property_keys(
  structure: AnyStructure | undefined | null,
): string[] {
  const keys = new Set<string>()
  for (const site of structure?.sites ?? []) {
    for (const key of Object.keys(site.properties ?? {})) {
      if (INTERNAL_SITE_PROPS.has(key) || keys.has(key)) continue
      if (site_property_scalar(site, key) !== null) keys.add(key)
    }
  }
  return [...keys].toSorted((key_a, key_b) => key_a.localeCompare(key_b))
}

const configs_equal = (first: AtomColorConfig, second: AtomColorConfig): boolean =>
  first.mode === second.mode &&
  first.scale === second.scale &&
  first.scale_type === second.scale_type &&
  (first.mode !== `property` ||
    (second.mode === `property` && first.property_key === second.property_key)) &&
  (first.mode !== `custom` || (second.mode === `custom` && first.color_fn === second.color_fn))

export const DEFAULT_ATOM_COLOR_CONFIG: AtomColorConfig = {
  mode: `element`,
  scale: DEFAULT_COLOR_SCALE,
  scale_type: DEFAULTS.structure.atom_color_scale_type,
}

const is_atom_color_mode = (value: unknown): value is AtomColorMode =>
  typeof value === `string` && ATOM_COLOR_MODE_OPTIONS.some((mode) => mode === value)
const is_color_scale_type = (value: unknown): value is ColorScaleType =>
  typeof value === `string` && COLOR_SCALE_TYPES.some((scale_type) => scale_type === value)
const is_atom_color_fn = (value: unknown): value is AtomColorFn => typeof value === `function`
const default_scale_type = (mode: AtomColorMode, property_key?: unknown): ColorScaleType =>
  mode === `wyckoff` ||
  mode === `selective_dynamics` ||
  (mode === `property` && property_key === CNA_TYPE_PROPERTY)
    ? `categorical`
    : `continuous`

// Normalize untyped/serialized props before rendering.
export function normalize_atom_color_config(config: unknown): AtomColorConfig {
  if (!config || typeof config !== `object` || Array.isArray(config)) {
    return { ...DEFAULT_ATOM_COLOR_CONFIG }
  }
  const candidate = config as Record<string, unknown>
  const mode = is_atom_color_mode(candidate.mode) ? candidate.mode : `element`
  const scale =
    typeof candidate.scale === `string` && is_d3_interpolate_name(candidate.scale)
      ? candidate.scale
      : DEFAULT_ATOM_COLOR_CONFIG.scale
  const scale_type = is_color_scale_type(candidate.scale_type)
    ? candidate.scale_type
    : default_scale_type(mode, candidate.property_key)
  const candidate_config = candidate as unknown as AtomColorConfig
  const finalize = (normalized: AtomColorConfig): AtomColorConfig =>
    configs_equal(candidate_config, normalized) ? candidate_config : normalized

  const property_key = typeof candidate.property_key === `string` ? candidate.property_key : ``
  if (mode === `property` && property_key)
    return finalize({ mode, scale, scale_type, property_key })
  if (mode === `custom` && is_atom_color_fn(candidate.color_fn))
    return finalize({ mode, scale, scale_type, color_fn: candidate.color_fn })
  if (mode === `property` || mode === `custom`)
    return finalize({ mode: `element`, scale, scale_type: default_scale_type(`element`) })
  return finalize({ mode, scale, scale_type })
}

// Preserve object identity when unchanged so reactive callers can assign unconditionally.
export const next_atom_color_config = (
  config: AtomColorConfig,
  mode: AtomColorMode,
  property_keys: string[],
  preferred_key?: string,
): AtomColorConfig => {
  const { scale } = config
  const finalize = (next: AtomColorConfig): AtomColorConfig =>
    configs_equal(next, config) ? config : next
  if (mode === `property`) {
    if (property_keys.length === 0)
      return finalize({ mode: `element`, scale, scale_type: default_scale_type(`element`) })
    const previous_key =
      preferred_key ?? (`property_key` in config ? config.property_key : undefined)
    const property_key =
      previous_key && property_keys.includes(previous_key) ? previous_key : property_keys[0]
    return finalize({
      mode,
      scale,
      scale_type: default_scale_type(mode, property_key),
      property_key,
    })
  }
  if (mode === `custom` && `color_fn` in config) return config
  if (mode === `custom`)
    throw new Error(`Cannot switch to custom atom coloring without a color_fn`)
  return finalize({ mode, scale, scale_type: default_scale_type(mode) })
}

// Keep discrete CNA phases on OVITO's stable palette as phases appear or vanish.
const cna_type_palette = (codes: number[]): string[] =>
  codes.map((code) => CNA_TYPE_COLORS[CNA_TYPE_NAMES[code]] ?? GRAY)

// Color atoms by an arbitrary per-site scalar (OVITO's Color Coding). Sites that don't
// declare the key keep a neutral gray and land in an `unknown` legend bucket rather than
// being pinned to one end of the ramp, and they're excluded from the min/max the ColorBar
// shows. An empty result (no site declares the key) tells callers to fall back.
export function get_site_property_colors(
  structure: AnyStructure,
  property_key: string,
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  const scalars = structure.sites.map((site) => site_property_scalar(site, property_key))
  const present = scalars.filter((val) => val !== null)
  if (present.length === 0) return { colors: [], values: [] }

  const { colors, unique_values } =
    property_key === CNA_TYPE_PROPERTY && type === `categorical`
      ? { colors: cna_type_palette(present), unique_values: undefined }
      : apply_color_scale(present, scale, type)
  const stats = build_prop_colors(present, colors, unique_values)
  if (present.length === scalars.length) return stats

  // Re-expand the ramp over all sites, gray-filling the ones that had nothing to color by
  let present_idx = 0
  return {
    ...stats,
    colors: scalars.map((scalar) => (scalar === null ? GRAY : stats.colors[present_idx++])),
    values: scalars.map((scalar) => scalar ?? `unknown`),
  }
}

export function get_custom_colors(
  structure: AnyStructure,
  fn: AtomColorFn,
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  const vals = structure.sites.map((site, idx) => fn(site, idx))
  const is_num = vals.every((val) => typeof val === `number`)

  if (is_num) {
    const nums = vals
    const { colors, unique_values } = apply_color_scale(nums, scale, type)
    return build_prop_colors(nums, colors, unique_values)
  }

  const strs = vals.map(String)
  const { colors, unique_values } = apply_categorical_color_scale(strs, scale)
  return { colors, values: strs, unique_values }
}

export type AtomColorSources = {
  // Cell the displayed structure tiles (cell-transformed, pre-supercell/pre-image). Coordination
  // is computed here so it reflects the infinite crystal, then followed to every displayed copy
  // through its supercell/image provenance. Defaults to the displayed structure itself.
  base?: AnyStructure
  // Index into `base` of a displayed site. Defaults to following both provenance properties
  // (orig_unit_cell_idx, then orig_site_idx); a caller whose input structure already carries
  // orig_unit_cell_idx from a supercell built elsewhere must not follow it (see
  // StructureSession.to_base_site_idx).
  to_base_idx?: (site: Site, site_idx: number) => number
  bonding_strategy?: BondingStrategy
  // Wyckoff rows whose site_indices already index the DISPLAYED structure
  wyckoff_rows?: readonly WyckoffPos[]
}

// Re-index colors computed on the base cell onto the displayed sites. Range/legend stats stay
// those of the base cell (a supercell has the same distinct values, image atoms add none).
const expand_to_displayed = (
  base_colors: AtomPropertyColors,
  displayed: AnyStructure,
  to_base_idx: (site: Site, site_idx: number) => number,
): AtomPropertyColors => {
  const base_indices = displayed.sites.map(to_base_idx)
  return {
    ...base_colors,
    colors: base_indices.map((base_idx) => base_colors.colors[base_idx] ?? GRAY),
    values: base_indices.map((base_idx) => base_colors.values[base_idx] ?? `unknown`),
  }
}

// Per-site colors for the DISPLAYED structure, indexed by displayed site. Only coordination is
// remapped through provenance; property/custom/selective modes read each displayed site
// directly, so a caller-supplied supercell carrying per-site data (phonon eigen-displacements,
// ...) colors by that data rather than by whatever its unit-cell ancestor carried.
export function get_atom_colors(
  structure: AnyStructure,
  config: AtomColorConfig,
  {
    base = structure,
    to_base_idx = get_orig_site_idx,
    bonding_strategy = `electroneg_ratio`,
    wyckoff_rows = [],
  }: AtomColorSources = {},
): AtomPropertyColors {
  const normalized_config = normalize_atom_color_config(config)
  const { mode, scale, scale_type } = normalized_config

  if (mode === `coordination`) {
    const on_base = get_coordination_colors(base, bonding_strategy, scale, scale_type)
    return base === structure ? on_base : expand_to_displayed(on_base, structure, to_base_idx)
  }
  if (mode === `wyckoff`) return get_wyckoff_colors(structure, wyckoff_rows, scale)
  if (mode === `selective_dynamics`) return get_selective_dynamics_colors(structure, scale)
  if (mode === `property`)
    return get_site_property_colors(
      structure,
      normalized_config.property_key,
      scale,
      scale_type,
    )
  if (mode === `custom`)
    return get_custom_colors(structure, normalized_config.color_fn, scale, scale_type)
  // Element mode needs no property colors
  return { colors: [], values: [] }
}

// get_atom_colors with the "nothing to color by" cases folded to null: no structure, element
// mode, or no site declares the property
export function get_property_colors(
  structure: AnyStructure | undefined,
  config: AtomColorConfig,
  sources: AtomColorSources = {},
): AtomPropertyColors | null {
  if (!structure) return null
  const result = get_atom_colors(structure, config, sources)
  return result.colors.length > 0 ? result : null
}

// What the current structure can feed each coloring mode with. Shared by the legend dropdown
// and the controls pane so the two pickers never disagree about which modes are selectable.
export type AtomColorModeContext = {
  has_sym_data: boolean
  has_selective_dynamics: boolean
  colorable_property_keys: readonly string[]
}
// Shared by both pickers; null means selectable.
export const atom_color_mode_unavailable_reason = (
  mode: AtomColorMode,
  { has_sym_data, has_selective_dynamics, colorable_property_keys }: AtomColorModeContext,
): string | null => {
  if (mode === `wyckoff` && !has_sym_data) return `needs symmetry analysis`
  if (mode === `selective_dynamics` && !has_selective_dynamics)
    return `no selective-dynamics flags in this file`
  if (mode === `property` && !colorable_property_keys.length)
    return `no per-atom properties in this file`
  return null
}

export const is_atom_color_mode_available = (
  mode: AtomColorMode,
  context: AtomColorModeContext,
): boolean => atom_color_mode_unavailable_reason(mode, context) === null

// One option list keeps labels, availability, and explanations in sync across both pickers.
export const get_atom_color_mode_options = (context: AtomColorModeContext) =>
  Object.entries(SETTINGS_CONFIG.structure.atom_color_mode.enum ?? {}).map(
    ([value, label]) =>
      [
        value as AtomColorMode,
        label,
        atom_color_mode_unavailable_reason(value as AtomColorMode, context),
      ] as const,
  )
