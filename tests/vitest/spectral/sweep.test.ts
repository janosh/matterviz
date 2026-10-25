// Sweeps (spectral/sweep): validation, computed and supplied descriptors, JSON normalization
import type { ElementSymbol } from '#lib/element/types.js'
import type { BandGridData } from '#lib/fermi-surface/types.js'
import type { Matrix3x3 } from '#lib/math.js'
import type { Pbc } from '#lib/structure/index.js'
import {
  compute_descriptor,
  descriptor_lines,
  descriptor_point,
  descriptor_value,
  dos_at_energy,
  fermi_band_count,
  format_axis_value,
  frame_fermi_energy,
  min_pair_distance,
  nearest_frame,
  normalize_sweep,
  series_spacing,
  validate_sweep,
  volume_per_atom,
} from '#lib/spectral/sweep.js'
import type { DescriptorSpec, Sweep } from '#lib/spectral/sweep.js'
import type { DosData, ElectronicDos } from '#lib/spectral/types.js'
import { describe, expect, test } from 'vitest'
import { IDENTITY_MATRIX3, make_crystal } from '../test-fixtures'

// fcc primitive cell (a = 4 Å) with one atom: nearest neighbours at a/√2
const FCC: Matrix3x3 = [
  [0, 2, 2],
  [2, 0, 2],
  [2, 2, 0],
]
const lone_cu = (lattice: Matrix3x3, pbc?: Pbc) =>
  make_crystal(lattice, [[`Cu`, [0, 0, 0]]], { pbc })
const cu = lone_cu(FCC)
// rock salt in its 8-atom cubic cell (a = 4 Å): Na–Cl at a/2, Na–Na and Cl–Cl at a/√2
// oxfmt-ignore
const nacl = make_crystal(4, [
  [`Na`, [0, 0, 0]], [`Na`, [0, 0.5, 0.5]], [`Na`, [0.5, 0, 0.5]], [`Na`, [0.5, 0.5, 0]],
  [`Cl`, [0.5, 0, 0]], [`Cl`, [0, 0.5, 0]], [`Cl`, [0, 0, 0.5]], [`Cl`, [0.5, 0.5, 0.5]],
])
const dos = (energies: number[], densities: number[], extra: Partial<ElectronicDos> = {}) =>
  ({ type: `electronic`, energies, densities, efermi: 1, ...extra }) satisfies ElectronicDos
// two bands on a 2³ grid: band 0 spans 0..2 (crosses E_F = 1), band 1 lies at 3..4
const band = (values: number[]): BandGridData[`energies`][number][number] => ({
  values: Float64Array.from(values),
  dims: [2, 2, 2],
  order: `z_fastest`,
})
const grid: BandGridData = {
  energies: [[band([0, 2, 0, 2, 0, 2, 0, 2]), band([3, 4, 3, 4, 3, 4, 3, 4])]],
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
  const with_descriptors = (...descriptors: DescriptorSpec[]): Sweep =>
    sweep_of([0], { descriptors })
  const duplicate_ids: Sweep = {
    ...sweep_of([0]),
    series: [
      { id: `a`, frames: [{ value: 0 }] },
      { id: `a`, frames: [{ value: 1 }] },
    ],
  }
  const shared_frame = { value: 0 }
  const shared_frames: Sweep = {
    ...sweep_of([0]),
    series: [
      { id: `a`, frames: [shared_frame] },
      { id: `b`, frames: [shared_frame] },
    ],
  }
  // oxfmt-ignore
  test.each<[string, Sweep, string]>([
    [`no series`, { ...sweep_of([0]), series: [] }, `at least one series`],
    [`an empty series`, { ...sweep_of([0]), series: [{ id: `a`, frames: [] }] }, `has no frames`],
    [`descending values`, sweep_of([50, 0]), `strictly ascending: frame 1 has 0 after 50`],
    [`repeated values`, sweep_of([50, 50]), `strictly ascending`],
    [`a non-finite value`, sweep_of([0, Number.NaN]), `frame 1 has a non-finite value NaN`],
    [`duplicate series ids`, duplicate_ids, `series id "a" is not unique`],
    [`a frame shared by two series`, shared_frames, `series "b" frame 0 reuses the frame object of series "a" frame 0`],
    [`duplicate descriptor keys`, with_descriptors({ key: `tc`, label: `Tc` }, { key: `tc`, label: `T_c` }), `descriptor key "tc" is not unique`],
    [`an element share without element`, with_descriptors({ key: `h`, label: `H`, compute: `fermi_dos_share` }), `element goes with (and only with) fermi_dos_share`],
    [`an element on another descriptor`, with_descriptors({ key: `n`, label: `N`, compute: `fermi_dos`, element: `H` }), `element goes with (and only with) fermi_dos_share`],
    [`a pair on another descriptor`, with_descriptors({ key: `v`, label: `V`, compute: `volume_per_atom`, pair: [`H`, `H`] }), `pair goes only with min_pair_distance`],
    [`an overlay of an unknown descriptor`, with_descriptors({ key: `tc`, label: `Tc`, overlay: [`tc_me`] }), `"tc" overlays "tc_me", no other descriptor`],
    [`an overlay listed twice`, with_descriptors({ key: `tc`, label: `Tc`, overlay: [`tc_me`, `tc_me`] }, { key: `tc_me`, label: `Tc (ME)` }), `"tc" overlays a descriptor twice`],
    [`an overlay of itself`, with_descriptors({ key: `tc`, label: `Tc`, overlay: [`tc`] }), `"tc" overlays "tc", no other descriptor`],
    [`an overlay in another unit`, with_descriptors({ key: `tc`, label: `Tc`, unit: `K`, overlay: [`lambda`] }, { key: `lambda`, label: `λ` }), `"tc" (K) overlays "lambda" in no unit: overlays share their unit`],
  ])(`rejects %s`, (_desc, sweep, message) => {
    expect(() => validate_sweep(sweep)).toThrow(message)
  })
})

describe(`computed descriptors`, () => {
  test(`volume per atom is the cell volume over the site count`, () => {
    expect(volume_per_atom(cu)).toBeCloseTo(16, 12) // fcc primitive cell: a³/4
    expect(volume_per_atom(nacl)).toBeCloseTo(8, 12) // 64 Å³ / 8 sites
  })

  // oxfmt-ignore
  test.each<[string, typeof cu, [ElementSymbol, ElementSymbol] | undefined, number | undefined]>([
    [`fcc Cu, its own images`, cu, undefined, 4 / Math.SQRT2],
    // b − 3a = (0.5, 0.5, 0): a shift no [-2, 2]³ search of the raw cell reaches
    [`a strongly sheared cell's own image`, lone_cu([[3, 0, 0], [9.5, 0.5, 0], [0, 0, 10]]), undefined, Math.SQRT1_2],
    [`a slab's own images in-plane only`, lone_cu([[3, 0, 0], [0, 3, 0], [0, 0, 1]], [true, true, false]), undefined, 3],
    [`a molecule's own images (none)`, lone_cu(IDENTITY_MATRIX3, [false, false, false]), undefined, undefined],
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

  // the frame's grid puts E_F at 1; the dos() helper's DOS default to efermi 1 too
  const fermi_dos: DescriptorSpec = { key: `n_ef`, label: `N(E_F)`, compute: `fermi_dos` }
  const h_share: DescriptorSpec = {
    key: `h`,
    label: `H`,
    compute: `fermi_dos_share`,
    element: `H`,
  }
  const phonon_total = { type: `phonon` as const, frequencies: [0, 2], densities: [1, 1] }
  const total = dos([0, 2], [2, 4])
  // oxfmt-ignore
  test.each<[string, Record<string, DosData>, DescriptorSpec, number | undefined]>([
    [`the total DOS at E_F`, { total, H: dos([0, 2], [1, 1]) }, fermi_dos, 3],
    [`an element's share of it`, { total, H: dos([0, 2], [1, 1]) }, h_share, 1 / 3],
    // a denser-k DOS sits at its own level, not the grid's
    [`the total DOS at its own E_F`, { total: dos([0, 2], [2, 4], { efermi: 0.5 }) }, fermi_dos, 2.5],
    [`a lone DOS as the total`, { cu: dos([0, 2], [1, 3]) }, fermi_dos, 2],
    [`no total from a lone element projection`, { Cu: dos([0, 2], [1, 3]) }, fermi_dos, undefined],
    [`no total from a phonon DOS`, { total: phonon_total }, fermi_dos, undefined],
    [`no share without its projection`, { total }, h_share, undefined],
  ])(`%s`, (_desc, doses, spec, expected) => {
    expect(compute_descriptor({ band_data: grid, doses }, spec)).toBe(expected)
  })

  const tc: DescriptorSpec = { key: `tc`, label: `Tc`, range: [`lo`, `hi`] }
  // oxfmt-ignore
  test.each<[string, Record<string, number | null>, string | ReturnType<typeof descriptor_point>]>([
    [`a value with its range`, { tc: 2, lo: 1, hi: 3 }, { value: 2, lower: 1, upper: 3 }],
    [`a value without bounds`, { tc: 2, lo: null }, { value: 2, lower: null, upper: null }],
    [`a value on its lower bound`, { tc: 1, lo: 1 }, { value: 1, lower: 1, upper: null }],
    [`no value`, { tc: null, lo: 1 }, null],
    [`a non-finite value`, { tc: Number.POSITIVE_INFINITY }, `Descriptor "tc" at 5 has a non-finite value Infinity`],
    [`a non-finite bound`, { tc: 1, hi: Number.NaN }, `has a non-finite range bound NaN`],
    [`a lower bound above the value`, { tc: 1, lo: 2 }, `range [2, null] does not bracket 1`],
    [`an upper bound below the value`, { tc: 4, hi: 3 }, `range [null, 3] does not bracket 4`],
  ])(`descriptor_point of %s`, (_desc, scalars, expected) => {
    const point = () => descriptor_point({ value: 5, scalars }, tc)
    if (typeof expected === `string`) expect(point).toThrow(expected)
    else expect(point()).toEqual(expected)
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

// the nearest frame of a series at 0, 50, 120: ties go to the lower frame
test.each([
  [-30, 0, 30],
  [25, 0, 25],
  [80, 1, 30],
  [85, 1, 35],
  [90, 2, 30],
  [500, 2, 380],
])(`nearest_frame at %d is frame %d, %d off`, (value, idx, distance) => {
  const series = { id: `fcc`, frames: [0, 50, 120].map((at) => ({ value: at })) }
  expect(nearest_frame(series, value)).toEqual({ idx, distance })
})

// the median of the series' consecutive gaps, 0 without any
test.each([
  [[0, 50, 120], 60],
  [[0, 10, 30, 60], 20],
  [[100, 110], 10],
  [[7], 0],
])(`series_spacing of frames at %j is %d`, (values, spacing) => {
  const frames = values.map((value) => ({ value }))
  expect(series_spacing({ id: `fcc`, frames })).toBe(spacing)
})

// a descriptor's lines: itself, then its overlays in their order; the first without a key
test.each([
  [undefined, [`tc`, `w2`, `wlog`]],
  [`wlog`, [`wlog`]],
  [`n_ef`, [`n_ef`]],
])(`descriptor_lines(%s) draws %j`, (key, keys) => {
  const descriptors: DescriptorSpec[] = [`tc`, `n_ef`, `wlog`, `w2`].map((at) => ({
    key: at,
    label: at,
  }))
  descriptors[0] = { ...descriptors[0], overlay: [`w2`, `wlog`] }
  const sweep: Sweep = { axis: { key: `p`, label: `P` }, series: [], descriptors }
  expect(descriptor_lines(sweep, key).map((spec) => spec.key)).toEqual(keys)
  expect(descriptor_lines({ ...sweep, descriptors: undefined })).toEqual([])
  expect(() => descriptor_lines(sweep, `tc_typo`)).toThrow(
    `descriptor "tc_typo" is not a descriptor of the sweep (tc, n_ef, wlog, w2)`,
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
              status: { unstable: true, note: `imaginary modes` },
              phonon: {
                a2f: { 'α²F': { frequencies: [0, 1], densities: [0, 0.5] } },
                // JSON writes NaN (no value) as null
                mode_values: {
                  label: `λ_qν`,
                  qpoints: [[0, 0, 0]],
                  frequencies: [[0, 3]],
                  values: [[null, 0.4]],
                },
              },
            },
            { value: 100, band_data: grid }, // typed grids pass through
          ],
        },
      ],
      descriptors: [
        { key: `tc`, label: `Tc`, unit: `K`, range: [`tc_lo`, `tc_hi`], threshold: 20 },
        { key: `tc_me`, label: `Tc (ME)`, unit: `K`, overlay: [`tc`] },
      ],
    })
    const [first, second, third] = sweep.series[0].frames
    expect(first.structure?.sites).toHaveLength(1)
    expect(first.scalars).toEqual({ tc: 10, lambda: null })
    expect(second.doses?.total).toMatchObject({ type: `electronic`, densities: [1, 2] })
    expect(second.status).toEqual({ unstable: true, note: `imaginary modes` })
    expect(third.band_data).toBe(grid)
    expect(second.phonon).toEqual({
      a2f: { 'α²F': { type: `phonon`, frequencies: [0, 1], densities: [0, 0.5] } },
      mode_values: {
        label: `λ_qν`,
        qpoints: [[0, 0, 0]],
        frequencies: [[0, 3]],
        values: [[NaN, 0.4]],
      },
    })
    expect(sweep.descriptors).toEqual([
      { key: `tc`, label: `Tc`, unit: `K`, range: [`tc_lo`, `tc_hi`], threshold: 20 },
      { key: `tc_me`, label: `Tc (ME)`, unit: `K`, overlay: [`tc`] },
    ])
  })

  // a one-frame JSON sweep with the frame's extra fields and the sweep's
  const raw_sweep = (frame: object = {}, sweep: object = {}): object => ({
    axis: { key: `p`, label: `P` },
    series: [{ id: `a`, frames: [{ value: 0, ...frame }] }],
    ...sweep,
  })
  const descriptor = (spec: object) =>
    raw_sweep({}, { descriptors: [{ key: `x`, label: `X`, ...spec }] })
  // oxfmt-ignore
  test.each<[string, unknown, string]>([
    [`no object`, [], `at root: must be an object`],
    [`no axis key`, { axis: { label: `P` }, series: [] }, `at axis.key: must be a string, got undefined`],
    [`no series array`, raw_sweep({}, { series: {} }), `at root.series: must be an array, got {}`],
    [`a frame without value`, raw_sweep({ value: undefined }), `series[0].frames[0]: value must be a number`],
    [`a molecule structure`, raw_sweep({ structure: { sites: json_structure.sites } }), `frames[0].structure: needs a periodic structure`],
    [`an unparsable DOS`, raw_sweep({ doses: { x: 1 } }), `frames[0].doses.x: unrecognized data`],
    [`a non-numeric scalar`, raw_sweep({ scalars: { tc: `hot` } }), `frames[0].scalars.tc: must be a number or null`],
    [`non-object scalars`, raw_sweep({ scalars: [1] }), `frames[0].scalars: must be an object`],
    [`a non-object band grid`, raw_sweep({ band_data: [] }), `frames[0].band_data: must be an object`],
    [`an invalid meshed surface`, raw_sweep({ fermi_data: { isosurfaces: [1] } }), `frames[0].fermi_data: Invalid FermiSurfaceData JSON`],
    [`a non-boolean unstable flag`, raw_sweep({ status: { unstable: `yes` } }), `frames[0].status.unstable: must be a boolean`],
    [`a non-string frame label`, raw_sweep({ label: 5 }), `frames[0].label: must be a string, got 5`],
    [`a non-string axis unit`, raw_sweep({}, { axis: { key: `p`, label: `P`, unit: 1 } }), `axis.unit: must be a string, got 1`],
    [`a numeric series id`, raw_sweep({}, { series: [{ id: 1, frames: [{ value: 0 }] }] }), `series[0].id: must be a string, got 1`],
    [`an electronic DOS among the phonons`, raw_sweep({ phonon: { doses: { x: { energies: [0], densities: [1] } } } }), `frames[0].phonon.doses.x: must be phonon data, got electronic`],
    [`a phonon DOS among the electronic ones`, raw_sweep({ doses: { x: { frequencies: [0], densities: [1] } } }), `frames[0].doses.x: must be electronic data, got phonon`],
    [`an unknown frame field (e.g. a typo)`, raw_sweep({ dos: {} }), `frames[0].dos: unknown field`],
    [`an electronic α²F`, raw_sweep({ phonon: { a2f: { x: { energies: [0], densities: [1] } } } }), `frames[0].phonon.a2f.x: must be phonon data, got electronic`],
    [`an unknown phonon field`, raw_sweep({ phonon: { dispersion: {} } }), `frames[0].phonon.dispersion: unknown field`],
    [`non-object mode values`, raw_sweep({ phonon: { mode_values: [] } }), `frames[0].phonon.mode_values: must be an object`],
    [`mode values unlike their frequencies`, raw_sweep({ phonon: { mode_values: { label: `λ`, qpoints: [[0, 0, 0]], frequencies: [[1, 2]], values: [[0.1]] } } }), `frames[0].phonon.mode_values: values[0] must be 2 numbers`],
    [`mode values without q-points`, raw_sweep({ phonon: { mode_values: { label: `λ`, frequencies: [[1]], values: [[0.1]] } } }), `frames[0].phonon.mode_values: qpoints must be an array`],
    [`an unknown status field`, raw_sweep({ status: { why: `x` } }), `frames[0].status.why: unknown field`],
    [`an unknown series field`, raw_sweep({}, { series: [{ id: `a`, frames: [], frames_: [] }] }), `series[0].frames_: unknown field`],
    [`an unknown axis field`, raw_sweep({}, { axis: { key: `p`, label: `P`, units: `GPa` } }), `axis.units: unknown field`],
    [`an unknown root field`, raw_sweep({}, { extra: 1 }), `root.extra: unknown field`],
    [`an unknown descriptor field`, descriptor({ units: `K` }), `descriptors[0].units: unknown field`],
    [`a string threshold`, descriptor({ threshold: `20` }), `descriptors[0].threshold: must be a finite number, got "20"`],
    [`an unknown computed descriptor`, descriptor({ compute: `magic` }), `descriptors[0].compute: must be one of volume_per_atom, min_pair_distance, fermi_dos, fermi_dos_share, fermi_band_count, got "magic"`],
    [`a descriptor pair that is no element symbols`, descriptor({ compute: `min_pair_distance`, pair: [`Hx`, `H`] }), `descriptors[0].pair: must be two element symbols, got ["Hx","H"]`],
    [`a non-list overlay`, descriptor({ overlay: `y` }), `descriptors[0].overlay: must be descriptor keys`],
    // normalize_sweep validates what it parsed
    [`an invalid series order`, raw_sweep({}, { series: [{ id: `a`, frames: [{ value: 2 }, { value: 1 }] }] }), `strictly ascending`],
  ])(`rejects %s, naming where`, (_desc, raw, message) => {
    expect(() => normalize_sweep(raw)).toThrow(message)
  })
})
