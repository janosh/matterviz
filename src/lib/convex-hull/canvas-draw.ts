// Canvas drawing for ConvexHullCanvas: markers, points, pulse overlay, labels, faces, plus
// the ternary/quaternary strategies (camera, projection, simplex outline, axes).
import { add_alpha, plot_color } from '$lib/colors'
import type { D3InterpolateName } from '$lib/colors'
import { get_formula_label_segments } from '$lib/composition/format'
import type { FormulaLabelSegment } from '$lib/composition/format'
import type { ElementSymbol } from '$lib/element'
import { capitalize, type D3SymbolName, format_num, symbol_map } from '$lib/labels'
import { array_min, clamp, mean, to_radians, type Vec3 } from '$lib/math'
import {
  centered_rect,
  pad_rect,
  rect_within_rect,
  rects_overlap,
} from '$lib/plot/core/layout'
import type { Rect } from '$lib/plot/core/layout'
import { DEFAULTS } from '$lib/settings'
import { clamp01 } from '$lib/utils'
import { ticks } from 'd3-array'
import { symbol } from 'd3-shape'
import { TETRAHEDRON_VERTICES, TRIANGLE_VERTICES } from './barycentric-coords'
import {
  entry_is_stable,
  get_composition_label_entries,
  get_energy_color_scale,
  get_entry_label,
  same_entry,
} from './helpers'
import { CONVEX_HULL_STYLE } from './index'
import type { ConvexHullEntry, HighlightStyle, HullFaceColorMode, MarkerSymbol } from './types'

export type Projected = { x: number; y: number; depth: number }
export type ProjectPoint = (x: number, y: number, z: number) => Projected

// Mean of the simplex corners (triangle or tetrahedron): the rotation centre of the view
export const simplex_centroid = (corners: readonly (readonly number[])[]): number[] =>
  corners[0].map(
    (_, axis) => corners.reduce((sum, corner) => sum + corner[axis], 0) / corners.length,
  )

// Marker radius in CSS px before the container scale (stable points are larger)
export const point_radius = (entry: ConvexHullEntry): number =>
  // `||` (not ??) on purpose: size=0 falls back to the default
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing
  entry.size || (entry_is_stable(entry) ? 6 : 4)

// === Markers ===

// D3 symbol name of a marker (`circle` → `Circle`), undefined for unknown marker names
export function marker_d3_name(marker: MarkerSymbol): D3SymbolName | undefined {
  const name = capitalize(marker)
  return name in symbol_map ? (name as D3SymbolName) : undefined
}

// SVG path data for a marker symbol of given radius, or null for unknown marker names.
// Uses d3-shape for consistent rendering with ScatterPlot.
export function marker_path_data(radius: number, marker: MarkerSymbol): string | null {
  const d3_name = marker_d3_name(marker)
  const symbol_type = d3_name && symbol_map[d3_name]
  return symbol_type
    ? symbol()
        .type(symbol_type)
        .size(Math.PI * radius * radius)()
    : null
}

// Outlines are position-independent (callers translate the context), so shape and size key
// them. Rotating a hull wants two per point per frame, a shadow and a marker, off a handful
// of distinct sizes — building those fresh was pure allocation.
const marker_path_cache = new Map<string, Path2D>()
const MAX_MARKER_PATH_CACHE = 512

export function create_marker_path(size: number, marker: MarkerSymbol = `circle`): Path2D {
  const rounded_size = Math.max(0, Number((Number.isFinite(size) ? size : 0).toFixed(3)))
  const key = `${marker}|${rounded_size}`
  const cached = marker_path_cache.get(key)
  if (cached) return cached
  const path_data = marker_path_data(rounded_size, marker)
  const path = new Path2D(path_data ?? undefined)
  if (!path_data) path.arc(0, 0, rounded_size, 0, 2 * Math.PI)
  if (marker_path_cache.size > MAX_MARKER_PATH_CACHE) marker_path_cache.clear()
  marker_path_cache.set(key, path)
  return path
}

// === Points ===

type HullPulse = { time: number; opacity: number }
export type HullPoint = { entry: ConvexHullEntry; projected: Projected }
export type HullPointOpts = {
  scale: number // canvas container scale factor
  shadow_factor: number // scales the depth-based shadow offset (0.1 for 3D, 2 for 4D)
  selected_entry: ConvexHullEntry | null
  is_highlighted: (entry: ConvexHullEntry) => boolean
  get_point_color: (entry: ConvexHullEntry) => string
  highlight_style: Required<HighlightStyle>
}

// Points whose rings animate. same_entry, not raw entry_id comparison: undefined ===
// undefined would mark EVERY id-less point as selected.
const is_pulsing = (entry: ConvexHullEntry, opts: HullPointOpts): boolean =>
  same_entry(opts.selected_entry, entry) || opts.is_highlighted(entry)

function draw_highlight_effect(
  ctx: CanvasRenderingContext2D,
  projected: Projected,
  size: number,
  scale: number,
  pulse_time: number,
  style: Required<HighlightStyle>,
): void {
  const { effect, color, size_multiplier, opacity, pulse_speed } = style
  if (effect === `pulse`) {
    // Smooth pulsating ring with moderate size and opacity changes
    const pulse_val = 0.5 + 0.5 * Math.sin(pulse_time * pulse_speed)
    const hl_size = size * (size_multiplier + 0.5 * pulse_val)
    const hl_opacity = opacity * (0.5 + 0.5 * pulse_val)
    ctx.lineWidth = (1.5 + pulse_val) * scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size, 0, 2 * Math.PI)
    ctx.fillStyle = add_alpha(color, hl_opacity * 0.3)
    ctx.strokeStyle = add_alpha(color, hl_opacity)
    ctx.fill()
    ctx.stroke()
  } else if (effect === `glow`) {
    // Soft glow: outer halo plus inner stroked disc
    const hl_size = size * size_multiplier
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size * 1.3, 0, 2 * Math.PI)
    ctx.fillStyle = add_alpha(color, opacity * 0.15)
    ctx.fill()
    ctx.lineWidth = 1.5 * scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, hl_size, 0, 2 * Math.PI)
    ctx.fillStyle = add_alpha(color, opacity * 0.4)
    ctx.strokeStyle = add_alpha(color, opacity * 0.8)
    ctx.fill()
    ctx.stroke()
  } else if (effect === `size`) {
    ctx.lineWidth = 2 * scale
    ctx.beginPath()
    ctx.arc(projected.x, projected.y, size * size_multiplier, 0, 2 * Math.PI)
    ctx.strokeStyle = color
    ctx.stroke()
  }
  // effect === `color` is handled by the marker fill
}

// One depth-sorted point: shadow, animated rings (only when `pulse` is given) and marker
function draw_hull_point(
  ctx: CanvasRenderingContext2D,
  { entry, projected }: HullPoint,
  opts: HullPointOpts,
  pulse?: HullPulse,
): void {
  const { scale, shadow_factor, highlight_style, is_highlighted, get_point_color } = opts
  const is_stable = entry_is_stable(entry)
  const entry_highlighted = is_highlighted(entry)
  const size = point_radius(entry) * scale
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing
  const marker = entry.marker || `circle`

  const shadow_offset = Math.abs(entry.z) * shadow_factor * scale
  ctx.fillStyle = `rgba(0, 0, 0, 0.2)`
  ctx.save()
  ctx.translate(projected.x + shadow_offset, projected.y + shadow_offset)
  ctx.fill(create_marker_path(size * 0.8, marker))
  ctx.restore()

  if (pulse) {
    if (same_entry(opts.selected_entry, entry)) {
      const ring = size * (1.8 + 0.3 * Math.sin(pulse.time * 4))
      ctx.fillStyle = add_alpha(`rgba(102, 240, 255, 1)`, pulse.opacity * 0.6)
      ctx.strokeStyle = add_alpha(`rgba(102, 240, 255, 1)`, pulse.opacity)
      ctx.lineWidth = 2 * scale
      ctx.beginPath()
      ctx.arc(projected.x, projected.y, ring, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
    if (entry_highlighted) {
      draw_highlight_effect(ctx, projected, size, scale, pulse.time, highlight_style)
    }
  }

  ctx.fillStyle =
    entry_highlighted && highlight_style.effect === `color`
      ? highlight_style.color
      : get_point_color(entry)
  ctx.strokeStyle = is_stable ? `#ffffff` : `#000000`
  ctx.lineWidth = 0.5 * scale
  const marker_path = create_marker_path(size, marker)
  ctx.save()
  ctx.translate(projected.x, projected.y)
  ctx.fill(marker_path)
  ctx.stroke(marker_path)
  ctx.restore()
}

// The depth-sorted points that hold still between animation frames
export function draw_hull_points(
  ctx: CanvasRenderingContext2D,
  sorted_points: HullPoint[],
  opts: HullPointOpts,
): void {
  for (const point of sorted_points) {
    if (is_pulsing(point.entry, opts)) continue // drawn on the pulse overlay instead
    draw_hull_point(ctx, point, opts)
  }
}

// Just the selected/highlighted points, onto the canvas stacked over the hull. Rebuilding
// faces, points and labels at pulse rate costs milliseconds a frame; this costs a handful of
// markers. Each marker is redrawn over its own ring so it still reads as sitting inside it.
export function draw_pulse_overlay(
  ctx: CanvasRenderingContext2D,
  sorted_points: HullPoint[],
  opts: HullPointOpts,
  pulse: HullPulse,
): void {
  // Device pixels under a DPR-scaled context, so this over-covers — right for a full clear
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (const point of sorted_points) {
    if (is_pulsing(point.entry, opts)) draw_hull_point(ctx, point, opts, pulse)
  }
}

// Mouse hit-testing against the already-projected points in paint order, walked back to
// front so the point drawn on top wins. `container_scale` is the same canvas_dims.scale the
// markers were drawn with, so hit radii match drawn radii.
export function find_hull_entry_at_mouse<Entry extends ConvexHullEntry>(
  canvas: HTMLCanvasElement | undefined,
  event: MouseEvent,
  painted_points: readonly { entry: Entry; projected: Projected }[],
  container_scale: number,
): Entry | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const mouse_x = event.clientX - rect.left
  const mouse_y = event.clientY - rect.top
  for (let idx = painted_points.length - 1; idx >= 0; idx--) {
    const { entry, projected } = painted_points[idx]
    const distance = Math.hypot(mouse_x - projected.x, mouse_y - projected.y)
    if (distance < point_radius(entry) * container_scale + 5) return entry
  }
  return null
}

// === Simplex outline ===

// Dashed outline of the composition simplex (edges in data coords), one stroke for all edges
export function draw_dashed_edges(
  ctx: CanvasRenderingContext2D,
  edges: [Vec3, Vec3][],
  project: ProjectPoint,
): void {
  ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
  ctx.lineWidth = CONVEX_HULL_STYLE.structure_line.line_width
  ctx.setLineDash(CONVEX_HULL_STYLE.structure_line.dash)
  ctx.beginPath()
  for (const [start, end] of edges) {
    const [from, to] = [project(...start), project(...end)]
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
  }
  ctx.stroke()
  ctx.setLineDash([]) // every later stroke sets its own strokeStyle
}

type CornerLabelOpts = {
  project: ProjectPoint
  elements: ElementSymbol[]
  text_color: string
  font_size: number
  offset: number
  width?: number // canvas CSS px; labels are kept inside when given
  height?: number
}

// Element symbols just outside each simplex corner, along the centroid-to-corner direction
export function draw_corner_labels(
  ctx: CanvasRenderingContext2D,
  corners: readonly (readonly number[])[],
  centroid: number[],
  { project, elements, text_color, font_size, offset, width, height }: CornerLabelOpts,
): void {
  ctx.save()
  ctx.fillStyle = text_color
  ctx.font = `bold ${font_size}px Arial`
  ctx.textAlign = `center`
  ctx.textBaseline = `middle`
  for (const [corner_idx, corner] of corners.entries()) {
    const direction = corner.map((coord, axis) => coord - centroid[axis])
    const length = Math.hypot(...direction) || 1
    const [x = 0, y = 0, z = 0] = corner.map(
      (coord, axis) => coord + (direction[axis] / length) * offset,
    )
    const label = elements[corner_idx]
    let { x: label_x, y: label_y } = project(x, y, z)
    // Narrow canvases (phones) put the simplex corners at the very edge, which would cut
    // the symbols in half; pull them back inside instead.
    if (width && height) {
      const half_w = ctx.measureText(label).width / 2
      label_x = clamp(label_x, half_w, width - half_w)
      label_y = clamp(label_y, font_size / 2, height - font_size / 2)
    }
    ctx.fillText(label, label_x, label_y)
  }
  ctx.restore()
}

// === Labels ===

const LABEL_FONT_SIZE = 12
const LABEL_FONT = `${LABEL_FONT_SIZE}px Arial`
const LABEL_SUBSCRIPT_FONT = `${LABEL_FONT_SIZE - 1}px Arial`

// Lowest energy first so the most relevant labels claim space before the crowd
function label_priority_energy(entry: ConvexHullEntry): number {
  for (const value of [
    entry.e_form_per_atom,
    entry.z,
    entry.energy_per_atom,
    entry.energy,
    entry.e_above_hull,
  ]) {
    if (typeof value === `number` && Number.isFinite(value)) return value
  }
  return Number.POSITIVE_INFINITY
}

export type LabelOpts = {
  project: ProjectPoint
  elements: ElementSymbol[]
  scale: number
  text_color: string
  width: number
  height: number
  show_stable_labels: boolean
  show_unstable_labels: boolean
  max_hull_dist_show_labels: number
  // Paint only these entries' labels. Placement still runs over all `entries` so the
  // painted subset lands exactly where a full pass would put it (overlay repaints).
  paint_only?: (entry: ConvexHullEntry) => boolean
}

// Compound labels that pass the label toggles, one per composition, most stable first
function hull_label_entries(
  entries: ConvexHullEntry[],
  { show_stable_labels, show_unstable_labels, max_hull_dist_show_labels }: LabelOpts,
): ConvexHullEntry[] {
  const labelled = get_composition_label_entries(
    entries.filter((entry) => {
      if (entry.is_element) return false
      return entry_is_stable(entry)
        ? show_stable_labels
        : show_unstable_labels && (entry.e_above_hull ?? 0) <= max_hull_dist_show_labels
    }),
  )
  // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- helper returns a fresh array
  return labelled.sort(
    (entry_1, entry_2) =>
      label_priority_energy(entry_1) - label_priority_energy(entry_2) ||
      (entry_1.e_above_hull ?? 0) - (entry_2.e_above_hull ?? 0),
  )
}

function measure_segments(ctx: CanvasRenderingContext2D, segments: FormulaLabelSegment[]) {
  return segments.reduce((sum, segment) => {
    ctx.font = segment.subscript ? LABEL_SUBSCRIPT_FONT : LABEL_FONT
    return sum + ctx.measureText(segment.text).width
  }, 0)
}

// Formula labels next to their points, trying 8 placements around each point and skipping
// labels that would overlap an earlier one or leave the canvas
export function draw_hull_labels(
  ctx: CanvasRenderingContext2D,
  entries: ConvexHullEntry[],
  opts: LabelOpts,
): void {
  const { project, elements, scale, text_color, width, height, paint_only } = opts
  const label_height = LABEL_FONT_SIZE + 2
  const padding = Math.max(1, 2 * scale)
  const canvas_rect: Rect = { x: 0, y: 0, width, height }
  const occupied: Rect[] = []

  ctx.save()
  ctx.fillStyle = text_color
  ctx.textAlign = `left`
  ctx.textBaseline = `top`
  for (const entry of hull_label_entries(entries, opts)) {
    const projected = project(entry.x, entry.y, entry.z)
    const segments = get_formula_label_segments(get_entry_label(entry, elements))
    const text_width = measure_segments(ctx, segments)
    const gap = point_radius(entry) * scale + 4 * scale
    const side = gap + scale + text_width / 2
    const half_height = label_height / 2
    // (center_x, top_y) candidates: below, above, right, left, then the four diagonals
    const candidates = [
      [projected.x, projected.y + gap],
      [projected.x, projected.y - gap - label_height],
      [projected.x + side, projected.y - half_height],
      [projected.x - side, projected.y - half_height],
      [projected.x + side, projected.y + gap],
      [projected.x - side, projected.y + gap],
      [projected.x + side, projected.y - gap - label_height],
      [projected.x - side, projected.y - gap - label_height],
    ]
    const placement = candidates.find(([center_x, top_y]) => {
      const rect = pad_rect(centered_rect(center_x, top_y, text_width, label_height), padding)
      if (!rect_within_rect(rect, canvas_rect)) return false
      if (occupied.some((taken) => rects_overlap(rect, taken))) return false
      occupied.push(rect)
      return true
    })
    if (!placement || (paint_only && !paint_only(entry))) continue

    let text_x = placement[0] - text_width / 2
    for (const segment of segments) {
      ctx.font = segment.subscript ? LABEL_SUBSCRIPT_FONT : LABEL_FONT
      ctx.fillText(
        segment.text,
        text_x,
        placement[1] + (segment.subscript ? LABEL_FONT_SIZE * 0.28 : 0),
      )
      text_x += ctx.measureText(segment.text).width
    }
  }
  ctx.restore()
}

// === Hull faces ===

// A drawable hull face: its vertex entries (3 for a triangle), projected screen points and
// mean formation energy. 4D tetrahedra contribute their 4 triangular faces with a shared
// `facet_idx` so they get one categorical colour.
export type HullFace = {
  vertices: ConvexHullEntry[]
  projected: Projected[]
  e_form: number
  depth: number
  facet_idx: number
}

// Drawable faces of the lower hull, back to front: each triangle facet is one face, each
// tetrahedron facet contributes the 4 triangles that drop one of its vertices
export function build_hull_faces(
  facet_entries: ConvexHullEntry[][],
  project: ProjectPoint,
): HullFace[] {
  const faces: HullFace[] = []
  const add_face = (vertices: ConvexHullEntry[], projected: Projected[], facet_idx: number) =>
    faces.push({
      vertices,
      projected,
      facet_idx,
      e_form: mean(vertices.map((vertex) => vertex.e_form_per_atom ?? 0)),
      depth: mean(projected.map((point) => point.depth)),
    })
  for (const [facet_idx, facet] of facet_entries.entries()) {
    const projected = facet.map((vertex) => project(vertex.x, vertex.y, vertex.z))
    if (facet.length === 3) add_face(facet, projected, facet_idx)
    else {
      for (const skip of facet.keys()) {
        add_face(facet.toSpliced(skip, 1), projected.toSpliced(skip, 1), facet_idx)
      }
    }
  }
  return faces.toSorted((left, right) => left.depth - right.depth)
}

type FaceColorOpts = {
  mode: HullFaceColorMode
  uniform_color: string
  color_scale: D3InterpolateName
  element_colors: Record<string, string>
  elements: ElementSymbol[]
}

// Element with the largest mean fraction over the face's vertices
function dominant_element(
  vertices: ConvexHullEntry[],
  elements: ElementSymbol[],
): ElementSymbol {
  const totals = elements.map(() => 0)
  for (const { composition } of vertices) {
    const atoms = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
    for (const [idx, el] of elements.entries()) totals[idx] += (composition[el] ?? 0) / atoms
  }
  return elements[totals.indexOf(Math.max(...totals))]
}

// Colour resolver for one frame's faces per hull_face_color_mode
export function face_color_resolver(
  faces: HullFace[],
  opts: FaceColorOpts,
): (face: HullFace) => string {
  const { mode, uniform_color, color_scale, element_colors, elements } = opts
  if (mode === `formation_energy`) {
    const min_e_form = array_min(faces.map((face) => face.e_form))
    const scale = get_energy_color_scale(
      `energy`,
      color_scale,
      faces.map((face) => ({ e_above_hull: face.e_form - min_e_form })), // 0-based
    )
    return (face) => scale?.(face.e_form - min_e_form) ?? uniform_color
  }
  if (mode === `dominant_element`) {
    return (face) => element_colors[dominant_element(face.vertices, elements)] ?? `#888888`
  }
  if (mode === `facet_index`) return (face) => plot_color(face.facet_idx)
  return () => uniform_color
}

// Fill + outline one projected polygon
export function draw_face(
  ctx: CanvasRenderingContext2D,
  projected: Projected[],
  fill: string | CanvasGradient,
  stroke: string,
): void {
  ctx.beginPath()
  ctx.moveTo(projected[0].x, projected[0].y)
  for (const point of projected.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1
  ctx.stroke()
}

export type HullFaceOpts = FaceColorOpts & {
  opacity: number
  e_form_min: number // most negative formation energy, the fully opaque end of uniform mode
  gradient: boolean // uniform mode: per-vertex opacity gradient, else one mean opacity per face
  stroke_alpha: (fill_alpha: number) => number
}

// Lower-hull faces, back to front. Uniform mode fades faces with their formation energy;
// the other colour modes use the fixed opacity.
export function draw_hull_faces(
  ctx: CanvasRenderingContext2D,
  faces: HullFace[],
  opts: HullFaceOpts,
): void {
  const { mode, opacity, e_form_min, gradient, stroke_alpha } = opts
  const face_color = face_color_resolver(faces, opts)
  // Fraction of the funnel depth, mapped onto the face opacity
  const norm_alpha = (e_form: number): number =>
    clamp01(e_form / Math.min(e_form_min, -1e-6)) * opacity
  for (const face of faces) {
    const color = face_color(face)
    if (mode !== `uniform` || !gradient) {
      const alpha = mode === `uniform` ? norm_alpha(face.e_form) : opacity
      draw_face(
        ctx,
        face.projected,
        add_alpha(color, alpha),
        add_alpha(color, stroke_alpha(alpha)),
      )
      continue
    }
    // Screen-space linear gradient solving a*x + b*y + c = alpha at the three projected vertices
    const [p1, p2, p3] = face.projected
    const [a1, a2, a3] = face.vertices.map((vertex) => norm_alpha(vertex.e_form_per_atom ?? 0))
    const det = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)
    const coef_a = (a1 * (p2.y - p3.y) + a2 * (p3.y - p1.y) + a3 * (p1.y - p2.y)) / det
    const coef_b = (a1 * (p3.x - p2.x) + a2 * (p1.x - p3.x) + a3 * (p2.x - p1.x)) / det
    const mag = Math.hypot(coef_a, coef_b)
    const [alpha_min, alpha_max] = [Math.min(a1, a2, a3), Math.max(a1, a2, a3)]
    const alpha_mean = (a1 + a2 + a3) / 3
    let fill: string | CanvasGradient = add_alpha(color, alpha_mean)
    if (Math.abs(det) > 1e-9 && mag > 1e-9) {
      const [dir_x, dir_y] = [coef_a / mag, coef_b / mag]
      const center_x = (p1.x + p2.x + p3.x) / 3
      const center_y = (p1.y + p2.y + p3.y) / 3
      const [s_min, s_max] = [(alpha_min - alpha_mean) / mag, (alpha_max - alpha_mean) / mag]
      const grad = ctx.createLinearGradient(
        center_x + dir_x * s_min,
        center_y + dir_y * s_min,
        center_x + dir_x * s_max,
        center_y + dir_y * s_max,
      )
      grad.addColorStop(0, add_alpha(color, alpha_min))
      grad.addColorStop(1, add_alpha(color, alpha_max))
      fill = grad
    }
    draw_face(ctx, face.projected, fill, add_alpha(color, stroke_alpha(alpha_max)))
  }
}

// === Dimension strategies ===

// Zoom + pan are shared; the rotation angles are the strategy's
export type HullCamera = { zoom: number; center_x: number; center_y: number }
type TernaryCamera = HullCamera & { elevation: number; azimuth: number } // degrees
type QuaternaryCamera = HullCamera & { rotation_x: number; rotation_y: number } // radians

// Formation energy span of the plotted entries: the ternary view scales E_form into its depth
// axis with `z_scale` about `center`; uniform-mode faces fade towards `min` in both
export type EnergyRange = { min: number; max: number; center: number; z_scale: number }

export function energy_range_of(entries: ConvexHullEntry[]): EnergyRange {
  let [min, max] = [0, 0]
  for (const entry of entries) {
    const e_form = entry.e_form_per_atom ?? 0
    min = Math.min(min, e_form)
    max = Math.max(max, e_form)
  }
  return { min, max, center: (min + max) / 2, z_scale: 0.75 / Math.max(max - min, 0.001) }
}

// Per-frame view the strategies draw against
type HullView = {
  project: ProjectPoint
  energy_range: EnergyRange
  text_color: string
  font_size: number
  scale: number // canvas container scale factor
}

// What differs between the ternary (triangle prism with an energy axis) and quaternary
// (tetrahedron) hull canvases; ConvexHullCanvas.svelte is everything they share. Method
// syntax on purpose: its bivariant parameters let a strategy over a concrete camera type sit
// in a HullCanvasStrategy<HullCamera> record without the component knowing the angles.
export interface HullCanvasStrategy<Camera extends HullCamera = HullCamera> {
  dim: 3 | 4
  kind: `ternary` | `quaternary` // DEFAULTS.convex_hull section
  corners: readonly (readonly number[])[]
  camera_default: Camera // initial view, restored by reset_camera
  wheel_clamp: [min: number, max: number] // zoom clamp range
  shadow_factor: number // scales the depth-based point shadow offset
  corner_labels: { font_size: number; offset: number }
  // Uniform-mode faces: a per-vertex opacity gradient down the 3D funnel, or one mean opacity
  // per face for the many thin 4D faces
  face_gradient: boolean
  face_stroke_alpha(fill_alpha: number): number
  // Plain drag rotates the view (Cmd/Ctrl-drag pans)
  rotate(camera: Camera, dx: number, dy: number): void
  // Data coords → view coords [x, y, depth] about the simplex centroid, before to_screen
  rotate_point(camera: Camera, point: Vec3, energy_range: EnergyRange): Vec3
  // Dashed simplex outline, edges in data coords
  outline_edges(energy_range: EnergyRange): [Vec3, Vec3][]
  // Axes drawn over the faces (none in 4D)
  draw_axes?(ctx: CanvasRenderingContext2D, camera: Camera, view: HullView): void
  // Keyboard actions beyond the shared ones
  actions?(camera: Camera, view_scale: number): Record<string, () => void>
  // Orientation gizmo ↔ camera angles (3D only)
  gizmo?: {
    to_three(camera: Camera): { position: Vec3; up: Vec3 }
    from_three(camera: Camera, position: Vec3, view_scale: number): void
  }
}

// Formation energy axis on whichever triangle vertex currently projects leftmost (changes
// with rotation): ticks plus a rotated "E_form (eV/atom)" label with "form" as subscript
function draw_energy_axis(
  ctx: CanvasRenderingContext2D,
  { project, energy_range, text_color, font_size, scale }: HullView,
): void {
  const { min: e_min, max: e_max, center: e_mid } = energy_range
  if (Math.abs(e_max - e_min) < 1e-6) return
  const projected_vertices = TRIANGLE_VERTICES.map(([vx, vy]) => project(vx, vy, e_mid))
  const leftmost_idx = projected_vertices.reduce(
    (min_idx, proj, idx) => (proj.x < projected_vertices[min_idx].x ? idx : min_idx),
    0,
  )
  const [axis_x, axis_y] = TRIANGLE_VERTICES[leftmost_idx]
  const tick_len = 6 * scale

  ctx.save()
  ctx.fillStyle = text_color
  ctx.textAlign = `right`
  ctx.textBaseline = `middle`
  ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
  ctx.font = `${font_size}px Arial`
  for (const tick of ticks(e_min, e_max, 5)) {
    const { x, y } = project(axis_x, axis_y, tick)
    ctx.beginPath()
    ctx.moveTo(x - tick_len, y)
    ctx.lineTo(x, y)
    ctx.stroke()
    ctx.fillText(format_num(tick, `.2~`), x - tick_len - 4, y)
  }

  const { x: label_x, y: label_y } = project(axis_x, axis_y, e_mid)
  const sub_font_size = Math.round(font_size * 0.75)
  ctx.translate(label_x - 50 * scale, label_y)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = `left`
  // Measure widths in each font, then draw — ordered to minimize font switches
  ctx.font = `bold ${font_size}px Arial`
  const e_width = ctx.measureText(`E`).width
  const suffix_width = ctx.measureText(` (eV/atom)`).width
  ctx.font = `${sub_font_size}px Arial`
  const form_width = ctx.measureText(`form`).width
  const offset = -(e_width + form_width + suffix_width) / 2
  ctx.fillText(`form`, offset + e_width, font_size * 0.3)
  ctx.font = `bold ${font_size}px Arial`
  ctx.fillText(`E`, offset, 0)
  ctx.fillText(` (eV/atom)`, offset + e_width + form_width, 0)
  ctx.restore()
}

const GIZMO_CAM_DIST = 5
const MIN_ELEV_FOR_ENERGY_AXIS = 5 // degrees — below this the axis ticks collapse to a point
const TRIANGLE_CENTROID = simplex_centroid(TRIANGLE_VERTICES)
const TETRAHEDRON_CENTROID = simplex_centroid(TETRAHEDRON_VERTICES)

// Center the camera on the triangle's visual center for its elevation. The centroid (rotation
// center) sits at 1/3 height while the bbox center is at 1/2 height — a difference of
// sqrt(3)/12 in data units, scaled by cos(elevation) so the offset only applies in
// near-top-down views.
function center_ternary_camera(camera: TernaryCamera, view_scale: number): void {
  camera.center_x = 0
  camera.center_y = (Math.sqrt(3) / 12) * view_scale * Math.cos(to_radians(camera.elevation))
}

const ternary_defaults = DEFAULTS.convex_hull.ternary
const TERNARY_HULL_STRATEGY: HullCanvasStrategy<TernaryCamera> = {
  dim: 3,
  kind: `ternary`,
  corners: TRIANGLE_VERTICES,
  camera_default: {
    elevation: ternary_defaults.camera_elevation,
    azimuth: ternary_defaults.camera_azimuth,
    zoom: ternary_defaults.camera_zoom,
    center_x: 0,
    center_y: -50, // Shift up to better show the formation energy funnel
  },
  wheel_clamp: [0.5, 10],
  shadow_factor: 0.1,
  corner_labels: { font_size: 16, offset: 0.05 },
  face_gradient: true,
  face_stroke_alpha: (fill_alpha) => Math.min(0.6, fill_alpha * 3),
  rotate(camera, dx, dy) {
    camera.azimuth += dx * 0.3 // drag right rotates clockwise around z
    camera.elevation -= dy * 0.3 // drag down tilts the view down
  },
  // Rz(azimuth) then Rx(-elevation) about the centroid, energy scaled into the view
  rotate_point(camera, [x, y, z], { center: e_ctr, z_scale }) {
    const [elev, azim] = [to_radians(camera.elevation), to_radians(camera.azimuth)]
    const [cos_az, sin_az] = [Math.cos(azim), Math.sin(azim)]
    const [cos_el, sin_el] = [Math.cos(-elev), Math.sin(-elev)]
    const [dx, dy, dz] = [
      x - TRIANGLE_CENTROID[0],
      y - TRIANGLE_CENTROID[1],
      (z - e_ctr) * z_scale,
    ]
    const [x1, y1] = [dx * cos_az - dy * sin_az, dx * sin_az + dy * cos_az]
    return [x1, y1 * cos_el - dz * sin_el, y1 * sin_el + dz * cos_el]
  },
  // Dashed triangle prism: base triangle at E_form = 0, bottom triangle at the most negative
  // formation energy, and vertical edges connecting corresponding corners
  outline_edges({ min: e_form_min }) {
    const edges: [Vec3, Vec3][] = []
    for (const [idx, [vx, vy]] of TRIANGLE_VERTICES.entries()) {
      const [nx, ny] = TRIANGLE_VERTICES[(idx + 1) % 3]
      for (const z_plane of [0, e_form_min]) {
        edges.push([
          [vx, vy, z_plane],
          [nx, ny, z_plane],
        ])
      }
      edges.push([
        [vx, vy, 0],
        [vx, vy, e_form_min],
      ])
    }
    return edges
  },
  draw_axes(ctx, camera, view) {
    // Hide the energy axis in near-top-down views where its ticks collapse to a point
    if (Math.abs(camera.elevation) < MIN_ELEV_FOR_ENERGY_AXIS) return
    draw_energy_axis(ctx, view)
  },
  actions: (camera, view_scale) => ({
    t: () => {
      camera.elevation = 0
      camera.azimuth = 0
      center_ternary_camera(camera, view_scale)
    },
  }),
  gizmo: {
    // elevation/azimuth (degrees) → Three.js camera position + up vector
    to_three({ elevation, azimuth }) {
      const [elev, azim] = [to_radians(elevation), to_radians(azimuth)]
      const [sin_el, cos_el, sin_az, cos_az] = [
        Math.sin(elev),
        Math.cos(elev),
        Math.sin(azim),
        Math.cos(azim),
      ]
      return {
        position: [
          -sin_az * sin_el * GIZMO_CAM_DIST,
          -cos_az * sin_el * GIZMO_CAM_DIST,
          cos_el * GIZMO_CAM_DIST,
        ],
        up: [sin_az * cos_el, cos_az * cos_el, sin_el],
      }
    },
    from_three(camera, [cam_x, cam_y, cam_z], view_scale) {
      const dist = Math.hypot(cam_x, cam_y, cam_z)
      if (dist < 1e-6) return
      const elev_rad = Math.acos(clamp(cam_z / dist, -1, 1))
      const sin_elev = Math.sin(elev_rad)
      camera.azimuth =
        Math.abs(sin_elev) > 1e-6
          ? (Math.atan2(-cam_x / (dist * sin_elev), -cam_y / (dist * sin_elev)) * 180) /
            Math.PI
          : 0
      camera.elevation = (elev_rad * 180) / Math.PI
      center_ternary_camera(camera, view_scale)
    },
  },
}

const quaternary_defaults = DEFAULTS.convex_hull.quaternary
const QUATERNARY_HULL_STRATEGY: HullCanvasStrategy<QuaternaryCamera> = {
  dim: 4,
  kind: `quaternary`,
  corners: TETRAHEDRON_VERTICES,
  camera_default: {
    rotation_x: quaternary_defaults.camera_rotation_x,
    rotation_y: quaternary_defaults.camera_rotation_y,
    zoom: quaternary_defaults.camera_zoom,
    center_x: 0,
    center_y: 20, // Slight offset to avoid legend overlap
  },
  wheel_clamp: [1.0, 15],
  shadow_factor: 2,
  corner_labels: { font_size: 18, offset: 0.06 },
  face_gradient: false,
  face_stroke_alpha: (fill_alpha) => Math.min(0.4, fill_alpha * 4),
  rotate(camera, dx, dy) {
    camera.rotation_y += dx * 0.005
    camera.rotation_x = clamp(camera.rotation_x - dy * 0.005, -Math.PI / 3, Math.PI / 3)
  },
  // Ry(rotation_y) then Rx(rotation_x) about the centroid (Materials Project camera)
  rotate_point(camera, [x, y, z]) {
    const [cx, cy, cz] = [
      x - TETRAHEDRON_CENTROID[0],
      y - TETRAHEDRON_CENTROID[1],
      z - TETRAHEDRON_CENTROID[2],
    ]
    const [cos_x, sin_x] = [Math.cos(camera.rotation_x), Math.sin(camera.rotation_x)]
    const [cos_y, sin_y] = [Math.cos(camera.rotation_y), Math.sin(camera.rotation_y)]
    const [x1, z1] = [cx * cos_y - cz * sin_y, cx * sin_y + cz * cos_y]
    return [x1, cy * cos_x - z1 * sin_x, cy * sin_x + z1 * cos_x]
  },
  // Every pair of tetrahedron corners
  outline_edges: () =>
    TETRAHEDRON_VERTICES.flatMap((start, start_idx) =>
      TETRAHEDRON_VERTICES.slice(start_idx + 1).map((end): [Vec3, Vec3] => [
        [...start],
        [...end],
      ]),
    ),
}

export const HULL_CANVAS_STRATEGIES: Record<3 | 4, HullCanvasStrategy> = {
  3: TERNARY_HULL_STRATEGY,
  4: QUATERNARY_HULL_STRATEGY,
}
