// Hatch/texture fills for filled marks (treemap cells, sunburst arcs, bars, histogram bins,
// box/violin bodies, fill-between regions, composition charts). A mark declares a `pattern`
// next to its color; `resolve_pattern` turns that into one SVG `<pattern>` tile (rendered by
// PatternDefs.svelte) and the `url(#id)` paint the mark fills with. Tiles live in user space
// so adjacent marks share one continuous texture, like plotly's pattern fills.

import { opaque_contrast_color } from '$lib/colors'

// Stroked line families (`diagonal` … `hexagons`) and filled marker families
// (`dots` … `checkerboard`)
export type PatternShape =
  | `diagonal` // ╱ stripes
  | `diagonal-reverse` // ╲ stripes
  | `cross-diagonal` // ✕ lattice
  | `horizontal`
  | `vertical`
  | `cross` // + grid
  | `zigzag`
  | `waves`
  | `bricks`
  | `hexagons`
  | `circles` // hollow rings
  | `dots`
  | `squares`
  | `triangles`
  | `checkerboard`

// plotly-compatible one-character aliases for the most common shapes
export type PatternShorthand = `/` | `\\` | `x` | `-` | `|` | `+` | `.` | `o`

export const PATTERN_SHORTHANDS: Readonly<Record<PatternShorthand, PatternShape>> = {
  '/': `diagonal`,
  '\\': `diagonal-reverse`,
  x: `cross-diagonal`,
  '-': `horizontal`,
  '|': `vertical`,
  '+': `cross`,
  '.': `dots`,
  o: `circles`,
}

// Every shape, ordered so consecutive entries stay visually distinct when assigned by index
export const PATTERN_SHAPES = [
  `diagonal`,
  `dots`,
  `cross-diagonal`,
  `horizontal`,
  `circles`,
  `diagonal-reverse`,
  `cross`,
  `zigzag`,
  `vertical`,
  `squares`,
  `waves`,
  `triangles`,
  `bricks`,
  `checkerboard`,
  `hexagons`,
] as const satisfies readonly PatternShape[]

// Stroke dashing for line shapes; the presets tile seamlessly on straight lines
export type PatternDash = `solid` | `dashed` | `dotted`

export interface PatternOptions {
  shape?: PatternShape | PatternShorthand // default `diagonal`
  size?: number // tile period in px (spacing between repeats), default 8
  // Fraction of the tile the foreground covers, 0-1 (default 0.25). Sets line widths and
  // marker sizes consistently across shapes. Filled markers saturate at the largest marker
  // that fits the tile (π/4 for dots, 3√3/16 for triangles) since a bigger one would be
  // clipped at the tile edges.
  solidity?: number
  angle?: number // extra rotation in degrees on top of the shape's own orientation
  dash?: PatternDash
  // `overlay` (default) paints the texture over the mark's own fill color; `replace` draws the
  // texture in the mark's color on a transparent background (plotly's fillmode)
  mode?: `overlay` | `replace`
  // Texture color. Defaults to black/white for contrast against the fill (overlay) or to the
  // mark's own color (replace). Use an rgba/alpha color to tune the texture strength.
  fg?: string
  // Background behind the texture. Defaults to the mark's color (overlay) or transparent
  // (replace)
  bg?: string
}

// What marks accept: a shape name, a plotly-style shorthand, or full options
export type FillPattern = PatternShape | PatternShorthand | PatternOptions

const is_shorthand = (shape: string): shape is PatternShorthand =>
  Object.hasOwn(PATTERN_SHORTHANDS, shape)

// One `<pattern>` tile, fully resolved: geometry plus the paint the mark uses
export interface ResolvedPattern {
  id: string
  url: string // `url(#id)` - the mark's fill attribute
  width: number
  height: number
  transform: string | undefined // patternTransform
  bg: string // tile background; `transparent` in replace mode
  fg: string
  fg_opacity: number
  d: string // tile geometry as one path (stroked or filled per `stroked`)
  stroked: boolean
  line_width: number
  dasharray: string | undefined
  linecap: `round` | undefined // round caps turn dotted dashes into dots; else SVG default
  dashoffset: string | undefined
}

const DEFAULT_SIZE = 8
const DEFAULT_SOLIDITY = 0.25
const SQRT3 = Math.sqrt(3)

// Numbers in path data trimmed to 3 decimals so ids/hashes stay short and stable
const num = (val: number): string =>
  Number.isInteger(val) ? `${val}` : `${Number(val.toFixed(3))}`

// Circle of `radius` centered at (cx, cy) as two arcs
const circle_path = (cx: number, cy: number, radius: number): string =>
  `M${num(cx - radius)} ${num(cy)}a${num(radius)} ${num(radius)} 0 1 0 ${num(2 * radius)} 0` +
  `a${num(radius)} ${num(radius)} 0 1 0 ${num(-2 * radius)} 0Z`

// Regular hexagon outline (pointy-top) with circumradius `radius` centered at (cx, cy)
const hexagon_path = (cx: number, cy: number, radius: number): string => {
  const half_w = (SQRT3 / 2) * radius
  return (
    `M${num(cx)} ${num(cy - radius)}` +
    `L${num(cx + half_w)} ${num(cy - radius / 2)}` +
    `L${num(cx + half_w)} ${num(cy + radius / 2)}` +
    `L${num(cx)} ${num(cy + radius)}` +
    `L${num(cx - half_w)} ${num(cy + radius / 2)}` +
    `L${num(cx - half_w)} ${num(cy - radius / 2)}Z`
  )
}

interface TileGeometry {
  width: number
  height: number
  d: string
  stroked: boolean
  rotation: number // the shape's intrinsic orientation in degrees
  // stroked shapes: total stroked length per tile, so solidity -> line width stays
  // comparable across shapes (coverage ≈ length * line_width / tile area)
  stroke_length: number
}

// Tile geometry for each shape. Stroked shapes derive from a few primitives plus a rotation
// (a horizontal line rotated -45° is `/`), so dashes stay seamless along straight lines.
function tile_geometry(shape: PatternShape, size: number, solidity: number): TileGeometry {
  const half = size / 2
  const stroked = (d: string, stroke_length: number, rotation = 0): TileGeometry => ({
    width: size,
    height: size,
    d,
    stroked: true,
    rotation,
    stroke_length,
  })
  const filled = (d: string): TileGeometry => ({
    width: size,
    height: size,
    d,
    stroked: false,
    rotation: 0,
    stroke_length: 0,
  })
  const line = `M0 ${num(half)}H${num(size)}`
  const cross = `${line}M${num(half)} 0V${num(size)}`
  if (shape === `horizontal`) return stroked(line, size)
  if (shape === `vertical`) return stroked(line, size, 90)
  if (shape === `diagonal`) return stroked(line, size, -45)
  if (shape === `diagonal-reverse`) return stroked(line, size, 45)
  if (shape === `cross`) return stroked(cross, 2 * size)
  if (shape === `cross-diagonal`) return stroked(cross, 2 * size, 45)
  // Zigzag and waves cross the tile edges at an angle, so a path that stops on the edge
  // leaves a butt-cap wedge at every seam. Overshooting half a period on both sides lets
  // the clipped tile carry the full stroke width through the edge (stroke_length stays
  // per tile).
  const [lo, hi] = [size * 0.25, size * 0.75]
  if (shape === `zigzag`) {
    const d =
      `M${num(-half)} ${num(lo)}L0 ${num(hi)}L${num(half)} ${num(lo)}` +
      `L${num(size)} ${num(hi)}L${num(1.5 * size)} ${num(lo)}`
    return stroked(d, 2 * Math.hypot(half, half))
  }
  if (shape === `waves`) {
    // Q + T (reflected control) gives matching tangents at each joint -> smooth sine
    const d =
      `M${num(-half)} ${num(half)}Q${num(-size / 4)} ${num(size * 0.9)} 0 ${num(half)}` +
      `T${num(half)} ${num(half)}T${num(size)} ${num(half)}T${num(1.5 * size)} ${num(half)}`
    return stroked(d, size * 1.2)
  }
  if (shape === `bricks`) {
    // two courses per tile; edge lines are drawn at both 0 and size so the half clipped
    // off one tile is completed by its neighbour
    const d =
      `M0 0H${num(size)}M0 ${num(size)}H${num(size)}M0 ${num(half)}H${num(size)}` +
      `M${num(half)} 0V${num(half)}M0 ${num(half)}V${num(size)}M${num(size)} ${num(
        half,
      )}V${num(size)}`
    return stroked(d, 3 * size)
  }
  if (shape === `hexagons`) {
    // honeycomb: one full hexagon plus the two half hexagons straddling the side edges
    const radius = half
    const width = SQRT3 * radius
    const height = 3 * radius
    const d =
      hexagon_path(width / 2, radius, radius) +
      hexagon_path(0, 2.5 * radius, radius) +
      hexagon_path(width, 2.5 * radius, radius)
    // each of the tile's two hexagons contributes 6 edges shared pairwise -> 6 edges of R
    return { width, height, d, stroked: true, rotation: 0, stroke_length: 6 * radius }
  }
  if (shape === `circles`) {
    const radius = size * 0.3
    return stroked(circle_path(half, half, radius), 2 * Math.PI * radius)
  }
  if (shape === `dots`) {
    const radius = size * Math.sqrt(Math.min(solidity, Math.PI / 4) / Math.PI)
    return filled(circle_path(half, half, radius))
  }
  if (shape === `squares`) {
    const side = size * Math.sqrt(solidity)
    const origin = half - side / 2
    return filled(`M${num(origin)} ${num(origin)}h${num(side)}v${num(side)}h${num(-side)}Z`)
  }
  if (shape === `triangles`) {
    // equilateral, up-pointing, area = solidity * tile area, centroid at the tile center; the
    // apex reaches the tile's top edge at solidity 3√3/16
    const side = Math.sqrt((4 * Math.min(solidity, (3 * SQRT3) / 16) * size * size) / SQRT3)
    const tri_height = (SQRT3 / 2) * side
    const apex_y = half - (2 / 3) * tri_height
    const base_y = half + tri_height / 3
    return filled(
      `M${num(half)} ${num(apex_y)}L${num(half + side / 2)} ${num(base_y)}L${num(
        half - side / 2,
      )} ${num(base_y)}Z`,
    )
  }
  if (shape === `checkerboard`) {
    return filled(
      `M0 0h${num(half)}v${num(half)}h${num(-half)}ZM${num(half)} ${num(half)}h${num(
        half,
      )}v${num(half)}h${num(-half)}Z`,
    )
  }
  throw new Error(`Unknown pattern shape: ${shape}`)
}

const dash_array = (dash: PatternDash, size: number): string | undefined => {
  if (dash === `solid`) return undefined
  if (dash === `dashed`) return `${num(size / 2)} ${num(size / 2)}`
  // zero-length dashes with round caps render as dots of the line's width
  return `0 ${num(size / 2)}`
}

// djb2 over the resolved fields -> short stable id suffix, so identical patterns within one
// chart share a single <defs> entry
const hash_str = (str: string): string => {
  let hash = 5381
  for (let idx = 0; idx < str.length; idx++) {
    hash = (Math.imul(hash, 33) + str.charCodeAt(idx)) >>> 0
  }
  return hash.toString(36)
}

// Resolve a mark's pattern against its fill color. `prefix` scopes the id to one chart
// instance (two charts on a page must not share ids: removing one would break the other's
// paint). `scale` shrinks the tile for thumbnails like legend swatches.
export function resolve_pattern(
  pattern: FillPattern,
  base_color: string,
  prefix: string,
  scale = 1,
): ResolvedPattern {
  const opts: PatternOptions = typeof pattern === `string` ? { shape: pattern } : pattern
  const shape_or_alias = opts.shape ?? `diagonal`
  const shape = is_shorthand(shape_or_alias)
    ? PATTERN_SHORTHANDS[shape_or_alias]
    : shape_or_alias
  const size = (opts.size ?? DEFAULT_SIZE) * scale
  const solidity = opts.solidity ?? DEFAULT_SOLIDITY
  const angle = opts.angle ?? 0
  // Negated comparisons so NaN fails too (it would otherwise leak into the path data)
  if (!(size > 0)) {
    throw new Error(
      `pattern size must be > 0, got ${opts.size ?? DEFAULT_SIZE} × scale ${scale}`,
    )
  }
  if (!(solidity >= 0 && solidity <= 1)) {
    throw new Error(`pattern solidity must be in [0, 1], got ${solidity}`)
  }
  if (!Number.isFinite(angle)) throw new Error(`pattern angle must be finite, got ${angle}`)
  const geometry = tile_geometry(shape, size, solidity)
  const replace = opts.mode === `replace`
  // Auto-contrast against the color the texture is painted over; translucent, CSS-variable
  // or otherwise unparsable colors fall back to currentColor so the texture still shows
  const fg = opts.fg ?? (replace ? base_color : opaque_contrast_color(base_color))
  const rotation = geometry.rotation + angle
  const dash = opts.dash ?? `solid`
  const resolved = {
    width: geometry.width,
    height: geometry.height,
    transform: rotation ? `rotate(${num(rotation)})` : undefined,
    bg: opts.bg ?? (replace ? `transparent` : base_color),
    fg,
    fg_opacity: replace ? 1 : 0.5,
    d: geometry.d,
    stroked: geometry.stroked,
    // coverage ≈ stroke_length × line_width / tile area
    line_width: geometry.stroked
      ? (solidity * geometry.width * geometry.height) / geometry.stroke_length
      : 0,
    dasharray: geometry.stroked ? dash_array(dash, size) : undefined,
    linecap: dash === `dotted` ? (`round` as const) : undefined,
    // `0 size/2` puts dots at 0, size/2 and size, and the dot on the far edge is not drawn
    // (renderers skip a zero-length dash at the path end), so the seam shows half dots.
    // Shifting by a quarter period puts both dots fully inside the tile.
    dashoffset: geometry.stroked && dash === `dotted` ? num(size / 4) : undefined,
  }
  const id = `${prefix}-pat-${hash_str(JSON.stringify(resolved))}`
  return { id, url: `url(#${id})`, ...resolved }
}

// Distinct patterns among a chart's marks (by id, first-seen order), for one PatternDefs render
export const unique_patterns = (
  patterns: Iterable<ResolvedPattern | null | undefined>,
): ResolvedPattern[] => {
  const by_id = new Map<string, ResolvedPattern>()
  for (const pat of patterns) if (pat && !by_id.has(pat.id)) by_id.set(pat.id, pat)
  return [...by_id.values()]
}
