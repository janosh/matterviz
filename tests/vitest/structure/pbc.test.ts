import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { create_frac_to_cart, euclidean_dist } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
import {
  find_drawn_completion_sites,
  find_image_atoms,
  get_pbc_image_sites,
  wrap_to_unit_cell,
} from '#lib/structure/pbc.js'
import type { ImageAtom, ImageAtomCompletion, ImageAtomOptions } from '#lib/structure/pbc.js'
import { DEFAULTS } from '#lib/settings.js'
import {
  electroneg_ratio,
  explicit_only,
  get_bond_data,
  get_majority_element,
} from '#lib/structure/bonding.js'
import { compute_polyhedra, polyhedra_options_from } from '#lib/structure/polyhedra.js'
import { bond_site_1, bond_site_2 } from '#lib/structure/bond-rendering.js'
import type { ResolvedPolyhedraOptions } from '#lib/structure/polyhedra.js'
import { parse_structure_file } from '#lib/structure/parse.js'
import { get_element_counts } from '#lib/structure/density.js'
import { is_image_site } from '#lib/structure/site.js'
import { open_trajectory } from '#lib/trajectory/open.js'
import { structure_map } from '#site/structures.js'
import lifemn_cif from '#site/structures/Li4Fe3Mn1(PO4)4.cif?raw'
import nacl_poscar from '#site/structures/NaCl-cubic.poscar?raw'
import quartz_cif from '#site/structures/quartz-alpha.cif?raw'
import extended_xyz_quartz from '#site/structures/quartz.extxyz?raw'
import { describe, expect, test } from 'vitest'
import {
  fcc_primitive_matrix,
  image_options,
  make_crystal,
  make_srtio3,
  SRTIO3_A,
} from '../test-fixtures'

const mp_1_struct = structure_map.get(`mp-1`) as Crystal
const mp_2_struct = structure_map.get(`mp-2`) as Crystal
const mp_1204603_struct = structure_map.get(`mp-1204603`) as Crystal
const tl_bi_se2_struct = structure_map.get(`TlBiSe2-highly-oblique-cell`) as Crystal
const ac2_br2_o_struct = structure_map.get(`mp-1207297-Ac2Br2O1-tetragonal`) as Crystal

const COMPLETIONS: readonly ImageAtomCompletion[] = [`polyhedra`, `boundary`, `none`]

// Completion (phase-2) copies per element
const completion_counts = (
  structure: Crystal,
  options: ImageAtomOptions,
): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const [idx, , , is_completion] of find_image_atoms(structure, options)) {
    const element = get_majority_element(structure.sites[idx]) ?? `?`
    if (is_completion) counts[element] = (counts[element] ?? 0) + 1
  }
  return counts
}

// What the renderer draws around every completion copy: a bond to a displayed anchor (base
// atom or phase-1 copy), else it floats, and in polyhedra mode a polyhedron it is a corner of
// (with the same options), else it is clutter. Every drawn polyhedron is whole: its vertex
// count is its center's on the periodic bond graph (`none` stamps nothing to check against).
// Returns the stray copies and truncated polyhedra.
function completion_problems(
  structure: Crystal,
  completion: ImageAtomCompletion = DEFAULTS.structure.image_atom_completion,
  polyhedra_options: Partial<ResolvedPolyhedraOptions> = {},
): { stray: string[]; truncated: string[] } {
  const imaged = get_pbc_image_sites(structure, image_options(completion, polyhedra_options))
  const bonds = get_bond_data(imaged, `electroneg_ratio`)
  const is_anchor = (idx: number) => !imaged.sites[idx].provenance?.completion
  const bonded = new Set<number>()
  for (let idx = 0; idx < bonds.length; idx++) {
    const [site_1, site_2] = [bond_site_1(bonds, idx), bond_site_2(bonds, idx)]
    if (is_anchor(site_1)) bonded.add(site_2)
    if (is_anchor(site_2)) bonded.add(site_1)
  }
  const resolved = { ...polyhedra_options_from({}), ...polyhedra_options }
  const polyhedra = compute_polyhedra(imaged, bonds, resolved)
  const corners = new Set(polyhedra.flatMap(({ vertex_site_idxs }) => vertex_site_idxs))
  const drawn = (idx: number) =>
    bonded.has(idx) && (completion !== `polyhedra` || corners.has(idx))
  const stray = imaged.sites.flatMap((site, idx) =>
    site.provenance?.completion && !drawn(idx) ? [`${idx}:${site.abc.join(`,`)}`] : [],
  )
  if (completion === `none`) return { stray, truncated: [] }
  const periodic_bonds = get_bond_data(structure, `electroneg_ratio`, {
    pbc: structure.lattice.pbc,
  })
  const periodic_cn = new Map(
    compute_polyhedra(structure, periodic_bonds, resolved).map((poly) => [
      poly.center_site_idx,
      poly.vertex_site_idxs.length,
    ]),
  )
  const truncated = polyhedra.flatMap(
    ({ center_site_idx, center_orig_idx, vertex_site_idxs }) =>
      periodic_cn.get(center_orig_idx) === vertex_site_idxs.length
        ? []
        : [`${center_site_idx}: CN ${vertex_site_idxs.length}`],
  )
  return { stray, truncated }
}
const NO_PROBLEMS = { stray: [], truncated: [] }

function assert_xyz_matches_lattice(
  lattice_matrix: Matrix3x3,
  frac: Vec3,
  xyz: Vec3,
  digits: number,
) {
  const frac_to_cart = create_frac_to_cart(lattice_matrix)
  const expected = frac_to_cart(frac)
  for (let dim = 0; dim < 3; dim++) {
    expect(xyz[dim]).toBeCloseTo(expected[dim], digits)
  }
}

// image_abc is a nonzero integer translation of orig_abc
function assert_integer_translation(orig_abc: Vec3, image_abc: Vec3, tol: number) {
  const shifts = image_abc.map((coord, dim) => coord - orig_abc[dim])
  for (const shift of shifts) expect(Math.abs(shift - Math.round(shift))).toBeLessThan(tol)
  expect(shifts.some((shift) => Math.abs(Math.round(shift)) > 0)).toBe(true)
}

function validate_image_tuples(
  structure: Crystal,
  image_atoms: ImageAtom[],
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

// SrTiO3 with Ti on the corners: every corner copy of Ti needs its 6 O, 24 of them beyond the
// faces. With Ti in the body center only bonds of the face O reach across to Ti. fcc Cu has no
// polyhedra at all, only metal bonds of the corner Cu.
const completion_fixtures = {
  srtio3_ti_corner: () => make_srtio3(`corner`),
  srtio3_ti_body: () => make_srtio3(`body`),
  cu_fcc: () => make_crystal(fcc_primitive_matrix(3.61), [[`Cu`, [0, 0, 0]]]),
}
// The modes nest: none adds nothing, polyhedra the corners of drawn polyhedra, boundary
// those plus every bond partner of a face atom. Default completion stamps every site once it
// judged polyhedra; metals in anion mode have none to judge (no bond search), so they stay
// unstamped and keep the max-CN rule.
test.each([
  [`srtio3_ti_corner`, { polyhedra: { O: 24 }, boundary: { O: 24 }, none: {} }, true],
  [`srtio3_ti_body`, { polyhedra: {}, boundary: { Ti: 6 }, none: {} }, true],
  [`cu_fcc`, { polyhedra: {}, boundary: { Cu: 12 }, none: {} }, false],
] as const)(`completion modes on %s`, (name, expected, stamped) => {
  const structure = completion_fixtures[name]()
  for (const completion of COMPLETIONS) {
    expect(completion_counts(structure, image_options(completion)), completion).toEqual(
      expected[completion],
    )
    expect(completion_problems(structure, completion)).toEqual(NO_PROBLEMS)
  }
  const { sites } = get_pbc_image_sites(structure, image_options())
  const stamps = sites.map((site) => site.provenance?.polyhedron_center)
  expect(stamps.every((stamp) => (stamp === undefined) !== stamped)).toBe(true)
})

// Hidden polyhedra (the viewer passes no polyhedra options) complete no corners: their copies
// would still end drawn bonds and float beyond the faces. Boundary mode keeps the face-atom
// bonds, and nothing is stamped either way.
test.each([
  [`srtio3_ti_corner`, { polyhedra: {}, boundary: { O: 24 } }],
  [`srtio3_ti_body`, { polyhedra: {}, boundary: { Ti: 6 } }],
] as const)(`hidden polyhedra complete no corners on %s`, (name, expected) => {
  const structure = completion_fixtures[name]()
  for (const completion of [`polyhedra`, `boundary`] as const) {
    const options = {
      completion,
      bonding_strategy: `electroneg_ratio`,
      bonding_options: {},
    } as const
    expect(completion_counts(structure, options), completion).toEqual(expected[completion])
    const { sites } = get_pbc_image_sites(structure, options)
    expect(sites.some((site) => site.provenance?.polyhedron_center !== undefined)).toBe(false)
  }
})

// Completion follows the renderer's polyhedra options: no corners for polyhedra it won't draw,
// corners for spectator centers it is told to draw (the Sr cuboctahedra on the corners) and
// metal polyhedra once every bonded neighbor counts as a corner. Only Cu corner copies whose
// whole cuboctahedron fits in the neighbor cells get corners: 9 copies, where completing each
// corner on its own added 12, 3 of them around cuboctahedra the renderer never draws.
test.each([
  [`srtio3_ti_corner`, { excluded_center_elements: [`Ti`] }, {}],
  [`srtio3_ti_corner`, { min_neighbors: 7 }, {}],
  [`srtio3_ti_body`, { included_center_elements: [`Sr`] }, { O: 48 }],
  [`cu_fcc`, { neighbor_mode: `bonded`, max_neighbors: 12 }, { Cu: 9 }],
] as const)(`polyhedra completion on %s with options %j`, (name, options, expected) => {
  const structure = completion_fixtures[name]()
  expect(completion_counts(structure, image_options(`polyhedra`, options))).toEqual(expected)
  expect(completion_problems(structure, `polyhedra`, options)).toEqual(NO_PROBLEMS)
})

// Regression: in small cells every displayed copy of a center can be truncated. Ac in mp-1183089
// Ac4Mg2 has 13 periodic neighbors, so bonded mode capped at 12 draws no Ac polyhedron, yet 14
// truncated CN 5-8 copies drew while the full count was the max over the displayed copies.
test.each(
  [...structure_map].filter(
    ([, structure]) => `lattice` in structure && structure.sites.length < 3000,
  ),
)(`completion draws only whole polyhedra on %s`, (_name, structure) => {
  for (const options of [{}, { neighbor_mode: `bonded`, max_neighbors: 12 }] as const)
    for (const completion of [`polyhedra`, `boundary`] as const)
      expect(completion_problems(structure, completion, options)).toEqual(NO_PROBLEMS)
})

test(`completion images carry provenance, phase-1 face images do not`, () => {
  const structure = make_srtio3(`corner`)
  const image_atoms = find_image_atoms(structure, image_options())
  // the O copy at x=-0.5 completes the octahedron of the base corner Ti
  const completing = image_atoms.find(
    ([site_idx, img_xyz]) =>
      site_idx === 2 && euclidean_dist(img_xyz, [-SRTIO3_A / 2, 0, 0]) < 1e-6,
  )
  expect(completing?.[3]).toBe(true)
  const boundary = image_atoms.filter(([site_idx]) => site_idx === 0)
  expect(boundary).toHaveLength(7)
  expect(boundary.map((img) => img[3])).toEqual(Array(7).fill(false))
  // Imported names remain ordinary data; only generated provenance identifies images.
  const source_properties = { orig_site_idx: 7, orig_unit_cell_idx: 2, completion_image: true }
  for (const site of structure.sites) site.properties = { ...source_properties }
  const imaged = structuredClone(get_pbc_image_sites(structure, image_options()))
  const original_sites = imaged.sites.slice(0, structure.sites.length)
  expect(get_element_counts(imaged)).toEqual({ Ti: 1, Sr: 1, O: 3 })
  for (const site of imaged.sites) expect(site.properties).toEqual(source_properties)
  expect(original_sites.some(is_image_site)).toBe(false)
  expect(imaged.sites.slice(structure.sites.length).every(is_image_site)).toBe(true)
  const completion_sites = imaged.sites.filter((site) => site.provenance?.completion)
  expect(completion_sites).toHaveLength(24)
  expect(original_sites.every((site) => !site.provenance?.completion)).toBe(true)

  // Face-atom completion measures metal-metal contacts the way the bond detector does,
  // against the metallic radii: Cs-Cs at 5.63 Å is 1.06x the metallic sum and bonds, so
  // the corner Cs of a bcc cell gets all 8 body-center neighbours
  const stretched_cs = get_pbc_image_sites(
    make_crystal(6.5, [
      [`Cs`, [0, 0, 0]],
      [`Cs`, [0.5, 0.5, 0.5]],
    ]),
    image_options(`boundary`),
  )
  const corner_bonds = electroneg_ratio(stretched_cs).filter(
    ({ site_idx_1, site_idx_2 }) => site_idx_1 === 0 || site_idx_2 === 0,
  )
  expect(corner_bonds).toHaveLength(8)
  for (const { bond_length } of corner_bonds) expect(bond_length).toBeCloseTo(5.629, 3)
})

// Regression (Li4Fe3Mn1(PO4)4): spectator Li sits at every cell corner/edge. The composition
// has framework cations (Fe/Mn/P), so Li renders no polyhedron, yet an earlier completion rule
// pulled P (and its O) ~2 Å beyond the faces to "complete" the never-drawn Li shells, floating
// whole PO4 groups outside the cell. Now only the O corners of the drawn FeO6/MnO6/PO4
// polyhedra cross the faces, and face-atom completion skips the spectator Li (else 44 more O).
test.each([
  [`polyhedra`, { O: 14 }],
  [`boundary`, { O: 14 }],
  [`none`, {}],
] as const)(
  `%s completion floats no PO4 groups around spectator Li`,
  (completion, expected) => {
    const structure = parse_structure_file(lifemn_cif, `Li4Fe3Mn1(PO4)4.cif`) as Crystal
    expect(completion_counts(structure, image_options(completion))).toEqual(expected)
  },
)

// Regression: this cell's heights (~3 Å) are shorter than the radii sum + 0.7 Å reach the
// completion pass used to accept, so every Sc and Ru copy one cell out passed: 46 completion
// images, 32 of them bonded to nothing, drawn as rows of Sc/Ru atoms around the cell. Its Sc-H
// shells form no polyhedra and the only face atom (the corner Ru) bonds nothing, so every mode
// draws just the 7 Ru corner copies.
test.each(COMPLETIONS)(
  `%s completion in a small Sc2H2Ru cell adds only Ru corners`,
  (completion) => {
    const structure = make_crystal(
      [
        [0, -3.1975882005551073, 0],
        [-3.1975882005551073, 0, 0],
        [1.598794100277664, 1.598794100277664, -5.732954304111368],
      ],
      [
        [`Sc`, [0.3623841392015765, 0.3623841392016186, 0.7247682784030762]],
        [`Sc`, [0.6376158607984923, 0.637615860798534, 0.2752317215969242]],
        [`H`, [0.25, 0.75, 0.5]],
        [`H`, [0.75, 0.25, 0.5]],
        [`Ru`, [0, 0, 0]],
      ],
    )
    const image_atoms = find_image_atoms(structure, image_options(completion))
    validate_image_tuples(structure, image_atoms)
    expect(image_atoms.every(([idx, , , is_completion]) => idx === 4 && !is_completion)).toBe(
      true,
    )
    expect(new Set(image_atoms.map(([, , abc]) => abc.join(`,`)))).toEqual(
      new Set([`1,0,0`, `0,1,0`, `1,1,0`, `0,0,1`, `1,0,1`, `0,1,1`, `1,1,1`]),
    )
  },
)

test(`find_image_atoms handles a degenerate (zero-volume) lattice without NaN`, () => {
  // two parallel lattice vectors -> zero volume; perpendicular heights are
  // ill-defined and naively divide by zero, which must not crash or yield NaN
  const degenerate_matrix: Matrix3x3 = [
    [10, 0, 0],
    [10, 0, 0], // parallel to the first vector
    [0, 0, 10],
  ]
  const degenerate = make_crystal(degenerate_matrix, [
    [`Na`, [0.05, 0.5, 0.005]],
    [`Cl`, [0.5, 0.5, 0.6]],
  ])

  // zero volume makes every cell height Infinity, so every face tolerance is 0 (also along the
  // healthy c axis Na sits on), and the periodic bond search is skipped instead of throwing
  for (const completion of COMPLETIONS)
    expect(find_image_atoms(degenerate, image_options(completion))).toEqual([])
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
// oxfmt-ignore
test.each([
  // Atoms sit within the unit cell, so this is treated as a normal crystal and generates
  // image atoms near cell boundaries. At most 10% of atoms read as outside the [-0.1, 1.1]
  // margin, the trajectory-detection threshold.
  { name: `normal cell`, content: normal_cell_extxyz, expect_images: true },
  // Detected as trajectory data → no image atoms, structure returned unchanged. A parsed
  // trajectory frame keeps its unwrapped coords, so 2 of 8 atoms (17 Å and -2 Å in a 15 Å
  // box) read as outside the margin: the heuristic fires on real parsed data.
  { name: `trajectory-like cell`, content: trajectory_like_extxyz, expect_images: false },
])(`find_image_atoms on a parsed $name`, async ({ content, expect_images }) => {
  const run = await open_trajectory(content, { filename: `test.xyz` })
  const structure = run.preview.structure as Crystal
  run.dispose()
  if (!structure.lattice) throw new Error(`Structure should have lattice`)

  const images = find_image_atoms(structure, image_options())
  const imaged_sites = get_pbc_image_sites(structure, image_options()).sites
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
  const threshold = structure.sites.length * 0.1
  if (expect_images) expect(atoms_outside.length).toBeLessThanOrEqual(threshold)
  else expect(atoms_outside.length).toBeGreaterThan(threshold)
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
      abc: idx < outside_atoms ? [1.2, 0.5, 0.5] : [0.01, 0.5, 0.5],
    })),
  )

  const images = find_image_atoms(structure, image_options())
  expect(images.length === 0).toBe(expect_skip)
  expect(
    get_pbc_image_sites(structure, image_options()).sites.length > structure.sites.length,
  ).toBe(!expect_skip)
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
    const image_atoms = find_image_atoms(structure, image_options())
    validate_image_tuples(structure, image_atoms)

    // the corner atom has replicas in every +a/+b/+c combination; the center atom is beyond the
    // face tolerance so gets no boundary images (bond-completing ones are allowed)
    const corner_xyz = image_atoms.filter(([idx]) => idx === 0).map(([, xyz]) => xyz)
    // oxfmt-ignore
    for (const shift of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
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

    const image_sites = get_pbc_image_sites(structure, image_options()).sites.slice(
      structure.sites.length,
    )
    expect(image_sites).toHaveLength(image_atoms.length)
    for (const [idx, [, expected_xyz, expected_abc]] of image_atoms.entries()) {
      for (let dim = 0; dim < 3; dim++) {
        expect(image_sites[idx].xyz[dim]).toBeCloseTo(expected_xyz[dim], 10)
        expect(image_sites[idx].abc[dim]).toBeCloseTo(expected_abc[dim], 10)
      }
    }
  },
)

// The face tolerance is 0.1 Å, i.e. 0.02 fractional in this 5 Å cell, and the check is a strict
// `|coord| < tol`, so a coordinate sitting exactly at the tolerance generates nothing. Face rows
// ([x, 0.5, 0.5]) touch one face; corner rows ([x, 0, 0]) also touch y=0 and z=0, so they yield
// several images — the cap of 26 (all 3³-1 neighbour cells) catches runaway generation. Only
// phase-1 images count.
test.each([
  { abc: [0.0199999, 0.5, 0.5], images: [1, 26], desc: `|coord| < tol` },
  { abc: [0.02, 0.5, 0.5], images: [0, 0], desc: `|coord| == tol` },
  { abc: [0.0200001, 0.5, 0.5], images: [0, 0], desc: `|coord| > tol` },
  { abc: [0.005, 0, 0], images: [1, 26], desc: `corner atom near the origin` },
  { abc: [0.015, 0, 0], images: [1, 26], desc: `corner atom just inside the tolerance` },
] as { abc: Vec3; images: [number, number]; desc: string }[])(
  `face tolerance boundary behavior: $desc`,
  ({ abc, images: [min_images, max_images] }) => {
    const image_atoms = find_image_atoms(
      make_crystal(5, [[`Na`, abc]]),
      image_options(),
    ).filter(([, , , is_completion]) => !is_completion)
    expect(image_atoms.length).toBeGreaterThanOrEqual(min_images)
    expect(image_atoms.length).toBeLessThanOrEqual(max_images)
  },
)

test(`get_pbc_image_sites preserves explicit periodic bond metadata`, () => {
  // both atoms within the 0.1 Å face tolerance of the x faces
  const structure = make_crystal(10, [
    [`C`, [0.995, 0.5, 0.5]],
    [`O`, [0.005, 0.5, 0.5]],
  ])
  structure.properties = {
    bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] }],
  }

  const with_images = get_pbc_image_sites(structure, image_options())

  expect(with_images.sites).toHaveLength(4)
  expect(with_images.properties?.bonds).toEqual([
    { site_idx_1: 0, site_idx_2: 1, order: 2, cell_shift: [1, 0, 0] },
  ])
})

// Default (polyhedra) completion: face copies plus the corners of polyhedra crossing a face.
// Metals (Cs, Pd) and the quartz files get face copies only, NaCl its 30 octahedron corners.
// oxfmt-ignore
test.each([
  { content: mp_1_struct, filename: `mp-1.json`, n_images: 7, description: `Two Cs atoms, one at (0,0,0), one at (0.5,0.5,0.5)` },
  { content: mp_2_struct, filename: `mp-2.json`, n_images: 10, description: `Four Pd atoms in FCC structure` },
  { content: nacl_poscar, filename: `NaCl-cubic.poscar`, n_images: 49, description: `8 atoms (4 Na + 4 Cl) in cubic structure` },
  { content: quartz_cif, filename: `quartz-alpha.cif`, n_images: 3, description: `Si and O atoms with some near cell edges` },
  { content: extended_xyz_quartz, filename: `quartz.extxyz`, n_images: 5, min_dist: 1e-4, tol: 1e-4, description: `Quartz structure from extended XYZ format` },
  // had 8 unbonded completion images (Ac/O copies within reach of an anchor but not bonded);
  // now only its one face atom is copied
  { content: ac2_br2_o_struct, filename: `mp-1207297.json`, n_images: 1, description: `Ac2Br2O tetragonal cell` },
  // highly oblique cells: images at their true periodic positions, possibly outside the cell
  { content: tl_bi_se2_struct, filename: `TlBiSe2.json`, n_images: 97, description: `TlBiSe2 highly oblique cell` },
  { content: mp_1204603_struct, filename: `mp-1204603.json`, n_images: 32, description: `mp-1204603 large oblique cell` },
])(
  `find_image_atoms with real structures: $description`,
  ({ content, filename, n_images, min_dist, tol }) => {
    let structure: Crystal
    if (filename.endsWith(`.json`)) structure = content as Crystal
    else {
      const parsed = parse_structure_file(content as string, filename)
      if (!(`lattice` in parsed)) throw new Error(`no lattice found in ${filename}`)
      structure = parsed
    }

    const image_atoms = find_image_atoms(structure, image_options())
    expect(image_atoms).toHaveLength(n_images)
    validate_image_tuples(structure, image_atoms, { min_dist, tol })
    expect(completion_problems(structure)).toEqual(NO_PROBLEMS)

    // one site per image tuple: (site, shift) pairs are unique, so none coincide
    const symmetrized = get_pbc_image_sites(structure, image_options())
    expect(symmetrized.sites).toHaveLength(structure.sites.length + n_images)

    // Verify no duplicate sites (coincident positions within tolerance)
    const duplicate_pairs = symmetrized.sites.flatMap((site_1, idx_1) =>
      symmetrized.sites
        .slice(idx_1 + 1)
        .filter((site_2) => euclidean_dist(site_1.xyz, site_2.xyz) < 1e-10),
    )
    expect(duplicate_pairs).toHaveLength(0)
  },
)

// Regression (mp-1204603): a 0.5 Å face tolerance imaged 114 of its 444 sites; 0.1 Å images the
// 24 on its faces. Measured along the cell heights, polyhedra corners reach at most 0.75 Å
// beyond the faces, face-atom bonds 1.11 Å.
test.each([
  [`none`, 24, 0.07],
  [`polyhedra`, 32, 0.75],
  [`boundary`, 68, 1.11],
] as const)(`mp-1204603 %s completion: %i images`, (completion, n_images, max_overhang) => {
  const images = find_image_atoms(mp_1204603_struct, image_options(completion))
  expect(images).toHaveLength(n_images)
  const heights = math.cell_heights(mp_1204603_struct.lattice.matrix)
  const overhangs = images.flatMap(([, , abc]) =>
    abc.map((coord, axis) => Math.max(0, -coord, coord - 1) * heights[axis]),
  )
  expect(Math.max(...overhangs)).toBeCloseTo(max_overhang, 2)
})

// Regression: the face tolerance is a physical 0.1 Å, so large cells (e.g. MOFs) don't
// over-generate, measured along the cell height (0.87 |a| in a hexagonal cell)
test(`find_image_atoms uses a 0.1 Å physical tolerance along the cell heights`, () => {
  const structure = make_crystal(100, [
    [`C`, [0.002, 0.5, 0.5]], // 0.2 Å from the face: no image
    [`H`, [0.0005, 0.5, 0.5]], // 0.05 Å from the face: imaged
  ])
  expect(find_image_atoms(structure, image_options()).map(([idx]) => idx)).toEqual([1])
  const hexagonal: Matrix3x3 = [
    [4, 0, 0],
    [-2, 2 * Math.sqrt(3), 0],
    [0, 0, 10],
  ]
  // 0.027 * cell height 2√3 Å = 0.094 Å from the face (0.108 Å if measured along |a| = 4 Å)
  const skewed = make_crystal(hexagonal, [[`C`, [0.027, 0.5, 0.5]]])
  expect(find_image_atoms(skewed, image_options()).map(([, , abc]) => abc)).toEqual([
    [1.027, 0.5, 0.5],
  ])
})

describe(`wrap_to_unit_cell`, () => {
  test.each([
    { input: [0.25, 0.75, 0.1], expected: [0.25, 0.75, 0.1], desc: `in-range unchanged` },
    { input: [1.3, 2.7, 3.1], expected: [0.3, 0.7, 0.1], desc: `> 1 wraps down` },
    { input: [-0.3, -0.8, -0.1], expected: [0.7, 0.2, 0.9], desc: `< 0 wraps up` },
    { input: [5.8, -10.7, 100.9], expected: [0.8, 0.3, 0.9], desc: `large values wrap` },
    { input: [1.0, -2.0, 0.0], expected: [0.0, 0.0, 0.0], desc: `exact ints -> 0` },
  ] as { input: Vec3; expected: Vec3; desc: string }[])(`$desc`, ({ input, expected }) => {
    const result = wrap_to_unit_cell(input)
    for (let dim = 0; dim < 3; dim++) {
      expect(result[dim]).toBeCloseTo(expected[dim], 8)
      expect(result[dim]).toBeGreaterThanOrEqual(0)
      expect(result[dim]).toBeLessThan(1)
    }
  })

  // Values within epsilon of 1 snap to 0 to suppress floating-point noise. The snap epsilon is
  // exactly 1e-10: 1 - 1e-10 is the first value that snaps, a value 10x further from 1 must
  // survive as itself (a real position, not float noise), and so does a tiny value near 0
  test.each([
    [1 - 1e-15, 0],
    [1 - 1e-12, 0],
    [1 - 1e-11, 0],
    [1 - 1e-10, 0],
    [1e-15, 1e-15],
    [1 - 1e-9, 1 - 1e-9],
    [1 - 1e-8, 1 - 1e-8],
    [2 - 1e-10, 0],
    [-1e-10, 0],
    [-1e-9, 1 - 1e-9],
    // Decimal halfways must round the original float, not an already-rounded product.
    [1.4999999999999997e-15, 1e-15],
    [1.5e-15, 1e-15],
    [1.5000000000000001e-15, 2e-15],
    [0.8195337599609045, 0.819533759960904],
    [0.3840773708652705, 0.38407737086527],
    [Number.MIN_VALUE, 0],
    [-0, 0],
    [Number.NaN, Number.NaN],
  ])(`wraps %d to exactly %d`, (input, expected) => {
    expect(wrap_to_unit_cell([input, input, input])).toEqual([expected, expected, expected])
  })
})

test(`find_image_atoms skips image generation along non-periodic axes (slab)`, () => {
  // Corner atom in a fully periodic cell generates images along all 3 dims. Counts are of
  // phase-1 images: phase 2 also completes the drawn 5 Å Na-Na bonds, but never across vacuum.
  const is_boundary_image = ([, , , is_completion]: ImageAtom) => !is_completion
  const periodic = make_crystal(5, [[`Na`, [0, 0, 0]]])
  const periodic_images = find_image_atoms(periodic, image_options()).filter(is_boundary_image)
  expect(periodic_images).toHaveLength(7) // 2^3 - 1 corner images

  // Slab with vacuum along z: no image may be shifted along z, also for an atom reaching past
  // the cell along z (a buckled sheet, not a scattered trajectory)
  for (const z_coord of [0, -0.3]) {
    const slab = make_crystal(5, [[`Na`, [0, 0, z_coord]]], { pbc: [true, true, false] })
    const slab_images = find_image_atoms(slab, image_options())
    expect(slab_images.filter(is_boundary_image)).toHaveLength(3) // 2^2 - 1 in-plane images
    for (const [, , img_abc] of slab_images) expect(img_abc[2]).toBe(z_coord)
  }

  // Fully non-periodic: no images at all
  const molecule_like = make_crystal(5, [[`Na`, [0, 0, 0]]], { pbc: [false, false, false] })
  expect(find_image_atoms(molecule_like, image_options())).toHaveLength(0)
})

// Explicit periodic bonds name a base site plus a cell shift, not the completion copy at their
// far end: a face Ti octahedron whose -x corner O lies across the face draws that copy through
// either its bond or its polyhedron corner. The +x corner copy beside the Ti face copy ends no
// explicit bond (they only start at base Ti), so it stays hidden. The 3.009 Å cell puts the
// copy at -0.75225 Å, where xyz + shift·L and frac_to_cart(abc + shift) differ by 1e-16: a
// position key rounding to 0.1 mÅ split them and missed 6% of such ends.
test.each([
  [6, 0.7],
  [3.009, 0.75],
])(
  `completion copies at explicit bond ends draw (a = %s Å, O at x = %s)`,
  (lattice_a, o_x) => {
    // oxfmt-ignore
    const structure = make_crystal(lattice_a, [
    [`Ti`, [0, 0.5, 0.5]], [`O`, [1 - o_x, 0.5, 0.5]], [`O`, [o_x, 0.5, 0.5]],
    [`O`, [0, 0.8, 0.5]], [`O`, [0, 0.2, 0.5]], [`O`, [0, 0.5, 0.8]], [`O`, [0, 0.5, 0.2]],
  ])
    const shift_of = (site_idx: number) =>
      site_idx === 2 ? { cell_shift: [-1, 0, 0] as Vec3 } : {}
    structure.properties = {
      bonds: [1, 2, 3, 4, 5, 6].map((site_idx) => ({
        site_idx_1: 0,
        site_idx_2: site_idx,
        order: 1,
        ...shift_of(site_idx),
      })),
    }
    const options = { ...image_options(), bonding_strategy: `explicit_only` } as const
    const imaged = get_pbc_image_sites(structure, options)
    const copy_at_x = (frac_x: number) =>
      imaged.sites.findIndex(
        (site) => site.provenance?.completion && Math.abs(site.abc[0] - frac_x) < 1e-9,
      )
    const [across_face, beside_copy] = [copy_at_x(o_x - 1), copy_at_x(2 - o_x)]
    expect([across_face > 0, beside_copy > 0]).toEqual([true, true])
    const bonds = explicit_only(imaged)
    const polyhedra = compute_polyhedra(imaged, bonds)
    expect(polyhedra.map((poly) => poly.vertex_site_idxs.length)).toEqual([6])
    for (const drawn of [
      find_drawn_completion_sites(imaged, bonds, []),
      find_drawn_completion_sites(imaged, [], polyhedra),
    ]) {
      expect([drawn.has(across_face), drawn.has(beside_copy)]).toEqual([true, false])
    }
  },
)
