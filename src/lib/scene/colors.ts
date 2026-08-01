// CSS colour to linear-space RGB for three.js buffers. Shared by every scene that writes
// colours into instanced or vertex attributes, which the renderer reads as Linear-sRGB.
import { rgb as parse_rgb } from 'd3-color'
import { Color, SRGBColorSpace } from 'three/webgpu'

export type LinearRgb = readonly [number, number, number]

const parse_scratch = new Color()

// Parsed by d3 rather than three's Color.set, which leaves the previous value in place on an
// unparseable string — painting one element with the last one's color. Falls back to mid grey.
// Fully transparent inputs land on grey too: d3 blanks their channels (`if (a <= 0) r = g = b =
// NaN`), and these meshes are opaque, so there is no hue left to honor anyway.
// Uncached: for one-shot conversions already cached by the caller (isosurface colormap LUTs),
// which would otherwise evict the element colors the memo below exists for.
export function parse_linear_rgb(css_color: string): LinearRgb {
  const { r, g, b } = parse_rgb(css_color)
  if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
    // d3 keeps out-of-gamut channels as authored (`rgb(300, -20, 0)`); CSS clamps them
    const clamp = (channel: number) => Math.min(255, Math.max(0, channel)) / 255
    parse_scratch.setRGB(clamp(r), clamp(g), clamp(b), SRGBColorSpace)
  } else parse_scratch.setRGB(0.5, 0.5, 0.5)
  return [parse_scratch.r, parse_scratch.g, parse_scratch.b]
}

// Bonds and polyhedra re-convert the same few element colors once per instance — 40k parses for
// a 20k-bond scene, measured at 6.4 ms against 0.6 ms cached. Only worth it at low cardinality:
// the same 40k spread over unique colors measured 2x slower cached than not, so a caller minting
// a distinct string per value (a continuous property scale) wants parse_linear_rgb instead.
// Bounded for that reason too — such a caller would otherwise grow the map without end.
const MAX_CACHED_COLORS = 4096
const linear_rgb_cache = new Map<string, LinearRgb>()

export function css_to_linear_rgb(css_color: string): LinearRgb {
  const cached = linear_rgb_cache.get(css_color)
  if (cached) return cached
  // Frozen because every caller shares this tuple: `readonly` only stops TypeScript, and one
  // stray write from a JS consumer would repaint every later use of that color.
  const rgb = Object.freeze(parse_linear_rgb(css_color))
  if (linear_rgb_cache.size >= MAX_CACHED_COLORS) linear_rgb_cache.clear()
  linear_rgb_cache.set(css_color, rgb)
  return rgb
}

// Channels are already in the working color space, so no second conversion here.
export function set_linear_css_color(css_color: string, scratch_color: Color): void {
  const [red, green, blue] = css_to_linear_rgb(css_color)
  scratch_color.setRGB(red, green, blue)
}

export function write_linear_color_to_buffer(
  buffer: Float32Array,
  idx: number,
  css_color: string,
): void {
  const [red, green, blue] = css_to_linear_rgb(css_color)
  buffer[idx * 3] = red
  buffer[idx * 3 + 1] = green
  buffer[idx * 3 + 2] = blue
}
