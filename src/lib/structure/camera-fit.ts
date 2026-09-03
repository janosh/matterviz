// Content-AABB camera framing: look-at center + padded bounding-sphere extent for the
// shorter viewport edge. Lattice midpoint alone mis-frames asymmetric image atoms.

import type { ElementSymbol } from '$lib/element'
import { element_by_symbol } from '$lib/element'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Site } from '$lib/structure'

// Occupy at most 92% of the shorter viewport edge.
export const DEFAULT_FIT_PADDING = 1 / 0.92
// Paired with DEFAULTS.structure.initial_zoom (50): default zoom = min(w,h) / fit_extent.
export const FIT_ZOOM_REF_PX = 50
// Unnormalized — keeps legacy offset [d, 0.3d, 0.8d] (do not unit-normalize).
const DEFAULT_CAMERA_VIEW: Vec3 = [1, 0.3, 0.8]

export type StructureFitOpts = {
  atom_radius_scale?: number // 0 when atoms hidden
  same_size_atoms?: boolean
  element_radius_overrides?: Partial<Record<ElementSymbol, number>>
  site_radius_overrides?: ReadonlyMap<number, number>
}

type StructureFitFrame = { center: Vec3; extent: number }

const empty_frame = (): StructureFitFrame => ({ center: [0, 0, 0], extent: 10 })

export const camera_needs_fit = (
  position: Vec3,
  previous_view: string | undefined,
  camera_view: string,
): boolean =>
  position.every((coordinate) => coordinate === 0) ||
  (previous_view !== undefined && previous_view !== camera_view)

const element_radius = (
  element: ElementSymbol,
  overrides?: Partial<Record<ElementSymbol, number>>,
): number => overrides?.[element] ?? element_by_symbol.get(element)?.atomic_radius ?? 1

// Display radius of a site in Å before the global atom_radius scale: the per-element
// override or atomic radius, occupancy-weighted over a disordered site's species. Normalized
// by total occupancy so vacancy-containing sites render at full size.
const site_display_radius = (
  site: Site,
  element_radius_overrides?: Partial<Record<ElementSymbol, number>>,
): number => {
  // ordered-site shortcut: runs for every atom of a large supercell
  const [only] = site.species
  if (site.species.length === 1 && only.occu === 1) {
    return element_radius(only.element, element_radius_overrides)
  }
  let total_occu = 0
  let weighted = 0
  for (const { element, occu } of site.species) {
    total_occu += occu
    weighted += occu * element_radius(element, element_radius_overrides)
  }
  return total_occu > 0 ? weighted / total_occu : 1
}

// The one precedence rule for how big a site renders, shared by the scene, the camera fit and
// the legend: same_size > site override > occupancy-weighted element radius
export const site_base_radius = (
  site: Site,
  site_idx: number,
  opts: Omit<StructureFitOpts, `atom_radius_scale`>,
): number =>
  opts.same_size_atoms
    ? 1
    : (opts.site_radius_overrides?.get(site_idx) ??
      site_display_radius(site, opts.element_radius_overrides))

export function structure_fit_frame(
  structure: AnyStructure | null | undefined,
  opts: StructureFitOpts = {},
): StructureFitFrame {
  if (!structure) return empty_frame()
  const sites = structure.sites ?? []
  const lattice = `lattice` in structure ? structure.lattice : null
  if (!sites.length && !lattice) return empty_frame()

  const scale = opts.atom_radius_scale ?? 0.7
  // Sites then the 8 cell corners (radius 0); one typed array of radii instead of a tuple
  // per site, which a 10k-site supercell allocated on every fit
  const radii = Float64Array.from(
    sites,
    (site, idx) => site_base_radius(site, idx, opts) * scale,
  )
  const corners: Vec3[] = []
  if (lattice) {
    const [a_vec, b_vec, c_vec] = lattice.matrix
    for (let corner_idx = 0; corner_idx < 8; corner_idx++) {
      const [a_on, b_on, c_on] = [corner_idx & 1, (corner_idx >> 1) & 1, (corner_idx >> 2) & 1]
      corners.push(
        [0, 1, 2].map((ax) => a_on * a_vec[ax] + b_on * b_vec[ax] + c_on * c_vec[ax]) as Vec3,
      )
    }
  }
  const for_each_sample = (visit: (point: Vec3, radius: number) => void): void => {
    for (const [idx, site] of sites.entries()) visit(site.xyz, radii[idx])
    for (const corner of corners) visit(corner, 0)
  }

  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for_each_sample((point, radius) => {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis] - radius)
      max[axis] = Math.max(max[axis], point[axis] + radius)
    }
  })
  if (!Number.isFinite(min[0])) return empty_frame()

  const center = math.add(min, math.scale(math.subtract(max, min), 0.5))
  let radius_sq = 0
  for_each_sample((point, radius) => {
    const reach = math.euclidean_dist(point, center) + radius
    radius_sq = Math.max(radius_sq, reach * reach)
  })
  if (!(radius_sq > 0)) return { center, extent: 10 }
  return { center, extent: 2 * Math.sqrt(radius_sq) * DEFAULT_FIT_PADDING }
}

// `fit_extent` is a scene diameter in the scene's own units, so it has no lower bound of its
// own: reciprocal-space callers pass 1/A extents below 1. Clamping at 1 framed those against a
// constant, so both fits reject a bad extent instead.
const bad_fit = (extent: number, width: number, height: number): boolean =>
  !(extent > 0) || !Number.isFinite(extent) || !(width > 0) || !(height > 0)

export const ortho_zoom_for_extent = (
  fit_extent: number,
  width: number,
  height: number,
  initial_zoom: number,
): number => {
  if (bad_fit(fit_extent, width, height)) {
    throw new Error(`Invalid ortho fit: extent=${fit_extent}, viewport=${width}x${height}`)
  }
  return (initial_zoom * Math.min(width, height)) / (fit_extent * FIT_ZOOM_REF_PX)
}

export const perspective_distance_for_extent = (
  fit_extent: number,
  width: number,
  height: number,
  vertical_fov_degrees: number,
): number => {
  const in_range = vertical_fov_degrees > 0 && vertical_fov_degrees < 180
  if (bad_fit(fit_extent, width, height) || !in_range) {
    throw new Error(
      `Invalid perspective fit: extent=${fit_extent}, viewport=${width}x${height}, fov=${vertical_fov_degrees}`,
    )
  }
  const vertical_fov = (vertical_fov_degrees * Math.PI) / 180
  const horizontal_fov = 2 * Math.atan(Math.tan(vertical_fov / 2) * (width / height))
  const limiting_fov = Math.min(vertical_fov, horizontal_fov)
  // fit_extent is a sphere diameter. The closest point on the sphere must remain inside
  // the limiting view cone, so the center distance is radius / sin(half_fov).
  return fit_extent / 2 / Math.sin(limiting_fov / 2)
}

// Explicit view_dir is unit-normalized; missing/zero keeps the unnormalized default.
export const camera_position_for_target = (
  target: Vec3,
  distance: number,
  view_dir?: Vec3 | null,
): Vec3 =>
  math.add(
    target,
    math.scale(
      view_dir?.some((val) => val !== 0) ? math.normalize_vec(view_dir) : DEFAULT_CAMERA_VIEW,
      distance,
    ),
  )
