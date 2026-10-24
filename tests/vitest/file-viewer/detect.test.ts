import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  detect_view_type,
  is_plottable_data,
  scan_renderable_paths,
} from '#lib/file-viewer/detect.js'
import { resolve_path } from 'svelte-widgets/json-tree/path'
import { IDENTITY_MATRIX3 } from '../test-fixtures'

const read_json_gz = (path: string): unknown =>
  JSON.parse(gunzipSync(readFileSync(`${import.meta.dirname}/${path}`)).toString())
const fixture = read_json_gz(`../fixtures/file-viewer/all-viz-types.json.gz`)

// Fixture-based detection is covered by scan_renderable_paths' exact path map plus the
// re-detect round-trip below.
describe(`detect_view_type`, () => {
  const labels_dict = { G: [0, 0, 0] }
  const pymatgen_bands = {
    kpoints: [[0, 0, 0]],
    branches: [{ start_index: 0, end_index: 1, name: `G-X` }],
    bands: { '1': [[1, 2, 3]] },
    labels_dict,
    efermi: 5.0,
  }
  const norm_dos = { type: `electronic`, energies: [0, 1, 2], densities: [[0.1, 0.2, 0.3]] }
  const fermi_surface = {
    isosurfaces: [],
    k_lattice: IDENTITY_MATRIX3,
    fermi_energy: 5.0,
    reciprocal_cell: `wigner_seitz`,
  }
  const combined_bands_dos = {
    branches: [{ start_index: 0, end_index: 1 }],
    labels_dict,
    energies: [0, 1],
    densities: [[0.1, 0.2]],
    kpoints: [[0, 0, 0]],
    bands: { '1': [[1, 2]] },
    efermi: 5.0,
  }
  const flat_volume = {
    values: [1, 2, 3, 4, 5, 6, 7, 8],
    dims: [2, 2, 2],
    lattice: IDENTITY_MATRIX3,
    origin: [0, 0, 0],
    periodic: true,
  }
  const binary_pd = {
    components: [`A`, `B`],
    regions: [],
    boundaries: [],
    temperature_range: [300, 1500],
  }

  // oxfmt-ignore
  test.each([
    // === Null / non-renderable inputs ===
    [`null`, null, null],
    [`undefined`, null, undefined],
    [`number`, null, 42],
    [`string`, null, `hello`],
    [`boolean`, null, true],
    [`empty array`, null, []],
    [`empty object`, null, {}],
    [`arbitrary object`, null, { foo: `bar` }],
    [`structure with empty sites`, null, { sites: [] }],
    [`structure site missing species`, null, { sites: [{}] }],
    [`partial band_grid`, null, { energies: [1], k_grid: [1, 2, 3] }],
    // === Minimal valid shapes ===
    [`structure (abc)`, `structure`, { sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }] }],
    [`structure (xyz)`, `structure`, { sites: [{ species: [{ element: `Si` }], xyz: [0, 0, 0] }] }],
    ...[`energy`, `e_form_per_atom`, `energy_per_atom`].map((energy_key) => [
      `convex_hull (${energy_key})`, `convex_hull`,
      [{ composition: { Li: 1 }, [energy_key]: -1.5 }, { composition: { Fe: 1 }, [energy_key]: -2.0 }],
    ]),
    [`band_grid`, `band_grid`, { energies: [[[1, 2]]], k_grid: [2, 2, 2], k_lattice: IDENTITY_MATRIX3, fermi_energy: 5.0, n_bands: 1, n_spins: 1 }],
    [`fermi_surface`, `fermi_surface`, { ...fermi_surface, metadata: { source: `test` } }],
    [`dos (electronic)`, `dos`, norm_dos],
    [`dos (phonon)`, `dos`, { type: `phonon`, frequencies: [0, 100, 200], densities: [[0.1, 0.2, 0.3]] }],
    [`dos (pymatgen @class)`, `dos`, { '@class': `CompleteDos`, energies: [-5, 0, 5], densities: { '1': [0.1, 0.5, 0.1] }, efermi: 0.0 }],
    [`band_structure (pymatgen)`, `band_structure`, pymatgen_bands],
    [`band_structure (normalized)`, `band_structure`, { qpoints: [[0, 0, 0]], branches: [{ start_index: 0, end_index: 1 }], bands: [[1, 2, 3]], labels_dict, nb_bands: 1 }],
    [`phase_diagram`, `phase_diagram`, binary_pd],
    [`volumetric`, `volumetric`, { grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]], grid_dims: [2, 2, 2], lattice: IDENTITY_MATRIX3, origin: [0, 0, 0], data_range: { min: 0, max: 1 }, periodic: true, id: `charge` }],
    [`xrd (hkls)`, `xrd`, { x: [10, 20, 30], y: [100, 50, 75], hkls: [[[1, 0, 0]], [[1, 1, 0]], [[1, 1, 1]]] }],
    [`xrd (wavelength)`, `xrd`, { x: [10, 20], y: [100, 50], wavelength: 1.5406 }],
    [`xrd (d_hkls)`, `xrd`, { x: [20, 40], y: [100, 50], d_hkls: [2.0, 1.5] }],
    [`xrd (@class)`, `xrd`, { x: [20, 40], y: [100, 50], '@class': `XrdPattern` }],
    [`brillouin_zone`, `brillouin_zone`, { k_lattice: IDENTITY_MATRIX3, k_path: [[0, 0, 0], [0.5, 0, 0]] }],
    [`brillouin_zone (reciprocal_lattice)`, `brillouin_zone`, { reciprocal_lattice: IDENTITY_MATRIX3, k_path: [[0, 0, 0]] }],
    [`brillouin_zone (bz_order)`, `brillouin_zone`, { k_lattice: IDENTITY_MATRIX3, bz_order: 1 }],
    [`bands_and_dos`, `bands_and_dos`, { band_structure: pymatgen_bands, dos: norm_dos }],
    [`bands_and_dos (combined fields)`, `bands_and_dos`, { ...combined_bands_dos, energies: [0, 1, 2], densities: [[0.1, 0.2, 0.3]], atom_dos: {} }],
    [`table (row-based)`, `table`, [{ name: `Si`, energy: -5.4, volume: 20.5 }, { name: `Ge`, energy: -4.6, volume: 22.7 }, { name: `C`, energy: -7.4, volume: 11.2 }]],
    [`table (column-based)`, `table`, { element: [`Si`, `Ge`, `C`], energy: [-5.4, -4.6, -7.4], volume: [20.5, 22.7, 11.2] }],
    // === Negative / boundary cases ===
    [`pure-string columns`, null, { names: [`Si`, `Ge`], symbols: [`Si`, `Ge`] }],
    [`x/y without hkls -> table not xrd`, `table`, { x: [1, 2, 3], y: [4, 5, 6], z: [7, 8, 9] }],
    [`single convex hull entry`, null, [{ composition: { Li: 1 }, energy: -1.5 }]],
    [`2-row table too small`, null, [{ a: 1, b: 2 }, { a: 3, b: 4 }]],
    [`BZ with isosurfaces -> fermi_surface`, `fermi_surface`, { ...fermi_surface, metadata: {} }],
    [`combined fields without atom_dos/spd_dos -> band_structure`, `band_structure`, combined_bands_dos],
    [`bands_and_dos wrapper with too many keys`, null, { band_structure: pymatgen_bands, dos: norm_dos, extra_1: 1, extra_2: 2, extra_3: 3, extra_4: 4 }],
    [`band_structure with empty branches`, null, { branches: [], labels_dict, kpoints: [[0, 0, 0]], bands: { '1': [[1]] }, efermi: 5.0 }],
    [`phase_diagram with 3 components (not binary)`, null, { ...binary_pd, components: [`A`, `B`, `C`] }],
    [`column table with unequal lengths`, null, { col_a: [1, 2, 3], col_b: [4, 5] }],
    // make_volume needs a nonempty string id, so id-less grids threw on open
    ...[{}, { id: `` }, { id: `  ` }, { id: 7 }].map((id_field) => [
      `volumetric grid with id ${JSON.stringify(id_field)}`, null, { ...flat_volume, ...id_field },
    ]),
    [`row table with inconsistent keys`, null, [{ a: 1, b: 2 }, { x: 3, y: 4 }, { z: 5, w: 6 }]],
  ] as [string, string | null, unknown][])(`%s -> %s`, (_label, expected, val) => {
    expect(detect_view_type(val)).toBe(expected)
  })
})

describe(`scan_renderable_paths`, () => {
  const fixture_paths = scan_renderable_paths(fixture)
  // The smallest value detect_view_type accepts as a structure
  const si_structure = { sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }] }

  // Exact path → type map: nested structures are found at their own path and not recursed
  // into (no `structures.Cu_FCC.sites` entry), every fixture type is discovered once
  test(`finds every renderable path in the fixture without recursing into them`, () => {
    expect([...fixture_paths]).toEqual([
      [`structures.Cu_FCC`, `structure`],
      [`structures.Bi2Zr2O8_fluorite`, `structure`],
      [`fermi_surface`, `fermi_surface`],
      [`phase_diagram`, `phase_diagram`],
      [`band_structure`, `band_structure`],
      [`dos`, `dos`],
      [`convex_hull_Li_Fe`, `convex_hull`],
      [`convex_hull_Li_Fe_O`, `convex_hull`],
      [`convex_hull_Li_Fe_P_O`, `convex_hull`],
    ])
    // every scanned path resolves back to a value that re-detects as the same type
    for (const [path, type] of fixture_paths) {
      expect(detect_view_type(resolve_path(fixture, path)), path).toBe(type)
    }
  })

  // pymatgen phonon band structures never serialise `branches`, which detection used to
  // require, so a PhononBSDOSDoc's bands got no badge (only its DOS did)
  test(`finds the phonon band structure and DOS inside a pymatgen phonon document`, () => {
    const doc = read_json_gz(`../../../src/site/phonons/mp-2667-Cs1Au1-pbe.json.gz`) as {
      phonon_bandstructure: Record<string, unknown>
    }
    const paths = scan_renderable_paths(doc)
    expect(paths.get(`phonon_bandstructure`)).toBe(`band_structure`)
    expect(paths.get(`phonon_dos`)).toBe(`dos`)
    // as_dict() spells the reciprocal lattice lattice_rec
    const { recip_lattice, ...rest } = doc.phonon_bandstructure
    expect(detect_view_type({ ...rest, lattice_rec: recip_lattice })).toBe(`band_structure`)
    // without any reciprocal lattice it is not a recognisable band structure
    expect(detect_view_type(rest)).not.toBe(`band_structure`)
  })

  test.each([{ foo: `bar`, n: 42 }, null, undefined, `hello`, true])(
    `returns empty map for %j`,
    (val) => expect(scan_renderable_paths(val).size).toBe(0),
  )

  test(`respects max_depth`, () => {
    const deep = { a: { b: { c: si_structure } } }
    expect(scan_renderable_paths(deep, 2).size).toBe(0)
    expect(scan_renderable_paths(deep, 4).size).toBe(1)
  })

  // Keys that are not plain identifiers use bracket notation and resolve back to the value
  test.each([
    [
      `array element`,
      { items: [{ composition: { Li: 1 }, energy: -1.5 }, si_structure] },
      `items[1]`,
    ],
    [`root-level dotted key`, { 'mp-1234.structure': si_structure }, `["mp-1234.structure"]`],
    ...[`a[b]`, `dot.key`, `say "hello"`, `slash\\key`, `mix.["quoted"]\\tail`, ``, `0`].map(
      (key) => [
        `key ${JSON.stringify(key)}`,
        { root: { [key]: si_structure } },
        `root[${JSON.stringify(key)}]`,
      ],
    ),
  ] as [string, unknown, string][])(`%s round-trips through path %s`, (_label, data, path) => {
    expect([...scan_renderable_paths(data)]).toEqual([[path, `structure`]])
    expect(resolve_path(data, path)).toBe(si_structure)
  })

  // a plottable table registers a second badge under a \x00-suffixed path at the same node
  test.each([
    [{ x: [1, 2, 3], y: [4, 5, 6], z: [7, 8, 9] }, [`table`, `plot`]],
    [{ name: [`Si`, `Ge`, `C`], energy: [-5.4, -4.6, -7.4] }, [`table`]],
  ])(`%j registers badges %j`, (data, expected_types) => {
    const paths = scan_renderable_paths(data)
    expect([...paths.values()]).toEqual(expected_types)
    expect(paths.get(`\u0000plot`)).toBe(expected_types.includes(`plot`) ? `plot` : undefined)
  })
})

// oxfmt-ignore
test.each([
  [`column-based with 2 numeric cols`, true, { x: [1, 2, 3], y: [4, 5, 6] }],
  [`row-based with 2 numeric cols`, true, [{ a: 1, b: 2, name: `x` }, { a: 3, b: 4, name: `y` }, { a: 5, b: 6, name: `z` }]],
  // any numeric element counts (typeof NaN === number), not just the first one
  [`column-based with null/NaN first elements`, true, { x: [null, 2, 3], y: [NaN, 5, 6] }],
  [`row-based with null first row values`, true, [{ a: null, b: 4 }, { a: 2, b: 5 }, { a: 3, b: 6 }]],
  // a leading null in EVERY column (or a first row of nulls) used to fail is_tabular_data
  [`column-based with all-null first elements`, true, { x: [null, 2, 3], y: [null, 5, 6] }],
  [`row-based with an all-null first row`, true, [{ a: null, b: null }, { a: 2, b: 5 }, { a: 3, b: 6 }]],
  [`column-based with 1 numeric col`, false, { name: [`Si`, `Ge`, `C`], energy: [-5.4, -4.6, -7.4] }],
  [`row-based with 1 numeric col`, false, [{ a: 1, name: `x` }, { a: 2, name: `y` }]],
  [`empty array`, false, []],
  [`non-tabular object`, false, { foo: `bar` }],
  [`null`, false, null],
  [`undefined`, false, undefined],
  [`string`, false, `hello`],
  [`boolean`, false, true],
] as [string, boolean, unknown][])(`is_plottable_data: %s -> %s`, (_label, expected, val) => {
  expect(is_plottable_data(val)).toBe(expected)
})
