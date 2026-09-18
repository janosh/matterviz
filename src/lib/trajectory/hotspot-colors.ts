import { interpolateInferno } from 'd3-scale-chromatic'
import type { Vec3 } from '$lib/math'
import { css_to_linear_rgb, parse_linear_rgb } from '$lib/scene/colors'
import { atom_field_bin, type AtomColorField } from '$lib/structure/atom-color-field'
import { Matrix4 } from 'three/webgpu'
import { clamp01 } from '$lib/utils'
import type { NumericFrame } from './frame'
import type { HotspotDisplayValues, HotspotMetric, HotspotResult } from './hotspots'

export const DEFAULT_HOTSPOT_CLOUD = {
  visible: false,
  opacity: 0.8,
  atom_opacity: 0.5,
  base_color: `#ffd6a6`,
  hot_color: `#e53935`,
}
export type HotspotCloudSettings = typeof DEFAULT_HOTSPOT_CLOUD

export interface HotspotScale {
  metric: HotspotMetric
  unit: `eV/atom` | `K`
  atom_max: number
  cloud_min: number
  cloud_max: number
  density_reference: number
  threshold: number
}

// Both domains are numeric snapshots: locking this object also freezes cloud density.
export function hotspot_scale(
  mean: number,
  metric: HotspotMetric,
  threshold: number,
): HotspotScale | undefined {
  if (!Number.isFinite(mean) || mean < 0 || !Number.isFinite(threshold)) return undefined
  const peak = Math.max(0, threshold)
  const onset = Math.min(1, peak * 0.8)
  const domain = {
    atom_max: Math.max(mean * 2, Number.MIN_VALUE),
    cloud_min: mean * onset,
    cloud_max: mean * (onset + Math.max(0.01, peak - onset)),
    density_reference: mean,
    threshold: mean * peak,
  }
  // Display values are Float32: reject ranges that vanish, collapse or overflow there.
  if (
    !Object.values(domain).every((value) => Number.isFinite(Math.fround(value))) ||
    (mean > 0 &&
      (Math.fround(mean) === 0 ||
        Math.fround(domain.cloud_max) <= Math.fround(domain.cloud_min)))
  )
    return undefined
  return { ...domain, metric, unit: metric === `temperature` ? `K` : `eV/atom` }
}

export function hotspot_probe(
  result: HotspotResult,
  display: HotspotDisplayValues,
  geometry: Omit<AtomColorField, `colors`>,
  position: Vec3,
):
  | { value: number; ratio: number; average_atoms: number; occupied_frames: number }
  | undefined {
  const bin = atom_field_bin(geometry, position)
  const value = display.values[bin]
  if (bin < 0 || !Number.isFinite(value)) return undefined
  return {
    value,
    ratio: display.mean > 0 ? value / display.mean : NaN,
    average_atoms: result.population[bin] / result.time_weight,
    occupied_frames: result.occupied_frames[bin],
  }
}

export function hotspot_cloud_colors(
  { values }: HotspotDisplayValues,
  scale: HotspotScale,
  base_color: string,
  hot_color: string,
): Float32Array | undefined {
  const { cloud_min, cloud_max, density_reference } = scale
  if (!(density_reference > 0)) return undefined
  const low = css_to_linear_rgb(base_color)
  const high = css_to_linear_rgb(hot_color)
  const colors = new Float32Array(values.length * 4)
  let visible = false
  // A faint cloud at the mean; smoothstep density emphasizes hotter regions. Render
  // settings never change the accumulated energies, temperatures, or hotspot threshold.
  for (let idx = 0; idx < values.length; idx++) {
    if (!Number.isFinite(values[idx])) continue
    const ratio = clamp01(values[idx] / density_reference)
    const heat = clamp01((values[idx] - cloud_min) / (cloud_max - cloud_min))
    for (let channel = 0; channel < 3; channel++)
      colors[idx * 4 + channel] = low[channel] + (high[channel] - low[channel]) * heat
    colors[idx * 4 + 3] = 0.03 * ratio + 0.97 * heat ** 2 * (3 - 2 * heat)
    visible ||= colors[idx * 4 + 3] > 0
  }
  // No cloud means no ray marching or atom fading for an empty/undersampled heatmap.
  return visible ? colors : undefined
}

// D3's Inferno is a discrete 256-color palette. Convert it once, when first requested,
// instead of parsing CSS or looking up color strings for every grid bin.
let inferno_rgb: ReturnType<typeof parse_linear_rgb>[] | undefined

// Build one small grid per analysis update, not a color buffer per atom or frame.
export function hotspot_colors(
  { values }: HotspotDisplayValues,
  scale: HotspotScale,
): Float32Array {
  const colors = new Float32Array(values.length * 4)
  inferno_rgb ??= Array.from({ length: 256 }, (_, idx) =>
    parse_linear_rgb(interpolateInferno(idx / 256)),
  )
  for (let idx = 0; idx < values.length; idx++) {
    if (!Number.isFinite(values[idx])) continue
    const color_idx = Math.min(255, Math.floor(clamp01(values[idx] / scale.atom_max) * 256))
    colors.set(inferno_rgb[color_idx], idx * 4)
    colors[idx * 4 + 3] = 1
  }
  return colors
}

export function hotspot_field_geometry(
  result: HotspotResult,
  frame: NumericFrame,
): Omit<AtomColorField, `colors`> {
  const box_origin = frame.header.metadata?.box_origin
  const render_origin: Vec3 =
    Array.isArray(box_origin) && box_origin.length === 3 && box_origin.every(Number.isFinite)
      ? (box_origin as Vec3)
      : [0, 0, 0]
  const { lattice } = frame.structure
  const grid =
    result.options.coordinates === `cell` && lattice
      ? {
          ...result.grid,
          cell: lattice.matrix,
          origin: render_origin,
          pbc: lattice.pbc ?? ([false, false, false] as const),
        }
      : result.grid
  // Cell vectors are columns for Three's column-vector multiplication. Scene positions
  // are relative to the source's box origin; analysis positions are absolute.
  const origin = grid.origin.map((value, axis) => value - render_origin[axis])
  const cartesian_to_fractional = new Matrix4()
    .fromArray([...grid.cell[0], 0, ...grid.cell[1], 0, ...grid.cell[2], 0, ...origin, 1])
    .invert()
  return { dims: grid.dims, pbc: grid.pbc, cartesian_to_fractional }
}
