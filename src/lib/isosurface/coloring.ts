// Vertex-color generation for cross-volume isosurface coloring: maps sampled
// scalar values through a d3 colormap LUT to Three.js color buffer attributes.
import type { D3InterpolateName } from '$lib/colors'
import { get_d3_interpolator } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { Color } from 'three'
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

export type IsoColormap = (typeof ISO_COLORMAPS)[number]

export const DEFAULT_ISO_COLORMAP: IsoColormap = `interpolateViridis`

// A field counts as signed when it has significant values of both signs
// (e.g. ESP, magnetization, orbitals) — drives diverging-colormap defaults.
export const is_signed_range = (data_range: DataRange): boolean =>
  data_range.min < -data_range.abs_max * 0.01 && data_range.max > data_range.abs_max * 0.01

const LUT_SIZE = 256

// LUTs cached per colormap name — building one parses 256 CSS color strings.
// Private so the mutable cached arrays cannot be corrupted by consumers.
const lut_cache = new Map<string, Float32Array>()

// Parse a CSS color to linear-space RGB via Three.js (vertex color attributes
// are interpreted as Linear-sRGB by the renderer, so sRGB values from d3 must
// be converted or surfaces render too bright)
const scratch_color = new Color()
const parse_linear_rgb = (css_color: string): [number, number, number] => {
  scratch_color.set(css_color)
  return [scratch_color.r, scratch_color.g, scratch_color.b]
}

function get_colormap_lut(colormap: D3InterpolateName): Float32Array {
  const cached = lut_cache.get(colormap)
  if (cached) return cached
  const interpolator = get_d3_interpolator(colormap)
  const lut = new Float32Array(LUT_SIZE * 3)
  for (let idx = 0; idx < LUT_SIZE; idx++) {
    const [red, green, blue] = parse_linear_rgb(interpolator(idx / (LUT_SIZE - 1)))
    lut[idx * 3] = red
    lut[idx * 3 + 1] = green
    lut[idx * 3 + 2] = blue
  }
  lut_cache.set(colormap, lut)
  return lut
}

export interface VertexColorOptions {
  colormap: D3InterpolateName
  color_range: Vec2 // [min, max]; inverted ranges (min > max) flip the colormap
  fallback_color?: string // used for non-finite scalars (out-of-bounds under 'fallback' policy)
}

// Map per-vertex scalars to a flat linear-RGB Float32Array (3 components per
// vertex) suitable for a Three.js 'color' BufferAttribute. Values outside
// color_range clamp to the ends of the colormap; non-finite values get
// fallback_color. Pass an existing array of the right size to fill in place
// (avoids reallocating GPU-bound buffers on recolor).
export function scalars_to_vertex_colors(
  scalars: Float32Array,
  { colormap, color_range, fallback_color = `#808080` }: VertexColorOptions,
  out?: Float32Array,
): Float32Array {
  const lut = get_colormap_lut(colormap)
  const [range_min, range_max] = color_range
  const span = range_max - range_min
  const inv_span = span !== 0 ? 1 / span : 0
  const [fb_r, fb_g, fb_b] = parse_linear_rgb(fallback_color)

  const colors =
    out?.length === scalars.length * 3 ? out : new Float32Array(scalars.length * 3)
  for (let idx = 0; idx < scalars.length; idx++) {
    const value = scalars[idx]
    if (!Number.isFinite(value)) {
      colors[idx * 3] = fb_r
      colors[idx * 3 + 1] = fb_g
      colors[idx * 3 + 2] = fb_b
      continue
    }
    // span === 0 maps everything to the middle of the colormap
    const normalized = span === 0 ? 0.5 : (value - range_min) * inv_span
    const clamped = normalized < 0 ? 0 : Math.min(1, normalized)
    const lut_idx = Math.round(clamped * (LUT_SIZE - 1)) * 3
    colors[idx * 3] = lut[lut_idx]
    colors[idx * 3 + 1] = lut[lut_idx + 1]
    colors[idx * 3 + 2] = lut[lut_idx + 2]
  }
  return colors
}

// Suggest a colormap and value range for coloring by a volume with the given
// data range: signed fields (e.g. ESP, magnetization) get a diverging RdBu map
// with a symmetric range about zero; non-negative fields get Viridis over [min, max].
export function auto_color_config(data_range: DataRange): {
  colormap: IsoColormap
  color_range: Vec2
} {
  const { min, max, abs_max } = data_range
  if (is_signed_range(data_range)) {
    // RdBu with symmetric range: negative → red, positive → blue (ESP convention)
    return { colormap: `interpolateRdBu`, color_range: [-abs_max, abs_max] }
  }
  return { colormap: DEFAULT_ISO_COLORMAP, color_range: [min, max] }
}

// Fit a color range to the scalar values actually present on the surface(s),
// ignoring non-finite (out-of-bounds) markers. This is the default when a layer
// has no explicit color_range: the whole-volume range is usually dominated by
// extreme values near nuclei that never appear on the rendered surface.
// `symmetric` (pass when the source field is signed) forces a range symmetric
// about zero even when the sampled values happen to be one-signed, so diverging
// colormaps keep zero at their center.
export function compute_scalar_range(
  scalar_arrays: Float32Array[],
  { symmetric = false }: { symmetric?: boolean } = {},
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
  if (symmetric || (min < 0 && max > 0)) {
    const abs_max = Math.max(Math.abs(min), Math.abs(max))
    return [-abs_max, abs_max]
  }
  return [min, max]
}
