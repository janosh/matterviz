// Canvas drawing shared by ConvexHull3D/4D: markers, points, pulse overlay, labels, faces.
import { add_alpha, PLOT_COLORS } from '$lib/colors'
import type { D3InterpolateName } from '$lib/colors'
import { get_formula_label_segments } from '$lib/composition/format'
import type { FormulaLabelSegment } from '$lib/composition/format'
import type { ElementSymbol } from '$lib/element'
import { symbol_map } from '$lib/labels'
import { array_min } from '$lib/math'
import {
  centered_rect,
  pad_rect,
  rect_within_rect,
  rects_overlap,
} from '$lib/plot/core/layout'
import type { Rect } from '$lib/plot/core/layout'
import { symbol } from 'd3-shape'
import {
  entry_is_stable,
  get_composition_label_entries,
  get_energy_color_scale,
  get_entry_label,
  same_entry,
} from './helpers'
import type { ConvexHullEntry, HighlightStyle, HullFaceColorMode, MarkerSymbol } from './types'

export type Projected = { x: number; y: number; depth: number }
export type ProjectPoint = (x: number, y: number, z: number) => Projected

// Marker radius in CSS px before the container scale (stable points are larger)
export const point_radius = (entry: ConvexHullEntry): number =>
  // `||` (not ??) on purpose: size=0 falls back to the default
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing
  entry.size || (entry_is_stable(entry) ? 6 : 4)

// === Markers ===

// SVG path data for a marker symbol of given radius, or null for unknown marker names.
// Uses d3-shape for consistent rendering with ScatterPlot.
export function marker_path_data(radius: number, marker: MarkerSymbol): string | null {
  // Capitalize first letter to get D3 symbol name (e.g. 'circle' -> 'Circle')
  const d3_name = marker.charAt(0).toUpperCase() + marker.slice(1)
  const symbol_type = symbol_map[d3_name as keyof typeof symbol_map]
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

// Mouse hit-testing against projected points (first hit wins)
export function find_hull_entry_at_mouse(
  canvas: HTMLCanvasElement | undefined,
  event: MouseEvent,
  plot_entries: ConvexHullEntry[],
  project_point: ProjectPoint,
): ConvexHullEntry | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const mouse_x = event.clientX - rect.left
  const mouse_y = event.clientY - rect.top
  const container_scale = Math.min(canvas.clientWidth || 600, canvas.clientHeight || 600) / 600
  for (const entry of plot_entries) {
    const projected = project_point(entry.x, entry.y, entry.z)
    const distance = Math.hypot(mouse_x - projected.x, mouse_y - projected.y)
    if (distance < point_radius(entry) * container_scale + 5) return entry
  }
  return null
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
}

// Compound labels that pass the label toggles, one per composition, most stable first
export function hull_label_entries(
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
  const { project, elements, scale, text_color, width, height } = opts
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
    if (!placement) continue

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

export type FaceColorOpts = {
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
  if (mode === `facet_index`) return (face) => PLOT_COLORS[face.facet_idx % PLOT_COLORS.length]
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
