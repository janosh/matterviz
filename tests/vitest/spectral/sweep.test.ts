// Sweeps (spectral/sweep): validation, computed and supplied descriptors, JSON normalization
import type { ElementSymbol } from '#lib/element/types.js'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type { Matrix3x3 } from '#lib/math.js'
import {
  compute_descriptor,
  descriptor_value,
  dos_at_energy,
  fermi_band_count,
  format_axis_value,
  frame_fermi_energy,
  min_pair_distance,
  normalize_sweep,
  validate_sweep,
  volume_per_atom,
} from '#lib/spectral/sweep.js'
import type { DescriptorSpec, Sweep, SweepFrame } from '#lib/spectral/sweep.js'
import type { ElectronicDos } from '#lib/spectral/types.js'
import { describe, expect, test } from 'vitest'
import { IDENTITY_MATRIX3, make_crystal } from '../test-fixtures'

// fcc primitive cell (a = 4 Å) with one atom: nearest neighbours at a/√2
const FCC: Matrix3x3 = [
  [0, 2, 2],
  [2, 0, 2],
  [2, 2, 0],
]
const cu = make_crystal(FCC, [[`Cu`, [0, 0, 0]]])
// rock salt in its 8-atom cubic cell (a = 4 Å): Na–Cl at a/2, Na–Na and Cl–Cl at a/√2
const nacl = make_crystal(4, [
  ...(
    [
      [0, 0, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
    ] as const
  ).map((abc): [string, [number, number, number]] => [`Na`, [...abc]]),
  ...(
    [
      [0.5, 0, 0],
      [0, 0.5, 0],
      [0, 0, 0.5],
      [0.5, 0.5, 0.5],
    ] as const
  ).map((abc): [string, [number, number, number]] => [`Cl`, [...abc]]),
])
const dos = (energies: number[], densities: number[], extra: Partial<ElectronicDos> = {}) =>
  ({ type: `electronic`, energies, densities, efermi: 1, ...extra }) satisfies ElectronicDos
// two bands on a 2³ grid: band 0 spans 0..2 (crosses E_F = 1), band 1 lies at 3..4
const grid: BandGridData = {
  energies: [
    [
      {
        values: Float64Array.from([0, 2, 0, 2, 0, 2, 0, 2]),
        dims: [2, 2, 2],
        order: `z_fastest`,
      },
      {
        values: Float64Array.from([3, 4, 3, 4, 3, 4, 3, 4]),
        dims: [2, 2, 2],
        order: `z_fastest`,
      },
    ],
  ],
  k_grid: [2, 2, 2],
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 1,
  n_bands: 2,
  n_spins: 1,
  periodic: true,
}
const sweep_of = (values: number[], extra: Partial<Sweep> = {}): Sweep => ({
  axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
  series: [{ id: `fcc`, frames: values.map((value) => ({ value })) }],
  ...extra,
})

describe(`validate_sweep`, () => {
  test(`accepts ascending frames in uniquely named series`, () => {
    expect(() => validate_sweep(sweep_of([0, 50, 100]))).not.toThrow()
  })
  test.each<[string, Sweep, string]>([
    [`no series`, { ...sweep_of([0]), series: [] }, `at least one series`],
    [
      `an empty series`,
      { ...sweep_of([0]), series: [{ id: `a`, frames: [] }] },
      `has no frames`,
    ],
    [`descending values`, sweep_of([50, 0]), `strictly ascending: frame 1 has 0 after 50`],
    [`repeated values`, sweep_of([50, 50]), `strictly ascending`],
    [`a non-finite value`, sweep_of([0, Number.NaN]), `frame 1 has a non-finite value NaN`],
    [
      `duplicate series ids`,
      {
        ...sweep_of([0]),
        series: [
          { id: `a`, frames: [{ value: 0 }] },
          { id: `a`, frames: [{ value: 1 }] },
        ],
      },
      `series id "a" is not unique`,
    ],
    [
      `duplicate descriptor keys`,
      sweep_of([0], {
        descriptors: [
          { key: `tc`, label: `Tc` },
          { key: `tc`, label: `T_c` },
        ],
      }),
      `descriptor key "tc" is not unique`,
    ],
    [
      `an element share without element`,
      sweep_of([0], { descriptors: [{ key: `h`, label: `H`, compute: `fermi_dos_share` }] }),
      `element goes with (and only with) fermi_dos_share`,
    ],
    [
      `an element on another descriptor`,
      sweep_of([0], {
        descriptors: [{ key: `n`, label: `N`, compute: `fermi_dos`, element: `H` }],
      }),
      `element goes with (and only with) fermi_dos_share`,
    ],
    [
      `a pair on another descriptor`,
      sweep_of([0], {
        descriptors: [{ key: `v`, label: `V`, compute: `volume_per_atom`, pair: [`H`, `H`] }],
      }),
      `pair goes only with min_pair_distance`,
    ],
  ])(`rejects %s`, (_desc, sweep, message) => {
    expect(() => validate_sweep(sweep)).toThrow(message)
  })
})

describe(`computed descriptors`, () => {
  test(`volume per atom is the cell volume over the site count`, () => {
    expect(volume_per_atom(cu)).toBeCloseTo(16, 12) // fcc primitive cell: a³/4
    expect(volume_per_atom(nacl)).toBeCloseTo(8, 12) // 64 Å³ / 8 sites
  })

  test.each<
    [string, typeof cu, [ElementSymbol, ElementSymbol] | undefined, number | undefined]
  >([
    [`fcc Cu, its own images`, cu, undefined, 4 / Math.SQRT2],
    // b − 3a = (0.5, 0.5, 0): a shift no [-2, 2]³ search of the raw cell reaches
    [
      `a strongly sheared cell's own image`,
      make_crystal(
        [
          [3, 0, 0],
          [9.5, 0.5, 0],
          [0, 0, 10],
        ],
        [[`Cu`, [0, 0, 0]]],
      ),
      undefined,
      Math.SQRT1_2,
    ],
    // the short non-periodic c axis brings no image
    [
      `a slab's own images in-plane only`,
      make_crystal(
        [
          [3, 0, 0],
          [0, 3, 0],
          [0, 0, 1],
        ],
        [[`Cu`, [0, 0, 0]]],
        { pbc: [true, true, false] },
      ),
      undefined,
      3,
    ],
    [
      `a molecule's own images (none)`,
      make_crystal(1, [[`Cu`, [0, 0, 0]]], { pbc: [false, false, false] }),
      undefined,
      undefined,
    ],
    [`Cu–Cu in fcc Cu`, cu, [`Cu`, `Cu`], 4 / Math.SQRT2],
    [`any pair in rock salt`, nacl, undefined, 2],
    [`Na–Cl`, nacl, [`Na`, `Cl`], 2],
    [`Cl–Na (order-free)`, nacl, [`Cl`, `Na`], 2],
    [`Na–Na`, nacl, [`Na`, `Na`], 4 / Math.SQRT2],
    [`an absent element`, nacl, [`H`, `H`], undefined],
  ])(`min_pair_distance: %s`, (_desc, structure, elements, expected) => {
    const dist = min_pair_distance(structure, elements)
    if (expected === undefined) expect(dist).toBeUndefined()
    else expect(Math.abs((dist ?? Number.NaN) - expected)).toBeLessThan(1e-12)
  })

  test.each([
    [`a grid point`, 1, 2],
    [`between points, linearly`, 1.5, 2.5],
    [`the first point`, 0, 1],
    [`the last point`, 2, 3],
    [`below the range`, -0.1, undefined],
    [`above the range`, 2.1, undefined],
  ])(`dos_at_energy at %s`, (_desc, energy, expected) => {
    expect(dos_at_energy(dos([0, 1, 2], [1, 2, 3]), energy)).toBe(expected)
  })

  test(`dos_at_energy adds both spins (spin down stored either sign) and skips phonons`, () => {
    const up_down = dos([0, 1], [1, 1], { spin_down_densities: [-0.5, -0.5] })
    expect(dos_at_energy(up_down, 0.5)).toBe(1.5)
    expect(
      dos_at_energy({ type: `phonon`, frequencies: [0, 1], densities: [1, 1] }, 0.5),
    ).toBeUndefined()
  })

  test(`E_F comes from the band grid first, then the DOS, then the band structure`, () => {
    const doses = { total: dos([0, 2], [1, 1], { efermi: 0.7 }) }
    expect(frame_fermi_energy({ band_data: grid, doses })).toBe(1)
    expect(frame_fermi_energy({ doses })).toBe(0.7)
    expect(frame_fermi_energy({})).toBeUndefined()
  })

  test(`fermi_band_count counts grid bands spanning E_F, or a meshed surface's sheets`, () => {
    expect(fermi_band_count({ band_data: grid })).toBe(1)
    expect(fermi_band_count({ band_data: { ...grid, fermi_energy: 3.5 } })).toBe(1)
    expect(fermi_band_count({ band_data: { ...grid, fermi_energy: 2.5 } })).toBe(0)
    const sheet = {
      positions: new Float32Array(),
      indices: new Uint32Array(),
      normals: new Float32Array(),
    }
    const fermi_data = {
      isosurfaces: [
        { ...sheet, band_index: 4, spin: null },
        { ...sheet, band_index: 4, spin: null }, // a second piece of the same sheet
        { ...sheet, band_index: 5, spin: null },
      ],
      k_lattice: IDENTITY_MATRIX3,
      fermi_energy: 0,
      reciprocal_cell: `wigner_seitz` as const,
      metadata: { n_bands: 2, n_surfaces: 3 },
    }
    expect(fermi_band_count({ fermi_data })).toBe(2)
    expect(fermi_band_count({})).toBeUndefined()
  })

  test(`fermi_dos and an element's share of it read the total and projected DOS at E_F`, () => {
    const frame: Partial<SweepFrame> = {
      band_data: grid, // E_F = 1
      doses: { total: dos([0, 2], [2, 4]), H: dos([0, 2], [1, 1]) },
    }
    const fermi_dos: DescriptorSpec = { key: `n_ef`, label: `N(E_F)`, compute: `fermi_dos` }
    const share: DescriptorSpec = {
      key: `h_share`,
      label: `H share`,
      compute: `fermi_dos_share`,
      element: `H`,
    }
    expect(compute_descriptor(frame, fermi_dos)).toBe(3)
    expect(compute_descriptor(frame, share)).toBeCloseTo(1 / 3, 15)
    // the total DOS's own E_F wins over the grid's (a denser-k DOS sits at its own level)
    const own_level = { ...frame, doses: { total: dos([0, 2], [2, 4], { efermi: 0.5 }) } }
    expect(compute_descriptor(own_level, fermi_dos)).toBe(2.5)
    // a lone DOS is the total unless it is an element projection; phonon DOS give none
    expect(
      compute_descriptor({ ...frame, doses: { cu: dos([0, 2], [1, 3]) } }, fermi_dos),
    ).toBe(2)
    expect(
      compute_descriptor({ ...frame, doses: { Cu: dos([0, 2], [1, 3]) } }, fermi_dos),
    ).toBeUndefined()
    const phonon_total = { type: `phonon` as const, frequencies: [0, 2], densities: [1, 1] }
    expect(
      compute_descriptor({ ...frame, doses: { total: phonon_total } }, fermi_dos),
    ).toBeUndefined()
    expect(
      compute_descriptor({ ...frame, doses: { total: dos([0, 2], [2, 4]) } }, share),
    ).toBeUndefined()
  })

  test(`a supplied value wins, null means known missing, else the computed one`, () => {
    const spec: DescriptorSpec = { key: `vol`, label: `V`, compute: `volume_per_atom` }
    expect(descriptor_value({ structure: cu, scalars: { vol: 99 } }, spec)).toBe(99)
    expect(descriptor_value({ structure: cu, scalars: { vol: null } }, spec)).toBeNull()
    expect(descriptor_value({ structure: cu }, spec)).toBeCloseTo(16, 12)
    expect(descriptor_value({ structure: cu }, { key: `tc`, label: `Tc` })).toBeUndefined()
  })
})

test(`format_axis_value prefers the frame's label`, () => {
  const axis = { key: `pressure`, label: `Pressure`, unit: `GPa` }
  expect(format_axis_value(axis, { value: 150 })).toBe(`150 GPa`)
  expect(format_axis_value({ ...axis, unit: undefined }, { value: 3 })).toBe(`3`)
  expect(format_axis_value(axis, { value: 150, label: `150 GPa (151.3 relaxed)` })).toBe(
    `150 GPa (151.3 relaxed)`,
  )
})

describe(`normalize_sweep`, () => {
  const json_structure = {
    lattice: { matrix: FCC },
    sites: [
      { species: [{ element: `Cu`, occu: 1 }], abc: [0, 0, 0], xyz: [0, 0, 0], label: `Cu` },
    ],
  }
  test(`parses JSON frames like single files and keeps scalars, status and descriptors`, () => {
    const sweep = normalize_sweep({
      axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
      series: [
        {
          id: `fcc`,
          label: `fcc Cu`,
          frames: [
            { value: 0, structure: json_structure, scalars: { tc: 10, lambda: null } },
            {
              value: 50,
              label: `50 GPa`,
              doses: { total: { energies: [0, 1], densities: [1, 2], efermi: 0.5 } },
              status: { unstable: true, note: `imaginary modes`, ignored: 1 },
            },
          ],
        },
      ],
      descriptors: [
        { key: `tc`, label: `Tc`, unit: `K`, range: [`tc_lo`, `tc_hi`], threshold: 20 },
      ],
    })
    const [first, second] = sweep.series[0].frames
    expect(first.structure?.sites).toHaveLength(1)
    expect(first.scalars).toEqual({ tc: 10, lambda: null })
    expect(second.doses?.total).toMatchObject({ type: `electronic`, densities: [1, 2] })
    expect(second.status).toEqual({ unstable: true, note: `imaginary modes` })
    expect(sweep.descriptors).toEqual([
      { key: `tc`, label: `Tc`, unit: `K`, range: [`tc_lo`, `tc_hi`], threshold: 20 },
    ])
  })

  const frame = { value: 0 }
  test.each<[string, unknown, string]>([
    [`no object`, [], `at root: must be an object`],
    [`no axis key`, { axis: { label: `P` }, series: [] }, `at axis: needs a key and a label`],
    [
      `no series array`,
      { axis: { key: `p`, label: `P` }, series: {} },
      `at series: must be an array`,
    ],
    [
      `a frame without value`,
      { axis: { key: `p`, label: `P` }, series: [{ id: `a`, frames: [{}] }] },
      `series[0].frames[0]: value must be a number`,
    ],
    [
      `a molecule structure`,
      {
        axis: { key: `p`, label: `P` },
        series: [
          { id: `a`, frames: [{ value: 0, structure: { sites: json_structure.sites } }] },
        ],
      },
      `frames[0].structure: needs a periodic structure`,
    ],
    [
      `an unparsable DOS`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [{ value: 0, doses: { x: 1 } }] }],
      },
      `frames[0].doses.x: unrecognized data`,
    ],
    [
      `a non-numeric scalar`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [{ value: 0, scalars: { tc: `hot` } }] }],
      },
      `frames[0].scalars.tc: must be a number or null`,
    ],
    [
      `an unknown computed descriptor`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [frame] }],
        descriptors: [{ key: `x`, label: `X`, compute: `magic` }],
      },
      `descriptors[0].compute: unknown "magic"`,
    ],
    [
      `a descriptor pair that is no element symbols`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [frame] }],
        descriptors: [
          { key: `x`, label: `X`, compute: `min_pair_distance`, pair: [`Hx`, `H`] },
        ],
      },
      `descriptors[0].pair: must be two element symbols, got ["Hx","H"]`,
    ],
    [
      `a numeric series id`,
      { axis: { key: `p`, label: `P` }, series: [{ id: 1, frames: [frame] }] },
      `series[0]: needs a string id`,
    ],
    [
      `an unknown frame field (e.g. a typo)`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [{ value: 0, dos: {} }] }],
      },
      `frames[0].dos: unknown frame field`,
    ],
    [
      `a non-boolean unstable flag`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [{ value: 0, status: { unstable: `yes` } }] }],
      },
      `frames[0].status.unstable: must be a boolean`,
    ],
    [
      `a non-string frame label`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [{ value: 0, label: 5 }] }],
      },
      `frames[0].label: must be a string, got 5`,
    ],
    [
      `a non-string axis unit`,
      { axis: { key: `p`, label: `P`, unit: 1 }, series: [{ id: `a`, frames: [frame] }] },
      `axis.unit: must be a string, got 1`,
    ],
    [
      `an invalid series order`,
      {
        axis: { key: `p`, label: `P` },
        series: [{ id: `a`, frames: [{ value: 2 }, { value: 1 }] }],
      },
      `strictly ascending`,
    ],
  ])(`rejects %s, naming where`, (_desc, raw, message) => {
    expect(() => normalize_sweep(raw)).toThrow(message)
  })
})
