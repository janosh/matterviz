import type { Matrix3x3, Point2D, Vec2, Vec3 } from '#lib/math.js'
import type { CameraProjection } from '#lib/settings.js'

// One family of crystal planes {hkl} and its surface energy. `miller` is any representative
// (the family is expanded with the point group), `energy` in J/m². With a `slope` (J/m² per
// eV), γ depends linearly on a chemical potential as in ab initio thermodynamics of compound
// surfaces: γ(Δμ) = energy + slope·Δμ, so `energy` is γ at Δμ = 0 and the slope is minus the
// termination's excess of that species per area.
export type WulffFacetInput = { miller: Vec3; energy: number; slope?: number; color?: string }

// A family's share of the equilibrium shape
export type WulffFamily = {
  miller: Vec3 // representative as given
  energy: number // J/m², at the shape's Δμ
  multiplicity: number // symmetry-equivalent planes in the family
  n_facets: number // how many of them bound the shape (0 when the family is absent)
  area: number // summed facet area, in units of the shape (see WulffShapeData)
  area_fraction: number // area / total surface area
}

// One face of the shape: a convex polygon on one symmetry-equivalent plane of a family
export type WulffFacet = {
  family_idx: number // into WulffShapeData.families
  miller: Vec3 // this plane's own indices, e.g. (0 1̄ 0) of the {100} family
  normal: Vec3 // outward unit normal (Cartesian)
  dist: number // distance from the center, ∝ γ
  vertex_indices: number[] // counter-clockwise seen from outside, into WulffShapeData.vertices
  area: number
}

// Equilibrium crystal shape. The Wulff construction fixes the shape, not its size, so every
// shape is scaled to the volume of a unit sphere (4π/3) and areas only compare within one shape.
export type WulffShapeData = {
  vertices: Vec3[]
  facets: WulffFacet[]
  edges: Vec2[] // vertex index pairs of every facet edge, each once
  families: WulffFamily[] // index-aligned with the input facets
  surface_area: number
  // Σ γᵢ·Aᵢ / Σ Aᵢ (J/m²), the mean surface energy of the particle
  weighted_surface_energy: number
  // surface_area / volume^(2/3): 4.84 for a sphere, 6 for a cube (pymatgen's shape_factor)
  shape_factor: number
  // area-weighted RMS deviation of γ from weighted_surface_energy, relative to it
  anisotropy: number
  point_group: Matrix3x3[] // integer fractional rotations the families were expanded with
}

// A facet under the pointer (or keyboard cursor), named by its plane so a pinned tooltip
// follows that plane while the energies change (and goes once the plane leaves the shape)
export type WulffHover = { mark: string; miller: Vec3; screen_position: Point2D }

// Viewer display defaults (WulffShape, WulffScene)
export const WULFF_DEFAULTS = {
  opacity: 1,
  edge_color: `#222222`,
  edge_width: 0.006, // fraction of the shape's radius
  show_axes: true,
  show_legend: true,
  camera_projection: `perspective` as CameraProjection,
}
export type WulffDisplaySettings = typeof WULFF_DEFAULTS
