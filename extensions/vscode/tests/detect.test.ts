// Tests for data type detection used by JsonBrowser and main.ts
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { detect_view_type, scan_renderable_paths } from '../src/webview/detect'

const fixture = JSON.parse(
  gunzipSync(readFileSync(`extensions/vscode/test-fixtures/all-viz-types.json.gz`))
    .toString(),
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

  test(`minimal structure with abc coords`, () => {
    const val = {
      sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }],
      lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
    }
    expect(detect_view_type(val)).toBe(`structure`)
  })

  test(`minimal structure with xyz coords`, () => {
    const val = {
      sites: [{ species: [{ element: `Si` }], xyz: [0, 0, 0] }],
    }
    expect(detect_view_type(val)).toBe(`structure`)
  })

  test(`minimal convex hull entries`, () => {
    const val = [
      { composition: { Li: 1 }, energy: -1.5 },
      { composition: { Fe: 1 }, energy: -2.0 },
    ]
    expect(detect_view_type(val)).toBe(`convex_hull`)
  })

  test(`convex hull with e_form_per_atom`, () => {
    const val = [
      { composition: { Li: 1 }, e_form_per_atom: 0.0 },
    ]
    expect(detect_view_type(val)).toBe(`convex_hull`)
  })

  test(`minimal band_grid`, () => {
    const val = {
      energies: [[[1, 2]]],
      k_grid: [2, 2, 2],
      k_lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      fermi_energy: 5.0,
      n_bands: 1,
      n_spins: 1,
    }
    expect(detect_view_type(val)).toBe(`band_grid`)
  })

  test(`minimal fermi_surface`, () => {
    const val = {
      isosurfaces: [],
      k_lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      fermi_energy: 5.0,
      reciprocal_cell: `wigner_seitz`,
      metadata: { source: `test` },
    }
    expect(detect_view_type(val)).toBe(`fermi_surface`)
  })

  test(`normalized dos format`, () => {
    const val = {
      type: `electronic`,
      energies: [0, 1, 2],
      densities: [[0.1, 0.2, 0.3]],
    }
    expect(detect_view_type(val)).toBe(`dos`)
  })

  test(`phonon dos format`, () => {
    const val = {
      type: `phonon`,
      frequencies: [0, 100, 200],
      densities: [[0.1, 0.2, 0.3]],
    }
    expect(detect_view_type(val)).toBe(`dos`)
  })

  test(`pymatgen band structure format`, () => {
    const val = {
      kpoints: [[0, 0, 0]],
      branches: [{ start_index: 0, end_index: 1, name: `G-X` }],
      bands: { '1': [[1, 2, 3]] },
      labels_dict: { G: [0, 0, 0] },
      efermi: 5.0,
    }
    expect(detect_view_type(val)).toBe(`band_structure`)
  })

  test(`normalized band structure format`, () => {
    const val = {
      qpoints: [[0, 0, 0]],
      branches: [{ start_index: 0, end_index: 1 }],
      bands: [[1, 2, 3]],
      labels_dict: { G: [0, 0, 0] },
      nb_bands: 1,
    }
    expect(detect_view_type(val)).toBe(`band_structure`)
  })

  test(`minimal phase_diagram`, () => {
    const val = {
      components: [`A`, `B`],
      regions: [],
      boundaries: [],
      temperature_range: [300, 1500],
    }
    expect(detect_view_type(val)).toBe(`phase_diagram`)
  })

  test(`minimal volumetric data`, () => {
    const val = {
      grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]],
      grid_dims: [2, 2, 2],
      lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      origin: [0, 0, 0],
      data_range: { min: 0, max: 1 },
      periodic: true,
    }
    expect(detect_view_type(val)).toBe(`volumetric`)
  })
})

describe(`scan_renderable_paths`, () => {
  test(`finds all renderable items in test fixture`, () => {
    const paths = scan_renderable_paths(fixture)
    // Fixture has: 2 structures, 1 fermi_surface, 1 phase_diagram,
    // 1 band_structure, 1 dos, 3 convex_hull arrays
    expect(paths.size).toBeGreaterThanOrEqual(9)

    const types = new Set([...paths.values()].map((info) => info.type))
    expect(types).toContain(`structure`)
    expect(types).toContain(`fermi_surface`)
    expect(types).toContain(`phase_diagram`)
    expect(types).toContain(`band_structure`)
    expect(types).toContain(`dos`)
    expect(types).toContain(`convex_hull`)
  })

  test(`returns correct paths for nested structures`, () => {
    const paths = scan_renderable_paths(fixture)
    expect(paths.has(`structures.Cu_FCC`)).toBe(true)
    expect(paths.get(`structures.Cu_FCC`)?.type).toBe(`structure`)
  })

  test(`does not recurse into renderable objects`, () => {
    const paths = scan_renderable_paths(fixture)
    // Should find structures.Cu_FCC but NOT structures.Cu_FCC.sites
    const fcc_children = [...paths.keys()].filter((key) =>
      key.startsWith(`structures.Cu_FCC.`)
    )
    expect(fcc_children).toHaveLength(0)
  })

  test(`returns empty map for non-renderable data`, () => {
    expect(scan_renderable_paths({ foo: `bar`, n: 42 }).size).toBe(0)
  })

  test(`handles null/undefined/primitives gracefully`, () => {
    expect(scan_renderable_paths(null).size).toBe(0)
    expect(scan_renderable_paths(undefined).size).toBe(0)
    expect(scan_renderable_paths(`hello`).size).toBe(0)
  })

  test(`respects max_depth`, () => {
    const deep = {
      a: { b: { c: { sites: [{ species: [{ element: `Si` }], abc: [0, 0, 0] }] } } },
    }
    // depth 0: a, depth 1: b, depth 2: c, depth 3: structure
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
    const paths = scan_renderable_paths(data)
    expect(paths.has(`items[1]`)).toBe(true)
    expect(paths.get(`items[1]`)?.type).toBe(`structure`)
  })
})

// Helper to resolve dotted paths like "structures.Cu_FCC"
function resolve(obj: Record<string, unknown>, path: string): unknown {
  return path.split(`.`).reduce<unknown>(
    (current, key) => (current as Record<string, unknown>)?.[key],
    obj,
  )
}
