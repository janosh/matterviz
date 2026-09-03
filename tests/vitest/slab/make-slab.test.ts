import { format_num } from '$lib/labels'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  enumerate_terminations,
  interplanar_spacing,
  make_oriented_bulk,
  make_slab,
} from '$lib/slab'
import type { Slab } from '$lib/slab'
// internals are deliberately not re-exported from $lib/slab, so reach for them directly
import { slab_basis_transform } from '$lib/slab/lattice-basis'
import { detect_layers } from '$lib/slab/terminations'
import type { Crystal, Pbc, Site } from '$lib/structure'
import { structure_map } from '$site/structures'
import { describe, expect, test } from 'vitest'
import { make_crystal, make_rocksalt } from '../setup'

// Conventional cubic cells: exact fractional coordinates, so every expectation below can
// be compared against a hand-derived analytic value rather than a stored number.
const FCC_A = 3.615 // Å, copper
const FCC_NN = FCC_A / Math.sqrt(2) // nearest neighbour, also the 1x1 surface mesh side
const ROCKSALT_A = 5.64 // NaCl, two interpenetrating fcc lattices, 8 atoms per cell
const PEROVSKITE_A = 3.905 // cubic SrTiO3, Sr on the corner, Ti body-centred, O on faces
const HCP_A = 3.21 // ideal hcp magnesium
const HCP_C = HCP_A * Math.sqrt(8 / 3)
const HCP_CELL = math.cell_to_lattice_matrix(HCP_A, HCP_A, HCP_C, 90, 90, 120)
// highly oblique triclinic cell, to check nothing silently assumes orthogonal axes
const TRICLINIC_CELL = math.cell_to_lattice_matrix(4.1, 5.3, 6.7, 71, 83, 115)

const site = (element: string, abc: Vec3) => ({ element, abc })
const on_sites = (element: string, positions: Vec3[]) =>
  positions.map((abc) => site(element, abc))

// oxfmt-ignore
const FACE_CENTRES: Vec3[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]

const fcc = (): Crystal => make_crystal(FCC_A, on_sites(`Cu`, FACE_CENTRES))
const rocksalt = (): Crystal => make_rocksalt(ROCKSALT_A)
// the three perovskite O sit on the cube faces, i.e. the fcc face centres bar the origin
const perovskite = (): Crystal =>
  make_crystal(PEROVSKITE_A, [
    site(`Sr`, [0, 0, 0]),
    site(`Ti`, [0.5, 0.5, 0.5]),
    ...on_sites(`O`, FACE_CENTRES.slice(1)),
  ])
const hcp = (): Crystal =>
  make_crystal(HCP_CELL, [site(`Mg`, [1 / 3, 2 / 3, 0.25]), site(`Mg`, [2 / 3, 1 / 3, 0.75])])
const triclinic = (): Crystal =>
  make_crystal(TRICLINIC_CELL, [site(`Si`, [0, 0, 0]), site(`O`, [0.3, 0.15, 0.42])])

// Two layers 3 Å and 7 Å apart in a 10 Å cell. The asymmetry is the point: with equal
// spacings a termination's reported spacings are right even when they are not re-based.
const UNEQUAL_GAPS: [number, number] = [3, 7]
const UNEQUAL_C = UNEQUAL_GAPS[0] + UNEQUAL_GAPS[1]
const unequal_spacings = (): Crystal =>
  make_crystal(math.cell_to_lattice_matrix(4, 4, UNEQUAL_C, 90, 90, 90), [
    site(`Na`, [0, 0, 0]),
    site(`Cl`, [0, 0, UNEQUAL_GAPS[0] / UNEQUAL_C]),
  ])

const normal_coords = (crystal: Crystal, normal: Vec3): number[] =>
  crystal.sites.map((atom) => math.dot(atom.xyz, normal))

// distances between consecutive values once sorted ascending
const sorted_gaps = (values: number[]): number[] => {
  const sorted = [...values].toSorted((left, right) => left - right)
  return sorted.slice(1).map((val, idx) => val - sorted[idx])
}

// oxfmt-ignore
const species_key = (atom: Site): string =>
  atom.species.map(({ element, occu }) => `${element}:${occu}`).toSorted().join(`,`)

// The slab must occupy exactly the height slab_info claims and the rest of the cell must
// be vacuum.
function expect_thickness_and_vacuum(slab: Slab, vacuum: number): void {
  const heights = normal_coords(slab, slab.slab_info.normal)
  const extent = Math.max(...heights) - Math.min(...heights)
  expect(extent).toBeCloseTo(slab.slab_info.slab_thickness, 9)
  expect(math.cell_heights(slab.lattice.matrix)[2] - extent).toBeCloseTo(vacuum, 9)
  expect(slab.lattice.pbc).toEqual([true, true, false])
}

// Worst distance, in Å, by which a slab atom misses the nearest atom of the input crystal
// once the slab is put back on the input lattice. Cleaving translates the whole slab so the
// chosen layer lands on the cell floor, so one rigid shift is allowed — it is fixed by
// matching the first slab atom, and every other atom must then fall on a real atom of the
// infinite input crystal. Only meaningful with reorient_lattice and center_slab off, which
// leave the slab in the input's Cartesian frame.
function worst_lattice_translate_error(crystal: Crystal, slab: Slab): number {
  const cart_to_frac = math.create_cart_to_frac(crystal.lattice.matrix)
  const frac_to_cart = math.create_frac_to_cart(crystal.lattice.matrix)
  const input_keys = crystal.sites.map(species_key)
  // distance to the nearest input atom of the same species, over all periodic images
  const miss = (xyz: Vec3, key: string): number => {
    const frac = cart_to_frac(xyz)
    let best = Infinity
    for (const [idx, atom] of crystal.sites.entries()) {
      if (input_keys[idx] !== key) continue
      const diff = math
        .subtract(frac, cart_to_frac(atom.xyz))
        .map((val) => val - Math.round(val)) as Vec3
      best = Math.min(best, Math.hypot(...frac_to_cart(diff)))
    }
    return best
  }
  const first_key = species_key(slab.sites[0])
  let best_overall = Infinity
  for (const [idx, anchor] of crystal.sites.entries()) {
    if (input_keys[idx] !== first_key) continue
    const shift = math.subtract(slab.sites[0].xyz, anchor.xyz)
    let worst = 0
    for (const atom of slab.sites) {
      worst = Math.max(worst, miss(math.subtract(atom.xyz, shift), species_key(atom)))
      if (worst >= best_overall) break
    }
    best_overall = Math.min(best_overall, worst)
  }
  return best_overall
}

describe(`analytic fcc surfaces`, () => {
  // d(111) = a/sqrt(3), d(100) = a/2, d(110) = a/(2*sqrt(2)) for an fcc lattice with cubic
  // lattice constant a. The conventional cell's own (hkl) plane spacing is 1/|G|; the extra
  // face-centring planes show up as extra layers inside that repeat, so the atomic
  // interlayer spacing is d_hkl / n_layers. The surface meshes are the textbook 1x1 fcc
  // cells and agree to 10 decimals with ASE's fcc111/fcc100/fcc110 for a = 3.615 Å.
  test.each<[Vec3, number, number, [number, number], number]>([
    [[1, 1, 1], FCC_A / Math.sqrt(3), 1, [FCC_NN, FCC_NN], 60],
    [[1, 0, 0], FCC_A / 2, 2, [FCC_NN, FCC_NN], 90],
    [[1, 1, 0], FCC_A / (2 * Math.sqrt(2)), 2, [FCC_NN, FCC_A], 90],
  ])(`fcc (%s) reproduces the analytic spacing and surface cell`, (...row) => {
    const [miller, spacing, n_layers, [short_side, long_side], angle] = row
    const opts = { min_slab_thickness: 8, min_vacuum_thickness: 12 }
    const slab = make_slab(fcc(), miller, opts)
    const { d_hkl, layer_spacings, n_repeats, surface_area } = slab.slab_info
    expect(layer_spacings).toHaveLength(n_layers)
    // every spacing inside one repeat is the same for these close-packed surfaces
    for (const gap of layer_spacings) expect(gap).toBeCloseTo(spacing, 12)
    expect(d_hkl / layer_spacings.length).toBeCloseTo(spacing, 12)

    // in-plane cell of the primitive surface mesh
    const { a: len_a, b: len_b, gamma } = slab.lattice
    expect(Math.min(len_a, len_b)).toBeCloseTo(short_side, 10)
    expect(Math.max(len_a, len_b)).toBeCloseTo(long_side, 10)
    expect(Math.min(gamma, 180 - gamma)).toBeCloseTo(angle, 10)
    const area = short_side * long_side * Math.sin(angle * math.DEG_TO_RAD)
    expect(surface_area).toBeCloseTo(area, 10)
    // one atom per layer once the in-plane cell is primitive
    expect(slab.sites).toHaveLength(n_layers * n_repeats)
  })

  // oxfmt-ignore
  const spacings: [Vec3, number][] = [
    [[1, 1, 1], FCC_A / Math.sqrt(3)], [[1, 0, 0], FCC_A], [[1, 1, 0], FCC_A / Math.sqrt(2)],
    [[3, 1, 1], FCC_A / Math.sqrt(11)], [[2, 2, 0], FCC_A / Math.sqrt(2)], // (220) -> (110)
  ]
  test.each(spacings)(`spacing of cubic (%s) is a/sqrt(h²+k²+l²)`, (miller, expected) => {
    expect(interplanar_spacing(fcc().lattice.matrix, miller)).toBeCloseTo(expected, 12)
    // the oriented cell's own height along c must reproduce it
    expect(make_oriented_bulk(fcc(), miller).d_hkl).toBeCloseTo(expected, 12)
  })
})

describe(`lattice basis`, () => {
  // low index, high index, negative and zero components
  // oxfmt-ignore
  const millers: [Vec3][] = [
    [[1, 0, 0]], [[1, 1, 0]], [[1, 1, 1]], [[3, 1, 1]],
    [[2, -1, 3]], [[0, 0, 1]], [[0, 1, 2]], [[-1, 0, 2]],
  ]
  test.each(millers)(`(%s) transform is unimodular with in-plane rows`, (miller) => {
    const bulk_matrix = fcc().lattice.matrix
    const transform = slab_basis_transform(bulk_matrix, miller)
    expect(transform.flat().every(Number.isInteger)).toBe(true)
    expect(Math.abs(math.det_3x3(transform))).toBeCloseTo(1, 12)
    expect(math.dot(transform[0], miller)).toBe(0)
    expect(math.dot(transform[1], miller)).toBe(0)
    // row 2 crosses exactly one interplanar spacing
    expect(math.dot(transform[2], miller)).toBe(1)
    // right-handed oriented cell, so rebuilding from lattice parameters is safe
    const oriented = math.dot(transform, bulk_matrix)
    expect(math.det_3x3(oriented)).toBeGreaterThan(0)
  })

  // oxfmt-ignore
  const conserving: [string, Crystal, Vec3][] = [
    [`fcc (311)`, fcc(), [3, 1, 1]], [`rocksalt (110)`, rocksalt(), [1, 1, 0]],
    [`perovskite (111)`, perovskite(), [1, 1, 1]], [`hcp (0001)`, hcp(), [0, 0, 1]],
    [`hcp (10-1)`, hcp(), [1, 0, -1]], [`triclinic (211)`, triclinic(), [2, 1, 1]],
  ]
  test.each(conserving)(`%s conserves the atom count`, (_name, crystal, miller) => {
    const bulk = make_oriented_bulk(crystal, miller, { primitive_in_plane: false })
    expect(bulk.crystal.sites).toHaveLength(crystal.sites.length)
    // volume is invariant under a unimodular transform
    expect(bulk.crystal.lattice.volume).toBeCloseTo(crystal.lattice.volume, 8)
    const multiplicity = Math.abs(Math.round(math.det_3x3(bulk.transform)))
    expect(multiplicity).toBe(1)
  })

  // oxfmt-ignore
  const shrink: [Vec3, number][] = [[[1, 1, 1], 4], [[1, 0, 0], 2], [[1, 1, 0], 2]]
  test.each(shrink)(`fcc (%s) in-plane primitive cell shrinks %ix`, (miller, index) => {
    const conventional = make_oriented_bulk(fcc(), miller, { primitive_in_plane: false })
    const primitive = make_oriented_bulk(fcc(), miller, { primitive_in_plane: true })
    expect(primitive.in_plane_index).toBe(index)
    expect(primitive.crystal.sites.length * index).toBe(conventional.crystal.sites.length)
    // c keeps its perpendicular height, only the in-plane cell shrinks
    expect(primitive.d_hkl).toBeCloseTo(conventional.d_hkl, 12)
    const primitive_volume = primitive.crystal.lattice.volume * index
    expect(primitive_volume).toBeCloseTo(conventional.crystal.lattice.volume, 8)
  })

  // oxfmt-ignore
  const invalid: [Vec3, RegExp][] = [
    [[0, 0, 0], /do not define a plane/], [[0.5, 0, 1], /must be integers/],
    [[1, Number.NaN, 0], /must be integers/],
  ]
  test.each(invalid)(`invalid Miller indices %s throw`, (miller, pattern) => {
    expect(() => make_slab(fcc(), miller)).toThrow(pattern)
    expect(() => enumerate_terminations(fcc(), miller)).toThrow(pattern)
    expect(() => interplanar_spacing(fcc().lattice.matrix, miller)).toThrow(pattern)
  })

  // oxfmt-ignore
  const aperiodic_cases: [Pbc, string][] = [
    [[true, true, false], `an existing slab`], [[true, false, false], `a periodic wire`],
    [[false, false, false], `an isolated molecule in a box`],
  ]
  test.each(aperiodic_cases)(`refuses to cut %s (%s)`, (pbc) => {
    // (hkl) planes only exist in a crystal periodic along all three axes. Without this
    // check a slab fed back in reports its vacuum-inclusive box height as d_hkl.
    const base = fcc()
    const aperiodic: Crystal = { ...base, lattice: { ...base.lattice, pbc: [...pbc] } }
    const complaint = /not periodic along all three axes, got pbc/
    expect(() => make_slab(aperiodic, [1, 1, 1])).toThrow(complaint)
    expect(() => make_oriented_bulk(aperiodic, [1, 1, 1])).toThrow(/not periodic/)
    // and the same holds for a real slab, which is how this is hit in practice
    const slab = make_slab(base, [1, 1, 1], { min_slab_thickness: 6 })
    expect(() => make_slab(slab, [0, 0, 1])).toThrow(/not periodic along all three axes/)
  })

  // MAX_SLAB_SITES bounds the OUTPUT, which costs nothing here (a 12-site oriented cell); the
  // 2.4 s is the translation search over the 6912-site INPUT the probe count pins.
  test(`a supercell too large to primitivize is refused before the search runs`, () => {
    const base = fcc()
    const reps = 12
    const sites = Array.from({ length: reps ** 3 }, (_cell, cell_idx) =>
      base.sites.map((cell_site) => ({
        ...cell_site,
        abc: cell_site.abc.map(
          (coord, axis) => (coord + (Math.floor(cell_idx / reps ** axis) % reps)) / reps,
        ) as Vec3,
      })),
    ).flat()
    const matrix = base.lattice.matrix.map((row) => math.scale(row, reps)) as math.Matrix3x3
    const supercell = { ...base, lattice: { ...base.lattice, matrix }, sites } as Crystal
    const started = performance.now()
    expect(() => make_slab(supercell, [1, 1, 1])).toThrow(
      /needs 47775744 probes \(6912 shifts x 6912 sites\).* primitive form/s,
    )
    // refused up front, not after the search it is meant to prevent
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test(`(2,2,0) and (1,1,0) describe the same surface`, () => {
    const reduced = make_slab(fcc(), [1, 1, 0])
    const unreduced = make_slab(fcc(), [2, 2, 0])
    expect(unreduced.slab_info.miller_indices).toEqual([1, 1, 0])
    expect(unreduced.sites).toHaveLength(reduced.sites.length)
    expect(unreduced.slab_info.d_hkl).toBeCloseTo(reduced.slab_info.d_hkl, 12)
  })
})

describe(`slab geometry`, () => {
  // oxfmt-ignore
  const cases: [string, Crystal, Vec3][] = [
    [`fcc (111)`, fcc(), [1, 1, 1]], [`fcc (311)`, fcc(), [3, 1, 1]],
    [`rocksalt (111)`, rocksalt(), [1, 1, 1]], [`perovskite (110)`, perovskite(), [1, 1, 0]],
    [`hcp basal (0001)`, hcp(), [0, 0, 1]], [`triclinic (101)`, triclinic(), [1, 0, 1]],
  ]
  // oxfmt-ignore
  const all_cases: [string, Crystal, Vec3][] = [
    ...cases,
    [`fcc (100)`, fcc(), [1, 0, 0]], [`fcc (110)`, fcc(), [1, 1, 0]],
    [`rocksalt (100)`, rocksalt(), [1, 0, 0]], [`rocksalt (110)`, rocksalt(), [1, 1, 0]],
    [`perovskite (001)`, perovskite(), [0, 0, 1]], [`hcp (10-1)`, hcp(), [1, 0, -1]],
  ]

  // The one test that pins the atom positions to something outside make_slab's own output.
  // Comparing xyz against create_frac_to_cart(abc) cannot fail — make_slab computes xyz
  // that way — whereas this fails on a transposed transform, a mis-sized cleavage shift or
  // a repeat placed at the wrong height.
  test.each(all_cases)(`%s puts every atom on the input lattice`, (_name, crystal, miller) => {
    const opts = { min_slab_thickness: 8, reorient_lattice: false, center_slab: false }
    const slab = make_slab(crystal, miller, opts)
    // pure float round-off: every position is a sum of a handful of lattice vectors
    expect(worst_lattice_translate_error(crystal, slab)).toBeLessThan(1e-11)
  })

  test.each(cases)(`%s hits the requested vacuum and thickness`, (_name, crystal, miller) => {
    const min_slab_thickness = 9
    const min_vacuum_thickness = 13.5
    const opts = { min_slab_thickness, min_vacuum_thickness, center_slab: false }
    const slab = make_slab(crystal, miller, opts)
    expect_thickness_and_vacuum(slab, min_vacuum_thickness)
    const { slab_thickness, d_hkl } = slab.slab_info
    expect(slab_thickness).toBeGreaterThanOrEqual(min_slab_thickness - 1e-9)
    // one fewer repeat would have fallen short of the requested thickness
    expect(slab_thickness - d_hkl).toBeLessThan(min_slab_thickness)
  })

  test.each(cases)(`%s reorients the surface normal to +z`, (_name, crystal, miller) => {
    const slab = make_slab(crystal, miller)
    const [vec_a, vec_b] = slab.lattice.matrix
    // a and b span the surface, so both must lie in the xy plane
    expect(Math.abs(vec_a[2])).toBeLessThan(1e-12)
    expect(Math.abs(vec_b[2])).toBeLessThan(1e-12)
    expect(slab.slab_info.normal).toEqual([0, 0, 1])
    expect(slab.lattice.matrix[2][2]).toBeGreaterThan(0)
    const mesh_area = Math.hypot(...math.cross_3d(vec_a, vec_b))
    expect(slab.slab_info.surface_area).toBeCloseTo(mesh_area, 10)
  })

  test.each(cases)(`%s leaves the vacuum empty when centred`, (_name, crystal, miller) => {
    const slab = make_slab(crystal, miller, { min_vacuum_thickness: 12 })
    const heights = normal_coords(slab, slab.slab_info.normal)
    const cell_height = math.cell_heights(slab.lattice.matrix)[2]
    // centring splits the vacuum evenly above and below the slab
    expect(Math.min(...heights)).toBeCloseTo(6, 9)
    expect(cell_height - Math.max(...heights)).toBeCloseTo(6, 9)
  })

  test(`fractional c is not wrapped, so the slab stays in one piece`, () => {
    // no vacuum at all forces atoms right up to the cell face
    const opts = { min_slab_thickness: 10, min_vacuum_thickness: 0, center_slab: false }
    const slab = make_slab(fcc(), [1, 1, 1], opts)
    const frac_c = slab.sites.map((atom) => atom.abc[2])
    expect(Math.min(...frac_c)).toBeCloseTo(0, 12)
    expect(Math.max(...frac_c)).toBeCloseTo(1, 12)
    // consecutive layers stay a constant spacing apart: nothing folded to the other side
    const steps = sorted_gaps(frac_c)
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 12)
  })

  test(`high-index fcc (3,1,1) gives a valid non-degenerate cell`, () => {
    const slab = make_slab(fcc(), [3, 1, 1], { min_slab_thickness: 6 })
    // (311) is an allowed fcc reflection, so d = a/sqrt(11) with one atom per layer and a
    // primitive mesh area of V_primitive / d = (a³/4)/(a/sqrt(11)) = a²·sqrt(11)/4
    expect(slab.slab_info.d_hkl).toBeCloseTo(FCC_A / Math.sqrt(11), 12)
    expect(slab.slab_info.layer_spacings).toHaveLength(1)
    expect(slab.slab_info.surface_area).toBeCloseTo((FCC_A ** 2 * Math.sqrt(11)) / 4, 10)
    expect(slab.sites).toHaveLength(slab.slab_info.n_repeats)
    // a genuinely oblique surface mesh, not an accidentally rectangular one
    expect(Math.abs(slab.lattice.gamma - 90)).toBeGreaterThan(5)
  })

  test(`hexagonal (0001) keeps the hexagonal surface mesh`, () => {
    const slab = make_slab(hcp(), [0, 0, 1], { min_slab_thickness: 8 })
    const { a: len_a, b: len_b, gamma } = slab.lattice
    // matches ASE's hcp0001 builder: a = b = 3.21 Å, 60° mesh, one atom per layer
    expect(len_a).toBeCloseTo(HCP_A, 10)
    expect(len_b).toBeCloseTo(HCP_A, 10)
    expect(Math.min(gamma, 180 - gamma)).toBeCloseTo(60, 10)
    const mesh_area = HCP_A ** 2 * Math.sin(60 * math.DEG_TO_RAD)
    expect(slab.slab_info.surface_area).toBeCloseTo(mesh_area, 10)
    // basal planes are c/2 apart in hcp
    expect(slab.slab_info.d_hkl).toBeCloseTo(HCP_C, 10)
    expect(slab.slab_info.layer_spacings).toHaveLength(2)
    for (const gap of slab.slab_info.layer_spacings) expect(gap).toBeCloseTo(HCP_C / 2, 10)
    expect(slab.sites).toHaveLength(2 * slab.slab_info.n_repeats)
  })

  test(`hcp (0001) A and B basal planes collapse to one termination`, () => {
    // The two hcp basal layers are not related by a lattice translation but by the 2-fold
    // rotation about the normal followed by one, so they expose the same surface.
    const terminations = enumerate_terminations(hcp(), [0, 0, 1])
    expect(terminations).toHaveLength(1)
    expect(terminations[0].formula).toBe(`Mg`)
    // the merged partner is reported rather than silently dropped
    expect(terminations[0].equivalent_layer_idxs).toEqual([1])
  })

  // Bond lengths are the sharpest test that the stacking registry survived the transform,
  // the primitive in-plane reduction and the vacuum: a misplaced layer shows up as a
  // nearest-neighbour distance that is too short or too long.
  // oxfmt-ignore
  const bonded: [string, Crystal, Vec3, number][] = [
    [`fcc (111)`, fcc(), [1, 1, 1], FCC_NN], [`fcc (100)`, fcc(), [1, 0, 0], FCC_NN],
    [`fcc (311)`, fcc(), [3, 1, 1], FCC_NN], [`hcp (0001)`, hcp(), [0, 0, 1], HCP_A],
    [`rocksalt (110)`, rocksalt(), [1, 1, 0], ROCKSALT_A / 2],
  ]
  test.each(bonded)(`%s keeps the bulk nearest-neighbour distance`, (...row) => {
    const [_name, crystal, miller, expected] = row
    const slab = make_slab(crystal, miller, { min_slab_thickness: 8 })
    const { matrix, pbc } = slab.lattice
    const converters = math.create_lattice_converters(matrix)
    let shortest = Infinity
    for (const [idx, atom] of slab.sites.entries()) {
      for (const other of slab.sites.slice(idx + 1)) {
        const dist = math.pbc_dist(atom.xyz, other.xyz, matrix, converters, pbc)
        if (dist < shortest) shortest = dist
      }
    }
    expect(shortest).toBeCloseTo(expected, 9)
  })

  test(`reorient_lattice=false keeps the bulk Cartesian frame`, () => {
    const miller: Vec3 = [1, 1, 1]
    const slab = make_slab(fcc(), miller, { reorient_lattice: false })
    // normal still points along the (111) reciprocal vector of the input cell
    const plane_normal = math.miller_plane_normal(fcc().lattice.matrix, miller)
    const expected_normal = math.normalize_vec(plane_normal)
    for (const axis of [0, 1, 2]) {
      expect(slab.slab_info.normal[axis]).toBeCloseTo(expected_normal[axis], 12)
    }
    // in-plane vectors are perpendicular to it
    for (const vec of [slab.lattice.matrix[0], slab.lattice.matrix[1]]) {
      expect(math.dot(vec, expected_normal)).toBeCloseTo(0, 10)
    }
    // same cell shape as the reoriented slab, only rotated
    const reoriented = make_slab(fcc(), miller)
    expect(slab.lattice.volume).toBeCloseTo(reoriented.lattice.volume, 9)
    expect(slab.sites).toHaveLength(reoriented.sites.length)
  })

  test(`disordered sites keep their full species list`, () => {
    const na_k: Site[`species`] = [
      { element: `Na`, occu: 0.6, oxidation_state: 1 },
      { element: `K`, occu: 0.4, oxidation_state: 1 },
    ]
    const base = rocksalt()
    const [first, ...rest] = base.sites
    const disordered: Crystal = { ...base, sites: [{ ...first, species: na_k }, ...rest] }
    const slab = make_slab(disordered, [1, 0, 0], { min_slab_thickness: 5 })
    const mixed = slab.sites.filter((atom) => atom.species.length === 2)
    expect(mixed.length).toBeGreaterThan(0)
    const occupancies = mixed[0].species.map(({ element, occu }) => `${element}:${occu}`)
    expect(occupancies).toEqual([`Na:0.6`, `K:0.4`])
    // the partially occupied site is no longer interchangeable with a pure Na site, so the
    // in-plane cell can no longer be reduced as far as in the ordered rocksalt
    const ordered = make_slab(rocksalt(), [1, 0, 0], { min_slab_thickness: 5 })
    expect(slab.sites.length).toBeGreaterThan(ordered.sites.length)
  })

  test(`charge scales with the oriented cell but is dropped from the slab`, () => {
    // A unimodular re-cell holds the same atoms, so it keeps the charge; the in-plane
    // primitive cell holds 1/index of them, so it keeps 1/index of it. A cleaved slab is
    // not charge-neutral by construction, so no bulk-derived number describes it.
    const charged = make_crystal(FCC_A, on_sites(`Cu`, FACE_CENTRES), { charge: -2 })
    const whole = make_oriented_bulk(charged, [1, 1, 1], { primitive_in_plane: false })
    expect(whole.crystal.charge).toBe(-2)
    const primitive = make_oriented_bulk(charged, [1, 1, 1])
    expect(primitive.in_plane_index).toBe(4)
    expect(primitive.crystal.charge).toBeCloseTo(-0.5, 12)
    expect(make_slab(charged, [1, 1, 1]).charge).toBeUndefined()
  })

  test(`termination_idx out of range throws with the available count`, () => {
    const out_of_range = () => make_slab(fcc(), [1, 1, 1], { termination_idx: 5 })
    expect(out_of_range).toThrow(/termination_idx 5 is out of range/)
  })

  test(`slab sites carry no index properties and the slab carries no bonds`, () => {
    // orig_unit_cell_idx and orig_site_idx mean "index into the pre-supercell structure"
    // to the renderer (atom-properties.ts, bonding.ts, Structure.svelte read them
    // unguarded). A slab's sites index a different array — the oriented, possibly
    // in-plane-reduced cell — so stamping either silently mis-colours the whole slab.
    const with_bonds: Crystal = {
      ...rocksalt(),
      properties: { bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }], source: `test` },
    }
    const slab = make_slab(with_bonds, [1, 1, 1], { min_slab_thickness: 6 })
    expect(slab.properties?.bonds).toBeUndefined()
    // unrelated properties survive
    expect(slab.properties?.source).toBe(`test`)
    for (const atom of slab.sites) {
      for (const key of [`orig_unit_cell_idx`, `orig_site_idx`, `repeat_idx`]) {
        expect(atom.properties?.[key]).toBeUndefined()
      }
    }
  })

  test(`layer spacings are re-based at the chosen termination`, () => {
    // Layers 3 Å and 7 Å apart: cleaving at the second layer puts the 7 Å gap at the
    // bottom, so the reported list must be rotated, not the cell's own [3, 7] ordering.
    const crystal = unequal_spacings()
    const opts = { min_slab_thickness: 20, center_slab: false, reorient_lattice: false }
    const built = [0, 1].map((termination_idx) => {
      const slab = make_slab(crystal, [0, 0, 1], { ...opts, termination_idx })
      const heights = normal_coords(slab, slab.slab_info.normal)
      return { spacings: slab.slab_info.layer_spacings, measured: sorted_gaps(heights) }
    })
    // the two terminations must not report the same thing
    expect(built[0].spacings).not.toEqual(built[1].spacings)
    for (const { spacings, measured } of built) {
      expect(spacings).toHaveLength(2)
      for (const [idx, spacing] of spacings.entries()) {
        expect(measured[idx]).toBeCloseTo(spacing, 9)
      }
    }
    const rounded = built.map(({ spacings }) => spacings.map((val) => Math.round(val)))
    expect(rounded).toEqual([UNEQUAL_GAPS, [...UNEQUAL_GAPS].toReversed()])
  })

  test(`atom count scales with the number of repeats`, () => {
    const thin = make_slab(fcc(), [1, 1, 1], { min_slab_thickness: 4 })
    const thick = make_slab(fcc(), [1, 1, 1], { min_slab_thickness: 12 })
    expect(thick.slab_info.n_repeats).toBeGreaterThan(thin.slab_info.n_repeats)
    const per_repeat = thick.sites.length / thick.slab_info.n_repeats
    expect(per_repeat).toBe(thin.sites.length / thin.slab_info.n_repeats)
  })
})

describe(`terminations`, () => {
  test.each<[string, Crystal, Vec3, number]>([
    [`rocksalt (111) alternates Na and Cl planes`, rocksalt(), [1, 1, 1], 2],
    [`perovskite (110) alternates SrTiO and O2 planes`, perovskite(), [1, 1, 0], 2],
    [`perovskite (001) alternates SrO and TiO2 planes`, perovskite(), [0, 0, 1], 2],
    [`fcc (111) has a single termination`, fcc(), [1, 1, 1], 1],
    [`fcc (100) has a single termination`, fcc(), [1, 0, 0], 1],
    [`rocksalt (100) has a single termination`, rocksalt(), [1, 0, 0], 1],
  ])(`%s`, (_name, crystal, miller, expected) => {
    const terminations = enumerate_terminations(crystal, miller)
    expect(terminations).toHaveLength(expected)
    // listed bottom-up, starting from the first layer of the oriented cell
    const layer_idxs = terminations.map((term) => term.layer_idx)
    expect(layer_idxs[0]).toBe(0)
    expect(layer_idxs).toEqual([...layer_idxs].toSorted((left, right) => left - right))
  })

  test(`rocksalt (111) cleaves at the layer its termination names`, () => {
    // formulas themselves are pinned by the `distinct` cases below
    const terminations = enumerate_terminations(rocksalt(), [1, 1, 1])
    for (const [idx, termination] of terminations.entries()) {
      const opts = { termination_idx: idx, min_slab_thickness: 6 }
      const slab = make_slab(rocksalt(), [1, 1, 1], opts)
      const heights = normal_coords(slab, slab.slab_info.normal)
      const lowest = heights.indexOf(Math.min(...heights))
      expect(slab.sites[lowest].species[0].element).toBe(termination.formula)
    }
  })

  test(`layer detection groups sites within the tolerance`, () => {
    const bulk = make_oriented_bulk(rocksalt(), [1, 0, 0])
    const layers = detect_layers(bulk)
    expect(layers).toHaveLength(2)
    // rocksalt (100) planes are mixed NaCl and half a lattice constant apart
    for (const layer of layers) expect(layer.formula).toBe(`NaCl`)
    expect(layers[1].height - layers[0].height).toBeCloseTo(ROCKSALT_A / 2, 10)
    // gaps below each layer sum with the layer thicknesses to the full repeat
    expect(layers[0].gap_below).toBeCloseTo(ROCKSALT_A / 2, 10)
  })

  test(`a loose layer tolerance merges neighbouring planes`, () => {
    const bulk = make_oriented_bulk(rocksalt(), [1, 1, 1])
    expect(detect_layers(bulk, 0.1)).toHaveLength(2)
    // Na and Cl planes are a/(2*sqrt(3)) = 1.63 Å apart, so a 2 Å tolerance fuses them
    expect(detect_layers(bulk, 2)).toHaveLength(1)
  })

  test(`no layer grows past the tolerance by chaining sub-tolerance steps`, () => {
    // 10 planes a hair under the tolerance apart. Comparing each site to its immediate
    // neighbour merges the lot into one 0.81 Å layer — 8x the tolerance that defined it —
    // and turns 10 candidate terminations into 1 with no complaint.
    const [n_planes, spacing, cell_c, layer_tolerance] = [10, 0.09, 20, 0.1]
    const step = spacing / cell_c
    const planes = Array.from({ length: n_planes }, (_val, idx): Vec3 => [0, 0, idx * step])
    const cell = math.cell_to_lattice_matrix(4, 4, cell_c, 90, 90, 90)
    const chained = make_crystal(cell, on_sites(`Cu`, planes))
    const opts = { primitive_in_plane: false, layer_tolerance }
    const bulk = make_oriented_bulk(chained, [0, 0, 1], opts)
    const layers = detect_layers(bulk, layer_tolerance)

    for (const layer of layers) {
      const heights = layer.site_idxs.map((idx) => bulk.crystal.sites[idx].abc[2] * cell_c)
      const spread = Math.max(...heights) - Math.min(...heights)
      expect(spread).toBeLessThanOrEqual(layer_tolerance + 1e-12)
    }
    // pairs, because 0.09 Å really is within the 0.1 Å tolerance — but bounded, not chained
    expect(layers).toHaveLength(n_planes / 2)
    // and the slab reports how knife-edge the split was: the tightest gap is the 0.09 Å
    // step between two paired planes, below the tolerance that separated the pairs
    const slab = make_slab(chained, [0, 0, 1], { ...opts, min_slab_thickness: 5 })
    expect(slab.slab_info.min_layer_gap).toBeCloseTo(spacing, 9)
    expect(slab.slab_info.min_layer_gap).toBeLessThan(2 * layer_tolerance)
  })

  // Single-species stacks whose layers can only be told apart by their in-plane registry:
  // one row per stack, with the equivalent_layer_idxs every surviving termination must
  // report. The lengths of that list of lists are the distinct termination counts.
  // oxfmt-ignore
  const l_shape: Vec3[] = [[0, 0, 0], [0.3, 0, 0], [0, 0.25, 0]]
  // oxfmt-ignore
  const registry: [string, Vec3, Vec3[], number[][]][] = [
    // All four layers expose the same surface, and the translation dedup alone misses half
    // of it: layers 0 and 2 are a lattice translation apart, but 0 and 1 only map onto each
    // other under (x, y, z) -> (-x, -y, z) + (0.3, 0.3, 0.25). The demo showed four
    // indistinguishable "Ac (2.62 Å gap)" options that built congruent slabs.
    [`a 2-fold rotation about the normal merges all four layers`, [4, 4, 12],
      [[0, 0, 0], [0.3, 0.3, 0.25], [0, 0, 0.5], [0.3, 0.3, 0.75]], [[1, 2, 3]]],
    // An L-shaped Cu3 motif has no 2-fold axis, so its mirror image in the layer above
    // (glide-related: reflect x, shift by (a + b + c)/2) is reached by no rotation about
    // the normal.
    [`a mirror through the normal merges the glide-related layers`, [5, 6, 8],
      [...l_shape, [0.5, 0.5, 0.5], [0.2, 0.5, 0.5], [0.5, 0.75, 0.5]], [[1]]],
    // Control: the same L with a longer arm, which no normal-preserving operation reaches.
    [`an L with a longer arm above stays distinct`, [5, 6, 8],
      [...l_shape, [0.5, 0.5, 0.5], [0.9, 0.5, 0.5], [0.5, 0.75, 0.5]], [[], []]],
    // Same species, same gaps, but the in-plane offsets 0, 0.1a, 0.4a are not the orbit of
    // any translation or 2-fold rotation, so cleaving at each layer exposes a different
    // registry of the layers below it. A merge on (formula, gap) alone collapses these.
    [`equal-gap layers at unrelated in-plane offsets stay distinct`, [4, 4, 9],
      [[0, 0, 0], [0.1, 0, 1 / 3], [0.4, 0, 2 / 3]], [[], [], []]],
  ]
  test.each(registry)(`%s`, (_name, [len_a, len_b, len_c], positions, want) => {
    const cell = math.cell_to_lattice_matrix(len_a, len_b, len_c, 90, 90, 90)
    const crystal = make_crystal(cell, on_sites(`Cu`, positions))
    const terminations = enumerate_terminations(crystal, [0, 0, 1], {
      primitive_in_plane: false,
    })
    expect(terminations.map((term) => term.equivalent_layer_idxs)).toEqual(want)
  })

  // oxfmt-ignore
  const distinct: [string, Crystal, Vec3, string[]][] = [
    [`rocksalt (111)`, rocksalt(), [1, 1, 1], [`Cl`, `Na`]],
    [`perovskite (001)`, perovskite(), [0, 0, 1], [`SrO`, `TiO2`]],
  ]
  test.each(distinct)(`%s keeps both chemically distinct terminations`, (...row) => {
    const [_name, crystal, miller, want] = row
    // The merge must not be so eager that it collapses genuinely different surfaces:
    // both of these are alternating AB stacks with equal gaps, so only the composition
    // ordering tells them apart.
    const terminations = enumerate_terminations(crystal, miller)
    expect(terminations.map((term) => term.formula).toSorted()).toEqual(want)
    for (const termination of terminations) {
      expect(termination.equivalent_layer_idxs).toEqual([])
    }
  })
})

// Slab invariants on real structure files: oblique, low-symmetry, disordered and
// multi-element cells that hand-built cubic fixtures do not cover.
// wrapped in single-element tuples so test.each passes each triple as one argument
const MILLER_SET: [Vec3][] = [[[0, 0, 1]], [[1, 1, 0]], [[1, 1, 1]], [[2, 1, 0]]]

// id, why it is interesting
// oxfmt-ignore
const FIXTURES: [string, string][] = [
  [`mp-2`, `cubic fcc Pd`], [`mp-1`, `bcc Cs`], [`mp-1234`, `binary Lu-Al, 24 sites`],
  [`mp-862690-Ac4-hexagonal`, `hexagonal`],
  [`mp-1207297-Ac2Br2O1-tetragonal`, `tetragonal ternary`],
  [`mp-1183089-Ac4Mg2-monoclinic`, `monoclinic`],
  [`TlBiSe2-highly-oblique-cell`, `highly oblique cell`],
  [`Bi2Zr2O8-Fm3m`, `partial occupancies`],
]

// Heights of the slab's atomic layers along the surface normal, bottom-up. Grouped the way
// detect_layers does it — against the layer's lowest member, so a layer never spans more
// than the tolerance — which is what makes the comparison against the reported spacings a
// measurement rather than a restatement.
const measured_layer_heights = (heights: number[]): number[] => {
  const layer_tolerance = 0.1 // SLAB_LAYER_TOLERANCE, the default make_slab ran with
  const sorted = [...heights].toSorted((left, right) => left - right)
  const starts = [sorted[0]]
  for (const height of sorted) {
    if (height - starts[starts.length - 1] > layer_tolerance) starts.push(height)
  }
  return starts
}

describe.each(FIXTURES)(`%s (%s)`, (id, _why) => {
  test.each(MILLER_SET)(`(%s) slab and terminations hold up`, (miller) => {
    const crystal = structure_map.get(id)
    if (!crystal) throw new Error(`fixture ${id} not found in $site/structures`)
    const min_vacuum_thickness = 11
    // at least two repeats, so the reported one-repeat spacings can be compared against
    // real gaps that include the wrap from the top of one repeat to the bottom of the next
    const min_slab_thickness = 2.2 * interplanar_spacing(crystal.lattice.matrix, miller)
    const terminations = enumerate_terminations(crystal, miller)
    expect(terminations.length).toBeGreaterThan(0)
    // the last termination, not the first: cleaving at layer 0 rotates the layer stack by
    // nothing, so it cannot tell a re-based spacing list from an un-rebased one
    const slab = make_slab(crystal, miller, {
      min_slab_thickness,
      min_vacuum_thickness,
      center_slab: false,
      termination_idx: terminations.length - 1,
    })
    const { d_hkl, n_repeats, layer_spacings, normal } = slab.slab_info
    expect(n_repeats).toBeGreaterThanOrEqual(2)
    expect(math.det_3x3(slab.lattice.matrix)).toBeGreaterThan(0)
    expect_thickness_and_vacuum(slab, min_vacuum_thickness)

    // Reported spacings must be the gaps actually present in the built slab, read up from
    // the cleaved face. Sums-to-d_hkl holds identically by construction and so proves
    // nothing; these are measured off the atom positions.
    const layer_heights = measured_layer_heights(normal_coords(slab, normal))
    const measured_gaps = layer_heights
      .slice(1, layer_spacings.length + 1)
      .map((height, idx) => height - layer_heights[idx])
    expect(measured_gaps).toHaveLength(layer_spacings.length)
    for (const [idx, spacing] of layer_spacings.entries()) {
      expect(measured_gaps[idx]).toBeCloseTo(spacing, 9)
    }
    // one repeat of the layer stack spans exactly the interplanar spacing
    expect(layer_spacings.reduce((sum, val) => sum + val, 0)).toBeCloseTo(d_hkl, 9)

    // Fingerprint of the cleaved face over the first full interplanar spacing: every pair
    // of atoms in that slice by species, depths and minimum-image distance. Depths alone
    // would not do — an ABAC stack shows the same depth profile from A and from B while
    // exposing different surfaces — but pair distances are invariant under exactly the
    // normal-preserving isometries that make two terminations the same surface. Two
    // terminations sharing one are duplicate entries in the picker.
    const surfaces = terminations.map((_termination, termination_idx) => {
      const cleaved = make_slab(crystal, miller, {
        termination_idx,
        min_slab_thickness: 4,
        center_slab: false,
        reorient_lattice: false,
      })
      const { matrix, pbc } = cleaved.lattice
      const converters = math.create_lattice_converters(matrix)
      const depths = normal_coords(cleaved, cleaved.slab_info.normal)
      const floor = Math.min(...depths)
      const slice = cleaved.sites
        .map((atom, idx) => ({ atom, depth: depths[idx] - floor }))
        .filter(({ depth }) => depth < cleaved.slab_info.d_hkl - 1e-6)
        .map(({ atom, depth }) => ({
          atom,
          tag: `${species_key(atom)}@${format_num(depth, `.4f`)}`,
        }))
      return slice
        .flatMap((first, idx) =>
          slice.slice(idx + 1).map((second) => {
            const dist = math.pbc_dist(
              first.atom.xyz,
              second.atom.xyz,
              matrix,
              converters,
              pbc,
            )
            return `${[first.tag, second.tag].toSorted().join(`-`)}:${format_num(dist, `.3f`)}`
          }),
        )
        .toSorted()
        .join(`|`)
    })
    expect(new Set(surfaces).size).toBe(terminations.length)
  })
})
