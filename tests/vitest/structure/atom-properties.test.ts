import type { ElementSymbol } from '$lib'
import { calc_coordination_nums } from '$lib/coordination'
import * as math from '$lib/math'
import type { Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure'
import * as ap from '$lib/structure/atom-properties'
import { parse_poscar } from '$lib/structure/parse'
import selective_dynamics_poscar from '$site/structures/selective-dynamics.poscar?raw'
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
  // C-O pair 1.5 Å apart, i.e. within bonding range
  const co_pair = (): Crystal =>
    make_struct([
      { xyz: [0, 0, 0], element: `C` },
      { xyz: [1.5, 0, 0], element: `O` },
    ])

  test(`bonded atoms CN > 0`, () => {
    const { values } = ap.get_coordination_colors(co_pair())
    expect(values.every((val) => typeof val === `number` && val > 0)).toBe(true)
  })

  test(`isolated atoms CN = 0`, () => {
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [100, 100, 100] }])
    expect(ap.get_coordination_colors(structure).values).toEqual([0, 0])
  })

  test(`linear chain middle > end`, () => {
    // oxfmt-ignore
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` }, { xyz: [1.5, 0, 0], element: `C` },
      { xyz: [3, 0, 0], element: `C` },
    ])
    const { values } = ap.get_coordination_colors(structure)
    expect(typeof values[1] === `number` && values[1] > (values[0] as number)).toBe(true)
  })

  describe(`PBC-aware coordination`, () => {
    type CnCheck = (vals: (number | string)[]) => boolean
    const all_positive: CnCheck = (vals) =>
      vals.every((cn) => typeof cn === `number` && cn > 0)
    const all_finite: CnCheck = (vals) => vals.every((cn) => typeof cn === `number` && cn >= 0)
    const nacl_corner_sites: { abc: Vec3; element: ElementSymbol }[] = [
      { abc: [0, 0, 0], element: `Na` },
      { abc: [0.5, 0, 0], element: `Cl` },
      { abc: [0, 0.5, 0], element: `Cl` },
      { abc: [0, 0, 0.5], element: `Cl` },
    ]
    const cubic_pbc: [boolean, boolean, boolean] = [true, true, true]

    // oxfmt-ignore
    test.each<{
      name: string
      sites: { abc: Vec3; element?: ElementSymbol }[]
      lattice_size: number
      pbc?: [boolean, boolean, boolean]
      check: CnCheck
    }>([
      { name: `cell boundaries`, lattice_size: 3, check: all_positive,
        sites: [{ abc: [0, 0, 0] }, { abc: [0.5, 0, 0] }] },
      { name: `BCC symmetry`, lattice_size: 5, check: (vals) => vals[0] === 8 && vals[1] === 8,
        sites: [{ abc: [0, 0, 0], element: `Cs` }, { abc: [0.5, 0.5, 0.5], element: `Cs` }] },
      { name: `NaCl corner`, lattice_size: 5, sites: nacl_corner_sites,
        check: (vals) => all_positive(vals) && typeof vals[0] === `number` && vals[0] >= 3 },
      { name: `partial PBC`, lattice_size: 5, pbc: [true, true, false], check: (vals) => vals.length === 2,
        sites: [{ abc: [0, 0, 0.3] }, { abc: [0.5, 0.5, 0.3] }] },
      // Regression: in the >20-atom optimized boundary-imaging path an inverted filter
      // imaged atoms on the wrong side, so edge atoms lost their cross-cell neighbors
      // (CN=1/0). A and B sit near opposite x faces and bond ONLY across the periodic
      // boundary (1.44Å); 24 interior fillers push the count past the optimization
      // threshold. The symmetric pair must each see the other (CN >= 1, equal).
      { name: `large structure boundary atoms keep cross-edge PBC neighbors`, lattice_size: 12,
        sites: [
          { abc: [0.06, 0.5, 0.5], element: `C` },
          { abc: [0.94, 0.5, 0.5], element: `C` },
          ...Array.from({ length: 24 }, (_, idx): { abc: Vec3; element: ElementSymbol } => ({
            abc: [0.5, 0.1 + (idx % 6) * 0.15, 0.2 + Math.floor(idx / 6) * 0.2],
            element: `C`,
          })),
        ],
        check: (vals) => typeof vals[0] === `number` && vals[0] >= 1 && vals[0] === vals[1] },
      { name: `small cell, both atoms near boundaries`, lattice_size: 3, check: all_finite,
        sites: [{ abc: [0, 0, 0] }, { abc: [0.5, 0.5, 0.5] }] },
      { name: `non-periodic (molecular) structure`, lattice_size: 10, pbc: [false, false, false],
        check: all_positive, sites: [{ abc: [0, 0, 0] }, { abc: [0.12, 0, 0], element: `O` }] },
      // returns CN for the 2 original sites only, not the 2 + 26·2 image atoms
      { name: `output excludes PBC image atoms`, lattice_size: 4, check: all_positive,
        sites: [{ abc: [0, 0, 0] }, { abc: [0.3, 0, 0] }] },
      // 64-atom grid exercises the optimized interior-atom imaging path
      { name: `large interior-atom grid`, lattice_size: 8,
        check: (vals) => vals.some((cn) => typeof cn === `number` && cn > 0),
        sites: Array.from({ length: 64 }, (_, idx) => ({
          abc: [((idx % 4) + 0.5) / 5, ((Math.floor(idx / 4) % 4) + 0.5) / 5, (Math.floor(idx / 16) + 0.5) / 5] as Vec3,
        })) },
      { name: `ionic atoms at exact cell boundary (NaCl)`, lattice_size: 5, check: all_positive,
        sites: [{ abc: [0, 0, 0], element: `Na` }, { abc: [0.5, 0, 0], element: `Cl` }] },
      // atoms at 0.1 and 0.9 bond across the wrap (1 Å apart through the boundary)
      { name: `atoms just inside opposite faces bond through PBC`, lattice_size: 5, check: all_positive,
        sites: [{ abc: [0.1, 0.5, 0.5] }, { abc: [0.9, 0.5, 0.5] }] },
      { name: `mixed interior + boundary atoms`, lattice_size: 5,
        check: (vals) => vals.every((cn) => typeof cn === `number`),
        sites: ([[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.75]] as Vec3[])
          .map((abc) => ({ abc, element: `Fe` as ElementSymbol })) },
      { name: `partial PBC, atoms inside cell`, lattice_size: 8, pbc: [true, true, false],
        check: all_finite, sites: [{ abc: [0, 0, 0.1] }, { abc: [0.5, 0.5, 0.1] }] },
      { name: `very large cell with sparse atoms`, lattice_size: 50, check: all_finite,
        sites: [
          { abc: [0.1, 0.1, 0.1] },
          { abc: [0.2, 0.1, 0.1], element: `O` },
          { abc: [0.9, 0.9, 0.9], element: `N` },
        ] },
    ])(`$name`, ({ sites, lattice_size, pbc = cubic_pbc, check }) => {
      const structure = make_cubic_structure(sites, lattice_size, pbc)
      const { values, colors } = ap.get_coordination_colors(structure)

      expect(values).toHaveLength(sites.length)
      expect(colors).toHaveLength(sites.length)
      expect(check(values)).toBe(true)
    })

    // CoordinationBarPlot and the 3D viewer both call calc_structure_coordination, so
    // their boundary-atom CN must agree and must exceed the raw-cell count (regression:
    // the bar plot previously ran on the raw cell and undercounted boundary atoms).
    test(`calc_structure_coordination expands PBC and matches viewer CN`, () => {
      const strategy = `electroneg_ratio`
      const structure = make_cubic_structure(nacl_corner_sites, 5)
      const bar_plot_cn = ap
        .calc_structure_coordination(structure, strategy)
        .sites.map((site) => site.coordination_num)
      const viewer_cn = ap.get_coordination_colors(structure, strategy).values
      const raw_cn = calc_coordination_nums(structure, strategy).sites.map(
        (site) => site.coordination_num,
      )

      expect(bar_plot_cn).toHaveLength(structure.sites.length)
      expect(bar_plot_cn).toEqual(viewer_cn)
      // Corner Na bonds to Cl images across the boundary, so PBC CN > raw-cell CN
      expect(bar_plot_cn[0]).toBeGreaterThan(raw_cn[0])
    })

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
            const abc = site.abc.map((coord, axis) => coord + off[axis]) as Vec3
            const properties = { ...site.properties, orig_site_idx: src }
            return { ...site, abc, xyz: frac_to_cart(abc), properties }
          }),
        )
        return calc_coordination_nums({ ...structure, sites: [...structure.sites, ...images] })
          .sites.slice(0, sites.length)
          .map((site) => site.coordination_num)
      }

      // production imaging vs the brute-force oracle, for the cases below to compare
      const cn_pair = (
        matrix: [Vec3, Vec3, Vec3],
        sites: { element: ElementSymbol; abc: Vec3 }[],
      ) => ({
        reference: brute_force_cn(matrix, sites),
        actual: ap.get_coordination_colors(make_crystal(matrix, sites, { charge: 0 })).values,
      })

      // Regression guards: get_coordination_colors must equal the brute-force ground
      // truth across the regimes where the old imaging was wrong — oblique cells
      // (heights ≠ vector lengths), thin cells (need >1 image shell), large-radius
      // atoms (bonds exceed the old hard-coded 5 Å reach) and atoms on a cell boundary
      // (abc component = 1, which must wrap so its cross-cell images are not dropped).
      // oxfmt-ignore
      test.each<[string, [Vec3, Vec3, Vec3], ElementSymbol, Vec3[]]>([
        [`oblique (sheared) cell`, [[12, 0, 0], [-12, 9, 0], [12, -12, 6]], `C`, [
          [0.75, 0.9, 0.85], [0.95, 0.75, 0.85], [0.15, 0.95, 0.4], [0.05, 0.75, 0.4],
          [0.6, 0.05, 0.9], [0.9, 0.1, 0.7], [1, 0.45, 0.05], [0.55, 0.7, 0.5],
          [0.7, 0.7, 0.5], [0.5, 0.75, 0.25], [0.3, 0.65, 0.6], [0.2, 0.85, 0.8],
          [0.75, 0.95, 0.9], [0.4, 0.55, 0.4], [0.3, 0.65, 0.35], [0.75, 0.2, 0.4],
          [0.35, 0.4, 0.9], [0.35, 0.9, 0.45], [0.1, 0.6, 0.25], [0.95, 0.7, 0.2],
          [0.1, 0.45, 0.4], [0.4, 0.85, 0.75], [0.45, 0.35, 0.75], [0.3, 0.35, 0.5],
          [0.8, 0.95, 0.05],
        ]],
        // c-axis height 3 Å < ~5 Å reach → needs 2 image shells along c
        [`thin cell (multi-shell)`, [[6, 0, 0], [0, 6, 0], [0, 0, 3]], `C`, [
          [0.1, 0.1, 0.05], [0.1, 0.5, 0.95], [0.5, 0.1, 0.5], [0.5, 0.5, 0.1],
          [0.9, 0.9, 0.9], [0.3, 0.7, 0.4], [0.7, 0.3, 0.6], [0.2, 0.8, 0.2],
          [0.85, 0.2, 0.8], [0.5, 0.9, 0.5],
        ]],
        // Cs covalent radius ~2.4 Å → bonds reach well past the old fixed 5 Å cutoff
        [`large-radius atoms (>5 Å bonds)`, [[9, 0, 0], [0, 9, 0], [0, 0, 9]], `Cs`, [
          [0.1, 0.1, 0.1], [0.7, 0.1, 0.1], [0.1, 0.7, 0.1], [0.1, 0.1, 0.7],
          [0.7, 0.7, 0.7], [0.4, 0.4, 0.4],
        ]],
        // atom 0 sits on the y=1 boundary; without wrapping, its cross-cell image
        // bonding atom 1 (at 4.0 Å) is dropped and atom 1's CN comes out 0 not 1
        [`boundary atom (abc component = 1)`, [[8.5, 0, 0], [0, 8.5, 0], [0, 0, 8.5]], `K`, [
          [0.05, 1, 0.55], [0.8, 0, 0.95],
        ]],
      ])(`coordination matches brute-force ground truth: %s`, (_name, matrix, element, abc_list) => {
        const { reference, actual } = cn_pair(matrix, abc_list.map((abc) => ({ element, abc })))
        expect(actual).toEqual(reference)
        // Sanity: the structure actually forms bonds (else the comparison is vacuous)
        expect(reference.some((cn) => cn > 0)).toBe(true)
      })

      test(`partial PBC keeps non-periodic coordinates outside the cell`, () => {
        // z is non-periodic; the two atoms are 9 Å apart in vacuum and must NOT bond.
        // Wrapping z (1.2 → 0.2) would fold them ~1 Å apart and invent a bond.
        const structure = make_crystal(
          10,
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
        // oxfmt-ignore
        const matrix: [Vec3, Vec3, Vec3] = [[5, 0, 0], [0, 5, 0], [0, 0, 1]]
        const sites: { element: ElementSymbol; abc: Vec3 }[] = [
          { element: `C`, abc: [0.2, 0.2, 0.5] },
          { element: `C`, abc: [0.6, 0.6, 0.5] },
        ]
        const { values } = ap.get_coordination_colors(
          make_crystal(matrix, sites, { charge: 0 }),
        )
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
        // oxfmt-ignore
        const matrix: [Vec3, Vec3, Vec3] = [[5.6, 0, 0], [0, 5.6, 0], [0, 0, 5.6]]
        // oxfmt-ignore
        const na_abc: Vec3[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]
        // oxfmt-ignore
        const cl_abc: Vec3[] = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0.5, 0.5]]
        const { reference, actual } = cn_pair(matrix, [
          ...na_abc.map((abc) => ({ element: `Na` as ElementSymbol, abc })),
          ...cl_abc.map((abc) => ({ element: `Cl` as ElementSymbol, abc })),
        ])
        expect(actual).toEqual(reference)
        expect(reference.some((cn) => cn > 0)).toBe(true)
      })
    })
  })

  test(`supercell atoms track originals via orig_unit_cell_idx for color mapping`, () => {
    const sites: { abc: Vec3; element: ElementSymbol }[] = [
      { abc: [0, 0, 0], element: `Fe` },
      { abc: [0.5, 0.5, 0.5], element: `Fe` },
    ]
    const supercell = make_supercell(make_cubic_structure(sites, 4), [2, 2, 2])
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
  // `count` carbon atoms on the body diagonal, one per Wyckoff label under test
  // oxfmt-ignore
  const diagonal_c = (count: number) =>
    make_struct(Array.from({ length: count }, (_, idx) => ({ xyz: [idx, idx, idx] as Vec3 })))

  test(`no data → gray`, () => {
    const { colors, values } = ap.get_wyckoff_colors(diagonal_c(1), null)
    expect([colors[0], values[0]]).toEqual([`#808080`, `unknown`])
  })

  test(`with data`, () => {
    const dataset = { wyckoffs: [`a`, `b`] } as unknown as MoyoDataset
    const { colors, values } = ap.get_wyckoff_colors(diagonal_c(2), dataset)
    expect([values, colors[0] !== colors[1]]).toEqual([[`a|C`, `b|C`], true])
  })

  test(`duplicates same color`, () => {
    const dataset = { wyckoffs: [`a`, `a`, `b`, `a`] } as unknown as MoyoDataset
    const { colors } = ap.get_wyckoff_colors(diagonal_c(4), dataset)
    expect([colors[0] === colors[1], colors[0] !== colors[2]]).toEqual([true, true])
  })

  test(`null positions`, () => {
    const dataset = { wyckoffs: [null, `b`] } as unknown as MoyoDataset
    expect(ap.get_wyckoff_colors(diagonal_c(2), dataset).values).toEqual([`unknown`, `b|C`])
  })

  test(`uses orig_site_indices_by_input_idx mapping for merged disordered sites`, () => {
    // moyo's wyckoffs array indexes the (merged) INPUT cell: input site 0 is the merged
    // O/F disordered site (original sites 0+1), input site 1 is Li (original site 2)
    // oxfmt-ignore
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `O` }, { xyz: [1, 1, 1], element: `F` },
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
  // oxfmt-ignore
  const diagonal_c = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }, { xyz: [2, 2, 2] }])

  test(`numeric`, () => {
    const { values } = ap.get_custom_colors(diagonal_c, (site) => site.xyz[2])
    expect(values).toEqual([0, 1, 2])
  })

  test(`string`, () => {
    // oxfmt-ignore
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` }, { xyz: [1, 1, 1], element: `O` },
      { xyz: [2, 2, 2], element: `C` },
    ])
    const color_fn = (site: { species: { element: string }[] }) => site.species[0].element
    const { values, colors } = ap.get_custom_colors(structure, color_fn)
    expect([values, colors[0] === colors[2]]).toEqual([[`C`, `O`, `C`], true])
  })

  test(`site index`, () => {
    const { colors } = ap.get_custom_colors(diagonal_c, (_, idx) => idx)
    expect(new Set(colors).size).toBe(3)
  })

  test(`properties`, () => {
    // oxfmt-ignore
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 0, 0] }, { xyz: [0, 1, 0] }])
    for (const [idx, magmom] of [2.5, -1.0, 0.5].entries()) {
      structure.sites[idx].properties = { magmom }
    }
    const { values } = ap.get_custom_colors(structure, (site) =>
      Number(site.properties?.magmom ?? 0),
    )
    expect(values).toEqual([2.5, -1.0, 0.5])
  })

  test(`distance`, () => {
    // oxfmt-ignore
    const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [3, 4, 0] }, { xyz: [6, 8, 0] }])
    const { values } = ap.get_custom_colors(structure, (site) =>
      Math.hypot(site.xyz[0], site.xyz[1]),
    )
    expect(values).toEqual([0, 5, 10])
  })
})

// OVITO-style Color Coding: map an arbitrary per-site scalar (or a vec3's magnitude)
// onto the color scale
describe(`Site property coloring`, () => {
  const with_props = (props: (Record<string, unknown> | undefined)[]): Crystal => {
    const structure = make_struct(props.map((_unused, idx) => ({ xyz: [idx, 0, 0] })))
    for (const [idx, properties] of props.entries()) {
      if (properties) structure.sites[idx].properties = properties
    }
    return structure
  }

  test(`colors by a numeric key and reports its range`, () => {
    const structure = with_props([{ charge: -0.5 }, { charge: 1.5 }, { charge: 0.5 }])
    const result = ap.get_site_property_colors(structure, `charge`)
    expect(result.values).toEqual([-0.5, 1.5, 0.5])
    expect([result.min_value, result.max_value]).toEqual([-0.5, 1.5])
    expect(new Set(result.colors).size).toBe(3)
  })

  test(`uses the magnitude of a vec3 property`, () => {
    const structure = with_props([
      { velocity: [3, 4, 0] },
      { velocity: [0, 0, 1] },
      { velocity: [1, 2, 2] },
    ])
    const result = ap.get_site_property_colors(structure, `velocity`)
    expect(result.values).toEqual([5, 1, 3])
    expect([result.min_value, result.max_value]).toEqual([1, 5])
  })

  test(`grays out sites missing the property and keeps them out of the range`, () => {
    const structure = with_props([{ charge: 2 }, {}, { charge: 4 }, { charge: `n/a` }])
    const result = ap.get_site_property_colors(structure, `charge`)
    expect(result.values).toEqual([2, `unknown`, 4, `unknown`])
    expect([result.min_value, result.max_value]).toEqual([2, 4])
    expect(result.colors[1]).toBe(`#808080`)
    expect(result.colors[3]).toBe(`#808080`)
  })

  test(`returns empty when no site declares the key, so callers can fall back`, () => {
    const result = ap.get_site_property_colors(with_props([{ charge: 1 }]), `velocity`)
    expect(result).toEqual({ colors: [], values: [] })
  })

  test.each([
    [`numbers and vec3s`, { charge: -1, velocity: [1, 0, 0] }, [`charge`, `velocity`]],
    [`skips non-numeric`, { tag: `core`, frozen: true, charge: 1 }, [`charge`]],
    [`skips non-finite`, { charge: NaN, c_pe: 2 }, [`c_pe`]],
    [`skips vec3s with a bad component`, { velocity: [1, `x`, 0], charge: 0 }, [`charge`]],
    // Viewer-internal provenance keys are numeric but meaningless to color by
    [
      `skips viewer bookkeeping`,
      { orig_site_idx: 3, orig_unit_cell_idx: 1, charge: 0 },
      [`charge`],
    ],
  ])(`get_colorable_property_keys: %s`, (_desc, properties, expected) => {
    expect(ap.get_colorable_property_keys(with_props([properties]))).toEqual(expected)
  })

  test(`unions keys across sites`, () => {
    const structure = with_props([{ charge: 1 }, { c_pe: -2 }, undefined])
    expect(ap.get_colorable_property_keys(structure)).toEqual([`c_pe`, `charge`])
    expect(ap.get_colorable_property_keys(undefined)).toEqual([])
  })

  test.each([
    [`vec3 magnitude`, `velocity`, [5, 1]],
    [`scalar`, `charge`, [-0.5, 0.5]],
  ])(`get_atom_colors property mode over a %s key`, (_desc, property_key, expected) => {
    const structure = with_props([
      { charge: -0.5, velocity: [3, 4, 0] },
      { charge: 0.5, velocity: [0, 1, 0] },
    ])
    const result = ap.get_atom_colors(structure, { mode: `property`, property_key })
    expect(result.values).toEqual(expected)
    expect(result.colors).toHaveLength(2)
  })

  test(`property mode without a key yields no colors`, () => {
    const structure = with_props([{ charge: 1 }, { charge: 2 }])
    expect(ap.get_atom_colors(structure, { mode: `property` })).toEqual({
      colors: [],
      values: [],
    })
  })
})

describe(`get_atom_colors`, () => {
  const structure = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1, 1, 1] }])

  // element mode needs no property colors, so it yields empty arrays; wyckoff without
  // symmetry data still colors every site gray rather than bailing
  test.each([
    [`element mode`, { mode: `element` }, 0],
    [`empty config (defaults to element)`, {}, 0],
    [`coordination mode`, { mode: `coordination` }, 2],
    [`wyckoff mode without symmetry data`, { mode: `wyckoff` }, 2],
  ] as const)(`%s`, (_name, config, expected_len) => {
    expect(ap.get_atom_colors(structure, config).colors).toHaveLength(expected_len)
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

  test(`scale option changes the rendered colors`, () => {
    // needs sites with DIFFERING CN: when every value is equal the scale maps them all
    // to t=0.5, where different interpolators can coincide and the check goes vacuous
    // oxfmt-ignore
    const chain = make_struct([{ xyz: [0, 0, 0] }, { xyz: [1.5, 0, 0] }, { xyz: [3, 0, 0] }])
    const coord_colors = (scale: `interpolatePlasma` | `interpolateViridis`) =>
      ap.get_atom_colors(chain, { mode: `coordination`, scale })
    const result_plasma = coord_colors(`interpolatePlasma`)
    expect(new Set(result_plasma.values).size).toBeGreaterThan(1)
    expect(result_plasma.colors[0]).not.toBe(coord_colors(`interpolateViridis`).colors[0])
  })
})

describe(`Edge Cases`, () => {
  test(`single atom`, () => {
    const { values } = ap.get_coordination_colors(make_struct([{ xyz: [0, 0, 0] }]))
    expect(values).toEqual([0])
  })

  test(`uniform same color`, () => {
    // oxfmt-ignore
    const structure = make_struct([
      { xyz: [0, 0, 0], element: `C` }, { xyz: [1.5, 0, 0], element: `C` },
    ])
    const { colors, values } = ap.get_coordination_colors(structure)
    expect(values[0]).toBe(values[1])
    expect(colors[0]).toBe(colors[1])
  })
})

describe(`Performance`, () => {
  const CI = 3 // CI multiplier

  // Budgets are the pre-optimization runtimes cut by >10x: 500 atoms took 4s+, 1000 atoms
  // 60s+, and the 512-atom interior grid 20s+. The 10s suite timeout fails fast overall.
  // oxfmt-ignore
  test.each<[string, number, (idx: number) => { xyz: Vec3; element: ElementSymbol }, number]>([
    [`500 atoms`, 500, (idx) => ({
      xyz: [idx % 10, Math.floor(idx / 10) % 10, Math.floor(idx / 100)],
      element: ([`C`, `O`, `N`, `H`] as const)[idx % 4],
    }), 1000 * CI],
    [`1000 atoms`, 1000, (idx) => ({
      xyz: [(idx % 10) * 1.5, (Math.floor(idx / 10) % 10) * 1.5, Math.floor(idx / 100) * 1.5],
      element: ([`C`, `O`] as const)[idx % 2],
    }), 3000 * CI],
    // 8x8x8 grid of interior atoms exercises the optimized interior-imaging path
    [`512 interior atoms`, 512, (idx) => ({
      xyz: [
        20 + ((idx % 8) / 7) * 60,
        20 + ((Math.floor(idx / 8) % 8) / 7) * 60,
        20 + ((Math.floor(idx / 64) % 8) / 7) * 60,
      ],
      element: `C`,
    }), 500 * CI],
  ])(`%s fast`, (_name, count, make_site, budget_ms) => {
    const structure = make_struct(Array.from({ length: count }, (_, idx) => make_site(idx)))
    const start = performance.now()
    const { colors } = ap.get_coordination_colors(structure)
    const elapsed = performance.now() - start

    expect(colors).toHaveLength(count)
    expect(elapsed).toBeLessThan(budget_ms)
  }, 10000)

  test(`50 categorical values`, () => {
    const sites = Array.from({ length: 50 }, (_, idx) => ({ xyz: [idx, 0, 0] as Vec3 }))
    const args = [`interpolateViridis`, `categorical`] as const
    const { colors } = ap.get_custom_colors(make_struct(sites), (_, idx) => idx, ...args)
    expect(new Set(colors).size).toBe(50)
  })

  test(`large ranges variety`, () => {
    const values = Array.from({ length: 100 }, (_, idx) => idx * 1000)
    expect(new Set(ap.apply_color_scale(values).colors).size).toBeGreaterThan(50)
  })
})

describe(`Selective dynamics`, () => {
  const sd_struct = (flag_sets: unknown[]): Crystal =>
    make_crystal(
      10,
      flag_sets.map((selective_dynamics, idx) => ({
        element: `Si` as const,
        abc: [0.1 * idx, 0, 0] as Vec3,
        properties: selective_dynamics === undefined ? {} : { selective_dynamics },
      })),
    )

  test.each([
    [`all axes relaxable (T T T)`, [true, true, true], `free`],
    [`out-of-plane axis frozen (T T F)`, [true, true, false], `partially fixed`],
    [`only one relaxable axis (F T F)`, [false, true, false], `partially fixed`],
    [`every axis frozen (F F F)`, [false, false, false], `fixed`],
    [`property absent`, undefined, `unknown`],
    [`property explicitly null`, null, `unknown`],
    // POSCAR literals and 0/1 spell the same triple, so they are coerced rather than rejected
    [`POSCAR string flags (T T F)`, [`T`, `T`, `F`], `partially fixed`],
    [`lowercase words`, [`false`, `false`, `false`], `fixed`],
    [`numeric flags`, [1, 1, 1], `free`],
    [`padded and mixed-case flags`, [` T `, `TRUE`, `f`], `partially fixed`],
    // ...anything else is `unknown`: this runs per site during render, so it must not throw
    [`four booleans`, [true, false, true, false], `unknown`],
    [`two booleans`, [true, false], `unknown`],
    [`a bare string`, `T T F`, `unknown`],
    [`an empty array`, [], `unknown`],
    [`unrecognized flag words`, [`yes`, `no`, `maybe`], `unknown`],
  ])(`categorizes %s as %s`, (_name, value, expected) => {
    expect(ap.categorize_selective_dynamics(value)).toBe(expected)
  })

  test(`gives partially constrained atoms their own color, distinct from free and fixed`, () => {
    const structure = sd_struct([
      [true, true, true],
      [true, true, false],
      [false, false, false],
      [true, true, true],
    ])
    const { colors, values, unique_values } = ap.get_selective_dynamics_colors(structure)
    expect(values).toEqual([`free`, `partially fixed`, `fixed`, `free`])
    // legend order is mobility-descending, not alphabetical
    expect(unique_values).toEqual([`free`, `partially fixed`, `fixed`])
    expect(colors[0]).toBe(colors[3])
    expect(new Set(colors).size).toBe(3)
  })

  test(`exposes selective dynamics through the shared atom color entry point`, () => {
    const structure = sd_struct([
      [false, false, false],
      [true, true, true],
    ])
    const via_mode = ap.get_atom_colors(structure, { mode: `selective_dynamics` })
    expect(via_mode.values).toEqual([`fixed`, `free`])
    expect(via_mode.colors).toHaveLength(2)
    const via_property = ap.get_property_colors(
      structure,
      { mode: `selective_dynamics` },
      `electroneg_ratio`,
      null,
    )
    expect(via_property?.values).toEqual([`fixed`, `free`])
    // legend order stays mobility-descending, so `free` sorts ahead of `fixed`
    expect(via_property?.unique_values).toEqual([`free`, `fixed`])
    expect(via_property?.colors).toEqual(via_mode.colors)
  })

  test.each([
    [`some site declares the property`, [[true, true, true], undefined], true],
    [`no site declares the property`, [undefined, undefined], false],
  ])(`detects availability when %s`, (_name, flag_sets, expected) => {
    expect(ap.structure_has_selective_dynamics(sd_struct(flag_sets))).toBe(expected)
  })

  test(`treats an empty structure as having no selective dynamics data`, () => {
    expect(ap.get_selective_dynamics_colors(sd_struct([]))).toEqual({ colors: [], values: [] })
    expect(ap.structure_has_selective_dynamics(undefined)).toBe(false)
  })

  test(`colors a real POSCAR slab by its frozen bottom layer`, () => {
    const structure = parse_poscar(selective_dynamics_poscar)
    if (!structure) throw new Error(`failed to parse selective-dynamics.poscar`)
    expect(ap.structure_has_selective_dynamics(structure)).toBe(true)
    const { values, colors } = ap.get_selective_dynamics_colors(structure)
    // fixture: 4 substrate atoms pinned (F F F), 4 adatoms free (T T T)
    expect(values).toEqual([...Array(4).fill(`fixed`), ...Array(4).fill(`free`)])
    expect(new Set(colors).size).toBe(2)
  })
})
