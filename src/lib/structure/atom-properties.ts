// Utility functions for computing atom properties and applying color scales

import type { ColorScaleType, D3InterpolateName } from '$lib/colors'
import { COLOR_SCALE_TYPES, get_d3_interpolator, is_d3_interpolate_name } from '$lib/colors'
import { calc_coordination_nums } from '$lib/coordination/calc-coordination'
import type { CoordinationData } from '$lib/coordination/calc-coordination'
import { element_by_symbol } from '$lib/element/data'
import * as math from '$lib/math'
import { ATOM_COLOR_MODE_OPTIONS, DEFAULTS, type AtomColorMode } from '$lib/settings'
import type { AnyStructure, Site } from '$lib/structure'
import { get_majority_element, type BondingStrategy } from '$lib/structure/bonding'
import { wrap_frac_coord, type Pbc } from '$lib/structure/pbc'
import { CNA_TYPE_COLORS, CNA_TYPE_NAMES } from '$lib/structure-id/calc-cna'
import { CNA_TYPE_PROPERTY } from '$lib/structure-id/calc-structure-id'
import type { MoyoDataset } from '@spglib/moyo-wasm'
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

// JSON-safe subset for serialized hosts. Runtime Svelte callers can still use custom
// functions through AtomColorConfig, but serialized payloads cannot represent them.
export type SerializableAtomColorConfig = Exclude<AtomColorConfig, { mode: `custom` }>

export interface AtomPropertyColors {
  colors: string[] // Color for each site index
  values: (number | string)[] // Property value for each site index
  min_value?: number // For continuous scales
  max_value?: number // For continuous scales
  unique_values?: (number | string)[] // For categorical scales
}

const GRAY = `#808080`
const DEFAULT_COLOR_SCALE = DEFAULTS.structure.atom_color_scale
// Cap on periodic image shells per axis when expanding for coordination. Guards
// against image explosion in very thin / highly oblique cells (coordination is ~O(n²)).
const MAX_IMAGE_SHELLS = 3
// Max bond distance electroneg_ratio can form, mirroring its max_distance_ratio default
// in bonding.ts. Used to size PBC image expansion just tightly enough that coordination
// never misses a bonded neighbor.
const ELECTRONEG_MAX_RATIO = 2
type SymmetryDataWithOrigMap = MoyoDataset & { orig_site_indices_by_input_idx?: number[][] }

const to_hex = (interp_fn: (t: number) => string, frac: number) =>
  rgb(interp_fn(frac)).formatHex()
const build_image_site = (
  site: Site,
  frac_to_cart: (v: math.Vec3) => math.Vec3,
  offset: readonly [number, number, number],
  orig_idx: number,
): Site => {
  const img_abc: math.Vec3 = [
    site.abc[0] + offset[0],
    site.abc[1] + offset[1],
    site.abc[2] + offset[2],
  ]
  return {
    ...site,
    abc: img_abc,
    xyz: frac_to_cart(img_abc),
    properties: { ...site.properties, orig_site_idx: orig_idx },
  }
}

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
  // Compute min/max in single pass to avoid spreading large arrays
  let [min, max] = [vals[0], vals[0]]
  for (const val of vals) {
    if (val < min) min = val
    if (val > max) max = val
  }
  return {
    colors: vals.map((val) =>
      to_hex(interp_fn, max === min ? 0.5 : (val - min) / (max - min)),
    ),
  }
}

export const apply_categorical_color_scale = (
  vals: string[],
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
): { colors: string[]; unique_values: string[] } =>
  vals.length > 0 ? make_categorical(vals, scale) : { colors: [], unique_values: [] }

// Get original site index for property color lookup.
// Supercell atoms use orig_unit_cell_idx, image atoms use orig_site_idx, otherwise use site_idx.
export const get_orig_site_idx = (site: Site | undefined, site_idx: number): number =>
  typeof site?.properties?.orig_unit_cell_idx === `number`
    ? site.properties.orig_unit_cell_idx
    : typeof site?.properties?.orig_site_idx === `number`
      ? site.properties.orig_site_idx
      : site_idx

// Expand a periodic structure with the neighbor images needed for correct
// coordination. Each atom's `reach` (the largest bond that can form for it,
// (r + r_max)·ratio) sizes how many whole cells to image per periodic axis, measured
// over the perpendicular cell height (not
// the lattice vector length, so oblique cells work), keeping only images within `reach`
// of the [0,1] cell and capping at MAX_IMAGE_SHELLS/axis (warns + may undercount beyond
// that — near-degenerate cells only). Smaller atoms image less; atoms with no covalent
// radius form no bonds and get no images.
// `pbc_override` lets callers (bond angles) analyse a structure under different
// periodicity than the lattice declares, without copying this whole routine.
export function expand_structure_for_pbc(
  structure: AnyStructure,
  pbc_override?: Pbc,
): AnyStructure {
  if (!(`lattice` in structure) || !structure.lattice || structure.sites.length === 0) {
    return structure
  }
  const { sites, lattice } = structure
  const pbc = pbc_override ?? lattice.pbc ?? [true, true, true]
  if (!pbc.some(Boolean)) return structure

  const frac_to_cart = math.create_frac_to_cart(lattice.matrix)
  // Wrap into [0,1) along PERIODIC axes only so the near-cell filter and image
  // building share one position (else boundary atoms image on the wrong side and lose
  // neighbors). Vacuum axes keep their real coord — wrapping would fold apart atoms
  // together and invent bonds.
  const cell_sites = sites.map((site) => {
    const abc = site.abc.map((coord, axis) =>
      pbc[axis] ? wrap_frac_coord(coord) : coord,
    ) as math.Vec3
    return { ...site, abc, xyz: frac_to_cart(abc) }
  })

  // Covalent radius per atom (0 = unknown → forms no bonds → needs no images)
  const radii = cell_sites.map((site) => {
    const elem = get_majority_element(site)
    return (elem ? element_by_symbol.get(elem)?.covalent_radius : undefined) ?? 0
  })
  let max_radius = 0
  for (const radius of radii) if (radius > max_radius) max_radius = radius
  const reach_of = (radius: number): number => (radius + max_radius) * ELECTRONEG_MAX_RATIO

  const heights = math.cell_heights(lattice.matrix)
  // Axes we image along: periodic and non-degenerate (finite height). Non-live axes
  // (vacuum or degenerate) contribute no images — 0 shells + ∞ cutoff so their only
  // copy (shift 0) always passes the near-cell filter. Loop-invariant, so hoisted out.
  const live_axis = heights.map((height, axis) => pbc[axis] && Number.isFinite(height))
  const image_near_cell = (frac: number, shift: number, axis_cutoff: number): boolean => {
    const shifted = frac + shift
    return shifted >= -axis_cutoff && shifted <= 1 + axis_cutoff
  }

  let capped = false
  const image_sites: Site[] = []
  for (const [orig_idx, site] of cell_sites.entries()) {
    const radius = radii[orig_idx]
    if (radius === 0) continue // no covalent radius → no bonds → no images
    const reach = reach_of(radius)
    // `cutoff` = fractional reach for the near-cell filter (keep an image shifted by `s`
    // iff abc+s lands within `cutoff` of [0,1]); `n_shells` bounds the loop so no
    // in-reach copy is missed.
    const cutoff = heights.map((height, axis) => (live_axis[axis] ? reach / height : Infinity))
    const n_shells = heights.map((height, axis) => {
      if (!live_axis[axis]) return 0
      const shells = Math.floor(1 + reach / height)
      if (shells > MAX_IMAGE_SHELLS) capped = true
      return Math.min(MAX_IMAGE_SHELLS, shells)
    })

    const [frac_a, frac_b, frac_c] = site.abc // periodic axes wrapped into [0, 1)
    for (let dx = -n_shells[0]; dx <= n_shells[0]; dx++) {
      if (!image_near_cell(frac_a, dx, cutoff[0])) continue
      for (let dy = -n_shells[1]; dy <= n_shells[1]; dy++) {
        if (!image_near_cell(frac_b, dy, cutoff[1])) continue
        for (let dz = -n_shells[2]; dz <= n_shells[2]; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          if (!image_near_cell(frac_c, dz, cutoff[2])) continue
          image_sites.push(build_image_site(site, frac_to_cart, [dx, dy, dz], orig_idx))
        }
      }
    }
  }
  if (capped) {
    console.warn(
      `[coordination] cell is very thin or oblique relative to bond reach; capping ` +
        `PBC images at ${MAX_IMAGE_SHELLS} shells/axis, coordination near cell ` +
        `boundaries may be undercounted`,
    )
  }

  return { ...structure, sites: [...cell_sites, ...image_sites] }
}

// PBC-aware coordination: expand periodic cells with image atoms (so boundary atoms get
// full coordination), counting only original atoms as centers. Shared by the 3D viewer and
// CoordinationBarPlot so both report identical numbers.
export function calc_structure_coordination(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
): CoordinationData {
  const has_lattice = `lattice` in structure && structure.lattice !== undefined
  const pbc = has_lattice ? structure.lattice.pbc : undefined
  const has_pbc = has_lattice && (pbc === undefined || pbc.some(Boolean))
  // Image atoms still count as neighbors but aren't iterated as centers (big speedup)
  const coord_structure = has_pbc ? expand_structure_for_pbc(structure) : structure
  return calc_coordination_nums(coord_structure, strategy, structure.sites.length)
}

export function get_coordination_colors(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  // sites is already limited to the original atoms (calc_coordination_nums center_count)
  const coord_nums = calc_structure_coordination(structure, strategy).sites.map(
    (site) => site.coordination_num,
  )

  const { colors, unique_values } = apply_color_scale(coord_nums, scale, type)
  return build_prop_colors(coord_nums, colors, unique_values)
}

export function get_wyckoff_colors(
  structure: AnyStructure,
  sym_data: SymmetryDataWithOrigMap | null,
  scale: D3InterpolateName = DEFAULT_COLOR_SCALE,
): AtomPropertyColors {
  const n_sites = structure.sites.length
  if (!sym_data?.wyckoffs || sym_data.wyckoffs.length === 0) {
    return {
      colors: Array(n_sites).fill(GRAY),
      values: Array(n_sites).fill(`unknown`),
      unique_values: [`unknown`],
    }
  }

  // moyo's wyckoffs array is indexed by INPUT cell sites (the merged moyo input cell),
  // so map letters to original sites through orig_site_indices_by_input_idx
  const wyckoff_by_orig_idx = new Map<number, string | null>()
  const mapping_by_input_idx = sym_data.orig_site_indices_by_input_idx
  if (mapping_by_input_idx) {
    for (let input_idx = 0; input_idx < sym_data.wyckoffs.length; input_idx += 1) {
      const wyckoff = sym_data.wyckoffs[input_idx]
      for (const orig_idx of mapping_by_input_idx[input_idx] ?? []) {
        if (!wyckoff_by_orig_idx.has(orig_idx)) wyckoff_by_orig_idx.set(orig_idx, wyckoff)
      }
    }
  }

  // Create unique orbit identifiers: Wyckoff position + element symbol
  const orbit_ids = structure.sites.map((site, idx) => {
    const sym_idx = get_orig_site_idx(site, idx)
    const mapped_wyckoff = wyckoff_by_orig_idx.get(sym_idx)
    if (mapped_wyckoff !== undefined) {
      const element = site.species[0]?.element ?? `?`
      return mapped_wyckoff ? `${mapped_wyckoff}|${element}` : `unknown`
    }

    if (sym_idx >= sym_data.wyckoffs.length) {
      console.error(
        `[get_wyckoff_colors] Site ${idx} (maps to ${sym_idx}) has no Wyckoff data. ` +
          `Structure has ${n_sites} sites but symmetry data only has ${sym_data.wyckoffs.length}.`,
      )
      return `unknown`
    }

    const wyckoff = sym_data.wyckoffs[sym_idx]
    const element = site.species[0]?.element ?? `?`
    return wyckoff ? `${wyckoff}|${element}` : `unknown`
  })

  const { colors, unique_values } = apply_categorical_color_scale(orbit_ids, scale)
  return { colors, values: orbit_ids, unique_values }
}

// POSCAR selective dynamics is a PER-AXIS flag triple (`T`/`F` per lattice direction), so an
// atom can be frozen along some axes only. Collapsing to a binary free/fixed split would hide
// that, hence the separate `partially fixed` category. `unknown` = site never declared the
// property, which the POSCAR parser emits for coordinate lines too short to carry flags.
export const SELECTIVE_DYNAMICS_CATEGORIES = [
  `free`,
  `partially fixed`,
  `fixed`,
  `unknown`,
] as const
export type SelectiveDynamicsCategory = (typeof SELECTIVE_DYNAMICS_CATEGORIES)[number]

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
export function site_property_scalar(site: Site, property_key: string): number | null {
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

export function get_atom_colors(
  structure: AnyStructure,
  config: AtomColorConfig,
  bonding_strategy: BondingStrategy = `electroneg_ratio`,
  sym_data: MoyoDataset | null = null,
): AtomPropertyColors {
  const normalized_config = normalize_atom_color_config(config)
  const { mode, scale, scale_type } = normalized_config

  if (mode === `coordination`)
    return get_coordination_colors(structure, bonding_strategy, scale, scale_type)
  if (mode === `wyckoff`) return get_wyckoff_colors(structure, sym_data, scale)
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

// Helper: Get property colors with null safety check
// Returns null if structure is missing, mode is element, or no colors computed
export function get_property_colors(
  structure: AnyStructure | undefined,
  config: AtomColorConfig,
  bonding_strategy: BondingStrategy,
  sym_data: MoyoDataset | null,
): AtomPropertyColors | null {
  if (!structure) return null
  const result = get_atom_colors(structure, config, bonding_strategy, sym_data)
  return result.colors.length > 0 ? result : null
}
