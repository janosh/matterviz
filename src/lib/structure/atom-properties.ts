// Utility functions for computing atom properties and applying color scales

import type { AnyStructure, Site } from '$lib'
import type { ColorScaleType } from '$lib/colors'
import { calc_coordination_nums } from '$lib/coordination'
import type { AtomColorMode } from '$lib/settings'
import type { BondingStrategy } from '$lib/structure/bonding'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'

export interface AtomColorConfig {
  mode: AtomColorMode
  scale: string
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
const DEFAULT = `interpolateViridis`

export const get_d3_color_scales = () =>
  Object.keys(d3_sc).filter((k) => k.startsWith(`interpolate`))

const get_interp = (scale: string) => {
  const fn = d3_sc[scale as keyof typeof d3_sc]
  if (typeof fn !== `function`) {
    console.warn(`Unknown D3 scale: ${scale}, using ${DEFAULT}`)
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
  scale = DEFAULT,
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
  scale = DEFAULT,
): { colors: string[]; unique_values: string[] } =>
  vals.length ? make_categorical(vals, scale) : { colors: [], unique_values: [] }

export function get_coordination_colors(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  scale = DEFAULT,
  type: ColorScaleType = `continuous`,
): AtomPropertyColors {
  const coord_nums = calc_coordination_nums(structure, strategy).sites.map((site) =>
    site.coordination_num
  )
  const { colors, unique_values } = apply_color_scale(coord_nums, scale, type)
  return build_prop_colors(coord_nums, colors, unique_values)
}

export function get_wyckoff_colors(
  structure: AnyStructure,
  sym_data: MoyoDataset | null,
  scale = DEFAULT,
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
  // Each orbit represents a set of symmetrically equivalent sites
  const orbit_ids = structure.sites.map((site, idx) => {
    // For image atoms, use the stored orig_site_idx property if available
    const { orig_site_idx } = site.properties ?? {}
    const sym_idx = typeof orig_site_idx === `number` && orig_site_idx >= 0
      ? orig_site_idx // Use tracked original index for image atoms
      : idx < sym_data.wyckoffs.length
      ? idx // Use current index for original sites
      : null // No valid mapping available

    if (sym_idx === null) {
      console.error(
        `[get_wyckoff_colors] Site ${idx} has no Wyckoff position data. Structure has ${n} sites but
        symmetry data only has ${sym_data.wyckoffs.length}. This site will be colored as 'unknown'.`,
      )
      return `unknown`
    }

    const wyckoff = sym_data.wyckoffs[sym_idx]
    const element = site.species[0]?.element ?? `?`
    return wyckoff ? `${wyckoff}|${element}` : `unknown`
  })

  const { colors, unique_values } = apply_categorical_color_scale(orbit_ids, scale)
  return {
    colors,
    values: orbit_ids,
    unique_values,
  }
}

export function get_custom_colors(
  structure: AnyStructure,
  fn: (site: Site, idx: number) => number | string,
  scale = DEFAULT,
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
  const { mode = `element`, scale = DEFAULT, scale_type = `continuous`, color_fn } =
    config

  if (mode === `coordination`) {
    return get_coordination_colors(structure, bonding_strategy, scale, scale_type)
  }
  if (mode === `wyckoff`) return get_wyckoff_colors(structure, sym_data, scale)
  if (mode === `custom` && color_fn) {
    return get_custom_colors(structure, color_fn, scale, scale_type)
  }
  // Element mode or custom without function, no property colors needed
  return { colors: [], values: [] }
}
