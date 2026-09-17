import { get_d3_interpolator } from '$lib/colors'
import type { Vec3 } from '$lib/math'
import { css_to_linear_rgb } from '$lib/scene/colors'
import type { AtomColorField } from '$lib/structure/atom-color-field'
import { Matrix4 } from 'three/webgpu'
import type { NumericFrame } from './frame'
import type { HotspotDisplayValues, HotspotResult } from './hotspots'

export const DEFAULT_HOTSPOT_CLOUD = {
  visible: false,
  opacity: 0.35,
  base_color: `#ffd6a6`,
  hot_color: `#e53935`,
}
export type HotspotCloudSettings = typeof DEFAULT_HOTSPOT_CLOUD

export function hotspot_cloud_colors(
  { values, mean }: HotspotDisplayValues,
  threshold: number,
  base_color: string,
  hot_color: string,
): Float32Array {
  const low = css_to_linear_rgb(base_color)
  const high = css_to_linear_rgb(hot_color)
  const colors = new Float32Array(values.length * 4)
  // A faint cloud at the mean; quadratic density emphasizes hotter regions. Render
  // settings never change the accumulated energies, temperatures, or hotspot threshold.
  const peak = Number.isFinite(threshold) ? Math.max(0, threshold) : 1.25
  const onset = Math.min(1, peak * 0.8)
  const ramp = Math.max(0.01, peak - onset)
  for (let idx = 0; idx < values.length; idx++) {
    if (!Number.isFinite(values[idx]) || !(mean > 0)) continue
    const ratio = Math.max(0, values[idx] / mean)
    const heat = Math.min(1, Math.max(0, (ratio - onset) / ramp))
    for (let channel = 0; channel < 3; channel++)
      colors[idx * 4 + channel] = low[channel] + (high[channel] - low[channel]) * heat
    colors[idx * 4 + 3] = 0.03 * Math.min(1, ratio) + 0.97 * heat ** 2
  }
  return colors
}

// Build one small grid per analysis update, not a color buffer per atom or frame.
export function hotspot_colors({ values, mean }: HotspotDisplayValues): Float32Array {
  const scale = Math.max(mean * 2, Number.EPSILON)
  const interpolate = get_d3_interpolator(`interpolateInferno`)
  const colors = new Float32Array(values.length * 4)
  for (let idx = 0; idx < values.length; idx++) {
    if (!Number.isFinite(values[idx])) continue
    const scaled = Math.min(1, Math.max(0, values[idx] / scale))
    colors.set(css_to_linear_rgb(interpolate(scaled)), idx * 4)
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
