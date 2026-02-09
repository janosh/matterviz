// Tests for data type detection used by JsonBrowser and main.ts
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { detect_view_type, scan_renderable_paths } from '../src/webview/detect'

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(`extensions/vscode/test-fixtures/all-viz-types.json.gz`),
  ).toString(),
)

describe(`detect_view_type`, () => {
  // === Positive detections from the test fixture ===

  test.each(
    [
      [`structures.Cu_FCC`, `structure`],
      [`structures.Bi2Zr2O8_fluorite`, `structure`],
      [`fermi_surface`, `fermi_surface`],
      [`phase_diagram`, `phase_diagram`],
      [`band_structure`, `band_structure`],
      [`dos`, `dos`],
      [`convex_hull_Li_Fe`, `convex_hull`],
      [`convex_hull_Li_Fe_O`, `convex_hull`],
      [`convex_hull_Li_Fe_P_O`, `convex_hull`],
    ] as const,
  )(`detects %s as %s`, (path, expected) => {
    expect(detect_view_type(resolve(fixture, path))).toBe(expected)
  })

  // === Null / non-renderable inputs ===

  test.each([
    [null, `null`],
    [undefined, `undefined`],
    [42, `number`],
    [`hello`, `string`],
    [true, `boolean`],
    [[], `empty array`],
    [{}, `empty object`],
    [{ foo: `bar` }, `arbitrary object`],
    [{ sites: [] }, `structure with empty sites`],
    [{ sites: [{}] }, `structure site missing species`],
    [{ energies: [1], k_grid: [1, 2, 3] }, `partial band_grid`],
  ] as [unknown, string][])(`returns null for %s (%s)`, (val) => {
    expect(detect_view_type(val)).toBeNull()
  })

  // === Minimal valid shapes ===

  // Reusable test data fragments
  const k_lattice_3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const labels_dict = { G: [0, 0, 0] }
  const pymatgen_bands = {
    kpoints: [[0, 0, 0]],
    branches: [{ start_index: 0, end_index: 1, name: `G-X` }],
    bands: { '1': [[1, 2, 3]] },
    labels_dict,
    efermi: 5.0,
  }
  const norm_dos = {
    type: `electronic`,
    energies: [0, 1, 2],
    densities: [[0.1, 0.2, 0.3]],
  }

  test.each([
    [`structure (abc)`, `structure`, {
      sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }],
    }],
    [`structure (xyz)`, `structure`, {
      sites: [{ species: [{ element: `Si` }], xyz: [0, 0, 0] }],
    }],
    [`convex_hull (energy)`, `convex_hull`, [{ composition: { Li: 1 }, energy: -1.5 }, {
      composition: { Fe: 1 },
      energy: -2.0,
    }]],
    [`convex_hull (e_form_per_atom)`, `convex_hull`, [
      { composition: { Li: 1 }, e_form_per_atom: 0.0 },
      { composition: { Fe: 1 }, e_form_per_atom: 0.0 },
    ]],
    [`band_grid`, `band_grid`, {
      energies: [[[1, 2]]],
      k_grid: [2, 2, 2],
      k_lattice: k_lattice_3x3,
      fermi_energy: 5.0,
      n_bands: 1,
      n_spins: 1,
    }],
    [`fermi_surface`, `fermi_surface`, {
      isosurfaces: [],
      k_lattice: k_lattice_3x3,
      fermi_energy: 5.0,
      reciprocal_cell: `wigner_seitz`,
      metadata: { source: `test` },
    }],
    [`dos (electronic)`, `dos`, norm_dos],
    [`dos (phonon)`, `dos`, {
      type: `phonon`,
      frequencies: [0, 100, 200],
      densities: [[0.1, 0.2, 0.3]],
    }],
    [`band_structure (pymatgen)`, `band_structure`, pymatgen_bands],
    [`band_structure (normalized)`, `band_structure`, {
      qpoints: [[0, 0, 0]],
      branches: [{ start_index: 0, end_index: 1 }],
      bands: [[1, 2, 3]],
      labels_dict,
      nb_bands: 1,
    }],
    [`phase_diagram`, `phase_diagram`, {
      components: [`A`, `B`],
      regions: [],
      boundaries: [],
      temperature_range: [300, 1500],
    }],
    [`volumetric`, `volumetric`, {
      grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
      grid_dims: [2, 2, 2],
      lattice: k_lattice_3x3,
      origin: [0, 0, 0],
      data_range: { min: 0, max: 1 },
      periodic: true,
    }],
    [`xrd (hkls)`, `xrd`, {
      x: [10, 20, 30],
      y: [100, 50, 75],
      hkls: [[[1, 0, 0]], [[1, 1, 0]], [[1, 1, 1]]],
    }],
    [`xrd (wavelength)`, `xrd`, { x: [10, 20], y: [100, 50], wavelength: 1.5406 }],
    [`brillouin_zone`, `brillouin_zone`, {
      k_lattice: k_lattice_3x3,
      k_path: [[0, 0, 0], [0.5, 0, 0]],
    }],
    [`bands_and_dos`, `bands_and_dos`, { band_structure: pymatgen_bands, dos: norm_dos }],
    [`table (row-based)`, `table`, [
      { name: `Si`, energy: -5.4, volume: 20.5 },
      { name: `Ge`, energy: -4.6, volume: 22.7 },
      { name: `C`, energy: -7.4, volume: 11.2 },
    ]],
    [`table (column-based)`, `table`, {
      element: [`Si`, `Ge`, `C`],
      energy: [-5.4, -4.6, -7.4],
      volume: [20.5, 22.7, 11.2],
    }],
    // Alternative format variants (testing all code branches)
    [`convex_hull (energy_per_atom)`, `convex_hull`, [
      { composition: { Li: 1 }, energy_per_atom: -1.5 },
      { composition: { Fe: 1 }, energy_per_atom: -2.0 },
    ]],
    [`dos (pymatgen @class)`, `dos`, {
      '@class': `CompleteDos`,
      '@module': `pymatgen.electronic_structure.dos`,
      energies: [-5, 0, 5],
      densities: { '1': [0.1, 0.5, 0.1] },
      efermi: 0.0,
    }],
    [`xrd (d_hkls)`, `xrd`, { x: [20, 40], y: [100, 50], d_hkls: [2.0, 1.5] }],
    [`xrd (@class)`, `xrd`, { x: [20, 40], y: [100, 50], '@class': `XrdPattern` }],
    [`brillouin_zone (reciprocal_lattice)`, `brillouin_zone`, {
      reciprocal_lattice: k_lattice_3x3,
      k_path: [[0, 0, 0]],
    }],
    [`brillouin_zone (bz_order)`, `brillouin_zone`, {
      k_lattice: k_lattice_3x3,
      bz_order: 1,
    }],
    [`bands_and_dos (combined fields)`, `bands_and_dos`, {
      branches: [{ start_index: 0, end_index: 1 }],
      labels_dict,
      energies: [0, 1, 2],
      densities: [[0.1, 0.2, 0.3]],
      atom_dos: {},
      kpoints: [[0, 0, 0]],
      bands: { '1': [[1, 2]] },
      efermi: 5.0,
    }],
  ] as [string, string, unknown][])(`detects %s`, (_, expected, val) => {
    expect(detect_view_type(val)).toBe(expected)
  })

  // === Negative / boundary cases ===

  test.each([
    [`pure-string columns`, null, { names: [`Si`, `Ge`], symbols: [`Si`, `Ge`] }],
    [`x/y without hkls -> table not xrd`, `table`, {
      x: [1, 2, 3],
      y: [4, 5, 6],
      z: [7, 8, 9],
    }],
    [`single convex hull entry`, null, [{ composition: { Li: 1 }, energy: -1.5 }]],
    [`2-row table too small`, null, [{ a: 1, b: 2 }, { a: 3, b: 4 }]],
    [`BZ with isosurfaces -> fermi_surface`, `fermi_surface`, {
      k_lattice: k_lattice_3x3,
      isosurfaces: [],
      fermi_energy: 5.0,
      reciprocal_cell: `wigner_seitz`,
      metadata: {},
    }],
    [`combined fields without atom_dos/spd_dos -> band_structure`, `band_structure`, {
      branches: [{ start_index: 0, end_index: 1 }],
      labels_dict,
      energies: [0, 1],
      densities: [[0.1, 0.2]],
      kpoints: [[0, 0, 0]],
      bands: { '1': [[1, 2]] },
      efermi: 5.0,
    }],
    [`bands_and_dos wrapper with too many keys`, null, {
      band_structure: pymatgen_bands,
      dos: norm_dos,
      extra_1: 1,
      extra_2: 2,
      extra_3: 3,
      extra_4: 4,
    }],
    [`band_structure with empty branches`, null, {
      branches: [],
      labels_dict,
      kpoints: [[0, 0, 0]],
      bands: { '1': [[1]] },
      efermi: 5.0,
    }],
    [`phase_diagram with 3 components (not binary)`, null, {
      components: [`A`, `B`, `C`],
      regions: [],
      boundaries: [],
      temperature_range: [300, 1500],
    }],
    [`column table with unequal lengths`, null, {
      col_a: [1, 2, 3],
      col_b: [4, 5],
    }],
    [`row table with inconsistent keys`, null, [
      { a: 1, b: 2 },
      { x: 3, y: 4 },
      { z: 5, w: 6 },
    ]],
  ] as [string, string | null, unknown][])(`%s -> %s`, (_, expected, val) => {
    if (expected === null) expect(detect_view_type(val)).toBeNull()
    else expect(detect_view_type(val)).toBe(expected)
  })
})

describe(`scan_renderable_paths`, () => {
  // Scan fixture once and reuse across related assertions
  const fixture_paths = scan_renderable_paths(fixture)

  test(`finds all expected types in test fixture`, () => {
    expect(fixture_paths.size).toBeGreaterThanOrEqual(9)
    const types = new Set([...fixture_paths.values()].map((info) => info.type))
    for (
      const expected of [
        `structure`,
        `fermi_surface`,
        `phase_diagram`,
        `band_structure`,
        `dos`,
        `convex_hull`,
      ]
    ) {
      expect(types, `missing type: ${expected}`).toContain(expected)
    }
  })

  test(`finds nested structures at correct paths without recursing into them`, () => {
    expect(fixture_paths.get(`structures.Cu_FCC`)?.type).toBe(`structure`)
    // Should NOT find children like structures.Cu_FCC.sites
    expect([...fixture_paths.keys()].some((key) => key.startsWith(`structures.Cu_FCC.`)))
      .toBe(false)
  })

  test.each([
    [{ foo: `bar`, n: 42 }, `non-renderable object`],
    [null, `null`],
    [undefined, `undefined`],
    [`hello`, `string primitive`],
  ] as [unknown, string][])(`returns empty map for %s`, (val) => {
    expect(scan_renderable_paths(val).size).toBe(0)
  })

  test(`respects max_depth`, () => {
    const deep = {
      a: { b: { c: { sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }] } } },
    }
    expect(scan_renderable_paths(deep, ``, 2).size).toBe(0)
    expect(scan_renderable_paths(deep, ``, 4).size).toBe(1)
  })

  test(`scans array elements`, () => {
    const data = {
      items: [
        { composition: { Li: 1 }, energy: -1.5 },
        { sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }] },
      ],
    }
    expect(scan_renderable_paths(data).get(`items[1]`)?.type).toBe(`structure`)
  })

  test.each([
    [`root-level dotted key`, {
      'mp-1234.structure': { sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }] },
    }, `["mp-1234.structure"]`],
    [`nested dotted key`, {
      results: {
        'calc.1': { sites: [{ species: [{ element: `Cu` }], abc: [0, 0, 0] }] },
      },
    }, `results["calc.1"]`],
  ] as [string, unknown, string][])(
    `handles %s via bracket notation`,
    (_, data, expected_path) => {
      const paths = scan_renderable_paths(data)
      expect(paths.get(expected_path)?.type).toBe(`structure`)
    },
  )

  test(`all scanned paths resolve back to the original value`, () => {
    // resolve_path mirror (same logic as JsonBrowser.svelte)
    function resolve_path(root: unknown, path: string): unknown {
      if (!path) return root
      const segments: string[] = []
      const segment_re = /\["([^"]+)"\]|\[(\d+)\]|([^.\[\]]+)/g
      let match: RegExpExecArray | null
      while ((match = segment_re.exec(path)) !== null) {
        segments.push(match[1] ?? match[2] ?? match[3])
      }
      let current: unknown = root
      for (const segment of segments) {
        if (current === null || current === undefined || typeof current !== `object`) {
          return undefined
        }
        current = (current as Record<string, unknown>)[segment]
      }
      return current
    }
    for (const [path] of fixture_paths) {
      const resolved = resolve_path(fixture, path)
      expect(resolved, `resolve_path failed for '${path}'`).not.toBeUndefined()
      // Re-detect should return the same type
      expect(detect_view_type(resolved)).toBe(fixture_paths.get(path)?.type)
    }
  })
})

// Helper to resolve dotted paths like "structures.Cu_FCC"
function resolve(obj: Record<string, unknown>, path: string): unknown {
  return path.split(`.`).reduce<unknown>(
    (current, key) => (current as Record<string, unknown>)?.[key],
    obj,
  )
}
