import type { ElementSymbol, Species, Vec3 } from '$lib'
import {
  copy_to_clipboard,
  export_json,
  export_xyz,
  generate_json_content,
  generate_structure_filename,
  generate_xyz_content,
} from '$lib/io/export'
import { parse_structure_file } from '$lib/io/parse'
import type { AnyStructure } from '$lib/structure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Mock clipboard API for testing
Object.defineProperty(navigator, `clipboard`, {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
})

// Get the mocked functions for type-safe access
const { download } = await import(`$lib/api`)
const { electro_neg_formula } = await import(`$lib`)
const mock_download = vi.mocked(download)
const mock_electro_neg_formula = vi.mocked(electro_neg_formula)
const mock_clipboard_write_text = vi.mocked(navigator.clipboard.writeText)

// Test structure fixtures with proper typing
const simple_structure: AnyStructure = {
  id: `test_h2o`,
  sites: [
    {
      species: [{ element: `H` as ElementSymbol, occu: 1, oxidation_state: 1 }],
      xyz: [0.757, 0.586, 0.0] as [number, number, number],
      abc: [0.1, 0.1, 0.0] as [number, number, number],
      label: `H`,
      properties: {},
    },
    {
      species: [{
        element: `O` as ElementSymbol,
        occu: 1,
        oxidation_state: -2,
      }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `H` as ElementSymbol, occu: 1, oxidation_state: 1 }],
      xyz: [-0.757, 0.586, 0.0],
      abc: [-0.1, 0.1, 0.0],
      label: `H`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [
      [10.0, 0.0, 0.0],
      [0.0, 10.0, 0.0],
      [0.0, 0.0, 10.0],
    ],
    pbc: [true, true, true],
    a: 10.0,
    b: 10.0,
    c: 10.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
    volume: 1000.0,
  },
}

const complex_structure: AnyStructure = {
  id: `test_complex`,
  sites: [
    {
      species: [{
        element: `Li` as ElementSymbol,
        occu: 1,
        oxidation_state: 1,
      }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `Li`,
      properties: {},
    },
    {
      species: [{
        element: `Fe` as ElementSymbol,
        occu: 1,
        oxidation_state: 2,
      }],
      xyz: [2.5, 0.0, 0.0],
      abc: [0.5, 0.0, 0.0],
      label: `Fe`,
      properties: {},
    },
    {
      species: [{ element: `P` as ElementSymbol, occu: 1, oxidation_state: 5 }],
      xyz: [0.0, 2.5, 0.0],
      abc: [0.0, 0.5, 0.0],
      label: `P`,
      properties: {},
    },
    {
      species: [{
        element: `O` as ElementSymbol,
        occu: 1,
        oxidation_state: -2,
      }],
      xyz: [1.25, 1.25, 0.0],
      abc: [0.25, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{
        element: `O` as ElementSymbol,
        occu: 1,
        oxidation_state: -2,
      }],
      xyz: [3.75, 1.25, 0.0],
      abc: [0.75, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{
        element: `O` as ElementSymbol,
        occu: 1,
        oxidation_state: -2,
      }],
      xyz: [1.25, 3.75, 0.0],
      abc: [0.25, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{
        element: `O` as ElementSymbol,
        occu: 1,
        oxidation_state: -2,
      }],
      xyz: [3.75, 3.75, 0.0],
      abc: [0.75, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [
      [5.0, 0.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 5.0],
    ],
    pbc: [true, true, true],
    a: 5.0,
    b: 5.0,
    c: 5.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
    volume: 125.0,
  },
}

// Real structure data from mp-1.json (2 Cs atoms)
const real_structure_json =
  `{"@module": "pymatgen.core.structure", "@class": "Structure", "charge": 0, "lattice": {"matrix": [[6.256930122878799, 0.0, 3.831264723736088e-16], [1.0061911048045417e-15, 6.256930122878799, 3.831264723736088e-16], [0.0, 0.0, 6.256930122878799]], "pbc": [true, true, true], "a": 6.256930122878799, "b": 6.256930122878799, "c": 6.256930122878799, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "volume": 244.95364960649798}, "sites": [{"species": [{"element": "Cs", "occu": 1}], "abc": [0.0, 0.0, 0.0], "xyz": [0.0, 0.0, 0.0], "label": "Cs", "properties": {}}, {"species": [{"element": "Cs", "occu": 1}], "abc": [0.5, 0.5, 0.5], "xyz": [3.1284650614394, 3.1284650614393996, 3.1284650614394], "label": "Cs", "properties": {}}]}`

describe(`Export functionality comprehensive tests`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock_electro_neg_formula.mockReturnValue(`H2O`)
  })

  describe(`Site count verification - Core Issue Fix`, () => {
    it(`should export all sites in XYZ format`, () => {
      const xyz_content = generate_xyz_content(simple_structure)
      const lines = xyz_content.split(`\n`)

      // Check header
      expect(lines[0]).toBe(`3`) // number of atoms
      expect(lines[1]).toBe(`test_h2o H2O`) // comment line

      // Check that all 3 atoms are present
      expect(lines[2]).toBe(`H 0.757000 0.586000 0.000000`)
      expect(lines[3]).toBe(`O 0.000000 0.000000 0.000000`)
      expect(lines[4]).toBe(`H -0.757000 0.586000 0.000000`)
      expect(lines).toHaveLength(5) // 3 atoms + 2 header lines
    })

    it(`should export all sites in JSON format`, () => {
      const json_content = generate_json_content(simple_structure)
      const parsed = JSON.parse(json_content)

      expect(parsed.sites).toHaveLength(3)
      expect(parsed.sites[0].species[0].element).toBe(`H`)
      expect(parsed.sites[1].species[0].element).toBe(`O`)
      expect(parsed.sites[2].species[0].element).toBe(`H`)
    })

    it(`should handle complex structures with many sites`, () => {
      mock_electro_neg_formula.mockReturnValue(`LiFeP4O7`)
      const xyz_content = generate_xyz_content(complex_structure)
      const lines = xyz_content.split(`\n`)

      // Check header
      expect(lines[0]).toBe(`7`) // number of atoms
      expect(lines[1]).toBe(`test_complex LiFeP4O7`) // comment line

      // Check all atoms are present
      expect(lines[2]).toBe(`Li 0.000000 0.000000 0.000000`)
      expect(lines[3]).toBe(`Fe 2.500000 0.000000 0.000000`)
      expect(lines[4]).toBe(`P 0.000000 2.500000 0.000000`)
      expect(lines[5]).toBe(`O 1.250000 1.250000 0.000000`)
      expect(lines[6]).toBe(`O 3.750000 1.250000 0.000000`)
      expect(lines[7]).toBe(`O 1.250000 3.750000 0.000000`)
      expect(lines[8]).toBe(`O 3.750000 3.750000 0.000000`)
      expect(lines).toHaveLength(9) // 7 atoms + 2 header lines

      // JSON should also have all sites
      const json_content = generate_json_content(complex_structure)
      const parsed = JSON.parse(json_content)
      expect(parsed.sites).toHaveLength(7)
    })

    it(`should handle large structures (24 sites)`, () => {
      const large_structure: AnyStructure = {
        id: `large_24_sites`,
        sites: [
          // 8 Lu atoms
          ...Array.from({ length: 8 }, (_, idx) => ({
            species: [{
              element: `Lu` as ElementSymbol,
              occu: 1,
              oxidation_state: 3,
            }],
            xyz: [idx, idx * 0.5, idx * 0.25] as [number, number, number],
            abc: [idx * 0.1, idx * 0.05, idx * 0.025] as [
              number,
              number,
              number,
            ],
            label: `Lu`,
            properties: {},
          })),
          // 16 Al atoms
          ...Array.from({ length: 16 }, (_, idx) => ({
            species: [{
              element: `Al` as ElementSymbol,
              occu: 1,
              oxidation_state: 3,
            }],
            xyz: [idx + 10, idx * 0.5 + 10, idx * 0.25 + 10] as [
              number,
              number,
              number,
            ],
            abc: [idx * 0.1 + 0.5, idx * 0.05 + 0.5, idx * 0.025 + 0.5] as [
              number,
              number,
              number,
            ],
            label: `Al`,
            properties: {},
          })),
        ],
      }

      // Export to XYZ
      const xyz_content = generate_xyz_content(large_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`24`) // number of atoms
      expect(lines).toHaveLength(26) // 24 atoms + 2 header lines

      // Check first few Lu and Al atoms
      expect(lines[2]).toBe(`Lu 0.000000 0.000000 0.000000`)
      expect(lines[3]).toBe(`Lu 1.000000 0.500000 0.250000`)
      expect(lines[10]).toBe(`Al 10.000000 10.000000 10.000000`)

      // Export to JSON and verify all sites
      const json_content = generate_json_content(large_structure)
      const parsed = JSON.parse(json_content)
      expect(parsed.sites).toHaveLength(24)

      // Verify element distribution
      const elements = parsed.sites.map((
        site: { species: { element: ElementSymbol }[] },
      ) => site.species[0].element)
      expect(elements.filter((el: string) => el === `Lu`)).toHaveLength(8)
      expect(elements.filter((el: string) => el === `Al`)).toHaveLength(16)
    })
  })

  describe(`Round-trip export and parse tests`, () => {
    it(`should round-trip real structure data correctly`, () => {
      // Parse the real structure
      const parsed_structure = parse_structure_file(
        real_structure_json,
        `mp-1.json`,
      )
      expect(parsed_structure).toBeTruthy()
      expect(parsed_structure?.sites).toHaveLength(2)

      // Export to XYZ and verify all sites are present
      const xyz_content = generate_xyz_content(parsed_structure as AnyStructure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`2`) // number of atoms
      expect(lines[2]).toBe(`Cs 0.000000 0.000000 0.000000`) // First Cs
      expect(lines[3]).toBe(`Cs 3.128465 3.128465 3.128465`) // Second Cs (rounded)
      expect(lines).toHaveLength(4) // 2 atoms + 2 header lines

      // Export to JSON and verify all sites are present
      const json_content = generate_json_content(parsed_structure as AnyStructure)
      const re_parsed = JSON.parse(json_content)
      expect(re_parsed.sites).toHaveLength(2)
      expect(re_parsed.sites[0].species[0].element).toBe(`Cs`)
      expect(re_parsed.sites[1].species[0].element).toBe(`Cs`)
    })

    it(`should round-trip XYZ export and parse for simple structure`, () => {
      const xyz_content = generate_xyz_content(simple_structure)
      const parsed_structure = parse_structure_file(xyz_content, `test.xyz`)

      // Check basic structure properties
      expect(parsed_structure?.sites).toHaveLength(3)

      // Check element symbols are preserved
      const elements = parsed_structure?.sites.map((site) => site.species?.[0]?.element)
      expect(elements).toEqual([`H`, `O`, `H`])

      // Check coordinates are preserved (with some tolerance for floating point precision)
      expect(parsed_structure?.sites[0].xyz?.[0]).toBeCloseTo(0.757, 5)
      expect(parsed_structure?.sites[0].xyz?.[1]).toBeCloseTo(0.586, 5)
      expect(parsed_structure?.sites[1].xyz?.[0]).toBeCloseTo(0.0, 5)
      expect(parsed_structure?.sites[2].xyz?.[0]).toBeCloseTo(-0.757, 5)
    })

    it(`should round-trip JSON export and parse for complex structure`, () => {
      const json_content = generate_json_content(complex_structure)
      const parsed_structure = parse_structure_file(json_content, `test.json`)

      // Check structure is identical
      expect((parsed_structure as AnyStructure).id).toBe(complex_structure.id)
      expect(parsed_structure?.sites).toHaveLength(7)

      // Check all sites are preserved with both xyz and abc coordinates
      for (let idx = 0; idx < (parsed_structure?.sites?.length ?? 0); idx++) {
        const original_site = complex_structure.sites[idx]
        const parsed_site = parsed_structure?.sites[idx]

        expect(parsed_site?.species?.[0]?.element).toBe(
          original_site.species?.[0]?.element,
        )
        expect(parsed_site?.xyz).toEqual(original_site.xyz)
        expect(parsed_site?.abc).toEqual(original_site.abc)
      }
    })
  })

  describe(`Coordinate handling`, () => {
    it(`should convert fractional coordinates to cartesian when xyz not available`, () => {
      const structure_with_abc: AnyStructure = {
        id: `frac_coords`,
        sites: [
          {
            species: [{
              element: `C` as ElementSymbol,
              occu: 1,
              oxidation_state: 0,
            }],
            abc: [0.5, 0.5, 0.5], // Center of unit cell
            xyz: [0, 0, 0],
            label: `C`,
            properties: {},
          },
        ],
        lattice: {
          matrix: [
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 2.0],
          ],
          pbc: [true, true, true],
          a: 2.0,
          b: 2.0,
          c: 2.0,
          alpha: 90.0,
          beta: 90.0,
          gamma: 90.0,
          volume: 8.0,
        },
      }

      // Remove xyz coordinates to force abc conversion by creating a modified structure
      const modified_structure = {
        ...structure_with_abc,
        sites: structure_with_abc.sites.map((site, idx) =>
          idx === 0
            ? { ...site, xyz: undefined as unknown as Vec3 } // Test scenario: force abc conversion
            : site
        ),
      }

      const xyz_content = generate_xyz_content(modified_structure)
      const lines = xyz_content.split(`\n`)

      expect(lines[0]).toBe(`1`)
      expect(lines[2]).toBe(`C 1.000000 1.000000 1.000000`) // 0.5 * 2.0 = 1.0 for each axis
    })

    it(`should preserve coordinate precision in round-trip`, () => {
      const high_precision_structure: AnyStructure = {
        sites: [
          {
            species: [{
              element: `C` as ElementSymbol,
              occu: 1,
              oxidation_state: 0,
            }],
            xyz: [1.23456789, 2.3456789, 3.456789],
            abc: [0.1, 0.2, 0.3],
            label: `C`,
            properties: {},
          },
          {
            species: [{
              element: `N` as ElementSymbol,
              occu: 1,
              oxidation_state: 0,
            }],
            xyz: [4.56789123, 5.6789123, 6.789123],
            abc: [0.4, 0.5, 0.6],
            label: `N`,
            properties: {},
          },
        ],
      }

      const xyz_content = generate_xyz_content(high_precision_structure)
      const parsed_structure = parse_structure_file(xyz_content, `test.xyz`)

      // XYZ format should preserve 6 decimal places
      expect(parsed_structure?.sites[0].xyz?.[0]).toBeCloseTo(1.234568, 5)
      expect(parsed_structure?.sites[0].xyz?.[1]).toBeCloseTo(2.345679, 5)
      expect(parsed_structure?.sites[1].xyz?.[0]).toBeCloseTo(4.567891, 5)
    })
  })

  describe(`Filename generation`, () => {
    it.each([
      {
        name: `basic structure with ID`,
        structure: {
          id: `water_molecule`,
          sites: [
            {
              species: [{
                element: `H` as ElementSymbol,
                occu: 1,
                oxidation_state: 1,
              }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `H`,
              properties: {},
            },
            {
              species: [{
                element: `O` as ElementSymbol,
                occu: 1,
                oxidation_state: -2,
              }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `O`,
              properties: {},
            },
          ],
        } as AnyStructure,
        extension: `xyz`,
        should_contain: [`water_molecule`, `2sites`, `.xyz`],
      },
      {
        name: `structure with many sites`,
        structure: {
          id: `complex_crystal`,
          sites: Array(24).fill({
            species: [{
              element: `Si` as ElementSymbol,
              occu: 1,
              oxidation_state: 4,
            }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `Si`,
            properties: {},
          }),
        } as AnyStructure,
        extension: `json`,
        should_contain: [`complex_crystal`, `24sites`, `.json`],
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

    it(`should strip HTML tags from chemical formulas`, () => {
      mock_electro_neg_formula.mockReturnValue(`Li<sub>2</sub>O`)
      const structure = {
        id: `lithium_oxide`,
        sites: Array(3).fill({
          species: [{
            element: `Li` as ElementSymbol,
            occu: 1,
            oxidation_state: 1,
          }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `Li`,
          properties: {},
        }),
      } as AnyStructure

      const result = generate_structure_filename(structure, `xyz`)
      expect(result).toContain(`Li2O`)
      expect(result).not.toContain(`<sub>`)
      expect(result).not.toContain(`</sub>`)
    })
  })

  describe(`Clipboard functionality`, () => {
    it(`should copy text to clipboard`, async () => {
      const test_text = `Hello, world!`
      await copy_to_clipboard(test_text)

      expect(mock_clipboard_write_text).toHaveBeenCalledWith(test_text)
    })

    it(`should handle clipboard API errors`, async () => {
      mock_clipboard_write_text.mockRejectedValueOnce(
        new Error(`Clipboard not available`),
      )

      await expect(copy_to_clipboard(`test`)).rejects.toThrow(
        `Clipboard not available`,
      )
    })
  })

  describe(`Error handling`, () => {
    it(`should throw error for structure without sites`, () => {
      expect(() => generate_xyz_content(undefined)).toThrow(
        `No structure or sites to export`,
      )
      // Empty sites array is valid and should not throw - it exports 0 atoms
      expect(() => generate_xyz_content({ sites: [] } as AnyStructure)).not
        .toThrow()

      const empty_xyz = generate_xyz_content({ sites: [] } as AnyStructure)
      const lines = empty_xyz.split(`\n`)
      expect(lines[0]).toBe(`0`) // 0 atoms
    })

    it(`should throw error for undefined structure in JSON export`, () => {
      expect(() => generate_json_content(undefined)).toThrow(
        `No structure to export`,
      )
    })

    it(`should handle species without element (fallback to X)`, () => {
      const structure_no_element: AnyStructure = {
        sites: [
          {
            species: [
              { element: undefined, occu: 1, oxidation_state: 0 } as Species & {
                element: undefined
              },
            ],
            xyz: [0.0, 0.0, 0.0],
            abc: [0.0, 0.0, 0.0],
            label: `X`,
            properties: {},
          },
        ],
      }

      const xyz_content = generate_xyz_content(structure_no_element)
      const lines = xyz_content.split(`\n`)

      expect(lines[2]).toBe(`X 0.000000 0.000000 0.000000`)
    })
  })

  describe(`Export functions with download`, () => {
    beforeEach(() => {
      vi.stubGlobal(`alert`, vi.fn())
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it(`should export XYZ with correct content and filename`, () => {
      export_xyz(simple_structure)

      expect(mock_download).toHaveBeenCalledOnce()
      const [content, filename, mime_type] = mock_download.mock.calls[0]

      // Check content format
      const lines = (content as string).split(`\n`)
      expect(lines[0]).toBe(`3`)
      expect(lines[1]).toBe(`test_h2o H2O`)
      expect(lines[2]).toBe(`H 0.757000 0.586000 0.000000`)

      // Check filename and MIME type
      expect(filename).toMatch(/.*\.xyz$/)
      expect(mime_type).toBe(`text/plain`)
    })

    it(`should export JSON with correct content and filename`, () => {
      export_json(simple_structure)

      expect(mock_download).toHaveBeenCalledOnce()
      const [content, filename, mime_type] = mock_download.mock.calls[0]

      // Check that content is valid JSON
      const parsed = JSON.parse(content as string)
      expect(parsed).toEqual(simple_structure)

      // Check formatting (should be pretty-printed)
      expect(content).toContain(`\n  "id": "test_h2o"`)

      // Check filename and MIME type
      expect(filename).toMatch(/.*\.json$/)
      expect(mime_type).toBe(`application/json`)
    })
  })
})
