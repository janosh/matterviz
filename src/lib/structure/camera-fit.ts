// Content-AABB camera framing: look-at center, a padded bounding-sphere extent, and the padded
// width and height the content spans as seen from the initial view, which the ortho zoom fits
// to the viewport. Lattice midpoint alone mis-frames asymmetric image atoms.

import type { ElementSymbol } from '#lib/element/index.js'
import { element_by_symbol } from '#lib/element/data.js'
import type { Vec2, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { AnyStructure, Site } from '#lib/structure/index.js'

// Occupy at most 92% of the viewport along the tighter axis.
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
  // Camera offset from its target (missing/zero: the default angled view) and world up, which
  // the spans are measured against
  view_dir?: Vec3 | null
  view_up?: Vec3 | null
}

// `extent` (bounding-sphere diameter) is orientation-free: perspective distance and the
// outgrown-fit check use it. `spans` is the screen-aligned [width, height] from the initial
// view, so a slab seen edge-on or a long supercell fills the viewer instead of a sphere around it.
type StructureFitFrame = { center: Vec3; extent: number; spans: Vec2 }

const empty_frame = (): StructureFitFrame => ({
  center: [0, 0, 0],
  extent: 10,
  spans: [10, 10],
})

// Screen right and up for a camera at `view_dir` from its target with world `view_up`; null
// when the view looks along the up vector and leaves no screen orientation to measure
const view_basis = (view_dir?: Vec3 | null, view_up?: Vec3 | null): [Vec3, Vec3] | null => {
  const offset = view_dir?.some((val) => val !== 0) ? view_dir : DEFAULT_CAMERA_VIEW
  const forward = math.normalize_vec(math.scale(offset, -1))
  const right = math.cross_3d(forward, view_up ?? [0, 1, 0])
  if (Math.hypot(...right) < 1e-6) return null
  const unit_right = math.normalize_vec(right)
  return [unit_right, math.cross_3d(unit_right, forward)]
}

export const camera_needs_fit = (
  position: Vec3 | undefined,
  previous_view: string | undefined,
  camera_view: string,
): boolean =>
  position === undefined || (previous_view !== undefined && previous_view !== camera_view)

const element_radius = (
  element: ElementSymbol,
  overrides?: Partial<Record<ElementSymbol, number>>,
): number => overrides?.[element] ?? element_by_symbol.get(element)?.atomic_radius ?? 1

// The camera pose carried from one structure's center to another's: target and position shift
// by the same offset, so the view direction, distance and any pan stay as the user left them.
export const follow_center = (
  pose: { target: Vec3; position: Vec3 },
  from: Vec3,
  to: Vec3,
): { target: Vec3; position: Vec3 } => {
  const offset = math.subtract(to, from)
  return { target: math.add(pose.target, offset), position: math.add(pose.position, offset) }
}

// Whether content of `extent` has outgrown a zoom fitted to `fitted_extent`: more than twice as
// large or small. A frame within that keeps the zoom, so a volume scan or an NPT cell still shows
// its change in size; a dataset's 86 Å slab after a 4 Å cell is re-framed instead. Extents
// floor at 1 Å like the framing distance, so a point-like fit (one hidden atom) is no zero.
export const outgrows_fit = (extent: number, fitted_extent: number): boolean => {
  const [size, fitted] = [Math.max(1, extent), Math.max(1, fitted_extent)]
  return size > 2 * fitted || size < fitted / 2
}

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
  // Compute radii while accumulating the bounds; Float64Array.from first materializes
  // iterable sites as an intermediate array and adds a separate full pass.
  const radii = new Float64Array(sites.length)
  const corners: Vec3[] = []
  if (lattice) {
    const [a_vec, b_vec, c_vec] = lattice.matrix
    for (let corner_idx = 0; corner_idx < 8; corner_idx++) {
      const [a_on, b_on, c_on] = [corner_idx & 1, (corner_idx >> 1) & 1, (corner_idx >> 2) & 1]
      corners.push(
        [0, 1, 2].map(
          (axis_x) => a_on * a_vec[axis_x] + b_on * b_vec[axis_x] + c_on * c_vec[axis_x],
        ) as Vec3,
      )
    }
  }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const n_samples = sites.length + corners.length
  for (let idx = 0; idx < n_samples; idx++) {
    const point = idx < sites.length ? sites[idx].xyz : corners[idx - sites.length]
    let radius = 0
    if (idx < sites.length) {
      radius = site_base_radius(sites[idx], idx, opts) * scale
      radii[idx] = radius
    }
    min[0] = Math.min(min[0], point[0] - radius)
    min[1] = Math.min(min[1], point[1] - radius)
    min[2] = Math.min(min[2], point[2] - radius)
    max[0] = Math.max(max[0], point[0] + radius)
    max[1] = Math.max(max[1], point[1] + radius)
    max[2] = Math.max(max[2], point[2] + radius)
  }
  if (!Number.isFinite(min[0])) return empty_frame()

  const center = math.add(min, math.scale(math.subtract(max, min), 0.5))
  const basis = view_basis(opts.view_dir, opts.view_up)
  const [right, up] = basis ?? [
    [0, 0, 0],
    [0, 0, 0],
  ]
  let radius_sq = 0
  // half-widths about the center, which stays the look-at point
  let [half_right, half_up] = [0, 0]
  for (let idx = 0; idx < n_samples; idx++) {
    const point = idx < sites.length ? sites[idx].xyz : corners[idx - sites.length]
    const radius = idx < sites.length ? radii[idx] : 0
    const delta_x = point[0] - center[0]
    const delta_y = point[1] - center[1]
    const delta_z = point[2] - center[2]
    // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- preserve distance arithmetic
    const reach = Math.sqrt(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z) + radius
    radius_sq = Math.max(radius_sq, reach * reach)
    const along_right = delta_x * right[0] + delta_y * right[1] + delta_z * right[2]
    const along_up = delta_x * up[0] + delta_y * up[1] + delta_z * up[2]
    half_right = Math.max(half_right, Math.abs(along_right) + radius)
    half_up = Math.max(half_up, Math.abs(along_up) + radius)
  }
  if (!(radius_sq > 0)) return { center, extent: 10, spans: [10, 10] }
  const extent = 2 * Math.sqrt(radius_sq) * DEFAULT_FIT_PADDING
  // Each span floors at 1 Å so content seen end-on (a hidden-atom chain along the view) still
  // has a finite zoom, like the framing distance
  const span = (half: number) => Math.max(1, 2 * half) * DEFAULT_FIT_PADDING
  return {
    center,
    extent,
    spans: basis ? [span(half_right), span(half_up)] : [extent, extent],
  }
}

// `fit_extent` is a scene diameter in the scene's own units, so it has no lower bound of its
// own: clamping at 1 framed the sub-1 1/A extents of reciprocal space against a constant.
const bad_fit = (extent: number, width: number, height: number): boolean =>
  !(extent > 0 && extent < Infinity) || !(width > 0) || !(height > 0)

// A number is a sphere's diameter, which must fit the shorter edge; a [width, height] pair is
// a screen-aligned box whose sides each fit their own viewport edge
export const ortho_zoom_for_extent = (
  fit_extent: number | Vec2,
  width: number,
  height: number,
  initial_zoom: number,
): number => {
  const [extent_x, extent_y] =
    typeof fit_extent === `number` ? [fit_extent, fit_extent] : fit_extent
  if (bad_fit(extent_x, width, height) || bad_fit(extent_y, width, height)) {
    throw new Error(`Invalid ortho fit: extent=${fit_extent}, viewport=${width}x${height}`)
  }
  return (initial_zoom / FIT_ZOOM_REF_PX) * Math.min(width / extent_x, height / extent_y)
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
