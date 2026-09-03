import {
  angle_bin_centers,
  angle_bin_index,
  BondAnglePlot,
  calc_bond_angle_distribution,
  calc_bond_angles,
  resolve_angle_bins,
  to_angle_bar_series,
} from '$lib/bond-angles'
import type { BondAngleOptions, BondAngleSplitMode } from '$lib/bond-angles'
import { element_by_symbol } from '$lib/element/data'
import type { Vec3 } from '$lib/math'
import type { Molecule } from '$lib/structure'
import { calc_coordination_nums } from '$lib/coordination/calc-coordination'
import { structure_map } from '$site/structures'
import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import {
  bind_props,
  expect_plot_controls,
  make_crystal,
  make_molecule,
  make_rocksalt,
  mount_sized,
} from '../setup'

// Exact tetrahedral angle: acos(-1/3) in degrees
const TETRAHEDRAL_ANGLE = 109.47122063449069

const scaled = (vec: Vec3, length: number): Vec3 => {
  const norm = Math.hypot(...vec)
  return [(vec[0] / norm) * length, (vec[1] / norm) * length, (vec[2] / norm) * length]
}

// One central atom surrounded by `bond`-length ligands, one along each direction in `dirs`
const ligand_shell = (center: string, ligand: string, dirs: Vec3[], bond: number): Molecule =>
  make_molecule([
    [center, [0, 0, 0]],
    ...dirs.map((dir) => [ligand, scaled(dir, bond)] as [string, Vec3]),
  ])

const fixture = (id: string) => {
  const struct = structure_map.get(id)
  if (!struct) throw new Error(`fixture ${id} not found in $site/structures`)
  return struct
}

const tally = (keys: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1
  return counts
}
// Tally angles into { rounded_angle: count } so expectations read as geometry, not indices
const angle_tally = (triplets: readonly { angle: number }[]): Record<string, number> =>
  tally(triplets.map((triplet) => triplet.angle.toFixed(4)))
// ...and the same for the `A-B-C` triplet labels of a freshly computed structure
const label_tally = (
  structure: Parameters<typeof calc_bond_angles>[0],
  options: Parameters<typeof calc_bond_angles>[1] = {},
): Record<string, number> =>
  tally(calc_bond_angles(structure, options).map((triplet) => triplet.triplet))

const axis_dirs: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

// C-H 1.087 Å along the four alternating cube diagonals
const methane = ligand_shell(
  `C`,
  `H`,
  [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  1.087,
)
// S-F 1.56 Å along all six Cartesian axes
const octahedron = ligand_shell(`S`, `F`, axis_dirs, 1.56)
// Pt-Cl 2.31 Å, four ligands in the xy plane
const square_planar = ligand_shell(`Pt`, `Cl`, axis_dirs.slice(0, 4), 2.31)
// O=C=O, 1.16 Å
const linear_triatomic = make_molecule([
  [`C`, [0, 0, 0]],
  [`O`, [1.16, 0, 0]],
  [`O`, [-1.16, 0, 0]],
])

// Rocksalt NaCl: every Na is octahedrally surrounded by Cl and vice versa. 8 sites x
// C(6, 2) = 120 angles, split evenly between the two centre elements.
const rocksalt = make_rocksalt()
const palladium = fixture(`mp-2`)

describe(`calc_bond_angles analytic geometry`, () => {
  // angle_tally buckets every triplet, so the tally values also pin the total angle count
  test.each([
    [`tetrahedral methane`, methane, { [TETRAHEDRAL_ANGLE.toFixed(4)]: 6 }, `H-C-H`],
    [`octahedral SF6`, octahedron, { '90.0000': 12, '180.0000': 3 }, `F-S-F`],
    [`square planar PtCl4`, square_planar, { '90.0000': 4, '180.0000': 2 }, `Cl-Pt-Cl`],
    [`linear CO2`, linear_triatomic, { '180.0000': 1 }, `O-C-O`],
  ] as const)(
    `%s reproduces the ideal angle multiset, every angle labelled %s`,
    (_name, structure, expected, label) => {
      const triplets = calc_bond_angles(structure)
      expect(angle_tally(triplets)).toEqual(expected)
      expect(triplets.every((triplet) => triplet.triplet === label)).toBe(true)
    },
  )

  test(`every triplet names its centre and both outer site indices`, () => {
    // methane: C at site 0, H at sites 1-4; the six angles are the C(4, 2) unordered H pairs
    const triplets = calc_bond_angles(methane)
    expect(triplets.every(({ center_idx }) => center_idx === 0)).toBe(true)
    const pairs = triplets.map(({ neighbor_idxs }) => neighbor_idxs.toSorted((a, b) => a - b))
    expect(pairs.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])).toEqual([
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
      [3, 4],
    ])
    // the indices are the real atoms the angle is subtended by, so highlighting them must
    // reproduce the angle from the structure itself
    for (const { neighbor_idxs, angle } of triplets) {
      const [vec_1, vec_2] = neighbor_idxs.map((site_idx) => methane.sites[site_idx].xyz)
      const cos =
        (vec_1[0] * vec_2[0] + vec_1[1] * vec_2[1] + vec_1[2] * vec_2[2]) /
        (Math.hypot(...vec_1) * Math.hypot(...vec_2))
      expect((Math.acos(cos) * 180) / Math.PI).toBeCloseTo(angle, 9)
    }
  })

  test(`methane H-C-H angles match acos(-1/3) to double precision`, () => {
    const triplets = calc_bond_angles(methane)
    expect(triplets).toHaveLength(6) // else Math.max over an empty deviation list passes
    // Measured: all six come out at 109.471220634490692, i.e. bit-identical to
    // Math.acos(-1/3) in degrees (deviation exactly 0). Math.acos is not required to be
    // correctly rounded across engines, so assert 1e-12 deg rather than strict equality —
    // still ~10 orders below any physically meaningful angle difference.
    const exact = (Math.acos(-1 / 3) * 180) / Math.PI
    expect(exact).toBe(TETRAHEDRAL_ANGLE)
    const deviations = triplets.map((triplet) => Math.abs(triplet.angle - exact))
    expect(Math.max(...deviations)).toBeLessThan(1e-12)
  })
})

// Bonds are emitted once per unordered pair, so a one-directional neighbour list leaves every
// centre half-populated. The exact identity below only holds when both endpoints of each bond
// register the other.
test.each([`mp-1`, `mp-2`, `mp-1234`, `mp-756175`])(
  `%s yields exactly sum_atoms C(coordination_number, 2) angles`,
  (id) => {
    const structure = fixture(id)
    const { coordination_nums } = calc_coordination_nums(structure)
    const expected = coordination_nums.reduce(
      (sum, coordination_num) => sum + (coordination_num * (coordination_num - 1)) / 2,
      0,
    )
    expect(expected).toBeGreaterThan(0)
    expect(calc_bond_angles(structure, { strategy: `electroneg_ratio` })).toHaveLength(
      expected,
    )
  },
)

describe(`periodic bonding`, () => {
  // One atom per cell with a = 2 * covalent_radius: nearest neighbours sit at exactly the
  // sum of covalent radii (bonded), the face diagonal at sqrt(2) times that (not bonded).
  // Every neighbour of the single atom is therefore one of its own periodic images.
  const radius = element_by_symbol.get(`Po`)?.covalent_radius
  if (!radius) throw new Error(`Po has no covalent radius, the cell size would be arbitrary`)
  const simple_cubic = make_crystal(2 * radius, [[`Po`, [0, 0, 0]]])

  test(`six-coordinate simple cubic gives 12 right angles and 3 straight angles`, () => {
    const triplets = calc_bond_angles(simple_cubic)
    expect(angle_tally(triplets)).toEqual({ '90.0000': 12, '180.0000': 3 })
    expect(triplets).toHaveLength(15) // C(6, 2)
    // Every neighbour is a periodic image of atom 0 itself, reported by its base site index
    expect(triplets.every((triplet) => triplet.triplet === `Po-Po-Po`)).toBe(true)
    expect(
      triplets.every(({ neighbor_idxs }) => neighbor_idxs.every((idx) => idx === 0)),
    ).toBe(true)
  })

  test.each<[BondAngleOptions, number]>([
    [{}, 15],
    [{ pbc: [true, true, true] }, 15],
    // a slab keeps the 4 in-plane images: C(4, 2) = 4 right + 2 straight angles
    [{ pbc: [true, true, false] }, 6],
    [{ pbc: [false, false, false] }, 0],
  ])(`%j gives %s angles for a one-atom cell`, (options, expected) => {
    expect(calc_bond_angles(simple_cubic, options)).toHaveLength(expected)
  })

  // On real crystals periodic bonding is not a small correction: bonded as a finite box,
  // every angle that closes through a cell face is silently lost.
  test.each([
    [`mp-1`, 56, 0],
    [`mp-2`, 264, 12],
    // LuAl2 is a MgCu2-type Laves phase. With metallic radii every Al sees its full
    // 6 Al + 6 Lu shell and every Lu its 12 Al + 4 Lu shell, so the periodic count is
    // exactly 16 * C(12, 2) + 8 * C(16, 2) = 2016.
    [`mp-1234`, 2016, 564],
  ])(
    `%s has %s angles across periodic boundaries but only %s in the finite box`,
    (id, periodic, bare) => {
      const structure = fixture(id)
      expect(calc_bond_angles(structure)).toHaveLength(periodic)
      expect(calc_bond_angles(structure, { pbc: [false, false, false] })).toHaveLength(bare)
    },
  )

  // Bond displacements must stay raw pos_2 - pos_1. With a bond length of exactly a/2 the
  // centre's two partners sit at +2 and -2 Å, which minimum-imaging would both fold to -2,
  // collapsing the straight angles into {0: 1, 180: 1}.
  test(`partners exactly half a lattice vector apart stay distinct directions`, () => {
    const chain = make_crystal(4, [
      [`C`, [0, 0, 0]],
      [`C`, [0.5, 0, 0]],
    ])
    const triplets = calc_bond_angles(chain, { strategy: `electroneg_ratio` })
    expect(angle_tally(triplets)).toEqual({ '180.0000': 2 })
  })
})

describe(`triplet labelling`, () => {
  test(`distinguishes A-B-A from B-A-B`, () => {
    expect(label_tally(rocksalt)).toEqual({ 'Cl-Na-Cl': 60, 'Na-Cl-Na': 60 })
    expect(angle_tally(calc_bond_angles(rocksalt))).toEqual({
      '90.0000': 96,
      '180.0000': 24,
    })
  })

  test(`outer elements are sorted so mirrored triplets collapse to one label`, () => {
    // Formaldehyde has a centre with two DIFFERENT outer elements, so the sort is
    // load-bearing: O is listed before the hydrogens, so neighbour insertion order would
    // label the two H-C-O angles `O-C-H` and split one chemical triplet over two buckets.
    // Coordinates are built from the target angle so the expectations stay exact: O along
    // +y, the two H mirrored about it at hco_angle each.
    const [hco_angle, ch_bond, co_bond] = [121.9, 1.111, 1.208]
    const hco_rad = (hco_angle * Math.PI) / 180
    const [h_x, h_y] = [ch_bond * Math.sin(hco_rad), ch_bond * Math.cos(hco_rad)]
    const formaldehyde = make_molecule([
      [`C`, [0, 0, 0]],
      [`O`, [0, co_bond, 0]],
      [`H`, [h_x, h_y, 0]],
      [`H`, [-h_x, h_y, 0]],
    ])
    const triplets = calc_bond_angles(formaldehyde)
    expect(triplets.map((triplet) => triplet.triplet)).toEqual([`H-C-O`, `H-C-O`, `H-C-H`])
    const [hco_1, hco_2, hch] = triplets.map((triplet) => triplet.angle)
    expect(hco_1).toBeCloseTo(hco_angle, 12)
    expect(hco_2).toBeCloseTo(hco_angle, 12)
    expect(hch).toBeCloseTo(360 - 2 * hco_angle, 12) // the three angles close a full turn
  })

  test.each([
    [{ center_elements: [`Na`] }, { 'Cl-Na-Cl': 60 }],
    [{ center_elements: [`Cl`] }, { 'Na-Cl-Na': 60 }],
    [{ neighbor_elements: [`Cl`] }, { 'Cl-Na-Cl': 60 }],
    [{ center_elements: [`Na`], neighbor_elements: [`Na`] }, {}],
  ])(`element filter %j keeps %j`, (options, expected) => {
    expect(label_tally(rocksalt, options)).toEqual(expected)
  })
})

describe(`explicit bonds`, () => {
  // Computed bonds never carry a cell_shift, but explicit ones do, and the shifted partner
  // position lives only on BondPair.pos_2. Keying the neighbour list on displacement rather
  // than site index is what lets both ends of such a bond see the right direction.
  const shifted_chain = make_crystal(4, [
    [`C`, [0, 0, 0]],
    [`C`, [0.5, 0, 0]],
  ])
  shifted_chain.properties = {
    bonds: [
      { site_idx_1: 0, site_idx_2: 1, order: 1 },
      { site_idx_1: 0, site_idx_2: 1, order: 1, cell_shift: [-1, 0, 0] },
    ],
  }

  // Under a proximity strategy the same two bonds are also found as periodic contacts, with
  // the same (site pair, cell_shift) keys, so apply_explicit_bond_metadata merges rather than
  // appending a second copy of each — which would put a bond vector against itself, i.e. a
  // spurious 0 degree angle.
  test.each([`explicit_only`, `electroneg_ratio`] as const)(
    `cell_shift on an explicit bond gives one straight angle per atom under %s`,
    (strategy) => {
      const triplets = calc_bond_angles(shifted_chain, { strategy })
      // Both atoms sit between two partners 4 Å apart on the x axis: one straight angle each
      expect(triplets.map((triplet) => triplet.center_idx)).toEqual([0, 1])
      for (const triplet of triplets) expect(triplet.angle).toBeCloseTo(180, 12)
    },
  )

  // Rocksalt has a full proximity-found bond network, so a periodic explicit record on top of
  // it is the case where a mismatched key silently double-counts. Measured before the fix:
  // 132 angles as { 0: 2, 90: 104, 180: 26 } instead of the correct 120.
  test(`a periodic explicit bond does not perturb the rocksalt histogram`, () => {
    // Na0 at the origin to the -x image of Cl4 at [0.5, 0, 0]: an existing 2.82 A contact
    const with_explicit = { ...rocksalt }
    with_explicit.properties = {
      bonds: [{ site_idx_1: 0, site_idx_2: 4, order: 1, cell_shift: [-1, 0, 0] }],
    }
    const expected = { '90.0000': 96, '180.0000': 24 }
    for (const structure of [rocksalt, with_explicit]) {
      const triplets = calc_bond_angles(structure, { strategy: `electroneg_ratio` })
      expect(angle_tally(triplets)).toEqual(expected)
    }
  })

  test(`explicit_only without declared bonds yields no angles`, () => {
    expect(calc_bond_angles(methane, { strategy: `explicit_only` })).toEqual([])
  })
})

describe(`binning`, () => {
  test.each([
    [`exactly 0`, 0, { bin_width: 2 }, 0],
    [`just below the first boundary`, 1.999, { bin_width: 2 }, 0],
    [`exactly on a bin boundary`, 2, { bin_width: 2 }, 1],
    // half-open on the lower edge: 5 deg belongs to [5, 10), not to [0, 5)
    [`just below a 5 deg boundary`, 4.999999, { bin_width: 5 }, 0],
    [`exactly on a 5 deg boundary`, 5, { bin_width: 5 }, 1],
    [`exactly on an interior boundary`, 90, { bin_width: 2 }, 45],
    [`exactly 180`, 180, { bin_width: 2 }, 89],
    [`just below 180`, 179.999, { bin_width: 2 }, 89],
    [`exactly 180 with a single bin`, 180, { bin_width: 180 }, 0],
    [`exactly 0 with a single bin`, 0, { bin_width: 180 }, 0],
    // 180/7 is not binary-exact, so 3 * bin_width evaluates to 77.14285714285714 while
    // 3 * bin_width recomputed by the division lands a hair above it: the boundary falls one
    // bin LOW rather than into the upper bin. Documented, not fixed — only exactly-on-boundary
    // angles are affected, they move by a single bin, and every width the UI can produce
    // (0.5 deg slider steps) is binary-exact.
    [`a boundary of a non-binary-exact width`, 3 * (180 / 7), { n_bins: 7 }, 2],
  ])(`%s lands in the expected bin`, (_name, angle, options, expected_bin) => {
    const { n_bins, bin_width } = resolve_angle_bins(options)
    expect(angle_bin_index(angle, n_bins, bin_width)).toBe(expected_bin)
  })

  test(`bin centers sit half a width above each lower edge`, () => {
    expect(angle_bin_centers(4, 45)).toEqual([22.5, 67.5, 112.5, 157.5])
  })

  test.each([
    [{ bin_width: 2, n_bins: 90 }, /not both/],
    [{ n_bins: 0 }, /positive integer/],
    [{ n_bins: 2.5 }, /positive integer/],
    [{ bin_width: 0 }, /must be a number in/],
    [{ bin_width: -1 }, /must be a number in/],
    [{ bin_width: 181 }, /must be a number in/],
    // bounding the WIDTH to (0, 180] bounded nothing: 1e-5 deg asked for 18 million bins
    [{ bin_width: 1e-5 }, /spans 18000000 bins .* past the 100000 limit/],
    [{ n_bins: 100_001 }, /positive integer <= 100000/],
  ])(`resolve_angle_bins(%j) throws`, (options, message) => {
    expect(() => resolve_angle_bins(options)).toThrow(message)
  })

  test.each([
    [{ bin_width: 2 }, 90, 2],
    [{ bin_width: 5 }, 36, 5],
    [{ n_bins: 36 }, 36, 5],
    [{ bin_width: 7 }, 26, 7], // does not divide 180: last bin overhangs to 182
    [{ bin_width: 0.0018 }, 100_000, 0.0018], // exactly at the bin cap
    [{}, 90, 2], // default
  ])(`resolve_angle_bins(%j) -> %s bins of %s deg`, (options, n_bins, bin_width) => {
    expect(resolve_angle_bins(options)).toEqual({ n_bins, bin_width })
  })
})

describe(`calc_bond_angle_distribution`, () => {
  test(`octahedron histogram puts 12 counts at 90 deg and 3 at 180 deg`, () => {
    const data = calc_bond_angle_distribution(octahedron, { bin_width: 2 })
    expect(data.n_angles).toBe(15)
    expect(data.total.counts[angle_bin_index(90, data.n_bins, data.bin_width)]).toBe(12)
    expect(data.total.counts.at(-1)).toBe(3)
    expect(data.total.counts.reduce((sum, count) => sum + count, 0)).toBe(15)
    expect(data.by_triplet.map((series) => series.triplet)).toEqual([`F-S-F`])
  })

  test(`per-triplet counts partition the total`, () => {
    const data = calc_bond_angle_distribution(rocksalt, { bin_width: 3 })
    expect(data.by_triplet.map((series) => series.triplet)).toEqual([`Cl-Na-Cl`, `Na-Cl-Na`])
    expect(data.by_triplet.map((series) => series.n_angles)).toEqual([60, 60])
    for (const [bin_idx, total] of data.total.counts.entries()) {
      expect(data.by_triplet.reduce((sum, series) => sum + series.counts[bin_idx], 0)).toBe(
        total,
      )
    }
  })

  test(`split_by_triplet=false skips the per-triplet histograms but keeps the total`, () => {
    const data = calc_bond_angle_distribution(octahedron, { split_by_triplet: false })
    expect(data.by_triplet).toEqual([])
    expect(data.n_angles).toBe(15)
  })

  test(`empty and angle-free structures give zeroed histograms rather than NaN`, () => {
    for (const structure of [make_molecule([]), make_molecule([[`H`, [0, 0, 0]]])]) {
      const data = calc_bond_angle_distribution(structure)
      expect(data.n_angles).toBe(0)
      expect(data.total.counts.every((count) => count === 0)).toBe(true)
    }
  })

  test(`center_elements keeps only angles centred on the filtered atoms`, () => {
    // Only S has two neighbours, so filtering to it keeps all 15; filtering it out keeps none
    expect(calc_bond_angle_distribution(octahedron, { center_elements: [`S`] }).n_angles).toBe(
      15,
    )
    expect(calc_bond_angle_distribution(octahedron, { center_elements: [`F`] }).n_angles).toBe(
      0,
    )
  })
})

// Mounting BarPlot in happy-dom costs seconds, so every case here earns its mount
describe(`BondAnglePlot`, { timeout: 30_000 }, () => {
  // Water, so a lattice-less molecule exercises the single-structure input shape
  const water = make_molecule([
    [`O`, [0, 0, 0]],
    [`H`, [0.757, 0.587, 0]],
    [`H`, [-0.757, 0.587, 0]],
  ])
  const mount_plot = (props: Record<string, unknown>) =>
    mount_sized(BondAnglePlot, props, { selector: `.bar-plot, .status-message, section` })

  test.each([
    [`single crystal`, { structures: rocksalt }],
    // is_crystal() would misread a lattice-less molecule as a Record of structures
    [`single lattice-less molecule`, { structures: water }],
    [`record of structures`, { structures: { NaCl: rocksalt, Pd: palladium } }],
    [
      `record with per-entry color`,
      {
        structures: { NaCl: { structure: rocksalt, color: `#ff0000` } },
      },
    ],
    [
      `array of entries`,
      {
        structures: [
          { label: `NaCl`, structure: rocksalt },
          { label: `Pd`, structure: palladium },
        ],
      },
    ],
  ])(`renders bars on a 0-180 degree axis for %s`, async (_name, props) => {
    const root = await mount_plot(props)
    expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
    expect(root.querySelectorAll(`path, rect`).length).toBeGreaterThan(0)
    expect(root.textContent).toContain(`Bond Angle (°)`)
    expect(root.textContent).toContain(`Count`)
  })

  // by_triplet is the default and is covered above
  test.each([`by_structure`, `none`] as BondAngleSplitMode[])(
    `split_mode=%s renders without error`,
    async (split_mode) => {
      const root = await mount_plot({
        structures: { NaCl: rocksalt, Pd: palladium },
        split_mode,
      })
      expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
    },
  )

  test(`normalize=density relabels the value axis`, async () => {
    const root = await mount_plot({ structures: rocksalt, normalize: `density` })
    expect(root.textContent).toContain(`Density (1/°)`)
    expect(root.textContent).not.toContain(`Count`)
  })

  test(`forwards flat control props and binding through StructureBarPlot`, async () => {
    expect.hasAssertions()
    const controls_state = { controls_open: true }
    const root = await mount_plot(
      bind_props(
        {
          structures: water,
          show_controls: true,
          controls_toggle_props: { 'data-testid': `bond-angle-toggle` },
          controls_pane_props: { 'data-testid': `bond-angle-pane` },
        },
        controls_state,
      ),
    )
    await expect_plot_controls(root, controls_state, `bond-angle`)
  })

  test.each([
    [true, `Drag and drop structure files`],
    [false, `No bond angles to display`],
  ])(`allow_file_drop=%s shows %s when empty`, async (allow_file_drop, message) => {
    const root = await mount_plot({ structures: {}, allow_file_drop })
    expect(root.textContent).toContain(message)
  })

  // 180 is the inclusive upper bound in resolve_angle_bins, so it must still plot
  test(`accepts a bin_width of exactly 180`, async () => {
    const root = await mount_plot({ structures: rocksalt, bin_width: 180 })
    expect(root.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
  })

  // bin_width is a public prop and resolve_angle_bins throws on anything outside (0, 180],
  // so an unguarded binning derived would take the whole render down with it
  test.each([0, -2, 500, 180.0001, NaN, Infinity])(
    `reports bin_width=%s as an error instead of crashing the render`,
    async (bin_width) => {
      // the error StatusMessage is a sibling of the mount root, so read the whole container
      const container = (await mount_plot({ structures: rocksalt, bin_width })).parentElement
      await tick()
      expect(container?.textContent).toContain(`bin_width must be a number in (0, 180]`)
      expect(container?.querySelector(`svg`)).toBeNull()
    },
  )

  // neighbor_query throws on a non-finite position; an unguarded compute derived would take
  // the whole render down with it. The healthy structure next to it must still plot.
  test(`reports a NaN site as an error and keeps plotting the other structures`, async () => {
    const broken = make_molecule([
      [`O`, [NaN, 0, 0]],
      [`H`, [0.757, 0.587, 0]],
    ])
    const container = (await mount_plot({ structures: { NaCl: rocksalt, broken } }))
      .parentElement
    await tick()
    expect(container?.textContent).toMatch(/broken: .*non-finite position/)
    expect(container?.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
  })
})

// The mounted plot only shows that bars exist, so the weighting maths is asserted against
// to_angle_bar_series, the function the component feeds BarPlot. NaCl and Pd have very
// different angle counts, so an unweighted sum would be dominated by one of them.
describe(`to_angle_bar_series density weighting`, () => {
  const BIN_WIDTH = 3
  const entries = [rocksalt, palladium].map((structure, idx) => ({
    label: [`NaCl`, `Pd`][idx],
    data: calc_bond_angle_distribution(structure, { bin_width: BIN_WIDTH }),
  }))
  const integral_of = (y_values: readonly number[]): number =>
    y_values.reduce((sum, value) => sum + value, 0) * BIN_WIDTH

  test.each([`by_triplet`, `none`] as BondAngleSplitMode[])(
    `split_mode=%s makes the union of the plotted series integrate to 1`,
    (split_mode) => {
      const series = to_angle_bar_series(entries, split_mode, `density`)
      const total = series.reduce((sum, one) => sum + integral_of(one.y), 0)
      // ~200 float multiply-accumulates over two structures, so ~1e-15 of drift at most
      expect(total).toBeCloseTo(1, 12)
    },
  )

  test(`split_mode=by_structure gives every structure its own unit-area density`, () => {
    const series = to_angle_bar_series(entries, `by_structure`, `density`)
    expect(series).toHaveLength(2)
    for (const one of series) expect(integral_of(one.y)).toBeCloseTo(1, 12)
  })

  test(`normalize=counts leaves the raw angle counts untouched`, () => {
    const series = to_angle_bar_series(entries, `by_structure`, `counts`)
    expect(series.map((one) => one.y.reduce((sum, value) => sum + value, 0))).toEqual(
      entries.map((entry) => entry.data.n_angles),
    )
  })
})
