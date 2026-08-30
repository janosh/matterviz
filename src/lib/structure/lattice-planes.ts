// (hkl) lattice planes drawn inside the unit cell, e.g. to show where a surface slab is cut.
// Miller indices refer to the basis of the drawn cell; in fractional coordinates the plane at
// `offset` is h·x + k·y + l·z = offset, so integer offsets are the lattice planes of the
// family and neighbouring integers sit one interplanar spacing d_hkl apart.
import type { Matrix3x3, Vec3 } from '$lib/math'
import { clip_frac_plane_to_cell } from '$lib/symmetry/symmetry-elements'

export interface LatticePlane {
  hkl: Vec3
  // Plane positions in units of d_hkl. Default: every lattice plane that cuts the cell.
  offsets?: number[]
  color?: string
  opacity?: number
}

// Integer offsets whose plane crosses the unit cell: the extreme values of h·x + k·y + l·z
// over the cell are reached at corners, i.e. the sums of the negative and positive indices.
export function lattice_plane_offsets(hkl: Vec3): number[] {
  const lo = hkl.reduce((sum, val) => sum + Math.min(val, 0), 0)
  const hi = hkl.reduce((sum, val) => sum + Math.max(val, 0), 0)
  return Array.from({ length: hi - lo + 1 }, (_, idx) => lo + idx)
}

// Cartesian polygons of the planes in `plane` clipped to the cell; planes that only touch a
// corner or an edge (fewer than 3 vertices) are dropped.
export function lattice_plane_polygons(
  plane: LatticePlane,
  lattice: Matrix3x3,
): { offset: number; polygon: Vec3[] }[] {
  const { hkl } = plane
  if (hkl.length !== 3 || hkl.every((val) => val === 0) || !hkl.every(Number.isInteger)) {
    throw new Error(`Invalid Miller indices ${JSON.stringify(hkl)}`)
  }
  return (plane.offsets ?? lattice_plane_offsets(hkl))
    .map((offset) => ({ offset, polygon: clip_frac_plane_to_cell(hkl, offset, lattice) }))
    .filter(({ polygon }) => polygon.length >= 3)
}
