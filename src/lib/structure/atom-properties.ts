// Utility functions for computing atom properties and applying color scales

import type { AnyStructure, Site } from '$lib'
import type { ColorScaleType, D3InterpolateName } from '$lib/colors'
import { calc_coordination_nums } from '$lib/coordination'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AtomColorMode } from '$lib/settings'
import type { BondingStrategy } from '$lib/structure/bonding'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'

export interface AtomColorConfig {
  mode: AtomColorMode
  scale: string | D3InterpolateName
  scale_type: ColorScaleType
  color_fn?: (site: Site, idx: number) => number | string
}

export interface AtomPropertyColors {
  colors: string[] // Color for each site index
  values: (number | string)[] // Property value for each site index
  min_value?: number // For continuous scales
  max_value?: number // For continuous scales
  unique_values?: (number | string)[] // For categorical scales
}

const GRAY = `#808080`
const DEFAULT_COLOR_SCALE = `interpolateViridis`

export const get_d3_color_scales = () =>
  Object.keys(d3_sc).filter((k) => k.startsWith(`interpolate`))

const get_interp = (scale: string) => {
  const fn = d3_sc[scale as keyof typeof d3_sc]
  if (typeof fn !== `function`) {
    console.warn(`Unknown D3 scale: ${scale}, using ${DEFAULT_COLOR_SCALE}`)
    return d3_sc.interpolateViridis as (t: number) => string
  }
  return fn as (t: number) => string
}

const to_hex = (fn: (t: number) => string, t: number) => rgb(fn(t)).formatHex()

const make_categorical = <T>(
  vals: T[],
  scale: string,
  sort_fn?: (a: T, b: T) => number,
): { colors: string[]; unique_values: T[] } => {
  const fn = get_interp(scale)
  const uniq = sort_fn ? [...new Set(vals)].sort(sort_fn) : [...new Set(vals)].sort()
  const colors = uniq.map((_, i) =>
    to_hex(fn, uniq.length === 1 ? 0.5 : i / (uniq.length - 1))
  )
  const map = new Map(uniq.map((v, i) => [v, colors[i]]))
  return {
    colors: vals.map((v) => map.get(v) ?? GRAY),
    unique_values: uniq,
  }
}

const build_prop_colors = (
  vals: number[],
  colors: string[],
  unique_values?: number[],
): AtomPropertyColors => {
  const uniq = unique_values ?? [...new Set(vals)].sort((a, b) => a - b)
  // Use sorted uniq array to avoid spreading large arrays into Math.min/max
  return {
    colors,
    values: vals,
    min_value: uniq.length > 0 ? uniq[0] : undefined,
    max_value: uniq.length > 0 ? uniq[uniq.length - 1] : undefined,
    unique_values: uniq,
  }
}

export function apply_color_scale(
  vals: number[],
  scale = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): { colors: string[]; unique_values?: number[] } {
  if (!vals.length) return { colors: [] }
  if (type === `categorical`) {
    const result = make_categorical(vals, scale, (a, b) => a - b)
    return { colors: result.colors, unique_values: result.unique_values }
  }

  const fn = get_interp(scale)
  // Compute min/max in single pass to avoid spreading large arrays
  let [min, max] = [vals[0], vals[0]]
  for (const val of vals) {
    if (val < min) min = val
    if (val > max) max = val
  }
  return {
    colors: vals.map((v) => to_hex(fn, max === min ? 0.5 : (v - min) / (max - min))),
  }
}

export const apply_categorical_color_scale = (
  vals: string[],
  scale = DEFAULT_COLOR_SCALE,
): { colors: string[]; unique_values: string[] } =>
  vals.length ? make_categorical(vals, scale) : { colors: [], unique_values: [] }

// Get original site index for property color lookup.
// Supercell atoms use orig_unit_cell_idx, image atoms use orig_site_idx, otherwise use site_idx.
export function get_orig_site_idx(
  site: Site | undefined,
  site_idx: number,
): number {
  return typeof site?.properties?.orig_unit_cell_idx === `number`
    ? site.properties.orig_unit_cell_idx
    : typeof site?.properties?.orig_site_idx === `number`
    ? site.properties.orig_site_idx
    : site_idx
}

// Helper: Expand structure with images from all 26 neighboring cells for PBC coordination
function expand_structure_for_pbc(structure: AnyStructure): AnyStructure {
  if (!(`lattice` in structure) || !structure.lattice) return structure

  const { sites } = structure
  const lattice_T = math.transpose_3x3_matrix(structure.lattice.matrix)

  // Pre-allocate array: original sites + 26 images per site
  const expanded_sites: Site[] = Array(sites.length * 27)

  // Copy original sites
  for (let idx = 0; idx < sites.length; idx++) {
    expanded_sites[idx] = sites[idx]
  }

  let write_idx = sites.length

  for (let orig_idx = 0; orig_idx < sites.length; orig_idx++) {
    const site = sites[orig_idx]
    const [a, b, c] = site.abc

    // Add images in all 26 neighboring cells (3x3x3 - 1 for center)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue

          const img_abc: Vec3 = [a + dx, b + dy, c + dz]
          expanded_sites[write_idx++] = {
            ...site,
            abc: img_abc,
            xyz: math.mat3x3_vec3_multiply(lattice_T, img_abc),
            properties: { ...site.properties, orig_site_idx: orig_idx },
          }
        }
      }
    }
  }

  return { ...structure, sites: expanded_sites }
}

export function get_coordination_colors(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  scale = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  const orig_site_count = structure.sites.length

  // Check if structure has periodic boundary conditions
  const has_lattice = `lattice` in structure && structure.lattice !== undefined
  const pbc = has_lattice ? structure.lattice.pbc : undefined
  const has_pbc = has_lattice &&
    (pbc === undefined || pbc.some((is_periodic) => is_periodic))

  // For PBC structures, expand with images from neighboring cells for accurate coordination
  const coord_structure = has_pbc ? expand_structure_for_pbc(structure) : structure

  // Calculate coordination numbers on the (potentially expanded) structure
  const all_coord_data = calc_coordination_nums(coord_structure, strategy)

  // Extract coordination numbers only for the original sites (not image atoms)
  const coord_nums = all_coord_data.sites
    .slice(0, orig_site_count)
    .map((site) => site.coordination_num)

  const { colors, unique_values } = apply_color_scale(coord_nums, scale, type)
  return build_prop_colors(coord_nums, colors, unique_values)
}

export function get_wyckoff_colors(
  structure: AnyStructure,
  sym_data: MoyoDataset | null,
  scale = DEFAULT_COLOR_SCALE,
): AtomPropertyColors {
  const n = structure.sites.length
  if (!sym_data?.wyckoffs || sym_data.wyckoffs.length === 0) {
    return {
      colors: Array(n).fill(GRAY),
      values: Array(n).fill(`unknown`),
      unique_values: [`unknown`],
    }
  }

  // Create unique orbit identifiers: Wyckoff position + element symbol
  const orbit_ids = structure.sites.map((site, idx) => {
    const sym_idx = get_orig_site_idx(site, idx)

    if (sym_idx >= sym_data.wyckoffs.length) {
      console.error(
        `[get_wyckoff_colors] Site ${idx} (maps to ${sym_idx}) has no Wyckoff data. ` +
          `Structure has ${n} sites but symmetry data only has ${sym_data.wyckoffs.length}.`,
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

export function get_custom_colors(
  structure: AnyStructure,
  fn: (site: Site, idx: number) => number | string,
  scale = DEFAULT_COLOR_SCALE,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  const vals = structure.sites.map((s, i) => fn(s, i))
  const is_num = vals.every((v) => typeof v === `number`)

  if (is_num) {
    const nums = vals as number[]
    const { colors, unique_values } = apply_color_scale(nums, scale, type)
    return build_prop_colors(nums, colors, unique_values)
  }

  const strs = vals.map(String)
  const { colors, unique_values } = apply_categorical_color_scale(strs, scale)
  return {
    colors,
    values: strs,
    unique_values,
  }
}

export function get_atom_colors(
  structure: AnyStructure,
  config: Partial<AtomColorConfig>,
  bonding_strategy: BondingStrategy = `electroneg_ratio`,
  sym_data: MoyoDataset | null = null,
): AtomPropertyColors {
  const { mode = `element`, scale = DEFAULT_COLOR_SCALE, scale_type = `continuous` } =
    config

  if (mode === `coordination`) {
    return get_coordination_colors(structure, bonding_strategy, scale, scale_type)
  }
  if (mode === `wyckoff`) return get_wyckoff_colors(structure, sym_data, scale)
  if (mode === `custom` && config.color_fn) {
    return get_custom_colors(structure, config.color_fn, scale, scale_type)
  }
  // Element mode or custom without function, no property colors needed
  return { colors: [], values: [] }
}

// Helper: Get property colors with null safety check
// Returns null if structure is missing, mode is element, or no colors computed
export function get_property_colors(
  structure: AnyStructure | undefined,
  config: Partial<AtomColorConfig>,
  bonding_strategy: BondingStrategy,
  sym_data: MoyoDataset | null,
): AtomPropertyColors | null {
  if (!structure || config.mode === `element`) return null
  const result = get_atom_colors(structure, config, bonding_strategy, sym_data)
  return result.colors.length ? result : null
}
