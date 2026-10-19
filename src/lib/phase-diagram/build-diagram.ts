// Build PhaseDiagramData from compact DiagramInput JSON format
//
// The compact format uses curve references in region bounds to avoid duplicating points.
// Curve reference syntax:
//   - "curve_name" - use all points from the curve
//   - "~curve_name" - use reversed curve points
//   - "curve_name[1:]" - Python-style slice (skip first point)
//   - "curve_name[:-1]" - slice (skip last point)
//   - "~curve_name[1:-1]" - reverse then slice

import type { BoundElement, DiagramInput, DiagramPoint } from './diagram-input'
import type { BoundaryType, PhaseBoundary, PhaseDiagramData, PhaseRegion } from './types'

interface CurveRef {
  name: string
  reverse: boolean
  start?: number // Array.slice bounds: Python-style, negative counts from the end
  end?: number
}

// Parse curve reference syntax: 'curve_name', '~curve_name', 'curve_name[1:]', etc.
export function parse_curve_ref(ref: string): CurveRef {
  const reverse = ref.startsWith(`~`)
  const name = reverse ? ref.slice(1) : ref
  const slice = /^(?<base>.+)\[(?<start>-?\d*):(?<end>-?\d*)\]$/.exec(name)?.groups
  const index = (digits?: string) => (digits ? Number(digits) : undefined)
  return slice
    ? { name: slice.base, reverse, start: index(slice.start), end: index(slice.end) }
    : { name, reverse }
}

// Expand bounds to vertex list
const expand_bounds = (
  bounds: BoundElement[],
  curves: Record<string, DiagramPoint[]>,
): DiagramPoint[] =>
  bounds.flatMap((bound) => {
    if (Array.isArray(bound)) return [bound]
    const ref = parse_curve_ref(bound)
    const points = curves[ref.name]
    if (!points) {
      throw new Error(
        `Unknown curve "${ref.name}" in region bounds; known curves: ${Object.keys(curves).join(`, `) || `none`}`,
      )
    }
    // Reverse before slicing, to match Python's `reversed(curve)[1:]` pattern
    return (ref.reverse ? points.toReversed() : points).slice(ref.start, ref.end)
  })

// Remove consecutive duplicate vertices and a closing vertex that repeats the first
function dedupe_consecutive_vertices(vertices: DiagramPoint[]): DiagramPoint[] {
  const result = vertices.filter(
    (vertex, idx) =>
      idx === 0 || vertex[0] !== vertices[idx - 1][0] || vertex[1] !== vertices[idx - 1][1],
  )
  const [first, last] = [result[0], result.at(-1)]
  if (result.length > 1 && first[0] === last?.[0] && first[1] === last[1]) result.pop()
  return result
}

// Default style of each boundary type a curve name can start with (liquidus_left → liquidus)
const NAMED_BOUNDARY_STYLES = {
  liquidus: { color: `#1565c0`, width: 2.5 },
  solidus: { color: `#2e7d32`, width: 2, dash: `4,2` },
  solvus: { color: `#7b1fa2`, width: 1.5, dash: `2,2` },
  eutectic: { color: `#d32f2f`, width: 2 },
  peritectic: { color: `#d32f2f`, width: 2 },
} as const satisfies Partial<Record<BoundaryType, PhaseBoundary[`style`]>>
const NAMED_BOUNDARY_TYPES = Object.keys(
  NAMED_BOUNDARY_STYLES,
) as (keyof typeof NAMED_BOUNDARY_STYLES)[]

const curve_boundary = (id: string, points: DiagramPoint[]): PhaseBoundary => {
  const type = NAMED_BOUNDARY_TYPES.find((name) => id.toLowerCase().startsWith(name))
  return type
    ? { id, type, points, style: { ...NAMED_BOUNDARY_STYLES[type] } }
    : { id, type: `custom`, points, style: { color: `#333`, width: 1.5 } }
}

// Region, boundary and special-point ids key the rendered SVG elements (and gradient ids), so
// each must be unique within its kind. Returns an error message for the first repeat, else null.
export function find_duplicate_id(data: PhaseDiagramData): string | null {
  const { regions, boundaries, special_points = [] } = data
  const kinds = { region: regions, boundary: boundaries, special_point: special_points }
  for (const [kind, items] of Object.entries(kinds)) {
    const ids = items.map(({ id }) => id)
    const repeat = ids.find((id, idx) => ids.indexOf(id) !== idx)
    if (repeat !== undefined) return `Duplicate ${kind} id "${repeat}"`
  }
  return null
}

// Build full PhaseDiagramData from compact DiagramInput JSON format
// Expands curve references in region bounds to full vertex lists
// and applies default styling based on boundary type names
export function build_diagram(input: DiagramInput): PhaseDiagramData {
  const { meta, curves, regions, special_points } = input

  const built_regions: PhaseRegion[] = regions.map((region) => {
    const vertices = dedupe_consecutive_vertices(expand_bounds(region.bounds, curves))
    return {
      id: region.id,
      name: region.name,
      vertices,
      ...(region.color && { color: region.color }),
      ...(region.label_position && { label_position: region.label_position }),
    }
  })

  const boundaries = Object.entries(curves).map(([id, points]) => curve_boundary(id, points))

  const data: PhaseDiagramData = {
    components: meta.components,
    temperature_range: meta.temp_range,
    temperature_unit: meta.temp_unit,
    composition_unit: meta.comp_unit,
    title: meta.title,
    regions: built_regions,
    boundaries,
    special_points,
    ...(meta.pseudo_binary && { pseudo_binary: meta.pseudo_binary }),
    ...(meta.x_axis_label && { x_axis_label: meta.x_axis_label }),
    ...(meta.y_axis_label && { y_axis_label: meta.y_axis_label }),
  }
  const duplicate = find_duplicate_id(data)
  if (duplicate) throw new Error(duplicate)
  return data
}
