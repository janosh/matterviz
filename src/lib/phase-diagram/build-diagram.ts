// Build PhaseDiagramData from compact DiagramInput JSON format
//
// The compact format uses curve references in region bounds to avoid duplicating points.
// Curve reference syntax:
//   - "curve_name" - use all points from the curve
//   - "~curve_name" - use reversed curve points
//   - "curve_name[1:]" - Python-style slice (skip first point)
//   - "curve_name[:-1]" - slice (skip last point)
//   - "~curve_name[1:-1]" - reverse then slice

import { resolve_diagram_color } from './colors'
import type { BoundElement, DiagramInput, DiagramPoint } from './diagram-input'
import type { BoundaryType, PhaseBoundary, PhaseDiagramData, PhaseRegion } from './types'

// Parse curve reference syntax: 'curve_name', '~curve_name', 'curve_name[1:]', etc.
export interface CurveRef {
  name: string
  reverse: boolean
  start: number | null // null means from beginning
  end: number | null // null means to end
}

export function parse_curve_ref(ref: string): CurveRef {
  let name = ref
  let reverse = false
  let start: number | null = null
  let end: number | null = null

  // Check for reverse prefix
  if (name.startsWith(`~`)) {
    reverse = true
    name = name.slice(1)
  }

  // Check for slice suffix [start:end]
  const slice_match = name.match(/^(.+)\[(-?\d*):(-?\d*)\]$/)
  if (slice_match) {
    name = slice_match[1]
    start = slice_match[2] ? parseInt(slice_match[2]) : null
    end = slice_match[3] ? parseInt(slice_match[3]) : null
  }

  return { name, reverse, start, end }
}

// Apply slicing to array (Python-style negative indices supported)
export function apply_slice<T>(arr: T[], start: number | null, end: number | null): T[] {
  const len = arr.length
  let s = start ?? 0
  let e = end ?? len

  // Handle negative indices
  if (s < 0) s = Math.max(0, len + s)
  if (e < 0) e = Math.max(0, len + e)

  return arr.slice(s, e)
}

// Expand bounds to vertex list
function expand_bounds(
  bounds: BoundElement[],
  curves: Record<string, DiagramPoint[]>,
): DiagramPoint[] {
  const vertices: DiagramPoint[] = []

  for (const bound of bounds) {
    if (Array.isArray(bound)) {
      // Inline point
      vertices.push(bound as DiagramPoint)
    } else {
      // Curve reference
      const ref = parse_curve_ref(bound)
      let points = curves[ref.name]

      if (!points) {
        console.warn(`Unknown curve: ${ref.name}`)
        continue
      }

      // Apply reverse first (to match Python's `reversed(curve)[1:]` pattern)
      if (ref.reverse) {
        points = [...points].reverse()
      }

      // Then apply slice
      points = apply_slice(points, ref.start, ref.end)

      vertices.push(...points)
    }
  }

  return vertices
}

// Remove consecutive duplicate vertices
function dedupe_consecutive_vertices(vertices: DiagramPoint[]): DiagramPoint[] {
  if (vertices.length <= 1) return vertices

  const result: DiagramPoint[] = [vertices[0]]
  for (let idx = 1; idx < vertices.length; idx++) {
    const prev = result[result.length - 1]
    const curr = vertices[idx]
    if (curr[0] !== prev[0] || curr[1] !== prev[1]) {
      result.push(curr)
    }
  }

  // Remove redundant closing vertex if polygon is explicitly closed
  if (result.length > 1) {
    const first = result[0]
    const last = result[result.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) {
      result.pop()
    }
  }

  return result
}

// Infer boundary type from curve name
function infer_boundary_type(curve_name: string): BoundaryType {
  const lower = curve_name.toLowerCase()
  if (lower.startsWith(`liquidus`)) return `liquidus`
  if (lower.startsWith(`solidus`)) return `solidus`
  if (lower.startsWith(`solvus`)) return `solvus`
  if (lower.startsWith(`eutectic`)) return `eutectic`
  if (lower.startsWith(`peritectic`)) return `peritectic`
  return `custom`
}

// Get default boundary style based on type
function get_boundary_style(btype: BoundaryType): PhaseBoundary[`style`] {
  switch (btype) {
    case `liquidus`:
      return { color: `#1565c0`, width: 2.5 }
    case `solidus`:
      return { color: `#2e7d32`, width: 2, dash: `4,2` }
    case `solvus`:
      return { color: `#7b1fa2`, width: 1.5, dash: `2,2` }
    case `eutectic`:
    case `peritectic`:
      return { color: `#d32f2f`, width: 2 }
    default:
      return { color: `#333`, width: 1.5 }
  }
}

// Build full PhaseDiagramData from compact DiagramInput JSON format
// Expands curve references in region bounds to full vertex lists
// and applies default styling based on boundary type names
export function build_diagram(input: DiagramInput): PhaseDiagramData {
  const { meta, curves, regions, special_points } = input

  // Build regions by expanding bounds to vertices
  const built_regions: PhaseRegion[] = regions.map((region) => {
    const vertices = dedupe_consecutive_vertices(expand_bounds(region.bounds, curves))
    return {
      id: region.id,
      name: region.name,
      vertices,
      color: resolve_diagram_color(region.color),
      ...(region.label_position && { label_position: region.label_position }),
    }
  })

  // Build boundaries from all curves
  const boundaries: PhaseBoundary[] = Object.entries(curves).map(([name, points]) => {
    const btype = infer_boundary_type(name)
    return {
      id: name,
      type: btype,
      points,
      style: get_boundary_style(btype),
    }
  })

  // Build the full diagram data (spread optional fields conditionally)
  return {
    components: meta.components,
    temperature_range: meta.temp_range,
    temperature_unit: meta.temp_unit,
    composition_unit: meta.comp_unit,
    title: meta.title,
    regions: built_regions,
    boundaries,
    special_points: special_points?.map((sp) => ({
      id: sp.id,
      type: sp.type,
      position: sp.position,
      label: sp.label,
    })),
    ...(meta.pseudo_binary && { pseudo_binary: meta.pseudo_binary }),
    ...(meta.x_axis_label && { x_axis_label: meta.x_axis_label }),
    ...(meta.y_axis_label && { y_axis_label: meta.y_axis_label }),
  }
}
