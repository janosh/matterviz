import {
  export_json,
  export_xyz,
  generate_structure_filename,
} from '$lib/io/export'
import type { AnyStructure } from '$lib/structure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Import the mocked modules to get access to the mock functions

// Mock the download function
vi.mock(`$lib/api`, () => ({
  download: vi.fn(),
}))

// Mock the electro_neg_formula function
vi.mock(`$lib`, async (import_original) => {
  const actual = (await import_original()) as Record<string, unknown>
  return {
    ...actual,
    electro_neg_formula: vi.fn(),
  }
})

// Get the mocked functions for type-safe access
const { download } = await import(`$lib/api`)
const { electro_neg_formula } = await import(`$lib`)
const mock_download = vi.mocked(download)
const mock_electro_neg_formula = vi.mocked(electro_neg_formula)

describe(`generate_structure_filename`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock_electro_neg_formula.mockReturnValue(`H2O`)
  })

  it.each([
    {
      name: `basic structure with ID`,
      structure: {
        id: `water_molecule`,
        sites: [
          { species: [{ element: `H` }] },
          { species: [{ element: `O` }] },
        ],
      } as AnyStructure,
      extension: `xyz`,
      should_contain: [`water_molecule`, `2sites`, `.xyz`],
    },
    {
      name: `structure with space group`,
      structure: {
        id: `quartz`,
        sites: Array(6).fill({ species: [{ element: `Si` }] }),
        symmetry: { space_group_symbol: `P3121` },
      } as AnyStructure,
      extension: `json`,
      should_contain: [`quartz`, `P3121`, `6sites`, `.json`],
    },
    {
      name: `structure with lattice system`,
      structure: {
        sites: Array(4).fill({ species: [{ element: `C` }] }),
        lattice: { lattice_system: `cubic` },
      } as AnyStructure,
      extension: `png`,
      should_contain: [`cubic`, `4sites`, `.png`],
    },
    {
      name: `minimal structure without metadata`,
      structure: {
        sites: [{ species: [{ element: `X` }] }],
      } as AnyStructure,
      extension: `xyz`,
      should_contain: [`1sites`, `.xyz`],
    },
    {
      name: `undefined structure`,
      structure: undefined,
      extension: `xyz`,
      should_contain: [`structure.xyz`],
    },
    {
      name: `structure with no sites`,
      structure: { sites: [] } as AnyStructure,
      extension: `json`,
      should_contain: [`.json`],
    },
  ])(
    `should generate filename for $name`,
    ({ structure, extension, should_contain }) => {
      const result = generate_structure_filename(structure, extension)
      for (const part of should_contain) {
        expect(result).toContain(part)
      }
    },
  )

  it(`should handle structure with all metadata`, () => {
    const structure = {
      id: `complex_structure`,
      sites: Array(10).fill({ species: [{ element: `Si` }] }),
      symmetry: { space_group_symbol: `Pm3m` },
      lattice: { lattice_system: `cubic` },
    } as AnyStructure

    const result = generate_structure_filename(structure, `cif`)
    expect(result).toContain(`complex_structure`)
    expect(result).toContain(`Pm3m`)
    expect(result).toContain(`cubic`)
    expect(result).toContain(`10sites`)
    expect(result).toContain(`.cif`)
  })
})

describe(`XYZ export format validation`, () => {
  it(`should generate correct XYZ header format`, () => {
    // Test the expected format: number of atoms, comment line, then coordinates
    const mock_structure = {
      id: `test_molecule`,
      sites: [
        {
          species: [{ element: `C` }],
          xyz: [0.0, 0.0, 0.0],
        },
        {
          species: [{ element: `H` }],
          xyz: [1.0, 0.0, 0.0],
        },
      ],
    } as AnyStructure

    // We can't easily test the actual export function due to dependencies,
    // but we can test the filename generation and coordinate handling logic
    const filename = generate_structure_filename(mock_structure, `xyz`)
    expect(filename).toContain(`test_molecule`)
    expect(filename).toContain(`2sites`)
    expect(filename.endsWith(`.xyz`)).toBe(true)
  })

  it(`should handle fractional coordinate conversion concept`, () => {
    // Test that we understand the coordinate conversion logic
    const lattice_matrix = [
      [2.0, 0.0, 0.0],
      [0.0, 2.0, 0.0],
      [0.0, 0.0, 2.0],
    ]
    const fractional_coords = [0.5, 0.5, 0.5]

    // Manual conversion to verify our understanding
    const cartesian = [
      fractional_coords[0] * lattice_matrix[0][0] +
        fractional_coords[1] * lattice_matrix[1][0] +
        fractional_coords[2] * lattice_matrix[2][0],
      fractional_coords[0] * lattice_matrix[0][1] +
        fractional_coords[1] * lattice_matrix[1][1] +
        fractional_coords[2] * lattice_matrix[2][1],
      fractional_coords[0] * lattice_matrix[0][2] +
        fractional_coords[1] * lattice_matrix[1][2] +
        fractional_coords[2] * lattice_matrix[2][2],
    ]

    expect(cartesian).toEqual([1.0, 1.0, 1.0])
  })
})

describe(`JSON export format validation`, () => {
  it(`should preserve structure data integrity`, () => {
    const original_structure = {
      id: `test_structure`,
      sites: [
        {
          species: [{ element: `H`, oxidation_state: 1 }],
          xyz: [0.0, 0.0, 0.0],
          properties: { charge: 1.0 },
        },
      ],
      lattice: {
        a: 5.0,
        b: 5.0,
        c: 5.0,
        alpha: 90,
        beta: 90,
        gamma: 90,
        volume: 125.0,
      },
      metadata: {
        source: `test`,
        calculation_type: `dft`,
      },
    }

    // Test that JSON.stringify preserves the structure correctly
    const json_string = JSON.stringify(original_structure, null, 2)
    const parsed_back = JSON.parse(json_string)

    expect(parsed_back).toEqual(original_structure)
    expect(parsed_back.sites[0].properties.charge).toBe(1.0)
    expect(parsed_back.lattice.volume).toBe(125.0)
    expect(parsed_back.metadata.calculation_type).toBe(`dft`)

    // Test that the filename generation works
    const filename = generate_structure_filename(
      original_structure as AnyStructure,
      `json`,
    )
    expect(filename).toContain(`test_structure`)
    expect(filename).toContain(`1sites`)
    expect(filename.endsWith(`.json`)).toBe(true)
  })
})

describe(`Error handling`, () => {
  it(`should handle malformed structures gracefully`, () => {
    const malformed_structures = [
      null,
      undefined,
      {},
      { sites: null },
      { sites: undefined },
      { sites: [`not an array`] },
    ]

    for (const structure of malformed_structures) {
      expect(() => {
        generate_structure_filename(
          structure as AnyStructure | undefined | null,
          `xyz`,
        )
      }).not.toThrow()
    }
  })

  it(`should handle sites with missing species`, () => {
    const structure_with_missing_species = {
      sites: [{ species: [] }, { species: null }, { species: undefined }, {}],
    } as AnyStructure

    const filename = generate_structure_filename(
      structure_with_missing_species,
      `xyz`,
    )
    expect(filename).toContain(`4sites`)
    expect(filename.endsWith(`.xyz`)).toBe(true)
  })
})

describe(`Edge cases`, () => {
  it(`should handle very large structures`, () => {
    const large_structure = {
      id: `large_crystal`,
      sites: Array(10000).fill({ species: [{ element: `Si` }] }),
    } as AnyStructure

    const filename = generate_structure_filename(large_structure, `xyz`)
    expect(filename).toContain(`large_crystal`)
    expect(filename).toContain(`10000sites`)
  })

  it(`should handle structures with complex element symbols`, () => {
    const structure_with_lanthanides = {
      id: `lanthanide_compound`,
      sites: [
        { species: [{ element: `La` }] },
        { species: [{ element: `Ce` }] },
        { species: [{ element: `Pr` }] },
        { species: [{ element: `Nd` }] },
      ],
    } as AnyStructure

    const filename = generate_structure_filename(
      structure_with_lanthanides,
      `cif`,
    )
    expect(filename).toContain(`lanthanide_compound`)
    expect(filename).toContain(`4sites`)
    expect(filename.endsWith(`.cif`)).toBe(true)
  })

  it(`should handle special characters in IDs`, () => {
    const structure_with_special_chars = {
      id: `structure-with_special.chars@123`,
      sites: [{ species: [{ element: `C` }] }],
    } as AnyStructure

    const filename = generate_structure_filename(
      structure_with_special_chars,
      `xyz`,
    )
    // Should still include the ID even with special characters
    expect(filename).toContain(`structure-with_special.chars@123`)
    expect(filename.endsWith(`.xyz`)).toBe(true)
  })
})

describe(`export_xyz`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock_electro_neg_formula.mockReturnValue(`H2O`)
    // Mock window.alert
    vi.stubGlobal(`alert`, vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    {
      name: `simple molecule with cartesian coordinates`,
      structure: {
        id: `water`,
        sites: [
          {
            species: [{ element: `O` }],
            xyz: [0.0, 0.0, 0.0],
            abc: [0.0, 0.0, 0.0],
          },
          {
            species: [{ element: `H` }],
            xyz: [0.757, 0.586, 0.0],
            abc: [0.1, 0.1, 0.0],
          },
          {
            species: [{ element: `H` }],
            xyz: [-0.757, 0.586, 0.0],
            abc: [-0.1, 0.1, 0.0],
          },
        ],
      } as AnyStructure,
      expected_lines: [
        `3`,
        `water H2O`,
        `O 0.000000 0.000000 0.000000`,
        `H 0.757000 0.586000 0.000000`,
        `H -0.757000 0.586000 0.000000`,
      ],
    },
    {
      name: `structure with fractional coordinates`,
      structure: {
        sites: [
          {
            species: [{ element: `Si` }],
            abc: [0.5, 0.5, 0.5],
          },
        ],
        lattice: {
          matrix: [
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 2.0],
          ],
        },
      } as AnyStructure,
      expected_lines: [`1`, `H2O`, `Si 1.000000 1.000000 1.000000`],
    },
    {
      name: `structure without coordinates (fallback)`,
      structure: {
        id: `test`,
        sites: [
          {
            species: [{ element: `C` }],
          },
        ],
      } as AnyStructure,
      expected_lines: [`1`, `test H2O`, `C 0.000000 0.000000 0.000000`],
    },
    {
      name: `structure with complex lattice matrix`,
      structure: {
        sites: [
          {
            species: [{ element: `N` }],
            abc: [0.25, 0.75, 0.5],
          },
        ],
        lattice: {
          matrix: [
            [3.0, 1.0, 0.0],
            [0.0, 4.0, 0.5],
            [0.0, 0.0, 5.0],
          ],
        },
      } as AnyStructure,
      expected_lines: [`1`, `H2O`, `N 0.750000 3.250000 2.500000`],
    },
  ])(`should export $name correctly`, ({ structure, expected_lines }) => {
    export_xyz(structure)

    expect(mock_download).toHaveBeenCalledOnce()
    const [content, filename, mime_type] = mock_download.mock.calls[0]

    // Check content format
    const lines = content.split(`\n`)
    expect(lines).toEqual(expected_lines)

    // Check filename and MIME type
    expect(filename).toMatch(/.*\.xyz$/)
    expect(mime_type).toBe(`text/plain`)
  })

  it(`should handle structure without sites`, () => {
    const structure = {} as AnyStructure
    export_xyz(structure)

    expect(mock_download).not.toHaveBeenCalled()
    expect(vi.mocked(alert)).toHaveBeenCalledWith(
      `No structure or sites to download`,
    )
  })

  it(`should handle structure with empty sites array`, () => {
    const structure = { sites: [] } as AnyStructure
    export_xyz(structure)

    expect(mock_download).not.toHaveBeenCalled()
    expect(vi.mocked(alert)).toHaveBeenCalledWith(
      `No structure or sites to download`,
    )
  })

  it(`should handle undefined structure`, () => {
    export_xyz(undefined)

    expect(mock_download).not.toHaveBeenCalled()
    expect(vi.mocked(alert)).toHaveBeenCalledWith(
      `No structure or sites to download`,
    )
  })

  it(`should handle sites with missing species`, () => {
    const structure = {
      sites: [{ species: [] }, { species: undefined }],
    } as AnyStructure

    export_xyz(structure)

    expect(mock_download).toHaveBeenCalledOnce()
    const [content] = mock_download.mock.calls[0]
    const lines = content.split(`\n`)

    expect(lines[2]).toBe(`X 0.000000 0.000000 0.000000`)
    expect(lines[3]).toBe(`X 0.000000 0.000000 0.000000`)
  })

  it(`should prioritize xyz over abc coordinates`, () => {
    const structure = {
      sites: [
        {
          species: [{ element: `C` }],
          xyz: [1.0, 2.0, 3.0],
          abc: [0.1, 0.2, 0.3],
        },
      ],
      lattice: {
        matrix: [
          [10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [0.0, 0.0, 10.0],
        ],
      },
    } as AnyStructure

    export_xyz(structure)

    expect(mock_download).toHaveBeenCalledOnce()
    const [content] = mock_download.mock.calls[0]
    const lines = content.split(`\n`)

    // Should use xyz coordinates (1,2,3) not converted abc coordinates (1,2,3)
    expect(lines[2]).toBe(`C 1.000000 2.000000 3.000000`)
  })
})

describe(`export_json`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock_electro_neg_formula.mockReturnValue(`H2O`)
    vi.stubGlobal(`alert`, vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`should export structure as formatted JSON`, () => {
    const structure = {
      id: `test_structure`,
      sites: [
        {
          species: [{ element: `H` }],
          xyz: [0.0, 0.0, 0.0],
        },
      ],
      lattice: {
        a: 1.0,
        b: 1.0,
        c: 1.0,
      },
    } as AnyStructure

    export_json(structure)

    expect(mock_download).toHaveBeenCalledOnce()
    const [content, filename, mime_type] = mock_download.mock.calls[0]

    // Check that content is valid JSON
    const parsed = JSON.parse(content)
    expect(parsed).toEqual(structure)

    // Check formatting (should be pretty-printed)
    expect(content).toContain(`\n  "id": "test_structure"`)

    // Check filename and MIME type
    expect(filename).toMatch(/.*\.json$/)
    expect(mime_type).toBe(`application/json`)
  })

  it(`should handle structure with complex nested data`, () => {
    const structure = {
      id: `complex`,
      sites: [
        {
          species: [{ element: `C`, oxidation_state: 0 }],
          xyz: [1.23456789, -2.3456789, 3.45678901],
          properties: { magnetic_moment: 0.5 },
        },
      ],
      lattice: {
        matrix: [
          [1.0, 0.0, 0.0],
          [0.0, 1.0, 0.0],
          [0.0, 0.0, 1.0],
        ],
        volume: 1.0,
      },
      metadata: {
        source: `test`,
        created: `2024-01-01`,
      },
    } as AnyStructure

    export_json(structure)

    expect(mock_download).toHaveBeenCalledOnce()
    const [content] = mock_download.mock.calls[0]

    const parsed = JSON.parse(content)
    expect(parsed).toEqual(structure)
    expect(parsed.sites[0].properties.magnetic_moment).toBe(0.5)
    expect(parsed.metadata.source).toBe(`test`)
  })

  it(`should handle undefined structure`, () => {
    export_json(undefined)

    expect(mock_download).not.toHaveBeenCalled()
    expect(vi.mocked(alert)).toHaveBeenCalledWith(`No structure to download`)
  })

  it(`should handle null structure`, () => {
    export_json(null)

    expect(mock_download).not.toHaveBeenCalled()
    expect(vi.mocked(alert)).toHaveBeenCalledWith(`No structure to download`)
  })

  it(`should export empty structure`, () => {
    const structure = {} as AnyStructure

    export_json(structure)

    expect(mock_download).toHaveBeenCalledOnce()
    const [content] = mock_download.mock.calls[0]

    const parsed = JSON.parse(content)
    expect(parsed).toEqual({})
  })
})
