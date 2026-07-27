// Periodic boundary conditions utilities
import { element_by_symbol } from '$lib/element/data'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  get_majority_element,
  has_framework_potential,
  is_spectator_center,
  pack_cell_key,
} from './bonding'
import type { ParsedStructure } from './parse'

export type Pbc = readonly [boolean, boolean, boolean]

// Distance slack added to the covalent-radii sum when deciding whether a candidate image
// atom bonds a base atom (VESTA-like additive criterion). Must cover the longest bond the
// perception strategies draw, else a drawn bond loses its far atom at the cell boundary:
// metallic bonds run past the radii sum, fcc Al at 2.864 Å against a 2.42 Å sum, Pb 3.50
// vs 2.92. Additive not multiplicative — a ratio big enough for Pb would make a 5 Å Na-Na
// second neighbour look bonded, since Na's radius is large.
const BOND_SLACK = 0.7 // Å
// Below this separation two sites are overlapping copies, not a bond (matches
// the min_bond_dist default in bonding.ts)
const MIN_BOND_DIST = 0.4 // Å

// Wrap a single fractional coordinate to [0, 1), clamping near-1 values to 0 and rounding
// to 15 digits to suppress floating-point noise.
// NOTE on epsilon: the tightest of three intentionally different wrap helpers. Coordinates
// here come almost straight from file parsing, so a 1e-10 snap + toFixed(15) preserves
// maximal precision. Compare wrap_frac @1e-9 [[src/lib/symmetry/index.ts:80]] (post-moyo)
// and wrap_point @1e-8 [[src/lib/symmetry/symmetry-elements.ts:214]] (feeds dedup keys).
// Do not unify: loosening this changes snapping near cell boundaries for parsed structures.
export const wrap_frac_coord = (coord: number): number => {
  const wrapped = coord - Math.floor(coord)
  if (wrapped >= 1 - 1e-10) return 0
  return Number(wrapped.toFixed(15))
}

// Wrap fractional coordinates to [0, 1) range for periodicity.
export const wrap_to_unit_cell = (frac: Vec3): Vec3 => [
  wrap_frac_coord(frac[0]),
  wrap_frac_coord(frac[1]),
  wrap_frac_coord(frac[2]),
]

// Trajectory-like data: >10% of atoms far outside the unit cell. Image-atom
// generation is skipped for such structures.
const is_scattered_trajectory = (sites: ParsedStructure[`sites`]): boolean => {
  const atoms_outside_cell = sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1),
  )
  return atoms_outside_cell.length > sites.length * 0.1
}

export function find_image_atoms(
  structure: ParsedStructure,
  { tolerance }: { tolerance?: number } = {},
): [number, Vec3, Vec3, boolean?][] {
  // Find image atoms for PBC. Returns [atom_idx, image_xyz, image_abc, is_completion?]
  // tuples; is_completion marks phase-2 images that only complete bonds / coordination
  // polyhedra at cell faces (renderers may hide them). Skips scattered trajectories.
  if (!structure.lattice || !structure.sites || structure.sites.length === 0) return []
  if (is_scattered_trajectory(structure.sites)) return []

  const image_sites: [number, Vec3, Vec3, boolean?][] = []
  const lattice_vecs = structure.lattice.matrix
  const frac_to_cart = math.create_frac_to_cart(lattice_vecs)
  const vec_lens = lattice_vecs.map((vec) => Math.hypot(...vec))

  // Scale zero-displacement threshold by lattice length scale to avoid magic numbers
  const lattice_norm = Math.max(...vec_lens)
  const displacement_eps_sq = (1e-10 * lattice_norm) ** 2

  // Boundary tolerance: physical 0.5 Å as fractional per-axis, so large cells (MOFs)
  // don't over-generate (a flat 0.05 fractional would be huge there)
  const PHYSICAL_TOLERANCE = 0.5 // Å
  const tolerances = vec_lens.map(
    (vec_len) => tolerance ?? (vec_len > 0 ? PHYSICAL_TOLERANCE / vec_len : 0.05),
  )

  const pbc: Pbc = structure.lattice.pbc ?? [true, true, true] // no images across vacuum

  // Faces this atom sits on, as ±(dim + 1) so axis and direction fit one number. Reused
  // across sites: interior atoms are the vast majority in a supercell and touch no face,
  // so a fresh array each time would allocate for nothing.
  const edge_dims: number[] = []
  // Phase 1: true periodic copies of atoms within `tolerance` of a cell face (bond
  // lengths preserved, rather than clamping the copy to the cell face)
  for (const [idx, site] of structure.sites.entries()) {
    edge_dims.length = 0
    for (let dim = 0; dim < 3; dim++) {
      if (!pbc[dim]) continue
      const coord = site.abc[dim]
      const dim_tolerance = tolerances[dim]
      if (Math.abs(coord) < dim_tolerance) edge_dims.push(dim + 1)
      if (Math.abs(coord - 1) < dim_tolerance) edge_dims.push(-dim - 1)
    }

    // Generate all translation combinations; if both +1 and -1 are selected for a dim the
    // net shift is zero and we skip (yields no image).
    for (let mask = 1; mask < 1 << edge_dims.length; mask++) {
      const selected_shift: Vec3 = [0, 0, 0]
      for (let bit = 0; bit < edge_dims.length; bit++) {
        if (mask & (1 << bit)) {
          selected_shift[Math.abs(edge_dims[bit]) - 1] += Math.sign(edge_dims[bit])
        }
      }
      if (selected_shift.every((val) => val === 0)) continue

      const [s_a, s_b, s_c] = site.abc
      const img_abc: Vec3 = [
        s_a + selected_shift[0],
        s_b + selected_shift[1],
        s_c + selected_shift[2],
      ]
      if (img_abc[0] === s_a && img_abc[1] === s_b && img_abc[2] === s_c) continue

      const img_xyz = frac_to_cart(img_abc)
      // Skip zero-displacement images (guards against FP edge cases)
      const displacement = math.subtract(img_xyz, site.xyz)
      const displacement_len_sq = displacement.reduce((sum, val) => sum + val * val, 0)
      if (displacement_len_sq < displacement_eps_sq) continue

      image_sites.push([idx, img_xyz, img_abc])
    }
  }

  // Per-site element data for the phase-2 completion pass. present_elements is the tiny
  // composition (so has_framework_potential doesn't re-scan every site in big supercells).
  const site_elements: (string | null)[] = []
  const site_radii: (number | null)[] = []
  const present_elements = new Set<string>()
  let max_radius = 0
  for (const site of structure.sites) {
    const elem = get_majority_element(site)
    const radius =
      (elem === null ? undefined : element_by_symbol.get(elem))?.covalent_radius ?? null
    site_elements.push(elem)
    if (elem !== null) present_elements.add(elem)
    site_radii.push(radius)
    if (radius !== null && radius > max_radius) max_radius = radius
  }

  // Skip spectator A-site cations (Li/Na, heavy alkaline earths) when a framework cation
  // is present: they render no polyhedron, so completing their shells floats coordination
  // groups (e.g. a PO4 around a corner Li) beyond the cell. Purely ionic binaries (NaCl)
  // keep theirs. Note: a spectator force-included as a polyhedra center (compute_polyhedra's
  // included_center_elements) is still skipped here, so its boundary polyhedra truncate at
  // cell faces - accepted to keep image generation independent of render-only settings.
  const skip_spectators = has_framework_potential(present_elements)
  // resolved per element, not per site: is_spectator_center does two lookups and a
  // supercell repeats the same handful of elements thousands of times
  const spectators = new Set(
    skip_spectators ? [...present_elements].filter(is_spectator_center) : [],
  )
  const site_skipped = site_elements.map((elem) => elem !== null && spectators.has(elem))

  // Phase 2: images that complete bonds / coordination polyhedra at cell faces. Phase 1's
  // ~0.5 Å face tolerance misses an atom just beyond a face that still bonds one near it,
  // truncating the boundary shell. A candidate is added when a copy of it would bond some
  // displayed anchor, regardless of which side of the bond it sits on: an earlier version
  // restricted this to anions completing cation shells, which left anions at cell faces
  // visibly under-coordinated (Cl in rocksalt drew 4 bonds where Na drew 6) and skipped
  // elemental and equal-EN structures entirely (diamond corners drew a single bond).
  const max_bond_dist = 2 * max_radius + BOND_SLACK
  if (max_bond_dist > BOND_SLACK) {
    // Per-axis fractional bond reach via perpendicular cell heights (correct for oblique
    // cells; 0 for degenerate cells → no images). The + face tolerance covers phase-1
    // anchors sitting slightly outside the cell.
    const pad_per_axis = math.frac_cutoff_per_axis(
      lattice_vecs,
      max_bond_dist + PHYSICAL_TOLERANCE,
    )

    // Bond-test anchors = base atoms + phase-1 boundary images, so every displayed
    // boundary cation gets its shell completed (VESTA-like; e.g. all 8 rutile corners).
    // Anchor = base atom or phase-1 image; anchor_src maps each back to the site it copies
    // so radius/EN/skipped stay single-sourced instead of being duplicated per anchor.
    const anchor_positions: Vec3[] = structure.sites.map((site) => site.xyz)
    const anchor_src: number[] = structure.sites.map((_site, idx) => idx)
    for (const [src_idx, img_xyz] of image_sites) {
      anchor_positions.push(img_xyz)
      anchor_src.push(src_idx)
    }

    // Spatial grid over anchors for the bond check (integer-packed keys: this
    // grid is probed 27x per candidate image in the loop below)
    const grid = new Map<number, number[]>()
    for (const [idx, pos] of anchor_positions.entries()) {
      const key = pack_cell_key(
        Math.floor(pos[0] / max_bond_dist),
        Math.floor(pos[1] / max_bond_dist),
        Math.floor(pos[2] / max_bond_dist),
      )
      const cell = grid.get(key)
      if (cell) cell.push(idx)
      else grid.set(key, [idx])
    }
    // True when a copy of the candidate at `pos` would bond some displayed anchor,
    // i.e. it completes that anchor's coordination shell
    const bonds_an_anchor = (pos: Vec3, radius: number): boolean => {
      const [cx, cy, cz] = pos.map((coord) => Math.floor(coord / max_bond_dist))
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cell = grid.get(pack_cell_key(cx + dx, cy + dy, cz + dz))
            if (!cell) continue
            for (const anchor_idx of cell) {
              const src_idx = anchor_src[anchor_idx]
              const anchor_radius = site_radii[src_idx]
              if (site_skipped[src_idx] || anchor_radius === null) continue
              // squared compare: this runs hundreds of thousands of times per supercell
              const anchor_pos = anchor_positions[anchor_idx]
              const diff_x = pos[0] - anchor_pos[0]
              const diff_y = pos[1] - anchor_pos[1]
              const diff_z = pos[2] - anchor_pos[2]
              const dist_sq = diff_x * diff_x + diff_y * diff_y + diff_z * diff_z
              const max_dist = radius + anchor_radius + BOND_SLACK
              if (dist_sq > MIN_BOND_DIST ** 2 && dist_sq <= max_dist * max_dist) return true
            }
          }
        }
      }
      return false
    }

    // Dedupe against phase-1 images via (site, integer shift) keys
    const seen_images = new Set(
      image_sites.map(
        ([idx, _xyz, img_abc]) =>
          `${idx}|${img_abc
            .map((coord, axis) => Math.round(coord - structure.sites[idx].abc[axis]))
            .join(`,`)}`,
      ),
    )

    // reused scratch: shifts[axis] holds [0, +1?, -1?], counts[axis] how many are live
    const shifts = [
      [0, 1, -1],
      [0, 1, -1],
      [0, 1, -1],
    ]
    const counts = [1, 1, 1]
    for (const [idx, site] of structure.sites.entries()) {
      const radius = site_radii[idx]
      // Spectator A-site cations stay excluded (see skip_spectators above); everything
      // else is a candidate, since any atom can be the missing end of a boundary bond
      if (radius === null || site_skipped[idx]) continue
      // Per-axis shifts that could land a copy of this atom within bonding reach of the
      // cell: {0} plus +1/-1 when the atom is within max_bond_dist of the boundary.
      // Counted into the reused scratch above instead of building four arrays per site.
      for (let axis = 0; axis < 3; axis++) {
        const below = pbc[axis] && site.abc[axis] < pad_per_axis[axis]
        const above = pbc[axis] && site.abc[axis] > 1 - pad_per_axis[axis]
        shifts[axis][1] = below ? 1 : -1 // slot 2 stays -1, only read when both apply
        counts[axis] = 1 + Number(below) + Number(above)
      }
      if (counts[0] * counts[1] * counts[2] === 1) continue // interior atom, no images

      for (let idx_a = 0; idx_a < counts[0]; idx_a++) {
        const shift_a = shifts[0][idx_a]
        for (let idx_b = 0; idx_b < counts[1]; idx_b++) {
          const shift_b = shifts[1][idx_b]
          for (let idx_c = 0; idx_c < counts[2]; idx_c++) {
            const shift_c = shifts[2][idx_c]
            if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
            const key = `${idx}|${shift_a},${shift_b},${shift_c}`
            if (seen_images.has(key)) continue
            const img_abc: Vec3 = [
              site.abc[0] + shift_a,
              site.abc[1] + shift_b,
              site.abc[2] + shift_c,
            ]
            const img_xyz = frac_to_cart(img_abc)
            if (!bonds_an_anchor(img_xyz, radius)) continue
            seen_images.add(key)
            image_sites.push([idx, img_xyz, img_abc, true])
          }
        }
      }
    }
  }

  return image_sites
}

// Return structure with image atoms added (unchanged when none are generated,
// e.g. for scattered trajectory-like data)
export function get_pbc_image_sites(
  ...args: Parameters<typeof find_image_atoms>
): ParsedStructure {
  const structure = args[0]
  const image_sites = find_image_atoms(...args)
  if (image_sites.length === 0) return structure
  const imaged_struct = { ...structure, sites: [...structure.sites] }

  for (const [site_idx, img_xyz, img_abc, is_completion] of image_sites) {
    const orig_site = structure.sites[site_idx]
    imaged_struct.sites.push({
      ...orig_site,
      abc: img_abc,
      xyz: img_xyz,
      properties: {
        ...orig_site.properties,
        orig_site_idx: site_idx,
        // phase-2 images only complete bonds/polyhedra - hidden when neither renders
        ...(is_completion ? { completion_image: true } : {}),
      },
    })
  }
  return imaged_struct
}
