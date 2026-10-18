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
  start: number | null // null means from beginning
  end: number | null // null means to end
}

// Parse curve reference syntax: 'curve_name', '~curve_name', 'curve_name[1:]', etc.
export function parse_curve_ref(ref: string): CurveRef {
  const reverse = ref.startsWith(`~`)
  const name = reverse ? ref.slice(1) : ref
  const slice = /^(?<base>.+)\[(?<start>-?\d*):(?<end>-?\d*)\]$/.exec(name)?.groups
  const index = (digits: string | undefined) => (digits ? Number(digits) : null)
  return slice
    ? { name: slice.base, reverse, start: index(slice.start), end: index(slice.end) }
    : { name, reverse, start: null, end: null }
}

// Python-style slice (negative indices count from the end), which Array.slice already does
export const apply_slice = <T>(arr: T[], start: number | null, end: number | null): T[] =>
  arr.slice(start ?? 0, end ?? arr.length)

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
    return apply_slice(ref.reverse ? points.toReversed() : points, ref.start, ref.end)
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

// Boundary type from the curve name prefix (liquidus_left → liquidus)
const NAMED_BOUNDARY_TYPES = [
  `liquidus`,
  `solidus`,
  `solvus`,
  `eutectic`,
  `peritectic`,
] as const
const infer_boundary_type = (curve_name: string): BoundaryType =>
  NAMED_BOUNDARY_TYPES.find((type) => curve_name.toLowerCase().startsWith(type)) ?? `custom`

function get_boundary_style(btype: BoundaryType): PhaseBoundary[`style`] {
  if (btype === `liquidus`) return { color: `#1565c0`, width: 2.5 }
  if (btype === `solidus`) return { color: `#2e7d32`, width: 2, dash: `4,2` }
  if (btype === `solvus`) return { color: `#7b1fa2`, width: 1.5, dash: `2,2` }
  if (btype === `eutectic` || btype === `peritectic`) {
    return { color: `#d32f2f`, width: 2 }
  }
  return { color: `#333`, width: 1.5 }
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

  const boundaries: PhaseBoundary[] = Object.entries(curves).map(([name, points]) => {
    const btype = infer_boundary_type(name)
    const style = get_boundary_style(btype)
    return { id: name, type: btype, points, style }
  })

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
