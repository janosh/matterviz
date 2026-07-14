import type { ElementSymbol } from '$lib'
import { calc_coordination_nums } from '$lib/coordination'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import * as ap from '$lib/structure/atom-properties'
import { get_pbc_image_sites } from '$lib/structure/pbc'
import { make_supercell } from '$lib/structure/supercell'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test, vi } from 'vitest'
import { make_crystal } from '../setup'

type MoyoDatasetWithOrigMap = MoyoDataset & { orig_site_indices_by_input_idx?: number[][] }

const make_struct = (sites: { xyz: Vec3; element?: ElementSymbol }[]): Crystal =>
  make_crystal(
    10,
    sites.map(({ xyz, element = `C` }) => ({ element, xyz, label: element })),
    { charge: 0 },
  )

// Helper: Create cubic structure with PBC for testing
const make_cubic_structure = (
  sites: { abc: Vec3; element?: ElementSymbol; label?: string }[],
  lattice_size: number,
  pbc: [boolean, boolean, boolean] = [true, true, true],
): Crystal =>
  make_crystal(
    lattice_size,
    sites.map(({ abc, element = `C`, label }) => ({ element, abc, label: label ?? element })),
    { pbc, charge: 0 },
  )

describe(`Color Scales`, () => {
  test(`d3 scales`, () => expect(ap.get_d3_color_scales()).toContain(`interpolateViridis`))

  test.each([
    [[1, 2, 3, 4, 5], `continuous`, true],
    [[1, 2, 3, 1, 2], `categorical`, false],
    [[5, 5, 5], `continuous`, false],
  ] as const)(`apply_color_scale %s`, (vals, scale_type, diff) => {
    const { colors } = ap.apply_color_scale([...vals], `interpolateViridis`, scale_type)
    expect(colors).toHaveLength(vals.length)
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true)
    if (diff) expect(colors[0]).not.toBe(colors.at(-1))
    if (scale_type === `categorical`) expect(colors[0]).toBe(colors[3])
  })

  test(`categorical strings`, () => {
    const { colors } = ap.apply_categorical_color_scale([`a`, `b`, `c`, `a`])
    expect([colors.length, colors[0] === colors[3]]).toEqual([4, true])
  })

  test(`invalid scale fallback`, () => {
    const { colors } = ap.apply_color_scale([1, 2], `bad`)
    expect(colors[0]).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe(`Coordination`, () => {
  test(`bonded atoms CN > 0`, () => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `O` },
    ])
    const { values } = ap.get_coordination_colors(structure)
    expect(values.every((val) => typeof val === `number` && val > 0)).toBe(true)
  })

  test(`isolated atoms CN = 0`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [100, 100, 100] }])
    const { values } = ap.get_coordination_colors(structure)
    expect(values).toEqual([0, 0])
  })

  test(`linear chain middle > end`, () => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `C` },
      { xyz: [3, 0, 0], element: `C` },
    ])
    const { values } = ap.get_coordination_colors(structure)
    expect(typeof values[1] === `number` && values[1] > (values[0] as number)).toBe(true)
  })

  test.each([`electroneg_ratio`, `solid_angle`] as const)(`%s strategy`, (strategy) => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `O` },
    ])
    const { values } = ap.get_coordination_colors(structure, strategy)
    expect(values.some((val) => typeof val === `number` && val > 0)).toBe(true)
  })

  describe(`PBC-aware coordination`, () => {
    test.each<{
      name: string
      sites: { abc: Vec3; element?: ElementSymbol }[]
      lattice_size: number
      pbc: [boolean, boolean, boolean]
      expected_length: number
      check: (vals: (number | string)[]) => boolean
    }>([
      {
        name: `cell boundaries`,
        sites: [{ abc: [0, 0, 0] }, { abc: [0.5, 0, 0] }],
        lattice_size: 3,
        pbc: [true, true, true],
        expected_length: 2,
        check: (vals) => vals.every((val) => typeof val === `number` && val > 0),
      },
      {
        name: `BCC symmetry`,
        sites: [
          { abc: [0, 0, 0], element: `Cs` },
          { abc: [0.5, 0.5, 0.5], element: `Cs` },
        ],
        lattice_size: 5,
        pbc: [true, true, true],
        expected_length: 2,
        check: (vals) => vals[0] === 8 && vals[1] === 8,
      },
      {
        name: `NaCl corner`,
        sites: [
          { abc: [0, 0, 0], element: `Na` },
          { abc: [0.5, 0, 0], element: `Cl` },
          { abc: [0, 0.5, 0], element: `Cl` },
          { abc: [0, 0, 0.5], element: `Cl` },
        ],
        lattice_size: 5,
        pbc: [true, true, true],
        expected_length: 4,
        check: (vals) =>
          vals.every((val) => typeof val === `number` && val > 0) &&
          typeof vals[0] === `number` &&
          vals[0] >= 3,
      },
      {
        name: `partial PBC`,
        sites: [{ abc: [0, 0, 0.3] }, { abc: [0.5, 0.5, 0.3] }],
        lattice_size: 5,
        pbc: [true, true, false],
        expected_length: 2,
        check: (vals) => vals.length === 2,
      },
      {
        // Regression: in the >20-atom optimized boundary-imaging path an inverted filter
        // imaged atoms on the wrong side, so edge atoms lost their cross-cell neighbors
        // (CN=1/0). A and B sit near opposite x faces and bond ONLY across the periodic
        // boundary (1.44Å); 24 interior fillers push the count past the optimization
        // threshold. The symmetric pair must each see the other (CN >= 1, equal).
        name: `large structure boundary atoms keep cross-edge PBC neighbors`,
        sites: [
          { abc: [0.06, 0.5, 0.5] as Vec3, element: `C` },
          { abc: [0.94, 0.5, 0.5] as Vec3, element: `C` },
          ...Array.from({ length: 24 }, (_, idx): { abc: Vec3; element: ElementSymbol } => ({
            abc: [0.5, 0.1 + (idx % 6) * 0.15, 0.2 + Math.floor(idx / 6) * 0.2] as Vec3,
            element: `C`,
          })),
        ],
        lattice_size: 12,
        pbc: [true, true, true] as [boolean, boolean, boolean],
        expected_length: 26,
        check: (vals: (number | string)[]) =>
          typeof vals[0] === `number` &&
          typeof vals[1] === `number` &&
          vals[0] >= 1 &&
          vals[1] >= 1 &&
          vals[0] === vals[1],
      },
      {
        name: `small cell, both atoms near boundaries`,
        sites: [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.5, 0.5, 0.5] as Vec3 }],
        lattice_size: 3,
        pbc: [true, true, true],
        expected_length: 2,
        check: (vals) => vals.every((cn) => typeof cn === `number` && cn >= 0),
      },
      {
        name: `non-periodic (molecular) structure`,
        sites: [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.12, 0, 0] as Vec3, element: `O` }],
        lattice_size: 10,
        pbc: [false, false, false],
        expected_length: 2,
        check: (vals) => vals.every((cn) => typeof cn === `number` && cn > 0),
      },
      {
        // returns CN for the 2 original sites only, not the 2 + 26·2 image atoms
        name: `output excludes PBC image atoms`,
        sites: [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.3, 0, 0] as Vec3 }],
        lattice_size: 4,
        pbc: [true, true, true],
        expected_length: 2,
        check: (vals) => vals.every((cn) => typeof cn === `number` && cn > 0),
      },
      {
        // 64-atom grid exercises the optimized interior-atom imaging path
        name: `large interior-atom grid`,
        sites: Array.from({ length: 64 }, (_, idx) => ({
          abc: [
            ((idx % 4) + 0.5) / 5,
            ((Math.floor(idx / 4) % 4) + 0.5) / 5,
            (Math.floor(idx / 16) + 0.5) / 5,
          ] as Vec3,
        })),
        lattice_size: 8,
        pbc: [true, true, true],
        expected_length: 64,
        check: (vals) => vals.some((cn) => typeof cn === `number` && cn > 0),
      },
      {
        name: `ionic atoms at exact cell boundary (NaCl)`,
        sites: [
          { abc: [0, 0, 0] as Vec3, element: `Na` },
          { abc: [0.5, 0, 0] as Vec3, element: `Cl` },
        ],
        lattice_size: 5,
        pbc: [true, true, true],
        expected_length: 2,
        check: (vals) => vals.every((cn) => typeof cn === `number` && cn > 0),
      },
      {
        // atoms at 0.1 and 0.9 bond across the wrap (1 Å apart through the boundary)
        name: `atoms just inside opposite faces bond through PBC`,
        sites: [{ abc: [0.1, 0.5, 0.5] as Vec3 }, { abc: [0.9, 0.5, 0.5] as Vec3 }],
        lattice_size: 5,
        pbc: [true, true, true],
        expected_length: 2,
        check: (vals) => vals.every((cn) => typeof cn === `number` && cn > 0),
      },
      {
        name: `mixed interior + boundary atoms`,
        sites: [
          { abc: [0, 0, 0] as Vec3, element: `Fe` },
          { abc: [0.5, 0.5, 0.5] as Vec3, element: `Fe` },
          { abc: [0.25, 0.25, 0.25] as Vec3, element: `Fe` },
          { abc: [0.75, 0.75, 0.75] as Vec3, element: `Fe` },
        ],
        lattice_size: 5,
        pbc: [true, true, true],
        expected_length: 4,
        check: (vals) => vals.every((cn) => typeof cn === `number`),
      },
      {
        name: `partial PBC, atoms inside cell`,
        sites: [{ abc: [0, 0, 0.1] as Vec3 }, { abc: [0.5, 0.5, 0.1] as Vec3 }],
        lattice_size: 8,
        pbc: [true, true, false],
        expected_length: 2,
        check: (vals) => vals.every((cn) => typeof cn === `number` && cn >= 0),
      },
      {
        name: `very large cell with sparse atoms`,
        sites: [
          { abc: [0.1, 0.1, 0.1] as Vec3 },
          { abc: [0.2, 0.1, 0.1] as Vec3, element: `O` },
          { abc: [0.9, 0.9, 0.9] as Vec3, element: `N` },
        ],
        lattice_size: 50,
        pbc: [true, true, true] as [boolean, boolean, boolean],
        expected_length: 3,
        check: (vals: (number | string)[]) =>
          vals.every((cn) => typeof cn === `number` && cn >= 0),
      },
    ])(`$name`, ({ sites, lattice_size, pbc, expected_length, check }) => {
      const structure = make_cubic_structure(sites, lattice_size, pbc)
      const { values, colors } = ap.get_coordination_colors(structure)

      expect(values).toHaveLength(expected_length)
      expect(colors).toHaveLength(expected_length)
      expect(check(values)).toBe(true)
    })

    test.each([`electroneg_ratio`, `solid_angle`] as const)(
      `works with %s strategy`,
      (strategy) => {
        const structure = make_cubic_structure(
          [{ abc: [0, 0, 0] as Vec3 }, { abc: [0.3, 0, 0] as Vec3 }],
          5,
        )
        const { values } = ap.get_coordination_colors(structure, strategy)
        expect(values).toHaveLength(2)
        expect(values.every((cn) => typeof cn === `number` && cn > 0)).toBe(true)
      },
    )

    // CoordinationBarPlot and the 3D viewer both call calc_structure_coordination, so
    // their boundary-atom CN must agree and must exceed the raw-cell count (regression:
    // the bar plot previously ran on the raw cell and undercounted boundary atoms).
    test.each([`electroneg_ratio`, `solid_angle`] as const)(
      `calc_structure_coordination expands PBC and matches viewer CN (%s)`,
      (strategy) => {
        const structure = make_cubic_structure(
          [
            { abc: [0, 0, 0] as Vec3, element: `Na` },
            { abc: [0.5, 0, 0] as Vec3, element: `Cl` },
            { abc: [0, 0.5, 0] as Vec3, element: `Cl` },
            { abc: [0, 0, 0.5] as Vec3, element: `Cl` },
          ],
          5,
        )
        const orig_count = structure.sites.length
        const bar_plot_cn = ap
          .calc_structure_coordination(structure, strategy)
          .sites.map((site) => site.coordination_num)
        const viewer_cn = ap.get_coordination_colors(structure, strategy).values
        const raw_cn = calc_coordination_nums(structure, strategy).sites.map(
          (site) => site.coordination_num,
        )

        expect(bar_plot_cn).toHaveLength(orig_count)
        expect(bar_plot_cn).toEqual(viewer_cn)
        // Corner Na bonds to Cl images across the boundary, so PBC CN > raw-cell CN
        expect(bar_plot_cn[0]).toBeGreaterThan(raw_cn[0])
      },
    )

    describe(`Boundary detection optimization`, () => {
      // Brute-force coordination ground truth: image every atom by a full `shells`-cell
      // shell (no cutoff approximation), tagging orig_site_idx exactly as production's
      // imaging does so the competitive electroneg_ratio strategy treats images as
      // their original atom. `shells` must exceed the cell's real bond reach in cells.
      const brute_force_cn = (
        matrix: [Vec3, Vec3, Vec3],
        sites: { element: ElementSymbol; abc: Vec3 }[],
        shells = 3,
      ): number[] => {
        const structure = make_crystal(matrix, sites, { charge: 0 })
        const frac_to_cart = math.create_frac_to_cart(matrix)
        const range = Array.from({ length: 2 * shells + 1 }, (_, idx) => idx - shells)
        const offsets = range
          .flatMap((dx) => range.flatMap((dy) => range.map((dz) => [dx, dy, dz] as Vec3)))
          .filter(([dx, dy, dz]) => dx !== 0 || dy !== 0 || dz !== 0)
        const images = structure.sites.flatMap((site, src) =>
          offsets.map((off) => {
            const abc: Vec3 = [
              site.abc[0] + off[0],
              site.abc[1] + off[1],
              site.abc[2] + off[2],
            ]
            const properties = { ...site.properties, orig_site_idx: src }
            return { ...site, abc, xyz: frac_to_cart(abc), properties }
          }),
        )
        return calc_coordination_nums({ ...structure, sites: [...structure.sites, ...images] })
          .sites.slice(0, sites.length)
          .map((site) => site.coordination_num)
      }

      // Regression guards: get_coordination_colors must equal the brute-force ground
      // truth across the regimes where the old imaging was wrong — oblique cells
      // (heights ≠ vector lengths), thin cells (need >1 image shell), large-radius
      // atoms (bonds exceed the old hard-coded 5 Å reach) and atoms on a cell boundary
      // (abc component = 1, which must wrap so its cross-cell images are not dropped).
      test.each<{
        name: string
        matrix: [Vec3, Vec3, Vec3]
        element: ElementSymbol
        abc_list: Vec3[]
      }>([
        {
          name: `oblique (sheared) cell`,
          matrix: [
            [12, 0, 0],
            [-12, 9, 0],
            [12, -12, 6],
          ] as [Vec3, Vec3, Vec3],
          element: `C`,
          abc_list: [
            [0.75, 0.9, 0.85],
            [0.95, 0.75, 0.85],
            [0.15, 0.95, 0.4],
            [0.05, 0.75, 0.4],
            [0.6, 0.05, 0.9],
            [0.9, 0.1, 0.7],
            [1, 0.45, 0.05],
            [0.55, 0.7, 0.5],
            [0.7, 0.7, 0.5],
            [0.5, 0.75, 0.25],
            [0.3, 0.65, 0.6],
            [0.2, 0.85, 0.8],
            [0.75, 0.95, 0.9],
            [0.4, 0.55, 0.4],
            [0.3, 0.65, 0.35],
            [0.75, 0.2, 0.4],
            [0.35, 0.4, 0.9],
            [0.35, 0.9, 0.45],
            [0.1, 0.6, 0.25],
            [0.95, 0.7, 0.2],
            [0.1, 0.45, 0.4],
            [0.4, 0.85, 0.75],
            [0.45, 0.35, 0.75],
            [0.3, 0.35, 0.5],
            [0.8, 0.95, 0.05],
          ] as Vec3[],
        },
        {
          // c-axis height 3 Å < ~5 Å reach → needs 2 image shells along c
          name: `thin cell (multi-shell)`,
          matrix: [
            [6, 0, 0],
            [0, 6, 0],
            [0, 0, 3],
          ] as [Vec3, Vec3, Vec3],
          element: `C`,
          abc_list: [
            [0.1, 0.1, 0.05],
            [0.1, 0.5, 0.95],
            [0.5, 0.1, 0.5],
            [0.5, 0.5, 0.1],
            [0.9, 0.9, 0.9],
            [0.3, 0.7, 0.4],
            [0.7, 0.3, 0.6],
            [0.2, 0.8, 0.2],
            [0.85, 0.2, 0.8],
            [0.5, 0.9, 0.5],
          ] as Vec3[],
        },
        {
          // Cs covalent radius ~2.4 Å → bonds reach well past the old fixed 5 Å cutoff
          name: `large-radius atoms (>5 Å bonds)`,
          matrix: [
            [9, 0, 0],
            [0, 9, 0],
            [0, 0, 9],
          ] as [Vec3, Vec3, Vec3],
          element: `Cs`,
          abc_list: [
            [0.1, 0.1, 0.1],
            [0.7, 0.1, 0.1],
            [0.1, 0.7, 0.1],
            [0.1, 0.1, 0.7],
            [0.7, 0.7, 0.7],
            [0.4, 0.4, 0.4],
          ] as Vec3[],
        },
        {
          // atom 0 sits on the y=1 boundary; without wrapping, its cross-cell image
          // bonding atom 1 (at 4.0 Å) is dropped and atom 1's CN comes out 0 not 1
          name: `boundary atom (abc component = 1)`,
          matrix: [
            [8.5, 0, 0],
            [0, 8.5, 0],
            [0, 0, 8.5],
          ] as [Vec3, Vec3, Vec3],
          element: `K`,
          abc_list: [
            [0.05, 1, 0.55],
            [0.8, 0, 0.95],
          ] as Vec3[],
        },
      ])(
        `coordination matches brute-force ground truth: $name`,
        ({ matrix, element, abc_list }) => {
          const sites = abc_list.map((abc) => ({ element, abc }))
          const reference = brute_force_cn(matrix, sites)
          expect(
            ap.get_coordination_colors(make_crystal(matrix, sites, { charge: 0 })).values,
          ).toEqual(reference)
          // Sanity: the structure actually forms bonds (else the comparison is vacuous)
          expect(reference.some((cn) => cn > 0)).toBe(true)
        },
      )

      test(`partial PBC keeps non-periodic coordinates outside the cell`, () => {
        // z is non-periodic; the two atoms are 9 Å apart in vacuum and must NOT bond.
        // Wrapping z (1.2 → 0.2) would fold them ~1 Å apart and invent a bond.
        const structure = make_crystal(
          [
            [10, 0, 0],
            [0, 10, 0],
            [0, 0, 10],
          ],
          [
            { element: `C`, abc: [0.5, 0.5, 1.2] },
            { element: `C`, abc: [0.5, 0.5, 0.3] },
          ],
          { pbc: [true, true, false], charge: 0 },
        )
        expect(ap.get_coordination_colors(structure).values).toEqual([0, 0])
      })

      test(`warns once and still returns finite CN for pathological thin cells`, () => {
        const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
        // c-axis height 1 Å ≪ ~5 Å reach → needs 6 image shells, far exceeding the cap
        const structure = make_crystal(
          [
            [5, 0, 0],
            [0, 5, 0],
            [0, 0, 1],
          ],
          [
            { element: `C`, abc: [0.2, 0.2, 0.5] },
            { element: `C`, abc: [0.6, 0.6, 0.5] },
          ],
          { charge: 0 },
        )
        const { values } = ap.get_coordination_colors(structure)
        // capped imaging must not throw or produce NaN/undefined CN
        expect(values.every((cn) => typeof cn === `number` && Number.isFinite(cn))).toBe(true)
        expect(warn_spy).toHaveBeenCalledTimes(1)
        expect(warn_spy.mock.calls[0][0]).toContain(`capping PBC images`)
        warn_spy.mockRestore()
      })

      test(`mixed-element cell coordination matches brute-force ground truth`, () => {
        // Rocksalt NaCl (different radii + electronegativities exercise the metal/
        // nonmetal bonding path): reach must use the larger radius (Na) so no Na-Cl
        // image is dropped. Compared against the brute-force oracle like the cases above.
        const matrix: [Vec3, Vec3, Vec3] = [
          [5.6, 0, 0],
          [0, 5.6, 0],
          [0, 0, 5.6],
        ]
        const sites: { element: ElementSymbol; abc: Vec3 }[] = [
          { element: `Na`, abc: [0, 0, 0] },
          { element: `Cl`, abc: [0.5, 0, 0] },
          { element: `Cl`, abc: [0, 0.5, 0] },
          { element: `Cl`, abc: [0, 0, 0.5] },
          { element: `Na`, abc: [0.5, 0.5, 0] },
          { element: `Na`, abc: [0.5, 0, 0.5] },
          { element: `Na`, abc: [0, 0.5, 0.5] },
          { element: `Cl`, abc: [0.5, 0.5, 0.5] },
        ]
        const reference = brute_force_cn(matrix, sites)
        expect(
          ap.get_coordination_colors(make_crystal(matrix, sites, { charge: 0 })).values,
        ).toEqual(reference)
        expect(reference.some((cn) => cn > 0)).toBe(true)
      })
    })
  })

  test(`supercell atoms track originals via orig_unit_cell_idx for color mapping`, () => {
    const unit_cell = make_cubic_structure(
      [
        { abc: [0, 0, 0], element: `Fe` },
        { abc: [0.5, 0.5, 0.5], element: `Fe` },
      ],
      4,
    )
    const supercell = make_supercell(unit_cell, [2, 2, 2])
    expect(supercell.sites).toHaveLength(16) // 2 atoms * 2³

    const orig_indices = supercell.sites.map((site) => site.properties?.orig_unit_cell_idx)
    expect(orig_indices.filter((idx) => idx === 0)).toHaveLength(8)
    expect(orig_indices.filter((idx) => idx === 1)).toHaveLength(8)
  })

  test(`image atoms use orig_site_idx for color mapping`, () => {
    const structure = make_cubic_structure([{ abc: [0, 0, 0] }], 3)
    const with_images = get_pbc_image_sites(structure)

    expect(with_images.sites.length).toBeGreaterThan(1)
    const image_atoms = with_images.sites.slice(1)
    expect(image_atoms.every((site) => site.properties?.orig_site_idx === 0)).toBe(true)
  })
})

describe(`Wyckoff`, () => {
  test(`no data → gray`, () => {
    const result = ap.get_wyckoff_colors(make_struct([{ xyz: [0, 0, 0] }]), null)
    const { colors, values } = result
    expect([colors[0], values[0]]).toEqual([`#808080`, `unknown`])
  })

  test(`with data`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])
    const { colors, values } = ap.get_wyckoff_colors(structure, {
      wyckoffs: [`a`, `b`],
    } as unknown as MoyoDataset)
    expect([values, colors[0] !== colors[1]]).toEqual([[`a|C`, `b|C`], true])
  })

  test(`duplicates same color`, () => {
    const structure = make_struct([
      { xyz: [0, 0, 0] },
      { xyz: [1, 1, 1] },
      { xyz: [2, 2, 2] },
      { xyz: [3, 3, 3] },
    ])
    const { colors } = ap.get_wyckoff_colors(structure, {
      wyckoffs: [`a`, `a`, `b`, `a`],
    } as unknown as MoyoDataset)
    expect([colors[0] === colors[1], colors[0] !== colors[2]]).toEqual([true, true])
  })

  test(`null positions`, () => {
    const result = ap.get_wyckoff_colors(
      make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }]),
      {
        wyckoffs: [null, `b`],
      } as unknown as MoyoDataset,
    )
    expect(result.values).toEqual([`unknown`, `b|C`])
  })

  test(`uses orig_site_indices_by_input_idx mapping for merged disordered sites`, () => {
    // moyo's wyckoffs array indexes the (merged) INPUT cell: input site 0 is the merged
    // O/F disordered site (original sites 0+1), input site 1 is Li (original site 2)
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `O` },
      { xyz: [1, 1, 1], element: `F` },
      { xyz: [2, 2, 2], element: `Li` },
    ])
    const result = ap.get_wyckoff_colors(structure, {
      wyckoffs: [`a`, `b`],
      orig_site_indices_by_input_idx: [[0, 1], [2]],
    } as unknown as MoyoDatasetWithOrigMap)
    expect(result.values).toEqual([`a|O`, `a|F`, `b|Li`])
  })
})

describe(`Custom`, () => {
  test(`numeric`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, { xyz: [2, 2, 2] }])
    const { values } = ap.get_custom_colors(structure, (site) => site.xyz[2])
    expect(values).toEqual([0, 1, 2])
  })

  test(`string`, () => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1, 1, 1], element: `O` },
      { xyz: [2, 2, 2], element: `C` },
    ])
    const { values, colors } = ap.get_custom_colors(
      structure,
      (site) => site.species[0].element,
    )
    expect([values, colors[0] === colors[2]]).toEqual([[`C`, `O`, `C`], true])
  })

  test(`site index`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, { xyz: [2, 2, 2] }])
    const { colors } = ap.get_custom_colors(structure, (_, idx) => idx)
    expect(new Set(colors).size).toBe(3)
  })

  test(`properties`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 0, 0] }, { xyz: [0, 1, 0] }])
    structure.sites[0].properties = { magmom: 2.5 }
    structure.sites[1].properties = { magmom: -1.0 }
    structure.sites[2].properties = { magmom: 0.5 }
    const { values } = ap.get_custom_colors(structure, (site) =>
      Number(site.properties?.magmom ?? 0),
    )
    expect(values).toEqual([2.5, -1.0, 0.5])
  })

  test(`distance`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [3, 4, 0] }, { xyz: [6, 8, 0] }])
    const { values } = ap.get_custom_colors(structure, (site) =>
      Math.hypot(site.xyz[0], site.xyz[1]),
    )
    expect(values).toEqual([0, 5, 10])
  })
})

describe(`get_atom_colors`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  test.each([
    [`element`, 0],
    [`coordination`, 2],
    [`wyckoff`, 2],
  ] as const)(`%s mode`, (mode, len) => {
    const { colors } = ap.get_atom_colors(
      structure,
      { mode },
      `electroneg_ratio`,
      mode === `wyckoff` ? null : undefined,
    )
    expect(colors).toHaveLength(len)
  })

  test(`custom with fn`, () => {
    const { values } = ap.get_atom_colors(structure, {
      mode: `custom`,
      color_fn: (_, idx) => idx * 10,
    })
    expect(values).toEqual([0, 10])
  })

  test(`custom without fn`, () => {
    // When color_fn is missing, returns empty arrays (no property coloring)
    const { colors, values } = ap.get_atom_colors(structure, { mode: `custom` })
    expect(colors).toEqual([])
    expect(values).toEqual([])
  })
})

describe(`Config`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  test(`partial uses defaults`, () => {
    const { colors } = ap.get_atom_colors(structure, { mode: `coordination` })
    expect(colors).toHaveLength(2)
  })

  test(`empty defaults to element`, () => {
    const { colors } = ap.get_atom_colors(structure, {})
    expect(colors).toHaveLength(0)
  })

  test(`scales differ`, () => {
    const result_plasma = ap.get_atom_colors(structure, {
      mode: `coordination`,
      scale: `interpolatePlasma`,
    })
    const result_viridis = ap.get_atom_colors(structure, {
      mode: `coordination`,
      scale: `interpolateViridis`,
    })
    if (result_plasma.values[0] !== result_plasma.values[1]) {
      expect(result_plasma.colors[0]).not.toBe(result_viridis.colors[0])
    }
  })

  test(`color_fn works`, () => {
    const struct_3 = make_struct([
      { xyz: [0, 0, 0] },
      { xyz: [5, 5, 5] },
      { xyz: [10, 10, 10] },
    ])
    const { values } = ap.get_atom_colors(struct_3, {
      mode: `custom`,
      color_fn: (site) => Math.hypot(...site.xyz),
    })
    expect(values[1]).toBeCloseTo(Math.hypot(5, 5, 5), 1)
  })
})

describe(`Edge Cases`, () => {
  test(`single atom`, () => {
    const { values } = ap.get_coordination_colors(make_struct([{ xyz: [0, 0, 0] }]))
    expect(values).toEqual([0])
  })

  test(`uniform same color`, () => {
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `C` },
    ])
    const { colors, values } = ap.get_coordination_colors(structure)
    expect(values[0]).toBe(values[1])
    expect(colors[0]).toBe(colors[1])
  })
})

describe(`Performance`, () => {
  const CI = 3 // CI multiplier

  test(`500 atoms fast`, () => {
    const structure = make_struct(
      Array.from({ length: 500 }, (_, idx) => ({
        xyz: [idx % 10, Math.floor(idx / 10) % 10, Math.floor(idx / 100)] as Vec3,
        element: ([`C`, `O`, `N`, `H`] as const)[idx % 4],
      })),
    )

    const start = performance.now()
    const { colors } = ap.get_coordination_colors(structure)
    const elapsed = performance.now() - start

    expect(colors).toHaveLength(500)
    expect(elapsed).toBeLessThan(1000 * CI) // Old: 4s+, New: ~300ms
  }, 3500) // Fail fast if > 3.5s

  test(`1000 atoms fast`, () => {
    const structure = make_struct(
      Array.from({ length: 1000 }, (_, idx) => ({
        xyz: [
          (idx % 10) * 1.5,
          (Math.floor(idx / 10) % 10) * 1.5,
          Math.floor(idx / 100) * 1.5,
        ] as Vec3,
        element: ([`C`, `O`] as const)[idx % 2],
      })),
    )

    const start = performance.now()
    const { colors } = ap.get_coordination_colors(structure)
    const elapsed = performance.now() - start

    expect(colors).toHaveLength(1000)
    expect(elapsed).toBeLessThan(3000 * CI) // Old: 60s+, New: ~1s
  }, 10000) // Fail fast if > 10s

  test(`512 interior atoms fast`, () => {
    const grid = 8
    const sites = Array.from({ length: grid ** 3 }, (_, idx) => ({
      xyz: [
        20 + ((idx % grid) / (grid - 1)) * 60,
        20 + ((Math.floor(idx / grid) % grid) / (grid - 1)) * 60,
        20 + ((Math.floor(idx / grid ** 2) % grid) / (grid - 1)) * 60,
      ] as Vec3,
      element: `C` as const,
    }))

    const structure = make_struct(sites)
    const start = performance.now()
    const { colors } = ap.get_coordination_colors(structure)
    const elapsed = performance.now() - start

    expect(colors).toHaveLength(512)
    expect(elapsed).toBeLessThan(500 * CI) // Old: 20s+, New: ~250ms
  }, 2000) // Fail fast if > 2s

  test(`50 categorical values`, () => {
    const structure = make_struct(
      Array.from({ length: 50 }, (_, idx) => ({ xyz: [idx, 0, 0] as Vec3 })),
    )
    const { colors } = ap.get_custom_colors(
      structure,
      (_, idx) => idx,
      `interpolateViridis`,
      `categorical`,
    )
    expect(new Set(colors).size).toBe(50)
  })

  test(`large ranges variety`, () => {
    const { colors } = ap.apply_color_scale(
      Array.from({ length: 100 }, (_, idx) => idx * 1000),
    )
    expect(new Set(colors).size).toBeGreaterThan(50)
  })
})
