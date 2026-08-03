// Nudged-elastic-band / reaction-path data model and viewer.
//
// A reaction path is an ordered list of images, each pairing a structure with its
// energy (and optionally per-atom forces). Unlike a trajectory the x-axis is a
// reaction coordinate — by default the cumulative arc length through configuration
// space — not a time step, so this module is deliberately standalone.

import type { Vec3 } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'

// All of parse.ts is user-facing file reading, but reaction-path.ts is mostly internals:
// spline primitives, geometry helpers and validators have no consumer outside this
// folder, so they are re-exported from here only where someone actually calls them.
export * from './parse'
export {
  analyze_barrier,
  path_profile,
  path_spline,
  reaction_coordinate,
} from './reaction-path'
export type { BarrierAnalysis, PathSpline, PathSplineOptions } from './reaction-path'
export { default as NebPlot } from './NebPlot.svelte'
export { default as NebViewer } from './NebViewer.svelte'

// One image (bead) of a reaction path.
export type NebImage = {
  structure: AnyStructure
  // Total energy of this image. Stored as given; `EnergyReference` controls only
  // how it is displayed, never how it is stored.
  energy: number
  // Per-atom forces in the same order as `structure.sites`, in energy_unit / Å.
  // Used for the force-projected spline; omit for a plain cubic through energies.
  forces?: Vec3[]
  label?: string
}

// An ordered reaction path (initial state → transition state → final state).
export type ReactionPath = {
  images: NebImage[]
  label?: string
  // Defaults to `eV` when unset; used for axis and barrier labels only.
  energy_unit?: string
  metadata?: Record<string, unknown>
}

// Accepted shapes: a bare image array, a single path, or a keyed record of named
// paths so several mechanisms can be compared on one plot.
export type ReactionPathInput =
  | ReactionPath
  | NebImage[]
  | Record<string, ReactionPath | NebImage[]>

// A path paired with the key it was registered under.
export type NamedReactionPath = { key: string; path: ReactionPath }

// `arc_length` (default) is the cumulative minimum-image distance through
// configuration space; `image_index` plots against the bare bead number.
export type ReactionCoordMode = `arc_length` | `image_index`

// `initial` subtracts the first image energy, making barriers directly readable.
export type EnergyReference = `absolute` | `initial`

// `minimum_image` (default) folds every per-atom displacement into the nearest
// periodic image. `cartesian` uses raw coordinate differences — correct only for
// non-periodic systems, and wrong by nearly a full cell vector for any atom that
// migrates across a cell boundary, which in a diffusion barrier is exactly the
// atom you care about.
export type PathMetric = `minimum_image` | `cartesian`

export type PathMetricOptions = {
  metric?: PathMetric
  // Overrides the lattice pbc flags (e.g. to disable wrapping along a slab vacuum axis).
  pbc?: Pbc
}

export type ReactionCoordOptions = PathMetricOptions & { mode?: ReactionCoordMode }
