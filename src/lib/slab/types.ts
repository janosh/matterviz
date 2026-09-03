// Shared types and tolerances for the Miller-index surface/slab builder.
// Everything here reaches the package root through `export *`, hence the SLAB_ prefixes.
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'

// Cartesian tolerance (Å) for deciding two atomic positions coincide. Loose enough to
// absorb file round-off, tight enough to keep a real displacement (e.g. the ~0.1 Å
// ferroelectric offsets of tetragonal BaTiO3) from being mistaken for a symmetry.
export const SLAB_POSITION_TOLERANCE = 0.01

// Cartesian tolerance (Å) along the surface normal below which two sites belong to the
// same atomic layer. A layer never spans more than this, so it also bounds how far the
// reported layer height can sit from any of its members.
export const SLAB_LAYER_TOLERANCE = 0.1

// Defaults, not floors: make_slab accepts any non-negative thickness and vacuum
export const SLAB_DEFAULT_THICKNESS = 10 // Å
export const SLAB_DEFAULT_VACUUM = 10 // Å

// Refuse to build absurd slabs rather than hanging the browser tab. MAX_SLAB_SITES bounds the
// OUTPUT; the time goes into primitivizing the oriented cell, (rarest species) x (sites)
// probes set by the INPUT. At 0.030 us per probe, 2e7 holds make_slab near 1 s.
export const MAX_SLAB_SITES = 50_000
export const MAX_TRANSLATION_PROBES = 20_000_000

// A bulk cell re-expressed so that c crosses the (hkl) planes exactly once. Still fully
// periodic — the vacuum and the cleaving happen in make_slab.
export type OrientedBulk = {
  crystal: Crystal
  // Unimodular integer transform taking the input lattice rows to the oriented ones
  transform: Matrix3x3
  // Reduced Miller indices the transform was built for
  miller_indices: Vec3
  // Perpendicular distance between neighbouring (hkl) lattice planes, Å
  d_hkl: number
  // Unit surface normal in the Cartesian frame of the oriented cell
  normal: Vec3
  // How many times the in-plane cell shrank when primitive_in_plane was applied
  in_plane_index: number
}

// One atomic layer of an oriented bulk cell, i.e. a set of sites at the same height
// along the surface normal (within layer_tolerance).
export type SlabLayer = {
  site_idxs: number[]
  // Height of the layer above the cell origin along the normal, Å
  height: number
  // Fractional c of the lowest site in the layer (the shift that puts it at c = 0)
  frac_c_start: number
  // Empty distance along the normal between this layer and the one below it, Å
  gap_below: number
  formula: string
}

// A distinct way of cleaving the crystal: the slab starts at `layer_idx` and the bond
// gap below that layer becomes the surface.
export type SlabTermination = {
  layer_idx: number
  // Composition of the surface (bottom-most) layer
  formula: string
  // Empty distance along the normal at the cleavage plane, Å
  gap: number
  // Layers a normal-preserving symmetry of the bulk (a translation, or a rotation about
  // the normal or mirror through it plus one) maps onto `layer_idx`: the same surface
  equivalent_layer_idxs: number[]
}

export type SlabOptions = {
  // Å between the outermost atomic planes of the slab (grown in whole c repeats)
  min_slab_thickness?: number
  // Å of empty space between the top of the slab and the bottom of its periodic image
  min_vacuum_thickness?: number
  // Index into the distinct terminations from enumerate_terminations
  termination_idx?: number
  // Put the slab in the middle of the cell instead of at c = 0
  center_slab?: boolean
  // Rebuild the Cartesian frame so the surface lies in the xy plane and the normal is +z
  reorient_lattice?: boolean
  // Shrink the in-plane cell to the smallest one the crystal is periodic under
  primitive_in_plane?: boolean
  // Å along the normal within which sites count as one layer; see SLAB_LAYER_TOLERANCE
  layer_tolerance?: number
}

export type SlabInfo = {
  miller_indices: Vec3
  transform: Matrix3x3
  d_hkl: number
  // Layers in the finished slab
  n_layers: number
  // c repeats of the oriented bulk cell stacked to reach min_slab_thickness
  n_repeats: number
  // Gaps between consecutive layers of the built slab, read upwards from the cleaved
  // face, Å. One c repeat's worth, so they sum to d_hkl and then tile.
  layer_spacings: number[]
  // Smallest of those gaps, Å. Below about twice the layer tolerance the layer split is a
  // knife-edge call: nudging the tolerance would change the layer count, the termination
  // list and every spacing.
  min_layer_gap: number
  // Distance between the outermost atomic planes, Å
  slab_thickness: number
  // Empty distance between the slab and its periodic image along c, Å
  vacuum_thickness: number
  surface_area: number
  // Unit surface normal in the output Cartesian frame
  normal: Vec3
  termination: SlabTermination
  terminations: SlabTermination[]
}

export type Slab = Crystal & { slab_info: SlabInfo }
