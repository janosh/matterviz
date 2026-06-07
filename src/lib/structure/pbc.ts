// Periodic boundary conditions utilities
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { element_lookup, get_majority_element } from './bonding'
import type { ParsedStructure } from './parse'

export type Pbc = readonly [boolean, boolean, boolean]

// Distance slack added to the covalent-radii sum when deciding whether a
// candidate image atom bonds to a base atom (VESTA-like bond search criterion)
const BOND_SLACK = 0.4 // Å

// Wrap a single fractional coordinate to [0, 1), clamping near-1 values to 0
// and rounding to 15 digits to suppress floating-point noise.
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

export function find_image_atoms(
  structure: ParsedStructure,
  { tolerance }: { tolerance?: number } = {},
): [number, Vec3, Vec3][] {
  // Find image atoms for PBC. Returns [atom_idx, image_xyz, image_abc] tuples.
  // Skips image generation for trajectory data with scattered atoms.
  if (!structure.lattice || !structure.sites || structure.sites.length === 0) return []

  // Skip trajectory data (>10% atoms outside cell)
  const atoms_outside_cell = structure.sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1),
  )
  // Skip image generation for trajectory data (>10% atoms outside cell)
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    return []
  }

  // Check if this is a supercell to correctly identify external boundaries correctly
  const image_sites: [number, Vec3, Vec3][] = []
  const lattice_vecs = structure.lattice.matrix

  // Scale zero-displacement threshold by lattice length scale to avoid hard-coded magic numbers
  const lattice_norm = Math.max(
    Math.hypot(...lattice_vecs[0]),
    Math.hypot(...lattice_vecs[1]),
    Math.hypot(...lattice_vecs[2]),
  )
  // Threshold to filter out floating-point-identical (zero-displacement) images; rarely triggers but guards against edge cases
  const displacement_eps_sq = (1e-10 * lattice_norm) ** 2

  // Tolerances determine which atoms are near cell boundaries and need image generation
  // Use provided tolerance or default to physical tolerance of 0.5 Angstroms converted to fractional
  // This prevents excessive image generation for large unit cells (e.g. MOFs) where 0.05 fractional is huge
  const PHYSICAL_TOLERANCE = 0.5 // Angstroms
  const tolerances = [0, 1, 2].map((dim) => {
    if (tolerance !== undefined) return tolerance
    const vec_len = Math.hypot(...lattice_vecs[dim])
    // zero-length lattice vector should not occur in valid structures,
    // but fall back to 0.05 fractional tolerance if it does
    return vec_len > 0 ? PHYSICAL_TOLERANCE / vec_len : 0.05
  })

  // Respect per-axis periodicity: no images across non-periodic (vacuum) directions
  const pbc: Pbc = structure.lattice.pbc ?? [true, true, true]

  for (const [idx, site] of structure.sites.entries()) {
    // Find edge dimensions and translation directions
    const edge_dims: { dim: number; direction: number }[] = []

    // Find boundary dimensions
    for (let dim = 0; dim < 3; dim++) {
      if (!pbc[dim]) continue
      const coord = site.abc[dim]
      const dim_tolerance = tolerances[dim]
      if (Math.abs(coord) < dim_tolerance) edge_dims.push({ dim, direction: 1 })
      if (Math.abs(coord - 1) < dim_tolerance) edge_dims.push({ dim, direction: -1 })
    }

    // Generate all translation combinations
    for (let mask = 1; mask < 1 << edge_dims.length; mask++) {
      // Track selected translation per dimension. If both +1 and -1 are selected for a dim,
      // the net shift is zero and we skip because it yields no image.
      const selected_shift: Vec3 = [0, 0, 0]
      for (let bit = 0; bit < edge_dims.length; bit++) {
        if (mask & (1 << bit)) {
          const { dim, direction } = edge_dims[bit]
          selected_shift[dim] += direction
        }
      }

      // Early skip if no net shift across any dimension
      if (selected_shift.every((val) => val === 0)) continue

      // Build fractional coordinates by applying the integer translation
      // This ensures the image is a true periodic copy (preserving bond lengths)
      // rather than clamping it to the cell face.
      const img_abc: Vec3 = [
        site.abc[0] + selected_shift[0],
        site.abc[1] + selected_shift[1],
        site.abc[2] + selected_shift[2],
      ]

      // If no dimension actually shifted, continue
      if (
        img_abc[0] === site.abc[0] &&
        img_abc[1] === site.abc[1] &&
        img_abc[2] === site.abc[2]
      )
        continue

      // Compute xyz from img_abc to ensure consistency
      const img_xyz = math.add(
        math.scale(lattice_vecs[0], img_abc[0]),
        math.scale(lattice_vecs[1], img_abc[1]),
        math.scale(lattice_vecs[2], img_abc[2]),
      )

      // Skip zero-displacement images (should not happen, guards against FP edge cases)
      const displacement = math.subtract(img_xyz, site.xyz)
      const displacement_len_sq = displacement.reduce((sum, val) => sum + val * val, 0)
      if (displacement_len_sq < displacement_eps_sq) continue

      image_sites.push([idx, img_xyz, img_abc])
    }
  }

  // Phase 2: polyhedra-completing images (VESTA boundary-mode-like). The face
  // tolerance above only catches atoms within ~0.5 Å of a boundary, but bonds
  // reach a covalent-radii sum further: an anion just beyond a cell face may be
  // needed to complete the coordination shell of a cation near that face, so
  // bonds and coordination polyhedra at cell edges come out truncated without it.
  // Phase 2 adds ONLY such anion images: a candidate must qualify as a polyhedron
  // vertex (a non-metal/metalloid - same condition as is_anion_vertex in
  // polyhedra.ts) and be strictly more electronegative than the anchor atom it
  // bonds to. Everything else - elemental metals, intermetallics (incl. multi
  // metal ones like Al-Fe-Ni where EN differs but no polyhedra exist), equal-EN
  // covalent networks, cation copies - gets no phase-2 images, so the default
  // render stays minimal and grows uniformly from all cell surfaces (the phase-1
  // boundary copies above are the only non-anion atoms outside the cell).
  const site_radii: (number | null)[] = []
  const site_en: (number | null)[] = []
  const site_is_metal: boolean[] = []
  let max_radius = 0
  // Minimum electronegativity among potential anchors: a candidate can only ever
  // complete some cation's shell if it's strictly more electronegative than this
  let min_anchor_en = Infinity
  for (const site of structure.sites) {
    const elem = get_majority_element(site)
    const data = elem === null ? undefined : element_lookup.get(elem)
    const radius = data?.covalent_radius ?? null
    const en = data?.electronegativity ?? null
    site_radii.push(radius)
    site_en.push(en)
    site_is_metal.push(data?.metal === true)
    if (radius !== null && radius > max_radius) max_radius = radius
    if (radius !== null && en !== null && en < min_anchor_en) min_anchor_en = en
  }
  const max_bond_dist = 2 * max_radius + BOND_SLACK
  if (max_bond_dist > BOND_SLACK && min_anchor_en < Infinity) {
    // Perpendicular cell heights: |frac| * height lower-bounds the Cartesian
    // distance along each axis (valid for oblique cells)
    const volume = Math.abs(
      math.dot(lattice_vecs[0], math.cross_3d(lattice_vecs[1], lattice_vecs[2])),
    )
    const heights = [
      volume / Math.hypot(...math.cross_3d(lattice_vecs[1], lattice_vecs[2])),
      volume / Math.hypot(...math.cross_3d(lattice_vecs[0], lattice_vecs[2])),
      volume / Math.hypot(...math.cross_3d(lattice_vecs[0], lattice_vecs[1])),
    ]

    // Anchor set for the bond test: base atoms plus the phase-1 boundary images
    // (corner/edge/face copies). Anchoring on those too matches VESTA - every
    // displayed boundary cation gets its shell completed (e.g. all 8 corner
    // octahedra in rutile, not just the one at the origin).
    const anchor_positions: Vec3[] = structure.sites.map((site) => site.xyz)
    const anchor_radii: (number | null)[] = [...site_radii]
    const anchor_en: (number | null)[] = [...site_en]
    for (const [src_idx, img_xyz] of image_sites) {
      anchor_positions.push(img_xyz)
      anchor_radii.push(site_radii[src_idx])
      anchor_en.push(site_en[src_idx])
    }

    // Spatial grid over anchors for the bond check
    const grid = new Map<string, number[]>()
    const grid_key = (pos: Vec3): string =>
      pos.map((coord) => Math.floor(coord / max_bond_dist)).join(`,`)
    for (const [idx, pos] of anchor_positions.entries()) {
      const key = grid_key(pos)
      const cell = grid.get(key)
      if (cell) cell.push(idx)
      else grid.set(key, [idx])
    }
    // True when the candidate (an anion image) bonds a strictly less
    // electronegative anchor, i.e. completes some cation's coordination shell
    const completes_cation_shell = (pos: Vec3, radius: number, en: number): boolean => {
      const [cx, cy, cz] = pos.map((coord) => Math.floor(coord / max_bond_dist))
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const anchor_idx of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              const anchor_radius = anchor_radii[anchor_idx]
              const anchor_electroneg = anchor_en[anchor_idx]
              if (anchor_radius === null) continue
              if (anchor_electroneg === null || en <= anchor_electroneg) continue
              const dist = math.euclidean_dist(pos, anchor_positions[anchor_idx])
              if (dist > 0.4 && dist <= radius + anchor_radius + BOND_SLACK) return true
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

    for (const [idx, site] of structure.sites.entries()) {
      const radius = site_radii[idx]
      const en = site_en[idx]
      // Skip candidates that could never be a polyhedron vertex: metals (e.g.
      // Fe/Ni in Al-Fe-Ni intermetallics, despite their higher EN) and anything
      // not strictly more electronegative than at least one anchor (covers all
      // sites of elemental/equal-EN structures and all cations)
      if (radius === null || en === null || en <= min_anchor_en) continue
      if (site_is_metal[idx]) continue
      // Per-axis shifts that could land a copy of this atom within bonding reach
      // of the cell: {0} plus +1/-1 when the atom is within max_bond_dist of the
      // respective boundary
      const axis_shifts = [0, 1, 2].map((axis) => {
        if (!pbc[axis]) return [0]
        // + face tolerance: anchors (phase-1 images) can sit slightly outside the cell
        const pad = (max_bond_dist + PHYSICAL_TOLERANCE) / heights[axis]
        const shifts = [0]
        if (site.abc[axis] < pad) shifts.push(1)
        if (site.abc[axis] > 1 - pad) shifts.push(-1)
        return shifts
      })
      for (const shift_a of axis_shifts[0]) {
        for (const shift_b of axis_shifts[1]) {
          for (const shift_c of axis_shifts[2]) {
            if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
            const key = `${idx}|${shift_a},${shift_b},${shift_c}`
            if (seen_images.has(key)) continue
            const img_abc: Vec3 = [
              site.abc[0] + shift_a,
              site.abc[1] + shift_b,
              site.abc[2] + shift_c,
            ]
            const img_xyz = math.add(
              math.scale(lattice_vecs[0], img_abc[0]),
              math.scale(lattice_vecs[1], img_abc[1]),
              math.scale(lattice_vecs[2], img_abc[2]),
            )
            if (!completes_cation_shell(img_xyz, radius, en)) continue
            seen_images.add(key)
            image_sites.push([idx, img_xyz, img_abc])
          }
        }
      }
    }
  }

  return image_sites
}

// Return structure with image atoms added
export function get_pbc_image_sites(
  ...args: Parameters<typeof find_image_atoms>
): ParsedStructure {
  const structure = args[0]

  if (!structure || !structure.sites || structure.sites.length === 0) {
    return structure
  }

  // Check for trajectory data
  const atoms_outside_cell = structure.sites.filter((site) =>
    site.abc.some((coord) => coord < -0.1 || coord > 1.1),
  )

  // Return trajectory data unchanged
  if (atoms_outside_cell.length > structure.sites.length * 0.1) {
    return structure
  }

  // Add image atoms to regular crystal structures
  const image_sites = find_image_atoms(...args)
  const imaged_struct = { ...structure, sites: [...structure.sites] }

  // Add image atoms as new sites using provided (xyz, abc) from find_image_atoms
  for (const [site_idx, img_xyz, img_abc] of image_sites) {
    const orig_site = structure.sites[site_idx]
    imaged_struct.sites.push({
      ...orig_site,
      abc: img_abc,
      xyz: img_xyz,
      properties: { ...orig_site.properties, orig_site_idx: site_idx },
    })
  }

  return imaged_struct
}
