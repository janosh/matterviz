// Utility functions for computing atom properties and applying color scales

import type { AnyStructure, Site } from '$lib'
import { calc_coordination_nums } from '$lib/coordination'
import type { BondingStrategy } from '$lib/structure/bonding'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { rgb } from 'd3-color'
import * as d3_sc from 'd3-scale-chromatic'

export type AtomColorMode = `element` | `coordination` | `wyckoff` | `custom`
export type AtomColorScaleType = `continuous` | `categorical`

export interface AtomColorConfig {
  mode: AtomColorMode
  scale: string
  scale_type: AtomColorScaleType
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
) => {
  const fn = get_interp(scale)
  const uniq = sort_fn ? [...new Set(vals)].sort(sort_fn) : [...new Set(vals)].sort()
  const colors = uniq.map((_, i) =>
    to_hex(fn, uniq.length === 1 ? 0.5 : i / (uniq.length - 1))
  )
  const map = new Map(uniq.map((v, i) => [v, colors[i]]))
  return vals.map((v) => map.get(v) ?? GRAY)
}

const build_prop_colors = (vals: number[], colors: string[]): AtomPropertyColors => {
  const uniq = [...new Set(vals)].sort((a, b) => a - b)
  return {
    colors,
    values: vals,
    min_value: Math.min(...vals),
    max_value: Math.max(...vals),
    unique_values: uniq,
  }
}

export function apply_color_scale(
  vals: number[],
  scale = DEFAULT,
  type: AtomColorScaleType = `continuous`,
): string[] {
  if (!vals.length) return []
  if (type === `categorical`) return make_categorical(vals, scale, (a, b) => a - b)

  const fn = get_interp(scale)
  const [min, max] = [Math.min(...vals), Math.max(...vals)]
  return vals.map((v) => to_hex(fn, max === min ? 0.5 : (v - min) / (max - min)))
}

export const apply_categorical_color_scale = (vals: string[], scale = DEFAULT) =>
  vals.length ? make_categorical(vals, scale) : []

export function get_coordination_colors(
  structure: AnyStructure,
  strategy: BondingStrategy = `electroneg_ratio`,
  scale = DEFAULT,
  type: AtomColorScaleType = `continuous`,
): AtomPropertyColors {
  const coord_nums = calc_coordination_nums(structure, strategy).sites.map((site) =>
    site.coordination_num
  )
  return build_prop_colors(coord_nums, apply_color_scale(coord_nums, scale, type))
}

export function get_wyckoff_colors(
  structure: AnyStructure,
  sym_data: MoyoDataset | null,
  scale = DEFAULT,
): AtomPropertyColors {
  const n = structure.sites.length
  // Handle both null/undefined and empty wyckoffs array consistently
  if (!sym_data?.wyckoffs || sym_data.wyckoffs.length === 0) {
    return {
      colors: Array(n).fill(GRAY),
      values: Array(n).fill(`unknown`),
      unique_values: [`unknown`],
    }
  }

  const letters = sym_data.wyckoffs.map((w) => w ?? `unknown`)
  return {
    colors: apply_categorical_color_scale(letters, scale),
    values: letters,
    unique_values: [...new Set(letters)].sort(),
  }
}

export function get_custom_colors(
  structure: AnyStructure,
  fn: (site: Site, idx: number) => number | string,
  scale = DEFAULT,
  type: AtomColorScaleType = `continuous`,
): AtomPropertyColors {
  const vals = structure.sites.map((s, i) => fn(s, i))
  const is_num = vals.every((v) => typeof v === `number`)

  if (is_num) {
    const nums = vals as number[]
    return build_prop_colors(nums, apply_color_scale(nums, scale, type))
  }

  const strs = vals.map(String)
  return {
    colors: apply_categorical_color_scale(strs, scale),
    values: strs,
    unique_values: [...new Set(strs)].sort(),
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
  if (mode === `custom`) {
    if (!color_fn) {
      console.warn(`Custom color mode requires a color_fn`)
      return { colors: [], values: [] } // Return empty arrays to indicate no property coloring
    }
    return get_custom_colors(structure, color_fn, scale, scale_type)
  }
  // Element mode, no property colors needed
  return { colors: [], values: [] }
}
