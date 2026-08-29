import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { create_frac_to_cart, euclidean_dist } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { find_image_atoms, get_pbc_image_sites, wrap_to_unit_cell } from '$lib/structure'
import { electroneg_ratio, get_majority_element } from '$lib/structure/bonding'
import { parse_structure_file } from '$lib/structure/parse'
import { open_trajectory } from '$lib/trajectory/open'
import { structure_map } from '$site/structures'
import lifemn_cif from '$site/structures/Li4Fe3Mn1(PO4)4.cif?raw'
import nacl_poscar from '$site/structures/NaCl-cubic.poscar?raw'
import quartz_cif from '$site/structures/quartz-alpha.cif?raw'
import extended_xyz_quartz from '$site/structures/quartz.extxyz?raw'
import { describe, expect, test } from 'vitest'
import { make_crystal } from '../setup'

const mp_1_struct = structure_map.get(`mp-1`) as Crystal
const mp_2_struct = structure_map.get(`mp-2`) as Crystal
const mp_1204603_struct = structure_map.get(`mp-1204603`) as Crystal
const tl_bi_se2_struct = structure_map.get(`TlBiSe2-highly-oblique-cell`) as Crystal

// Helpers to reduce duplication while preserving coverage
function assert_xyz_matches_lattice(
  lattice_matrix: Matrix3x3,
  frac: Vec3,
  xyz: Vec3,
  digits: number = 10,
) {
  const frac_to_cart = create_frac_to_cart(lattice_matrix)
  const expected = frac_to_cart(frac)
  for (let dim = 0; dim < 3; dim++) {
    expect(xyz[dim]).toBeCloseTo(expected[dim], digits)
  }
}

function assert_integer_translation(
  orig_abc: Vec3,
  image_abc: Vec3,
  tol: number = 1e-8,
  require_nonzero: boolean = true,
) {
  for (let dim = 0; dim < 3; dim++) {
    const frac_diff = image_abc[dim] - orig_abc[dim]
    const int_diff = Math.round(frac_diff)
    expect(Math.abs(frac_diff - int_diff)).toBeLessThan(tol)
  }
  if (require_nonzero) {
    const has_translation = [0, 1, 2].some((dim) => {
      const frac_diff = image_abc[dim] - orig_abc[dim]
      return Math.abs(Math.round(frac_diff)) > 0
    })
    expect(has_translation).toBe(true)
  }
}

function validate_image_tuples(
  structure: Crystal,
  image_atoms: [number, Vec3, Vec3, boolean?][],
  opts?: { min_dist?: number; tol?: number },
): void {
  const { min_dist = 0.01, tol = 1e-8 } = opts ?? {}
  for (const [orig_idx, image_xyz, image_abc] of image_atoms) {
    expect(orig_idx).toBeGreaterThanOrEqual(0)
    expect(orig_idx).toBeLessThan(structure.sites.length)
    expect(image_xyz.every((coord) => Number.isFinite(coord))).toBe(true)
    expect(image_abc.every((coord) => Number.isFinite(coord))).toBe(true)

    const orig_xyz = structure.sites[orig_idx].xyz
    const distance = euclidean_dist(orig_xyz, image_xyz)
    expect(distance).toBeGreaterThan(min_dist)

    const orig_abc = structure.sites[orig_idx].abc
    assert_integer_translation(orig_abc, image_abc, tol)
    assert_xyz_matches_lattice(structure.lattice.matrix, image_abc, image_xyz, 10)
  }
}

test(`find_image_atoms adds bond-completing images beyond the face tolerance`, () => {
  // Ag at 0.2 Å inside the low-x face; its I neighbor sits 2.5 Å inside the
  // high-x face (far beyond the 0.5 Å face tolerance) but its periodic image at
  // x=-2.5 is 3.0 Å from Ag - within Ag+I covalent radii + slack, so phase 2
  // must generate that image to complete the bond across the boundary
  const structure = make_crystal(10, [
    [`Ag`, [0.02, 0.5, 0.5]],
    [`I`, [0.75, 0.5, 0.5]],
  ])

  const image_atoms = find_image_atoms(structure)
  // the I image shifted by (-1, 0, 0) lands at x=-2.5, 3.0 Å from Ag
  const completing = image_atoms.find(
    ([site_idx, img_xyz]) => site_idx === 1 && euclidean_dist(img_xyz, [-2.5, 5, 5]) < 1e-6,
  )
  expect(completing).toBeDefined()
  // phase-2 (bond-completing) images carry the is_completion marker…
  expect(completing?.[3]).toBe(true)
  // …while phase-1 boundary images do not (Ag at x=0.02 is within face tolerance)
  const boundary = image_atoms.filter(([site_idx]) => site_idx === 0)
  expect(boundary.length).toBeGreaterThan(0)
  expect(boundary.every((img) => img[3] === undefined)).toBe(true)
  // get_pbc_image_sites propagates the marker onto site properties
  const imaged = get_pbc_image_sites(structure)
  const completion_sites = imaged.sites.filter((site) => site.properties?.completion_image)
  expect(completion_sites.length).toBeGreaterThan(0)
  expect(completion_sites.every((site) => site.species[0].element === `I`)).toBe(true)
  // original (non-image) sites never carry the marker
  expect(
    imaged.sites
      .slice(0, structure.sites.length)
      .every((site) => !site.properties?.completion_image),
  ).toBe(true)

  // an isolated atom pair too far apart to bond must NOT generate phase-2 images
  const unbonded = make_crystal(10, [
    [`Ag`, [0.05, 0.5, 0.5]],
    [`I`, [0.55, 0.5, 0.5]],
  ])
  // I image at (-4.5, 5, 5) would be 5 Å from Ag - beyond bonding distance
  const unbonded_images = find_image_atoms(unbonded).filter(([idx]) => idx === 1)
  expect(unbonded_images).toHaveLength(0)

  // Completion is symmetric in the two ends of a bond: whichever atom is missing gets
  // the image, cation or anion. An earlier anion-only rule left the other end short -
  // rocksalt drew 6 bonds on Na but only 4 on Cl - and skipped elemental and equal-EN
  // structures outright, so diamond corners drew a single bond.
  const metal_in_compound = make_crystal(10, [
    [`Ti`, [0.05, 0.5, 0.5]],
    [`Ti`, [0.75, 0.5, 0.5]], // image at x=-2.5 is 3.0 Å from first Ti
    [`O`, [0.8, 0.5, 0.5]], // image at x=-2 is 2.5 Å from first Ti
  ])
  const compound_images = find_image_atoms(metal_in_compound)
  // both the cation and the anion copy appear, each completing a bond it participates in
  expect(compound_images.filter(([idx]) => idx === 1)).toHaveLength(1)
  expect(compound_images.filter(([idx]) => idx === 2)).toHaveLength(1)

  // pure metals and intermetallics get completion images too - their homoatomic
  // contacts are the bonding network, so leaving them out truncated fcc metals
  // (Cu/Al/Ag/Pb rendered CN 8 or, for Al, nothing at all)
  for (const elements of [
    [`Cu`, `Cu`],
    [`Al`, `Fe`],
  ]) {
    const metal = make_crystal(10, [
      [elements[0], [0.05, 0.5, 0.5]],
      [elements[1], [0.8, 0.5, 0.5]],
    ])
    // the second atom's image at x=-2 is 2.5 Å from the first, within bonding range
    expect(find_image_atoms(metal).filter(([idx]) => idx === 1)).toHaveLength(1)
  }

  // Completion measures metal-metal contacts the way the bond detector does, against the
  // metallic radii (expected_bond_length). Cs-Cs at 5.63 Å is 1.06x the metallic sum and
  // bonds, but lies past the covalent sum + slack (4.88 + 0.7), which used to leave the
  // corner Cs of a bcc cell with fewer than its 8 body-center neighbours
  const stretched_cs = get_pbc_image_sites(
    make_crystal(6.5, [
      [`Cs`, [0, 0, 0]],
      [`Cs`, [0.5, 0.5, 0.5]],
    ]),
  )
  const corner_bonds = electroneg_ratio(stretched_cs).filter(
    ({ site_idx_1, site_idx_2 }) => site_idx_1 === 0 || site_idx_2 === 0,
  )
  expect(corner_bonds).toHaveLength(8)
  for (const { bond_length } of corner_bonds) expect(bond_length).toBeCloseTo(5.629, 3)
})

test(`phase-2 doesn't float framework cation-formers beyond the cell to complete spectator shells`, () => {
  // Regression (Li4Fe3Mn1(PO4)4): spectator Li sits at every cell corner/edge. The
  // composition has framework cations (Fe/Mn/P) so Li renders no polyhedron - yet
  // before the fix phase-2 still pulled P (and its O) periodic images ~2 Å (0.42
  // fractional on the short 4.74 Å c-axis) beyond the face to "complete" the
  // never-drawn Li shells, floating whole PO4 groups outside the cell. The spectator
  // skip is what fixes that: Li is neither a completion candidate nor an anchor, so
  // nothing is pulled out to serve it. Completion is otherwise symmetric, so Fe/Mn/P
  // copies are expected here - each completes a bond that is actually drawn.
  const structure = parse_structure_file(lifemn_cif, `Li4Fe3Mn1(PO4)4.cif`) as Crystal
  const completion = find_image_atoms(structure).filter(
    ([, , , is_completion]) => is_completion,
  )
  expect(completion.length).toBeGreaterThan(0)
  expect(completion.length).toBeLessThanOrEqual(40) // was 74 under the buggy rule
  const { matrix } = structure.lattice
  const axis_lengths = matrix.map((vec) => Math.hypot(...vec))
  for (const [src_idx, , img_abc] of completion) {
    // no spectator (Li) copies: those were the ones with no shell to complete
    expect(get_majority_element(structure.sites[src_idx])).not.toBe(`Li`)
    // a bond-completing image sits at most one bond length outside the cell; anything
    // beyond that is second-shell stacking on another image rather than a real bond
    for (const [axis, coord] of img_abc.entries()) {
      const overhang_ang = Math.max(0, -coord, coord - 1) * axis_lengths[axis]
      expect(overhang_ang).toBeLessThan(3.5)
    }
  }
})

test(`find_image_atoms handles a degenerate (zero-volume) lattice without NaN`, () => {
  // two parallel lattice vectors -> zero volume; perpendicular heights are
  // ill-defined and naively divide by zero, which must not crash or yield NaN
  const degenerate_matrix: Matrix3x3 = [
    [10, 0, 0],
    [10, 0, 0], // parallel to the first vector
    [0, 0, 10],
  ]
  const degenerate = make_crystal(degenerate_matrix, [
    [`Na`, [0.05, 0.5, 0.1]],
    [`Cl`, [0.5, 0.5, 0.6]],
  ])

  const images = find_image_atoms(degenerate)
  // must terminate and produce only finite coordinates (no NaN/Infinity)
  for (const [, img_xyz] of images) {
    for (const coord of img_xyz) expect(Number.isFinite(coord)).toBe(true)
  }
})

const normal_cell_extxyz = `8
Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" Properties=species:S:1:pos:R:3 pbc="T T T"
Cl       0.0       0.0       0.0
Cl       2.5       0.0       2.5
Cl       0.0       2.5       2.5
Cl       2.5       2.5       0.0
Cl       2.5       0.0       0.0
Cl       0.0       0.0       2.5
Cl       0.0       2.5       0.0
Cl       2.5       2.5       2.5`

const trajectory_like_extxyz = `8
Lattice="15.0 0.0 0.0 0.0 15.0 0.0 0.0 0.0 15.0" Properties=species:S:1:pos:R:3 pbc="T T T"
C         1.0       1.0       1.0
C         9.0       1.0       9.0
C         1.0       9.0       9.0
C         9.0       9.0       1.0
C         8.0       2.0       2.0
C        16.0       2.0      16.0
C         2.0      17.0      17.0
C        -2.0      10.0      12.0`

// Trajectory heuristic through a real parse (the synthetic threshold cases live in the
// `trajectory detection threshold` test below)
test.each([
  // Atoms sit within the unit cell, so this is treated as a normal crystal and generates
  // image atoms near cell boundaries. Few/no atoms read as outside the [-0.1, 1.1] margin,
  // i.e. below the 10% trajectory-detection threshold.
  { name: `normal cell`, content: normal_cell_extxyz, expect_images: true, max_outside: 0.1 },
  // Detected as trajectory data → no image atoms, structure returned unchanged. abc coords
  // are wrapped into the cell on parse, so none read as outside the [-0.1, 1.1] margin (the
  // raw cartesian positions extend past the 15 Å box, which is what flags trajectory).
  {
    name: `trajectory-like cell`,
    content: trajectory_like_extxyz,
    expect_images: false,
    max_outside: 0,
  },
])(`find_image_atoms on a parsed $name`, async ({ content, expect_images, max_outside }) => {
  const run = await open_trajectory(content, { filename: `test.xyz` })
  const structure = run.preview.structure as Crystal
  run.dispose()
  if (!structure.lattice) throw new Error(`Structure should have lattice`)

  const images = find_image_atoms(structure)
  const imaged_sites = get_pbc_image_sites(structure).sites
  if (expect_images) {
    expect(images.length).toBeGreaterThan(0)
    expect(imaged_sites.length).toBeGreaterThan(structure.sites.length)
  } else {
    expect(images).toHaveLength(0)
    expect(imaged_sites).toHaveLength(structure.sites.length)
  }

  const atoms_outside = structure.sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1),
  )
  expect(atoms_outside.length).toBeLessThanOrEqual(structure.sites.length * max_outside)
})

// In-cell atoms sit within face tolerance, so only the trajectory heuristic can suppress images
test.each([
  [`exactly 10% atoms outside does NOT skip image generation`, 1, false],
  [`more than 10% atoms outside SKIPS image generation`, 2, true],
])(`trajectory detection threshold: %s`, (_desc, outside_atoms, expect_skip) => {
  const structure = make_crystal(
    5,
    Array.from({ length: 10 }, (_, idx) => ({
      element: `C`,
      abc: idx < outside_atoms ? [1.2, 0.5, 0.5] : [0.02, 0.5, 0.5],
    })),
  )

  const images = find_image_atoms(structure)
  expect(images.length === 0).toBe(expect_skip)
  expect(get_pbc_image_sites(structure).sites.length > structure.sites.length).toBe(
    !expect_skip,
  )
})

// Cubic lattices can't distinguish L*frac from L^T*frac, so the non-orthogonal cells (L != L^T)
// catch wrong-convention bugs. The last one is built from cell params rather than hand-written,
// so it also covers the a/b/c/alpha/beta/gamma -> matrix convention feeding image generation.
// oxfmt-ignore
const lattices: { name: string; lattice: Matrix3x3 }[] = [
  { name: `cubic`, lattice: [[5, 0, 0], [0, 5, 0], [0, 0, 5]] },
  { name: `orthorhombic`, lattice: [[4, 0, 0], [0, 6, 0], [0, 0, 8]] },
  { name: `monoclinic`, lattice: [[5, 0, 0], [0, 6, 0], [2, 0, 7]] },
  { name: `hexagonal`, lattice: [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]] },
  { name: `triclinic`, lattice: [[5, 0, 0], [2.5, 4.33, 0], [1, 1, 4]] },
  { name: `triclinic from cell params`, lattice: math.cell_to_lattice_matrix(4, 5, 6, 75, 85, 65) },
]

// Corner (0,0,0) and face (1,0.5,0) atoms image, the cell-center atom does not; every image is
// an integer translation of its source with xyz = L^T abc, and get_pbc_image_sites carries the
// tuples over 1:1 (abc preserved, not re-derived).
test.each(lattices)(
  `corner/face/center images stay lattice-consistent ($name)`,
  ({ lattice }) => {
    const structure = make_crystal(lattice, [
      [`Na`, [0, 0, 0]],
      [`Cl`, [1.0, 0.5, 0]],
      [`Na`, [0.5, 0.5, 0.5]],
    ])
    const frac_to_cart = create_frac_to_cart(lattice)
    const image_atoms = find_image_atoms(structure)
    validate_image_tuples(structure, image_atoms)

    // the corner atom has replicas in every +a/+b/+c combination; the center atom is beyond the
    // face tolerance so gets no boundary images (bond-completing ones are allowed)
    const corner_xyz = image_atoms.filter(([idx]) => idx === 0).map(([, xyz]) => xyz)
    for (const shift of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]) {
      const expected = frac_to_cart(shift as Vec3)
      expect(corner_xyz.some((xyz) => euclidean_dist(xyz, expected) < 1e-8)).toBe(true)
    }
    expect(
      image_atoms.filter(([idx, , , is_completion]) => idx === 2 && !is_completion),
    ).toHaveLength(0)

    // the face atom at a=1 wraps to exactly a=0 (snapped, not 1e-16 noise) keeping b and c
    const wrapped = image_atoms.find(([idx, , abc]) => idx === 1 && Math.abs(abc[0]) < 1e-8)
    if (!wrapped) throw new Error(`no wrapped a-face image found`)
    expect(wrapped[2][0]).toBe(0)
    expect(wrapped[2][1]).toBeCloseTo(0.5, 12)
    expect(wrapped[2][2]).toBeCloseTo(0, 12)

    const image_sites = get_pbc_image_sites(structure).sites.slice(structure.sites.length)
    expect(image_sites).toHaveLength(image_atoms.length)
    for (const [idx, [, expected_xyz, expected_abc]] of image_atoms.entries()) {
      for (let dim = 0; dim < 3; dim++) {
        expect(image_sites[idx].xyz[dim]).toBeCloseTo(expected_xyz[dim], 10)
        expect(image_sites[idx].abc[dim]).toBeCloseTo(expected_abc[dim], 10)
      }
    }
  },
)

// The face tolerance is 0.5 Å, i.e. 0.1 fractional in this 5 Å cell, and the check is a strict
// `|coord| < tol`, so a coordinate sitting exactly at the tolerance generates nothing. Face rows
// ([x, 0.5, 0.5]) touch one face; corner rows ([x, 0, 0]) also touch y=0 and z=0, so they yield
// several images — the cap of 26 (all 3³-1 neighbour cells) catches runaway generation.
test.each([
  { abc: [0.0999999, 0.5, 0.5], images: [1, 26], desc: `|coord| < tol` },
  { abc: [0.1, 0.5, 0.5], images: [0, 0], desc: `|coord| == tol` },
  { abc: [0.1000001, 0.5, 0.5], images: [0, 0], desc: `|coord| > tol` },
  { abc: [0.005, 0, 0], images: [1, 26], desc: `corner atom near the origin` },
  { abc: [0.08, 0, 0], images: [1, 26], desc: `corner atom just inside the tolerance` },
] as { abc: Vec3; images: [number, number]; desc: string }[])(
  `face tolerance boundary behavior: $desc`,
  ({ abc, images: [min_images, max_images] }) => {
    const image_atoms = find_image_atoms(make_crystal(5, [[`Na`, abc]]))
    expect(image_atoms.length).toBeGreaterThanOrEqual(min_images)
    expect(image_atoms.length).toBeLessThanOrEqual(max_images)
  },
)

test(`get_pbc_image_sites preserves explicit periodic bond metadata`, () => {
  // both atoms within the 0.5 Å face tolerance of the x faces
  const structure = make_crystal(10, [
    [`C`, [0.96, 0.5, 0.5]],
    [`O`, [0.04, 0.5, 0.5]],
  ])
  structure.properties = {
    bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
  }

  const with_images = get_pbc_image_sites(structure)

  expect(with_images.sites).toHaveLength(4)
  expect(with_images.properties?.bonds).toEqual([
    { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
  ])
})

// Comprehensive tests for find_image_atoms with real structure files
test.each([
  {
    content: mp_1_struct,
    filename: `mp-1.json`,
    expected_min_images: 7, // Based on actual test output: 10 images found, atom at (0,0,0) creates 7 images
    expected_max_images: 40,
    description: `Two Cs atoms, one at (0,0,0), one at (0.5,0.5,0.5)`,
  },
  {
    content: mp_2_struct,
    filename: `mp-2.json`,
    expected_min_images: 10, // Based on actual test output: 13 images found
    // fcc Pd: every atom is a surface atom in a 4-site cell, and phase 2 now completes
    // metal shells too (without them fcc metals rendered CN 8 instead of 12)
    expected_max_images: 70,
    description: `Four Pd atoms in FCC structure`,
  },
  {
    content: nacl_poscar,
    filename: `NaCl-cubic.poscar`,
    expected_min_images: 19,
    // phase 2 also completes shells of boundary-image copies, and reaches Na-Na contacts
    // (4.02 A) against the metallic radii; every image still carries a drawn Na-Cl bond
    expected_max_images: 100,
    description: `8 atoms (4 Na + 4 Cl) in cubic structure`,
  },
  {
    content: quartz_cif,
    filename: `quartz-alpha.cif`,
    expected_min_images: 3, // Based on actual test output: 5 images found
    expected_max_images: 20,
    description: `Si and O atoms with some near cell edges`,
  },
  {
    content: extended_xyz_quartz,
    filename: `quartz.extxyz`,
    expected_min_images: 0,
    expected_max_images: 20,
    min_dist: 1e-4,
    tol: 1e-4,
    description: `Quartz structure from extended XYZ format`,
  },
])(
  `find_image_atoms with real structures: $description`,
  ({ content, filename, expected_min_images, expected_max_images, min_dist, tol }) => {
    // Parse the structure
    let structure: Crystal
    if (filename.endsWith(`.json`)) structure = content as Crystal
    else {
      const parsed = parse_structure_file(content as string, filename)
      if (!(`lattice` in parsed)) throw new Error(`no lattice found in ${filename}`)
      structure = parsed
    }

    // Test find_image_atoms
    const image_atoms = find_image_atoms(structure)

    // Check expected count range (allow some flexibility for different interpretations)
    expect(image_atoms.length).toBeGreaterThanOrEqual(expected_min_images)
    expect(image_atoms.length).toBeLessThanOrEqual(expected_max_images)

    // Validate all image atoms
    validate_image_tuples(structure, image_atoms, { min_dist, tol })

    // Test get_pbc_image_sites
    const symmetrized = get_pbc_image_sites(structure)
    // When deduplication removes coincident images, symmetrized may contain fewer than tuple count
    expect(symmetrized.sites.length).toBeGreaterThanOrEqual(structure.sites.length)
    expect(symmetrized.sites.length).toBeLessThanOrEqual(
      structure.sites.length + image_atoms.length,
    )

    // Verify no duplicate sites (coincident positions within tolerance)
    const duplicate_pairs = symmetrized.sites.flatMap((site_1, idx_1) =>
      symmetrized.sites
        .slice(idx_1 + 1)
        .filter((site_2) => euclidean_dist(site_1.xyz, site_2.xyz) < 1e-10),
    )
    expect(duplicate_pairs).toHaveLength(0)
  },
)

// Regression test: highly oblique cells must still yield well-defined image atoms and sites
test.each([
  [`TlBiSe2 highly oblique cell`, tl_bi_se2_struct],
  [`mp-1204603 large oblique cell`, mp_1204603_struct],
])(`image atoms and sites stay valid for %s`, (_name, structure) => {
  const image_atoms = find_image_atoms(structure)
  expect(image_atoms.length).toBeGreaterThan(0)

  // Fractional coords are finite but deliberately NOT forced inside [0, 1]: for
  // visualization/bonding we want images at their true periodic positions (possibly
  // outside the cell), only reachable from the original by integer translations.
  for (const [orig_idx, __, img_abc] of image_atoms) {
    expect(img_abc.every((coord) => Number.isFinite(coord))).toBe(true)
    assert_integer_translation(structure.sites[orig_idx].abc, img_abc, 1e-8)
  }

  // Slice out just the image sites appended at the end; deduplication may drop coincident ones
  const image_sites = get_pbc_image_sites(structure).sites.slice(structure.sites.length)
  expect(image_sites.length).toBeLessThanOrEqual(image_atoms.length)
  for (const site of image_sites) {
    assert_xyz_matches_lattice(structure.lattice.matrix, site.abc, site.xyz, 9)
  }
})

// Regression test for large unit cells (e.g. MOFs) using physical tolerance
test(`find_image_atoms uses physical tolerance for large cells`, () => {
  const structure = make_crystal(100, [
    [`C`, [0.04, 0.5, 0.5]], // 4 Angstroms from edge (0.04 * 100)
    [`H`, [0.001, 0.5, 0.5]], // 0.1 Angstroms from edge (0.001 * 100)
  ])

  // Default behavior: physical tolerance (~0.5 Angstroms)
  // C1 at 4A should NOT image (too far)
  // H1 at 0.1A SHOULD image (close enough)
  const image_atoms = find_image_atoms(structure)

  const c_images = image_atoms.filter(([idx]) => idx === 0)
  const h_images = image_atoms.filter(([idx]) => idx === 1)

  expect(c_images).toHaveLength(0)
  expect(h_images.length).toBeGreaterThan(0)
})

describe(`wrap_to_unit_cell`, () => {
  test.each([
    { input: [0.25, 0.75, 0.1], expected: [0.25, 0.75, 0.1], desc: `in-range unchanged` },
    { input: [1.3, 2.7, 3.1], expected: [0.3, 0.7, 0.1], desc: `> 1 wraps down` },
    { input: [-0.3, -0.8, -0.1], expected: [0.7, 0.2, 0.9], desc: `< 0 wraps up` },
    { input: [5.8, -10.7, 100.9], expected: [0.8, 0.3, 0.9], desc: `large values wrap` },
    { input: [1.0, -2.0, 0.0], expected: [0.0, 0.0, 0.0], desc: `exact ints -> 0` },
    // values within epsilon of 1 snap to 0 to suppress floating-point noise
    {
      input: [1.0 - 1e-12, 1 - 1e-15, 1e-15],
      expected: [0.0, 0.0, 0.0],
      desc: `all dims ~ 1 (or ~ 0) snap to 0`,
    },
    { input: [0.9999999999, 0.5, 0.5], expected: [0.0, 0.5, 0.5], desc: `x ~ 1 snaps to 0` },
    {
      input: [1.0 - 1e-12, 1.0 - 1e-11, 1.0 - 1e-10],
      expected: [0.0, 0.0, 0.0],
      desc: `all dims within epsilon of 1 snap to 0`,
    },
  ] as { input: Vec3; expected: Vec3; desc: string }[])(`$desc`, ({ input, expected }) => {
    const result = wrap_to_unit_cell(input)
    for (let dim = 0; dim < 3; dim++) {
      expect(result[dim]).toBeCloseTo(expected[dim], 8)
      expect(result[dim]).toBeGreaterThanOrEqual(0)
      expect(result[dim]).toBeLessThan(1)
    }
  })

  // The snap epsilon is exactly 1e-10: 1 - 1e-10 is the first value that snaps, a value 10x
  // further from 1 must survive as itself (a real position, not float noise)
  test.each([
    [1 - 1e-10, 0],
    [1 - 1e-9, 1 - 1e-9],
    [1 - 1e-8, 1 - 1e-8],
    [2 - 1e-10, 0],
    [-1e-10, 0],
    [-1e-9, 1 - 1e-9],
  ])(`wraps %d to exactly %d`, (input, expected) => {
    expect(wrap_to_unit_cell([input, input, input])).toEqual([expected, expected, expected])
  })
})

test(`find_image_atoms skips image generation along non-periodic axes (slab)`, () => {
  // Corner atom in a fully periodic cell generates images along all 3 dims
  const periodic = make_crystal(5, [[`Na`, [0, 0, 0]]])
  const periodic_images = find_image_atoms(periodic)
  expect(periodic_images).toHaveLength(7) // 2^3 - 1 corner images

  // Slab with vacuum along z: no image may be shifted along z
  const slab = make_crystal(5, [[`Na`, [0, 0, 0]]], { pbc: [true, true, false] })
  const slab_images = find_image_atoms(slab)
  expect(slab_images).toHaveLength(3) // 2^2 - 1 in-plane images
  for (const [, , img_abc] of slab_images) expect(img_abc[2]).toBe(0)

  // Fully non-periodic: no images at all
  const molecule_like = make_crystal(5, [[`Na`, [0, 0, 0]]], { pbc: [false, false, false] })
  expect(find_image_atoms(molecule_like)).toHaveLength(0)
})
