// Periodic boundary conditions utilities
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  expected_bond_length,
  has_framework_potential,
  intern_site_elements,
  is_spectator_center,
} from './bonding'
import type { AnyStructure, Site } from './index'

export type Pbc = readonly [boolean, boolean, boolean]

// Distance slack added to the bond detector's expected length (expected_bond_length) when
// deciding whether a candidate image atom bonds a base atom (VESTA-like additive
// criterion). Must cover the longest bond the perception strategies draw, else a drawn
// bond loses its far atom at the cell boundary: ionic bonds stretch ~0.2 Å past the
// covalent sum (Ba-O 2.99 vs 2.81), and metals without a tabulated metallic radius still
// measure against covalent radii (Pb 3.50 vs 2.92). Additive not multiplicative — a ratio
// big enough for Pb would make a 5 Å Na-Na second neighbour look bonded, since Na's radius
// is large.
const BOND_SLACK = 0.7 // Å
// Below this separation two sites are overlapping copies, not a bond (matches
// the min_bond_dist default in bonding.ts)
const MIN_BOND_DIST = 0.4 // Å

// Pack quantized cell coordinates into one integer key (exact for cell coords in
// [-512, 511], i.e. structures up to ~1000 cells per axis - far beyond any real case).
// Integer Map keys avoid per-lookup string building in the phase-2 completion grid below.
const CELL_OFFSET = 512
const pack_cell_key = (x: number, y: number, z: number): number =>
  (x + CELL_OFFSET) * 1048576 + (y + CELL_OFFSET) * 1024 + (z + CELL_OFFSET)

// Wrap a single fractional coordinate to [0, 1), snapping near-1 values to 0 and rounding
// to 15 digits to suppress floating-point noise. The one wrap helper for parsed coordinates,
// moyo-standardized Wyckoff positions and symmetry-element fixed points alike; the symmetry
// dedup keys downstream quantize at 1e-4 / 1e-8, far coarser than this snap.
export const wrap_frac_coord = (coord: number): number => {
  const wrapped = coord - Math.floor(coord)
  if (wrapped >= 1 - 1e-10) return 0
  return Number(wrapped.toFixed(15))
}

// Wrap fractional coords to [0, 1). Non-periodic axes keep their out-of-cell coordinate
// (matching normalize_fractional_coords) — folding a slab along its vacuum direction tears it.
export const wrap_to_unit_cell = (frac: Vec3, pbc: Pbc = [true, true, true]): Vec3 => [
  pbc[0] ? wrap_frac_coord(frac[0]) : frac[0],
  pbc[1] ? wrap_frac_coord(frac[1]) : frac[1],
  pbc[2] ? wrap_frac_coord(frac[2]) : frac[2],
]

// Trajectory-like data: >10% of atoms far outside the unit cell. Image-atom
// generation is skipped for such structures.
const is_scattered_trajectory = (sites: Site[]): boolean => {
  const atoms_outside_cell = sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1),
  )
  return atoms_outside_cell.length > sites.length * 0.1
}

// Image atoms for PBC as [atom_idx, image_xyz, image_abc, is_completion?] tuples; is_completion
// marks phase-2 images that only complete bonds / coordination polyhedra at cell faces
// (renderers may hide them). Skips scattered trajectories.
export function find_image_atoms(structure: AnyStructure): [number, Vec3, Vec3, boolean?][] {
  if (!(`lattice` in structure) || structure.sites.length === 0) return []
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
  const tolerances = vec_lens.map((vec_len) =>
    vec_len > 0 ? PHYSICAL_TOLERANCE / vec_len : 0.05,
  )

  const { pbc } = structure.lattice // no images across vacuum

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
      if (selected_shift[0] === 0 && selected_shift[1] === 0 && selected_shift[2] === 0)
        continue

      const img_abc: Vec3 = [
        site.abc[0] + selected_shift[0],
        site.abc[1] + selected_shift[1],
        site.abc[2] + selected_shift[2],
      ]
      const img_xyz = frac_to_cart(img_abc)
      // A shift along a zero-length lattice vector (degenerate cell) lands on the atom itself
      const diff_x = img_xyz[0] - site.xyz[0]
      const diff_y = img_xyz[1] - site.xyz[1]
      const diff_z = img_xyz[2] - site.xyz[2]
      if (diff_x * diff_x + diff_y * diff_y + diff_z * diff_z < displacement_eps_sq) continue

      image_sites.push([idx, img_xyz, img_abc])
    }
  }

  // Per-site element ids for the phase-2 completion pass; the composition is the tiny
  // per-element list (so has_framework_potential and the pair table below don't re-scan
  // every site in big supercells).
  const {
    symbols: present_elements,
    site_elem_ids,
    elem_data,
  } = intern_site_elements(structure.sites)
  // Per-element-pair bond reach: the bond detector's expected length plus slack, 0 when the
  // pair cannot bond (unknown radius). One read in the hot loop below instead of a radius
  // sum, and the same metallic-vs-covalent choice electroneg_ratio makes.
  const n_elem = present_elements.length
  const pair_reach = new Float64Array(n_elem * n_elem)
  let max_bond_dist = 0
  for (let id_a = 0; id_a < n_elem; id_a++) {
    for (let id_b = 0; id_b < n_elem; id_b++) {
      const expected = expected_bond_length(elem_data[id_a], elem_data[id_b])
      if (expected === null) continue
      const reach = expected + BOND_SLACK
      pair_reach[id_a * n_elem + id_b] = reach
      if (reach > max_bond_dist) max_bond_dist = reach
    }
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
  const elem_skipped = present_elements.map(
    (elem) => skip_spectators && is_spectator_center(elem),
  )

  // Phase 2: images that complete bonds / coordination polyhedra at cell faces. Phase 1's
  // ~0.5 Å face tolerance misses an atom just beyond a face that still bonds one near it,
  // truncating the boundary shell. A candidate is added when a copy of it would bond some
  // displayed anchor, regardless of which side of the bond it sits on: an earlier version
  // restricted this to anions completing cation shells, which left anions at cell faces
  // visibly under-coordinated (Cl in rocksalt drew 4 bonds where Na drew 6) and skipped
  // elemental and equal-EN structures entirely (diamond corners drew a single bond).
  if (max_bond_dist > 0) {
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
    // so its element id (and with it the pair reach and skip flag) stays single-sourced.
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
    const bonds_an_anchor = (pos: Vec3, elem_id: number): boolean => {
      const cx = Math.floor(pos[0] / max_bond_dist)
      const cy = Math.floor(pos[1] / max_bond_dist)
      const cz = Math.floor(pos[2] / max_bond_dist)
      const pair_row = elem_id * n_elem
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cell = grid.get(pack_cell_key(cx + dx, cy + dy, cz + dz))
            if (!cell) continue
            for (const anchor_idx of cell) {
              const anchor_elem = site_elem_ids[anchor_src[anchor_idx]]
              const max_dist = pair_reach[pair_row + anchor_elem] // 0 = pair cannot bond
              if (max_dist === 0 || elem_skipped[anchor_elem]) continue
              // squared compare: this runs hundreds of thousands of times per supercell
              const anchor_pos = anchor_positions[anchor_idx]
              const diff_x = pos[0] - anchor_pos[0]
              const diff_y = pos[1] - anchor_pos[1]
              const diff_z = pos[2] - anchor_pos[2]
              const dist_sq = diff_x * diff_x + diff_y * diff_y + diff_z * diff_z
              if (dist_sq > MIN_BOND_DIST ** 2 && dist_sq <= max_dist * max_dist) return true
            }
          }
        }
      }
      return false
    }

    // Dedupe against phase-1 images via (site, integer shift) keys. Shifts are -1/0/1 per
    // axis, so site index and shift pack into one integer (no string per candidate).
    const image_key = (idx: number, shift_a: number, shift_b: number, shift_c: number) =>
      idx * 27 + (shift_a + 1) * 9 + (shift_b + 1) * 3 + shift_c + 1
    const seen_images = new Set<number>()
    for (const [idx, , img_abc] of image_sites) {
      const { abc } = structure.sites[idx]
      const shift = (axis: number) => Math.round(img_abc[axis] - abc[axis])
      seen_images.add(image_key(idx, shift(0), shift(1), shift(2)))
    }

    // reused scratch: shifts[axis] holds [0, +1?, -1?], counts[axis] how many are live
    const shifts = [
      [0, 1, -1],
      [0, 1, -1],
      [0, 1, -1],
    ]
    const counts = [1, 1, 1]
    for (const [idx, site] of structure.sites.entries()) {
      const elem_id = site_elem_ids[idx]
      // Spectator A-site cations stay excluded (see skip_spectators above); everything
      // else is a candidate, since any atom can be the missing end of a boundary bond
      if (elem_skipped[elem_id]) continue
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
            const key = image_key(idx, shift_a, shift_b, shift_c)
            if (seen_images.has(key)) continue
            const img_abc: Vec3 = [
              site.abc[0] + shift_a,
              site.abc[1] + shift_b,
              site.abc[2] + shift_c,
            ]
            const img_xyz = frac_to_cart(img_abc)
            if (!bonds_an_anchor(img_xyz, elem_id)) continue
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
export function get_pbc_image_sites(structure: AnyStructure): AnyStructure {
  const image_sites = find_image_atoms(structure)
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
