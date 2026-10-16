// Vertex-color generation for cross-volume isosurface coloring: maps sampled
// scalar values through a d3 colormap LUT to Three.js color buffer attributes.
import type { D3InterpolateName } from '#lib/colors/index.js'
import type { Vec2 } from '#lib/math.js'
import {
  color_interpolator,
  color_ramp_scale,
  to_color_scale_config,
} from '#lib/plot/core/scales.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import { get_scale_type_name } from '#lib/plot/core/types.js'
import { clamp01 } from '#lib/utils.js'
import { css_to_linear_rgb, parse_linear_rgb } from '#lib/scene/colors.js'
import { BufferAttribute, type BufferGeometry } from 'three/webgpu'
import type { DataRange } from './types'

// Curated continuous colormaps offered in the isosurface controls UI.
// Sequential maps for densities/potential magnitudes, diverging for signed fields.
export const ISO_COLORMAPS = [
  `interpolateViridis`,
  `interpolatePlasma`,
  `interpolateInferno`,
  `interpolateMagma`,
  `interpolateCividis`,
  `interpolateTurbo`,
  `interpolateRdBu`,
  `interpolateRdYlBu`,
  `interpolateSpectral`,
  `interpolatePiYG`,
  `interpolateBrBG`,
  `interpolatePuOr`,
] as const satisfies readonly D3InterpolateName[]

type IsoColormap = (typeof ISO_COLORMAPS)[number]

// ColorScaleSelect props for picking one of ISO_COLORMAPS inside a compact settings grid
// (isosurface layer colouring, Fermi surface property colouring)
export const ISO_COLORMAP_SELECT_PROPS = {
  options: [...ISO_COLORMAPS],
  color_bar: { bar_style: `height: 8px`, title_style: `width: 4em; font-size: 1em;` },
  li_selected_style: `width: 100%; margin: 0; padding: 0; background: transparent;`,
}

// A field counts as signed when it has significant values of both signs
// (e.g. ESP, magnetization, orbitals) — drives diverging-colormap defaults.
export const is_signed_range = (data_range: DataRange): boolean =>
  data_range.min < -data_range.abs_max * 0.01 && data_range.max > data_range.abs_max * 0.01

export const COLORMAP_LUT_SIZE = 256

// A color scale's palette (scheme clipped to palette_range) sampled at COLORMAP_LUT_SIZE
// fractions and packed by `build`, for GPU vertex colors and canvas slice pixels. Cached in the
// caller's private `cache` (building one parses 256 CSS colors); function schemes are rebuilt.
export function palette_lut<Lut>(
  cache: Map<string, Lut>,
  color_scale: ColorScale,
  build: (colors: string[]) => Lut,
): Lut {
  const { scheme, palette_range } = to_color_scale_config(color_scale)
  const key = typeof scheme === `function` ? null : `${scheme}|${palette_range}`
  const cached = key === null ? undefined : cache.get(key)
  if (cached) return cached
  const interpolate = color_interpolator(color_scale)
  const lut = build(
    Array.from({ length: COLORMAP_LUT_SIZE }, (_, idx) =>
      interpolate(idx / (COLORMAP_LUT_SIZE - 1)),
    ),
  )
  if (key !== null) cache.set(key, lut)
  return lut
}

// LUT index of a value on [min, max] with the color scale type's spacing (an inverted range
// flips the palette, a degenerate one maps every value to its middle). -1 marks values with no
// color: non-finite ones and, on a log scale, non-positive ones.
export function lut_index_fn(color_scale: ColorScale, [min, max]: Vec2) {
  const last = COLORMAP_LUT_SIZE - 1
  const { type } = to_color_scale_config(color_scale)
  const inv_span = 1 / (max - min)
  const position =
    min === max
      ? (value: number) => (Number.isFinite(value) ? 0.5 : NaN)
      : !type || get_scale_type_name(type) === `linear`
        ? (value: number) => (value - min) * inv_span
        : color_ramp_scale(type, [min, max], [0, 1])
  return (value: number): number => {
    const fraction = position(value)
    return Number.isFinite(fraction) ? Math.round(clamp01(fraction) * last) : -1
  }
}

// Linear-RGB LUTs for vertex colors: vertex colors are read as Linear-sRGB, so d3's sRGB output
// is converted. parse_linear_rgb is uncached on purpose (256 one-shot keys would evict shared
// element colors).
const linear_lut_cache = new Map<string, Float32Array>()
const build_linear_lut = (colors: string[]): Float32Array => {
  const lut = new Float32Array(colors.length * 3)
  for (const [idx, color] of colors.entries()) lut.set(parse_linear_rgb(color), idx * 3)
  return lut
}

// Range for a colormap over values in [min, max]. `true` forces a range symmetric about
// zero, `false` keeps [min, max] as is, and `auto` (the default) symmetrises only when the
// values straddle zero so diverging colormaps keep zero at their centre.
export type ValueRangeSymmetry = boolean | `auto`
export function fit_value_range(
  min: number,
  max: number,
  symmetric: ValueRangeSymmetry = `auto`,
): Vec2 {
  if (symmetric === true || (symmetric === `auto` && min < 0 && max > 0)) {
    const abs_max = Math.max(Math.abs(min), Math.abs(max))
    return [-abs_max, abs_max]
  }
  return [min, max]
}

export interface VertexColorOptions {
  color_scale: ColorScale // scheme, palette_range and type spacing
  // [min, max] the caller resolved from color_scale.value_range and the data (see
  // resolve_value_range); inverted ranges flip the colormap
  value_range: Vec2
  // used for scalars with no color: non-finite (out-of-bounds under 'fallback' policy), or
  // non-positive on a log scale
  fallback_color?: string
}

// Map per-vertex scalars to a flat linear-RGB Float32Array (3 components per
// vertex) suitable for a Three.js 'color' BufferAttribute. Values outside
// value_range clamp to the ends of the colormap; values with no color get
// fallback_color. Pass an existing array of the right size to fill in place
// (avoids reallocating GPU-bound buffers on recolor).
export function scalars_to_vertex_colors(
  scalars: Float32Array,
  { color_scale, value_range, fallback_color = `#808080` }: VertexColorOptions,
  out?: Float32Array,
): Float32Array {
  const lut = palette_lut(linear_lut_cache, color_scale, build_linear_lut)
  const lut_index = lut_index_fn(color_scale, value_range)
  const [fb_r, fb_g, fb_b] = css_to_linear_rgb(fallback_color)

  const colors =
    out?.length === scalars.length * 3 ? out : new Float32Array(scalars.length * 3)
  for (let idx = 0; idx < scalars.length; idx++) {
    const lut_idx = lut_index(scalars[idx]) * 3
    if (lut_idx < 0) {
      colors[idx * 3] = fb_r
      colors[idx * 3 + 1] = fb_g
      colors[idx * 3 + 2] = fb_b
      continue
    }
    colors[idx * 3] = lut[lut_idx]
    colors[idx * 3 + 1] = lut[lut_idx + 1]
    colors[idx * 3 + 2] = lut[lut_idx + 2]
  }
  return colors
}

// Set or refresh a geometry's per-vertex `color` attribute from scalars without touching
// positions or the index, so colormap/range changes never rebuild the mesh. An existing
// attribute's buffer is rewritten in place and flagged for re-upload.
export function set_vertex_colors(
  geometry: BufferGeometry,
  scalars: Float32Array,
  options: VertexColorOptions,
): void {
  const existing = geometry.getAttribute(`color`) as BufferAttribute | undefined
  const colors = scalars_to_vertex_colors(
    scalars,
    options,
    existing?.array instanceof Float32Array ? existing.array : undefined,
  )
  if (existing?.array === colors) existing.needsUpdate = true
  else geometry.setAttribute(`color`, new BufferAttribute(colors, 3))
}

// Suggest a colormap and value range for coloring by a volume with the given
// data range: signed fields (e.g. ESP, magnetization) get a diverging RdBu map
// with a symmetric range about zero; non-negative fields get Viridis over [min, max].
export function auto_color_config(data_range: DataRange): {
  scheme: IsoColormap
  value_range: Vec2
} {
  const { min, max, abs_max } = data_range
  if (is_signed_range(data_range)) {
    // RdBu with symmetric range: negative → red, positive → blue (ESP convention)
    return { scheme: `interpolateRdBu`, value_range: [-abs_max, abs_max] }
  }
  return { scheme: `interpolateViridis`, value_range: [min, max] }
}

// Fit a color range to the scalar values actually present on the surface(s),
// ignoring non-finite (out-of-bounds) markers. This is the default when a layer
// has no explicit value_range: the whole-volume range is usually dominated by
// extreme values near nuclei that never appear on the rendered surface.
// `symmetric: true` (pass when the source field is signed) forces a range symmetric
// about zero even when the sampled values happen to be one-signed, so diverging
// colormaps keep zero at their center; see fit_value_range for the other modes.
export function compute_scalar_range(
  scalar_arrays: Float32Array[],
  { symmetric = `auto` }: { symmetric?: ValueRangeSymmetry } = {},
): Vec2 {
  let min = Infinity
  let max = -Infinity
  for (const scalars of scalar_arrays) {
    for (const value of scalars) {
      if (!Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (min === Infinity) return [0, 1] // no finite samples
  return fit_value_range(min, max, symmetric)
}
