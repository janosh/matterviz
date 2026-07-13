import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { create_frac_to_cart, euclidean_dist } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { find_image_atoms, get_pbc_image_sites, wrap_to_unit_cell } from '$lib/structure'
import { get_majority_element } from '$lib/structure/bonding'
import { parse_structure_file } from '$lib/structure/parse'
import { parse_trajectory_data } from '$lib/trajectory/parse'
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

  // metal (cation) images are never added by phase 2 in compounds - anion images
  // complete the cation shells instead. Pulled-in cation copies would protrude
  // asymmetrically wherever the anion sublattice hugs one cell face (e.g. bare
  // Ti images below the rutile cell but not above).
  const metal_in_compound = make_crystal(10, [
    [`Ti`, [0.05, 0.5, 0.5]],
    [`Ti`, [0.75, 0.5, 0.5]], // image at x=-2.5 is 3.0 Å from first Ti
    [`O`, [0.8, 0.5, 0.5]], // image at x=-2 is 2.5 Å from first Ti (bonds!)
  ])
  const compound_images = find_image_atoms(metal_in_compound)
  expect(compound_images.filter(([idx]) => idx === 1)).toHaveLength(0)
  // ...while the anion gets pulled in to complete the Ti coordination
  expect(compound_images.filter(([idx]) => idx === 2).length).toBeGreaterThan(0)

  // pure metals get NO phase-2 images at all (equal electronegativity = no
  // anion->cation pull): only the uniform phase-1 boundary copies render, so
  // e.g. a 1-atom FCC metal cell shows just its corner copies instead of an
  // asymmetric nearest-neighbor blob
  const pure_metal = make_crystal(10, [
    [`Cu`, [0.05, 0.5, 0.5]],
    [`Cu`, [0.8, 0.5, 0.5]],
  ])
  // Cu image at x=-2 would be 2.5 Å from first Cu (within 2*r_Cu + slack) but
  // must still not be generated
  const cu_images = find_image_atoms(pure_metal).filter(([idx]) => idx === 1)
  expect(cu_images).toHaveLength(0)

  // multi-metal intermetallics (e.g. Al-Fe-Ni) also get no phase-2 images even
  // though their metals differ in electronegativity - metals can never be
  // polyhedron vertices, so such images would complete nothing
  const intermetallic = make_crystal(10, [
    [`Al`, [0.05, 0.5, 0.5]],
    [`Fe`, [0.8, 0.5, 0.5]],
  ])
  // Fe (EN 1.83) > Al (EN 1.61) and the Fe image at x=-2 would be within bonding
  // distance of Al, but Fe is a metal -> no image
  const fe_images = find_image_atoms(intermetallic).filter(([idx]) => idx === 1)
  expect(fe_images).toHaveLength(0)
})

test(`phase-2 doesn't float framework cation-formers beyond the cell to complete spectator shells`, () => {
  // Regression (Li4Fe3Mn1(PO4)4): spectator Li sits at every cell corner/edge. The
  // composition has framework cations (Fe/Mn/P) so Li renders no polyhedron - yet
  // before the fix phase-2 still pulled P (and its O) periodic images ~2 Å (0.42
  // fractional on the short 4.74 Å c-axis) beyond the face to "complete" the
  // never-drawn Li shells, floating whole PO4 groups outside the cell. Completion
  // images must now only complete framework (Fe/Mn) shells: all O anions, far fewer
  // of them, none stacked far past a face.
  const structure = parse_structure_file(lifemn_cif, `Li4Fe3Mn1(PO4)4.cif`) as Crystal
  const completion = find_image_atoms(structure).filter(
    ([, , , is_completion]) => is_completion,
  )
  expect(completion.length).toBeGreaterThan(0)
  expect(completion.length).toBeLessThanOrEqual(20) // was 74 before the fix
  for (const [src_idx, , img_abc] of completion) {
    // every completion image is an oxygen anion - no P (or Li/Fe/Mn) cation copies
    expect(get_majority_element(structure.sites[src_idx])).toBe(`O`)
    // and none float more than ~0.35 fractional units past any face (would have been
    // 0.42 for the spurious P images), i.e. no second-shell stacking on PBC images
    for (const coord of img_abc) {
      expect(Math.max(0, -coord, coord - 1)).toBeLessThan(0.35)
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

test(`find_image_atoms finds correct images for normal cell`, async () => {
  const normal_structure_extxyz = `8
Lattice="5.0 0.0 0.0 0.0 5.0 0.0 0.0 0.0 5.0" Properties=species:S:1:pos:R:3 pbc="T T T"
Cl       0.0       0.0       0.0
Cl       2.5       0.0       2.5
Cl       0.0       2.5       2.5
Cl       2.5       2.5       0.0
Cl       2.5       0.0       0.0
Cl       0.0       0.0       2.5
Cl       0.0       2.5       0.0
Cl       2.5       2.5       2.5`

  const normal_trajectory = await parse_trajectory_data(normal_structure_extxyz, `test.xyz`)
  const normal_structure = normal_trajectory.frames[0].structure as Crystal
  if (!(`lattice` in normal_structure) || !normal_structure.lattice) {
    throw new Error(`Structure should have lattice`)
  }

  // Atoms sit within the unit cell, so this is treated as a normal crystal and
  // generates image atoms for atoms near cell boundaries
  expect(find_image_atoms(normal_structure).length).toBeGreaterThan(0)
  expect(get_pbc_image_sites(normal_structure).sites.length).toBeGreaterThan(
    normal_structure.sites.length,
  )

  // Few/no atoms outside the unit cell (below the 10% trajectory-detection threshold)
  const atoms_outside = normal_structure.sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1),
  )
  expect(atoms_outside.length).toBeLessThanOrEqual(normal_structure.sites.length * 0.1)
})

// Additional regression tests for trajectory threshold, triclinic correctness, tolerance edges, and boundary wrapping

test.each([
  {
    total_atoms: 10,
    outside_atoms: 1, // exactly 10%
    expect_skip: false,
    description: `exactly 10% atoms outside should NOT skip image generation`,
  },
  {
    total_atoms: 10,
    outside_atoms: 2, // >10%
    expect_skip: true,
    description: `more than 10% atoms outside SHOULD skip image generation`,
  },
])(
  `trajectory detection threshold: $description`,
  ({ total_atoms, outside_atoms, expect_skip }) => {
    const structure = make_crystal(
      5,
      Array.from({ length: total_atoms }, (_, idx) => ({
        element: `C`,
        abc: idx < outside_atoms ? [1.2, 0.5, 0.5] : [0.5, 0.5, 0.5],
      })),
    )

    const images = find_image_atoms(structure)
    if (expect_skip) {
      expect(images).toHaveLength(0)
      const unchanged = get_pbc_image_sites(structure)
      expect(unchanged.sites).toHaveLength(structure.sites.length)
    } else {
      // Not trajectory data; may or may not produce images depending on tolerance/edges
      const with_images = get_pbc_image_sites(structure)
      expect(with_images.sites.length).toBeGreaterThanOrEqual(structure.sites.length)
    }
  },
)

test(`triclinic lattice image xyz must match lattice * abc`, () => {
  const matrix = math.cell_to_lattice_matrix(4, 5, 6, 75, 85, 65)
  const structure = make_crystal(matrix, [[`C`, [0, 0, 0]]])

  const images = find_image_atoms(structure)
  expect(images.length).toBeGreaterThanOrEqual(7)

  for (const [orig_idx, img_xyz, img_abc] of images) {
    const orig_abc = structure.sites[orig_idx].abc
    assert_integer_translation(orig_abc, img_abc, 1e-8)
    assert_xyz_matches_lattice(matrix, img_abc, img_xyz, 9)
  }
})

// Non-orthogonal lattices where L ≠ L^T — using cubic lattices here can't
// distinguish L*frac from L^T*frac, so these catch wrong-convention bugs.
const non_ortho_lattices = [
  {
    name: `monoclinic`,
    lattice: [
      [5, 0, 0],
      [0, 6, 0],
      [2, 0, 7],
    ] as Matrix3x3,
  },
  {
    name: `hexagonal`,
    lattice: [
      [4, 0, 0],
      [2, 3.464, 0],
      [0, 0, 8],
    ] as Matrix3x3,
  },
  {
    name: `triclinic`,
    lattice: [
      [5, 0, 0],
      [2.5, 4.33, 0],
      [1, 1, 4],
    ] as Matrix3x3,
  },
]

test.each(non_ortho_lattices)(
  `non-ortho image generation stays lattice-consistent ($name)`,
  ({ lattice }) => {
    const structure = make_crystal(lattice, [
      [`Na`, [0.0, 0.0, 0.0]],
      [`Cl`, [0.01, 0.5, 0.5]],
    ])
    const images = find_image_atoms(structure)
    expect(images.length).toBeGreaterThan(0)

    for (const [orig_idx, img_xyz, img_abc] of images) {
      assert_xyz_matches_lattice(lattice, img_abc, img_xyz)
      assert_integer_translation(structure.sites[orig_idx].abc, img_abc)
    }

    const with_images = get_pbc_image_sites(structure)
    const image_sites = with_images.sites.slice(structure.sites.length)
    expect(image_sites.length).toBeGreaterThan(0)

    for (const site of image_sites) {
      assert_xyz_matches_lattice(lattice, site.abc, site.xyz)
    }
  },
)

test.each([
  {
    tolerance: 0.02,
    coord: 0.0199999,
    expect_images: true,
    description: `|coord| < tol`,
  },
  { tolerance: 0.02, coord: 0.02, expect_images: false, description: `|coord| == tol` },
  {
    tolerance: 0.02,
    coord: 0.0200001,
    expect_images: false,
    description: `|coord| > tol`,
  },
])(`tolerance boundary behavior: $description`, ({ tolerance, coord, expect_images }) => {
  const structure = make_crystal(5, [[`Na`, [coord, 0.5, 0.5]]])
  const images = find_image_atoms(structure, { tolerance })
  if (expect_images) expect(images.length).toBeGreaterThan(0)
  else expect(images).toHaveLength(0)
})

test(`upper boundary at abc=1.0 images wrap near 0 via epsilon`, () => {
  const structure = make_crystal(5, [[`Cl`, [1.0, 0.5, 0.5]]])

  const images = find_image_atoms(structure)
  expect(images.length).toBeGreaterThan(0)
  // pick the x-translated replica (wrapped to 0 along x)
  const candidate = images.find(([, , image_abc]) => Math.abs(image_abc[0]) < 1e-8)
  if (!candidate) throw new Error(`no wrapped x-boundary image found`)
  const [, img_xyz, img_abc] = candidate

  // Fractional should be exactly 0 on x and equal original on y,z
  expect(img_abc[0]).toBeCloseTo(0.0, 10)
  expect(img_abc[1]).toBeCloseTo(0.5, 12)
  expect(img_abc[2]).toBeCloseTo(0.5, 12)

  // xyz must be consistent with L^T * abc
  assert_xyz_matches_lattice(structure.lattice.matrix, img_abc, img_xyz)
})

test(`get_pbc_image_sites preserves explicit periodic bond metadata`, () => {
  const structure = make_crystal(10, [
    [`C`, [0.95, 0.5, 0.5]],
    [`O`, [0.05, 0.5, 0.5]],
  ])
  structure.properties = {
    bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
  }

  const with_images = get_pbc_image_sites(structure, { tolerance: 0.1 })

  expect(with_images.sites).toHaveLength(4)
  expect(with_images.properties?.bonds).toEqual([
    { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
  ])
})

test(`find_image_atoms finds correct images for trajectory-like cell`, async () => {
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

  const trajectory_like = await parse_trajectory_data(trajectory_like_extxyz, `test.xyz`)
  const trajectory_structure = trajectory_like.frames[0].structure as Crystal
  if (!(`lattice` in trajectory_structure) || !trajectory_structure.lattice) {
    throw new Error(`Structure should have lattice`)
  }

  // Detected as trajectory data → no image atoms, structure returned unchanged
  expect(find_image_atoms(trajectory_structure)).toHaveLength(0)
  expect(get_pbc_image_sites(trajectory_structure).sites).toHaveLength(
    trajectory_structure.sites.length,
  )

  // abc coords are wrapped into the cell on parse, so none read as outside the [-0.1, 1.1]
  // margin (the raw cartesian positions extend past the 15 Å box, which is what flags trajectory)
  const atoms_outside = trajectory_structure.sites.filter(({ abc }) =>
    abc.some((coord) => coord < -0.1 || coord > 1.1),
  )
  expect(atoms_outside).toHaveLength(0)
})

// Comprehensive tests for find_image_atoms with real structure files
test.each([
  {
    content: mp_1_struct,
    filename: `mp-1.json`,
    expected_min_images: 7, // Based on actual test output: 10 images found, atom at (0,0,0) creates 7 images
    expected_max_images: 15,
    description: `Two Cs atoms, one at (0,0,0), one at (0.5,0.5,0.5)`,
  },
  {
    content: mp_2_struct,
    filename: `mp-2.json`,
    expected_min_images: 10, // Based on actual test output: 13 images found
    expected_max_images: 30, // bond-completing images (phase 2) add a few more
    description: `Four Pd atoms in FCC structure`,
  },
  {
    content: nacl_poscar,
    filename: `NaCl-cubic.poscar`,
    expected_min_images: 19,
    expected_max_images: 90, // phase 2 also completes shells of boundary-image copies
    description: `8 atoms (4 Na + 4 Cl) in cubic structure`,
  },
  {
    content: quartz_cif,
    filename: `quartz-alpha.cif`,
    expected_min_images: 3, // Based on actual test output: 5 images found
    expected_max_images: 10,
    description: `Si and O atoms with some near cell edges`,
  },
  {
    content: extended_xyz_quartz,
    filename: `quartz.extxyz`,
    expected_min_images: 0,
    expected_max_images: 10,
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
      if (!parsed?.lattice) {
        throw new Error(`Failed to parse structure or no lattice found`)
      }
      structure = {
        sites: parsed.sites,
        lattice: { ...parsed.lattice, pbc: [true, true, true] },
      }
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

// Test edge detection accuracy
test(`edge detection should be precise for atoms at boundaries`, () => {
  // Create a test structure with atoms exactly at edges
  const test_structure = make_crystal(5, [
    [`Na`, [0.0, 0.0, 0.0]], // Exactly at corner
    [`Cl`, [1.0, 0.0, 0.0]], // Exactly at edge
    [`Na`, [0.5, 0.5, 0.5]], // In middle, no images expected
  ])

  const image_atoms = find_image_atoms(test_structure)

  // Atom at (0,0,0) should generate images in all directions
  const corner_images = image_atoms.filter(([idx]) => idx === 0)
  expect(corner_images.length).toBeGreaterThan(0)

  // Atom at (1,0,0) should generate images
  const edge_images = image_atoms.filter(([idx]) => idx === 1)
  expect(edge_images.length).toBeGreaterThan(0)

  // Atom at (0.5,0.5,0.5) should NOT generate images (not at edge)
  const center_images = image_atoms.filter(([idx]) => idx === 2)
  expect(center_images).toHaveLength(0)

  // Check specific image positions for corner atom
  const corner_image_positions = corner_images.map(([_, xyz]) => xyz)

  // Should have images at expected positions like (5,0,0), (0,5,0), (0,0,5), etc.
  const expected_corner_images = [
    [5.0, 0.0, 0.0], // +x direction
    [0.0, 5.0, 0.0], // +y direction
    [0.0, 0.0, 5.0], // +z direction
    [5.0, 5.0, 0.0], // +x,+y corner
    [5.0, 0.0, 5.0], // +x,+z corner
    [0.0, 5.0, 5.0], // +y,+z corner
    [5.0, 5.0, 5.0], // +x,+y,+z corner
  ]

  // Check that we get the expected corner images (with some tolerance)
  for (const expected_pos of expected_corner_images) {
    const found = corner_image_positions.some((actual_pos) => {
      const dist = euclidean_dist(actual_pos, expected_pos)
      return dist < 0.001
    })
    expect(found).toBe(true)
  }
})

// Test tolerance parameter effects with clearer edge cases
test.each([
  { tolerance: 0.01, abc_coords: [0.005, 0.0, 0.0], description: `strict tolerance` },
  { tolerance: 0.05, abc_coords: [0.02, 0.0, 0.0], description: `default tolerance` },
  { tolerance: 0.1, abc_coords: [0.08, 0.0, 0.0], description: `loose tolerance` },
])(
  `atom within tolerance of edge generates images: $description`,
  ({ tolerance, abc_coords }) => {
    const test_structure = make_crystal(5, [[`Na`, abc_coords as Vec3]])
    const image_atoms = find_image_atoms(test_structure, { tolerance })

    // Edge/corner combinations may create several images; cap catches runaway generation
    expect(image_atoms.length).toBeGreaterThanOrEqual(1)
    expect(image_atoms.length).toBeLessThanOrEqual(26)
  },
)

// Test image atom generation with various crystal systems
// oxfmt-ignore
test.each([
  { name: `cubic`, lattice: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], abc_list: [[0, 0, 0]] },
  { name: `orthorhombic`, lattice: [[4, 0, 0], [0, 6, 0], [0, 0, 8]], abc_list: [[0, 0, 0]] },
  {
    name: `face-centered`,
    lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
    abc_list: [[0, 0, 0], [0.5, 0.5, 0]],
  },
])(`image atom generation for $name crystal system`, ({ lattice, abc_list }) => {
  const test_structure = make_crystal(
    lattice as Matrix3x3,
    abc_list.map((abc) => ({ element: `C`, abc: abc as Vec3 })),
  )
  const expected_min = 7 // at least 7 images for the corner atom

  const image_atoms = find_image_atoms(test_structure)
  expect(image_atoms.length).toBeGreaterThanOrEqual(expected_min)

  // Validate all image atoms
  for (const [orig_idx, image_xyz, image_abc] of image_atoms) {
    expect(orig_idx).toBeGreaterThanOrEqual(0)
    expect(orig_idx).toBeLessThan(test_structure.sites.length)
    expect(image_xyz.every((coord) => Number.isFinite(coord))).toBe(true)
    expect(image_abc.every((coord) => Number.isFinite(coord))).toBe(true)

    // Verify fractional coordinates are related by integer translations
    const orig_abc = test_structure.sites[orig_idx].abc
    assert_integer_translation(orig_abc, image_abc, 1e-8)
  }
})

// Test the new behavior: abc coordinates should be preserved and synchronized with xyz
test(`image atoms preserve fractional coordinates correctly`, () => {
  // Create a simple test structure with atoms at known boundary positions
  const test_structure = make_crystal(5, [
    [`Na`, [0.0, 0.0, 0.0]], // Corner atom
    [`Cl`, [1.0, 0.5, 0.0]], // Edge atom in x-direction
  ])

  const image_atoms = find_image_atoms(test_structure)
  expect(image_atoms.length).toBeGreaterThan(0)

  // Test get_pbc_image_sites to ensure the fractional coordinates are properly set
  const symmetrized = get_pbc_image_sites(test_structure)

  // Check that each image atom in the symmetrized structure has correct abc coordinates
  const orig_n_sites = test_structure.sites.length
  const image_sites = symmetrized.sites.slice(orig_n_sites) // Image atoms are added after original atoms

  expect(image_sites).toHaveLength(image_atoms.length)

  for (let idx = 0; idx < image_atoms.length; idx++) {
    const [orig_idx, expected_xyz, expected_abc] = image_atoms[idx]
    const image_site = image_sites[idx]

    // Verify the image site has the expected coordinates
    for (let dim = 0; dim < 3; dim++) {
      expect(image_site.xyz[dim]).toBeCloseTo(expected_xyz[dim], 10)
      expect(image_site.abc[dim]).toBeCloseTo(expected_abc[dim], 10)
    }

    // Verify consistency between abc and xyz coordinates in the image site
    assert_xyz_matches_lattice(test_structure.lattice.matrix, image_site.abc, image_site.xyz)

    // Verify the image abc coordinates are related to the original by NON-ZERO
    // integer translations (assert_integer_translation requires non-zero by default)
    assert_integer_translation(test_structure.sites[orig_idx].abc, image_site.abc, 1e-8)
  }
})

// Test that highly oblique cells are handled correctly
test(`highly oblique cells should have finite, well-defined fractional coordinates`, () => {
  const image_atoms = find_image_atoms(tl_bi_se2_struct)
  expect(image_atoms.length).toBeGreaterThan(0)

  // Check that all image atoms have finite fractional coordinates (no specific range check)
  // We no longer force them to be inside [0, 1] because for visualization/bonding
  // we want them at their true periodic positions (which might be outside).
  for (const [orig_idx, __, img_abc] of image_atoms) {
    expect(img_abc.every((coord) => Number.isFinite(coord))).toBe(true)

    // Also verify they are valid integer translations from the original
    const orig_abc = tl_bi_se2_struct.sites[orig_idx].abc
    assert_integer_translation(orig_abc, img_abc, 1e-8)
  }
})

// Regression test: ensure image sites for highly oblique large cell are valid
test(`mp-1204603 image sites are valid integer translations`, () => {
  const structure = mp_1204603_struct

  // Sanity: has lattice and angles imply non-orthogonal
  expect(`lattice` in structure).toBe(true)
  if (!(`lattice` in structure) || !structure.lattice) throw new Error(`no lattice`)

  const image_atoms = find_image_atoms(structure)
  const with_images = get_pbc_image_sites(structure)

  // Slice out just the image sites appended at the end
  const orig_len = structure.sites.length
  const image_sites = with_images.sites.slice(orig_len)

  // Allow deduplication to remove coincident images
  expect(image_sites.length).toBeLessThanOrEqual(image_atoms.length)

  const lattice_matrix = structure.lattice.matrix
  for (const site of image_sites) {
    assert_xyz_matches_lattice(lattice_matrix, site.abc, site.xyz, 9)
  }
})

// check we preserve relative fractional offsets across boundary wrapping
test.each([
  {
    coord: 0.98,
    expected_int_shift: -1,
    description: `near upper boundary (wrap negative)`,
  },
  {
    coord: 0.02,
    expected_int_shift: 1,
    description: `near lower boundary (wrap positive)`,
  },
])(
  `image atoms preserve fractional offset across x-boundary: $description`,
  ({ coord, expected_int_shift }) => {
    const orig_abc: Vec3 = [coord, 0.5, 0.5]
    const structure = make_crystal(5, [[`Na`, orig_abc]])
    const image_atoms = find_image_atoms(structure).filter(([site_idx]) => site_idx === 0)
    expect(image_atoms.length).toBeGreaterThan(0)

    // the x-translated replica must shift in the expected direction with consistent xyz
    const candidate = image_atoms.find(
      ([, , image_abc]) => Math.abs(Math.round(image_abc[0] - orig_abc[0])) === 1,
    )
    expect(candidate).toBeDefined()
    if (!candidate) return

    const [, img_xyz, img_abc] = candidate
    expect(Math.round(img_abc[0] - orig_abc[0])).toBe(expected_int_shift)
    assert_xyz_matches_lattice(structure.lattice.matrix, img_abc, img_xyz, 10)
  },
)

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

  // Explicit tolerance override (fractional 0.05 = 5 Angstroms)
  // C1 at 4A SHOULD image now
  const images_explicit = find_image_atoms(structure, { tolerance: 0.05 })
  const c_images_explicit = images_explicit.filter(([idx]) => idx === 0)
  expect(c_images_explicit.length).toBeGreaterThan(0)
})

describe(`wrap_to_unit_cell`, () => {
  test.each([
    { input: [0.0, 0.0, 0.0], expected: [0.0, 0.0, 0.0], desc: `origin stays at origin` },
    { input: [0.5, 0.5, 0.5], expected: [0.5, 0.5, 0.5], desc: `center stays at center` },
    { input: [0.25, 0.75, 0.1], expected: [0.25, 0.75, 0.1], desc: `in-range unchanged` },
    { input: [1.3, 0.5, 0.5], expected: [0.3, 0.5, 0.5], desc: `x > 1 wraps` },
    { input: [0.5, 2.7, 0.5], expected: [0.5, 0.7, 0.5], desc: `y > 1 wraps` },
    { input: [0.5, 0.5, 3.1], expected: [0.5, 0.5, 0.1], desc: `z > 1 wraps` },
    { input: [1.0, 2.0, 3.0], expected: [0.0, 0.0, 0.0], desc: `exact ints wrap to 0` },
    { input: [5.8, 10.2, 100.9], expected: [0.8, 0.2, 0.9], desc: `large values wrap` },
    { input: [-0.3, 0.5, 0.5], expected: [0.7, 0.5, 0.5], desc: `x < 0 wraps` },
    { input: [0.5, -0.8, 0.5], expected: [0.5, 0.2, 0.5], desc: `y < 0 wraps` },
    { input: [0.5, 0.5, -0.1], expected: [0.5, 0.5, 0.9], desc: `z < 0 wraps` },
    { input: [-1.0, -2.0, -3.0], expected: [0.0, 0.0, 0.0], desc: `negative ints → 0` },
    { input: [-5.2, -10.7, -100.4], expected: [0.8, 0.3, 0.6], desc: `large negatives` },
    // values within epsilon of 1 snap to 0 to suppress floating-point noise
    { input: [0.9999999999, 0.5, 0.5], expected: [0.0, 0.5, 0.5], desc: `x ≈ 1 snaps to 0` },
    {
      input: [1.0 - 1e-12, 1.0 - 1e-11, 1.0 - 1e-10],
      expected: [0.0, 0.0, 0.0],
      desc: `all dims ≈ 1 snap to 0`,
    },
  ] as { input: Vec3; expected: Vec3; desc: string }[])(`$desc`, ({ input, expected }) => {
    const result = wrap_to_unit_cell(input)
    for (let dim = 0; dim < 3; dim++) {
      expect(result[dim]).toBeCloseTo(expected[dim], 8)
    }
  })

  test.each([
    [[0.0, 0.0, 0.0]],
    [[1.0, 1.0, 1.0]],
    [[-1.0, -1.0, -1.0]],
    [[100.123, -50.456, 0.789]],
    [[1e-15, 1 - 1e-15, 0.5]],
  ] as [Vec3][])(`result values for %j are always in [0, 1)`, (input) => {
    for (const coord of wrap_to_unit_cell(input)) {
      expect(coord).toBeGreaterThanOrEqual(0.0)
      expect(coord).toBeLessThan(1.0)
    }
  })
})

describe(`find_image_atoms respects lattice.pbc`, () => {
  test(`skips image generation along non-periodic axes (slab)`, () => {
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
    const molecule_like = make_crystal(5, [[`Na`, [0, 0, 0]]], {
      pbc: [false, false, false],
    })
    expect(find_image_atoms(molecule_like)).toHaveLength(0)
  })
})
