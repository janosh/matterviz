import type { ElementSymbol, Species, Vec3 } from '$lib'
import {
  copy_to_clipboard,
  create_structure_filename,
  export_canvas_as_png,
  export_structure_as_json,
  export_structure_as_xyz,
  export_svg_as_png,
  export_svg_as_svg,
  structure_to_cif_str,
  structure_to_json_str,
  structure_to_poscar_str,
  structure_to_xyz_str,
} from '$lib/io/export'
import { parse_structure_file } from '$lib/io/parse'
import type { AnyStructure } from '$lib/structure'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the download function
vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))

// Mock the electro_neg_formula function
vi.mock(`$lib`, async (import_original) => {
  const actual = (await import_original()) as Record<string, unknown>
  return { ...actual, electro_neg_formula: vi.fn() }
})

// Get the mocked functions for type-safe access
const { download } = await import(`$lib/io/fetch`)
const { electro_neg_formula } = await import(`$lib`)
const mock_download = vi.mocked(download)
const mock_electro_neg_formula = vi.mocked(electro_neg_formula)
const mock_clipboard_write_text = vi.mocked(navigator.clipboard.writeText)

// Test structure fixtures
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
      species: [{ element: `O` as ElementSymbol, occu: 1, oxidation_state: -2 }],
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
    matrix: [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]],
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
      species: [{ element: `Li` as ElementSymbol, occu: 1, oxidation_state: 1 }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `Li`,
      properties: {},
    },
    {
      species: [{ element: `Fe` as ElementSymbol, occu: 1, oxidation_state: 2 }],
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
      species: [{ element: `O` as ElementSymbol, occu: 1, oxidation_state: -2 }],
      xyz: [1.25, 1.25, 0.0],
      abc: [0.25, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O` as ElementSymbol, occu: 1, oxidation_state: -2 }],
      xyz: [3.75, 1.25, 0.0],
      abc: [0.75, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O` as ElementSymbol, occu: 1, oxidation_state: -2 }],
      xyz: [1.25, 3.75, 0.0],
      abc: [0.25, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O` as ElementSymbol, occu: 1, oxidation_state: -2 }],
      xyz: [3.75, 3.75, 0.0],
      abc: [0.75, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
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

const real_structure_json =
  `{"@module": "pymatgen.core.structure", "@class": "Structure", "charge": 0, "lattice": {"matrix": [[6.256930122878799, 0.0, 3.831264723736088e-16], [1.0061911048045417e-15, 6.256930122878799, 3.831264723736088e-16], [0.0, 0.0, 6.256930122878799]], "pbc": [true, true, true], "a": 6.256930122878799, "b": 6.256930122878799, "c": 6.256930122878799, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "volume": 244.95364960649798}, "sites": [{"species": [{"element": "Cs", "occu": 1}], "abc": [0.0, 0.0, 0.0], "xyz": [0.0, 0.0, 0.0], "label": "Cs", "properties": {}}]}`

// Helper functions
function create_mock_svg(view_box = `0 0 100 100`): SVGElement {
  const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
  svg.setAttribute(`viewBox`, view_box)
  svg.setAttribute(`width`, `100`)
  svg.setAttribute(`height`, `100`)
  return svg
}

function create_mock_canvas(): HTMLCanvasElement & { __customRenderer?: unknown } {
  const canvas = document.createElement(`canvas`) as HTMLCanvasElement & {
    __customRenderer?: unknown
  }
  canvas.toBlob = vi.fn((cb: (blob: Blob | null) => void) =>
    cb(new Blob([`pngdata`], { type: `image/png` }))
  ) as unknown as (HTMLCanvasElement & { __customRenderer?: unknown })[`toBlob`]
  return canvas
}

function create_mock_image(): HTMLImageElement {
  return {
    crossOrigin: ``,
    onload: null,
    onerror: null,
    src: ``,
  } as unknown as HTMLImageElement
}

// Test cases for structure export
const export_cases = [
  {
    name: `simple structure`,
    structure: simple_structure,
    expected_xyz: [
      `3`,
      `test_h2o H2O`,
      `H 0.757000 0.586000 0.000000`,
      `O 0.000000 0.000000 0.000000`,
      `H -0.757000 0.586000 0.000000`,
    ],
    expected_json: simple_structure,
    formula: `H2O`,
    filename_contains: [`test_h2o`, `H2O`, `3sites`],
  },
  {
    name: `complex structure`,
    structure: complex_structure,
    expected_xyz: [
      `7`,
      `test_complex LiFeP4O7`,
      `Li 0.000000 0.000000 0.000000`,
      `Fe 2.500000 0.000000 0.000000`,
      `P 0.000000 2.500000 0.000000`,
      `O 1.250000 1.250000 0.000000`,
      `O 3.750000 1.250000 0.000000`,
      `O 1.250000 3.750000 0.000000`,
      `O 3.750000 3.750000 0.000000`,
    ],
    expected_json: complex_structure,
    formula: `LiFeP4O7`,
    filename_contains: [`test_complex`, `LiFeP4O7`, `7sites`],
  },
  {
    name: `structure without ID`,
    structure: { ...simple_structure, id: undefined },
    expected_xyz: [
      `3`,
      `H2O`,
      `H 0.757000 0.586000 0.000000`,
      `O 0.000000 0.000000 0.000000`,
      `H -0.757000 0.586000 0.000000`,
    ],
    expected_json: { ...simple_structure, id: undefined },
    formula: `H2O`,
    filename_contains: [`H2O`, `3sites`],
  },
  {
    name: `empty structure`,
    structure: { ...simple_structure, sites: [] },
    expected_xyz: [`0`, `test_h2o Empty`],
    expected_json: { ...simple_structure, sites: [] },
    formula: `Empty`,
    filename_contains: [`test_h2o`, `Empty`],
  },
]

describe(`Export functionality`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock_electro_neg_formula.mockReturnValue(`H2O`)
  })

  describe(`Structure export (XYZ/JSON)`, () => {
    it.each(export_cases)(
      `exports $name to XYZ`,
      ({ structure, expected_xyz, formula, filename_contains }) => {
        mock_electro_neg_formula.mockReturnValue(formula)
        export_structure_as_xyz(structure)
        expect(mock_download).toHaveBeenCalledOnce()
        const [content, filename, mime_type] = mock_download.mock.calls[0]
        const lines = (content as string).split(`\n`)
        expected_xyz.forEach((line, idx) => expect(lines[idx]).toBe(line))
        filename_contains.forEach((part) => expect(filename).toContain(part))
        expect(filename).toMatch(/\.xyz$/)
        expect(mime_type).toBe(`text/plain`)
      },
    )

    it.each(export_cases)(
      `exports $name to JSON`,
      ({ structure, expected_json, formula, filename_contains }) => {
        mock_electro_neg_formula.mockReturnValue(formula)
        export_structure_as_json(structure)
        expect(mock_download).toHaveBeenCalledOnce()
        const [content, filename, mime_type] = mock_download.mock.calls[0]
        expect(JSON.parse(content as string)).toEqual(expected_json)
        filename_contains.forEach((part) => expect(filename).toContain(part))
        expect(filename).toMatch(/\.json$/)
        expect(mime_type).toBe(`application/json`)
      },
    )

    it.each([
      { func: export_structure_as_xyz, error_msg: `Error exporting XYZ:` },
      { func: export_structure_as_json, error_msg: `Error exporting JSON:` },
    ])(`handles undefined structure gracefully`, ({ func, error_msg }) => {
      const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
      func(undefined)
      expect(console_error).toHaveBeenCalledWith(error_msg, expect.any(Error))
      expect(mock_download).not.toHaveBeenCalled()
      console_error.mockRestore()
    })
  })

  describe(`Site count verification`, () => {
    it(`exports all sites in XYZ format`, () => {
      const xyz_content = structure_to_xyz_str(simple_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`3`)
      expect(lines[1]).toBe(`test_h2o H2O`)
      expect(lines[2]).toBe(`H 0.757000 0.586000 0.000000`)
      expect(lines[3]).toBe(`O 0.000000 0.000000 0.000000`)
      expect(lines[4]).toBe(`H -0.757000 0.586000 0.000000`)
      expect(lines).toHaveLength(5)
    })

    it(`exports all sites in JSON format`, () => {
      const json_content = structure_to_json_str(simple_structure)
      const parsed = JSON.parse(json_content)
      expect(parsed.sites).toHaveLength(3)
      expect(parsed.sites[0].species[0].element).toBe(`H`)
      expect(parsed.sites[1].species[0].element).toBe(`O`)
      expect(parsed.sites[2].species[0].element).toBe(`H`)
    })

    it(`handles complex structures with many sites`, () => {
      mock_electro_neg_formula.mockReturnValue(`LiFeP4O7`)
      const xyz_content = structure_to_xyz_str(complex_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`7`)
      expect(lines[1]).toBe(`test_complex LiFeP4O7`)
      expect(lines[2]).toBe(`Li 0.000000 0.000000 0.000000`)
      expect(lines[3]).toBe(`Fe 2.500000 0.000000 0.000000`)
      expect(lines[4]).toBe(`P 0.000000 2.500000 0.000000`)
      expect(lines[5]).toBe(`O 1.250000 1.250000 0.000000`)
      expect(lines[6]).toBe(`O 3.750000 1.250000 0.000000`)
      expect(lines[7]).toBe(`O 1.250000 3.750000 0.000000`)
      expect(lines[8]).toBe(`O 3.750000 3.750000 0.000000`)
      expect(lines).toHaveLength(9)
    })
  })

  describe(`Round-trip tests`, () => {
    it(`round-trips real structure data correctly`, () => {
      const parsed_structure = parse_structure_file(real_structure_json, `mp-1.json`)
      expect(parsed_structure?.sites).toHaveLength(1)
      const xyz_content = structure_to_xyz_str(parsed_structure as AnyStructure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`1`)
      expect(lines[2]).toMatch(/^Cs \d+\.\d+ \d+\.\d+ \d+\.\d+$/)
    })

    it(`round-trips XYZ export and parse`, () => {
      const xyz_content = structure_to_xyz_str(simple_structure)
      const parsed_structure = parse_structure_file(xyz_content, `test.xyz`)
      expect(parsed_structure?.sites).toHaveLength(3)
      const elements = parsed_structure?.sites.map((site) => site.species?.[0]?.element)
      expect(elements).toEqual([`H`, `O`, `H`])

      // Check coordinates are preserved (with some tolerance for floating point precision)
      expect(parsed_structure?.sites[0].xyz?.[0]).toBeCloseTo(0.757, 5)
      expect(parsed_structure?.sites[0].xyz?.[1]).toBeCloseTo(0.586, 5)
      expect(parsed_structure?.sites[1].xyz?.[0]).toBeCloseTo(0.0, 5)
      expect(parsed_structure?.sites[2].xyz?.[0]).toBeCloseTo(-0.757, 5)
    })

    it(`round-trips JSON export and parse`, () => {
      const json_content = structure_to_json_str(complex_structure)
      const parsed_structure = parse_structure_file(json_content, `test.json`)
      expect((parsed_structure as AnyStructure).id).toBe(complex_structure.id)
      expect(parsed_structure?.sites).toHaveLength(7)
    })
  })

  describe(`Coordinate handling`, () => {
    it(`converts fractional coordinates to cartesian when xyz not available`, () => {
      const structure_with_abc: AnyStructure = {
        id: `frac_coords`,
        sites: [{
          species: [{ element: `C` as ElementSymbol, occu: 1, oxidation_state: 0 }],
          abc: [0.5, 0.5, 0.5],
          xyz: [0, 0, 0],
          label: `C`,
          properties: {},
        }],
        lattice: {
          matrix: [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 2.0]],
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
      const modified_structure = {
        ...structure_with_abc,
        sites: [{ ...structure_with_abc.sites[0], xyz: undefined as unknown as Vec3 }],
      }
      const xyz_content = structure_to_xyz_str(modified_structure)
      const lines = xyz_content.split(`\n`)
      expect(lines[0]).toBe(`1`)
      expect(lines[2]).toBe(`C 1.000000 1.000000 1.000000`)
    })
  })

  describe(`Filename generation`, () => {
    it.each([
      {
        name: `basic structure with ID`,
        structure: {
          id: `water_molecule`,
          sites: Array(2).fill({
            species: [{ element: `H` as ElementSymbol, occu: 1, oxidation_state: 1 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `H`,
            properties: {},
          }),
        } as AnyStructure,
        extension: `xyz`,
        should_contain: [`water_molecule`, `2sites`, `.xyz`],
      },
      {
        name: `structure with many sites`,
        structure: {
          id: `complex_crystal`,
          sites: Array(24).fill({
            species: [{ element: `Si` as ElementSymbol, occu: 1, oxidation_state: 4 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `Si`,
            properties: {},
          }),
        } as AnyStructure,
        extension: `json`,
        should_contain: [`complex_crystal`, `24sites`, `.json`],
      },
    ])(`generates filename for $name`, ({ structure, extension, should_contain }) => {
      const result = create_structure_filename(structure, extension)
      should_contain.forEach((part) => expect(result).toContain(part))
    })

    it(`strips HTML tags from chemical formulas`, () => {
      mock_electro_neg_formula.mockReturnValue(`Li<sub>2</sub>O`)
      const structure = {
        id: `lithium_oxide`,
        sites: Array(3).fill({
          species: [{ element: `Li` as ElementSymbol, occu: 1, oxidation_state: 1 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `Li`,
          properties: {},
        }),
      } as AnyStructure
      const result = create_structure_filename(structure, `xyz`)
      expect(result).toContain(`Li2O`)
      expect(result).not.toContain(`<sub>`)
      expect(result).not.toContain(`</sub>`)
    })
  })

  describe(`Clipboard functionality`, () => {
    it(`copies text to clipboard`, async () => {
      const test_text = `Hello, world!`
      await copy_to_clipboard(test_text)
      expect(mock_clipboard_write_text).toHaveBeenCalledWith(test_text)
    })

    it(`handles clipboard API errors`, async () => {
      mock_clipboard_write_text.mockRejectedValueOnce(
        new Error(`Clipboard not available`),
      )
      await expect(copy_to_clipboard(`test`)).rejects.toThrow(`Clipboard not available`)
    })
  })

  describe(`Error handling`, () => {
    it.each([
      { func: structure_to_xyz_str, error_msg: `No structure or sites to export` },
      { func: structure_to_json_str, error_msg: `No structure to export` },
      { func: structure_to_cif_str, error_msg: `No structure or sites to export` },
      { func: structure_to_poscar_str, error_msg: `No structure or sites to export` },
    ])(`throws error for undefined structure`, ({ func, error_msg }) => {
      expect(() => func(undefined)).toThrow(error_msg)
    })

    it(`handles species without element (fallback to X)`, () => {
      const structure_no_element: AnyStructure = {
        sites: [{
          species: [
            { element: undefined, occu: 1, oxidation_state: 0 } as Species & {
              element: undefined
            },
          ],
          xyz: [0.0, 0.0, 0.0],
          abc: [0.0, 0.0, 0.0],
          label: `X`,
          properties: {},
        }],
      }
      const xyz_content = structure_to_xyz_str(structure_no_element)
      const lines = xyz_content.split(`\n`)
      expect(lines[2]).toBe(`X 0.000000 0.000000 0.000000`)
    })

    it(`exports CIF format correctly`, () => {
      const cif_content = structure_to_cif_str(complex_structure)
      const lines = cif_content.split(`\n`)

      // Check CIF header
      expect(lines[0]).toBe(`# CIF file generated by MatterViz`)
      expect(lines[1]).toBe(`_cell_identifier ${complex_structure.id}`)

      // Check cell parameters (order may vary)
      expect(lines.some((line) => line.includes(`_cell_length_a`))).toBe(true)
      expect(lines.some((line) => line.includes(`_cell_length_b`))).toBe(true)
      expect(lines.some((line) => line.includes(`_cell_length_c`))).toBe(true)

      // Check atom site loop
      expect(lines).toContain(`loop_`)
      expect(lines).toContain(`_atom_site_label`)
      expect(lines).toContain(`_atom_site_type_symbol`)
      expect(lines).toContain(`_atom_site_fract_x`)
      expect(lines).toContain(`_atom_site_fract_y`)
      expect(lines).toContain(`_atom_site_fract_z`)

      // Check atom data (should have Li, Fe, P, O atoms)
      expect(lines.some((line) => line.includes(`Li`))).toBe(true)
      expect(lines.some((line) => line.includes(`Fe`))).toBe(true)
      expect(lines.some((line) => line.includes(`P`))).toBe(true)
      expect(lines.some((line) => line.includes(`O`))).toBe(true)
    })

    it(`exports POSCAR format correctly`, () => {
      const poscar_content = structure_to_poscar_str(complex_structure)
      const lines = poscar_content.split(`\n`)

      // Check title line
      expect(lines[0]).toBe(complex_structure.id)

      // Check scale factor
      expect(lines[1]).toBe(`1.0`)

      // Check lattice vectors (should be 3 lines)
      expect(lines[2]).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)
      expect(lines[3]).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)
      expect(lines[4]).toMatch(/^-?\d+\.\d+ -?\d+\.\d+ -?\d+\.\d+$/)

      // Check element symbols (should have Li, Fe, P, O)
      expect(lines[5]).toBe(`Li Fe P O`)

      // Check atom counts (1 Li, 1 Fe, 1 P, 4 O)
      expect(lines[6]).toBe(`1 1 1 4`)

      // Check coordinate mode
      expect(lines[7]).toBe(`Direct`)

      // Check atom coordinates (should have multiple lines)
      expect(lines.length).toBeGreaterThan(8)
      expect(lines[8]).toMatch(/^0\.\d+ 0\.\d+ 0\.\d+$/)
    })
  })

  describe(`Canvas PNG export`, () => {
    it(`exports PNG for direct export`, () => {
      const mock_canvas = create_mock_canvas()
      export_canvas_as_png(mock_canvas, simple_structure, 72)
      expect(mock_canvas.toBlob).toHaveBeenCalled()
      expect(mock_download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining(`.png`),
        `image/png`,
      )
    })

    it(`exports high-res PNG with renderer`, () => {
      const mock_canvas = create_mock_canvas()
      const mock_renderer = {
        getPixelRatio: vi.fn(() => 1),
        setPixelRatio: vi.fn(),
        getSize: vi.fn(() => ({ width: 100, height: 100 })),
        setSize: vi.fn(),
        render: vi.fn(),
      }
      mock_canvas.__customRenderer = mock_renderer
      export_canvas_as_png(mock_canvas, simple_structure, 144)
      expect(mock_renderer.setPixelRatio).toHaveBeenCalledWith(2)
      expect(mock_renderer.setSize).toHaveBeenCalledWith(100, 100, false)
      expect(mock_download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining(`.png`),
        `image/png`,
      )
    })

    it.each([
      { canvas: null, warn_msg: `Canvas not found for PNG export` },
      {
        canvas: create_mock_canvas(),
        warn_msg: `Failed to generate PNG - canvas may be empty`,
        setup: (canvas: HTMLCanvasElement) => {
          canvas.toBlob = vi.fn((cb: (blob: Blob | null) => void) =>
            cb(null)
          ) as unknown as (HTMLCanvasElement & { __customRenderer?: unknown })[`toBlob`]
        },
      },
    ])(`handles canvas issues`, ({ canvas, warn_msg, setup }) => {
      if (setup) setup(canvas as HTMLCanvasElement)
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_canvas_as_png(canvas, simple_structure)
      expect(warn).toHaveBeenCalledWith(warn_msg)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe(`SVG export`, () => {
    let mock_xml_serializer: { serializeToString: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mock_xml_serializer = { serializeToString: vi.fn(() => `<svg></svg>`) }
      globalThis.XMLSerializer = vi.fn(() =>
        mock_xml_serializer
      ) as unknown as typeof XMLSerializer
    })

    it(`exports SVG with XML/DOCTYPE and font-family`, () => {
      const mock_svg = create_mock_svg()
      const mock_cloned_svg = create_mock_svg()
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      export_svg_as_svg(mock_svg, `f.svg`)
      expect(mock_xml_serializer.serializeToString).toHaveBeenCalledWith(mock_cloned_svg)
      expect(mock_download).toHaveBeenCalledWith(
        expect.stringContaining(`<?xml version="1.0"`),
        `f.svg`,
        `image/svg+xml`,
      )
      expect(mock_download).toHaveBeenCalledWith(
        expect.stringContaining(`<!DOCTYPE svg PUBLIC`),
        `f.svg`,
        `image/svg+xml`,
      )
      expect(mock_cloned_svg.getAttribute(`font-family`)).toBe(`sans-serif`)
      expect(mock_cloned_svg.getAttribute(`style`)).toContain(`font-family:sans-serif`)
      expect(mock_svg.cloneNode).toHaveBeenCalledWith(true)
    })

    it(`preserves existing font-family`, () => {
      const mock_svg = create_mock_svg()
      const mock_cloned_svg = create_mock_svg()
      mock_cloned_svg.setAttribute(`style`, `color: red; font-family: Arial;`)
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      export_svg_as_svg(mock_svg, `f.svg`)
      expect(mock_cloned_svg.getAttribute(`style`)).toBe(
        `color: red; font-family: Arial;`,
      )
    })

    it(`handles null SVG`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_svg_as_svg(null, `f.svg`)
      expect(warn).toHaveBeenCalledWith(`SVG element not found for export`)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it(`handles serialization errors`, () => {
      const mock_svg = create_mock_svg()
      const mock_cloned_svg = create_mock_svg()
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      mock_xml_serializer.serializeToString.mockImplementation(() => {
        throw new Error(`fail`)
      })
      const err = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_svg_as_svg(mock_svg, `f.svg`)
      expect(err).toHaveBeenCalledWith(`Error exporting SVG:`, expect.any(Error))
      expect(mock_download).not.toHaveBeenCalled()
      err.mockRestore()
    })
  })

  describe(`SVG to PNG export`, () => {
    let mock_svg: SVGElement
    let mock_cloned_svg: SVGElement
    let mock_canvas: HTMLCanvasElement
    let mock_context: CanvasRenderingContext2D
    let mock_image: HTMLImageElement
    let mock_xml_serializer: { serializeToString: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mock_svg = create_mock_svg()
      mock_cloned_svg = create_mock_svg()
      mock_svg.cloneNode = vi.fn(() => mock_cloned_svg)
      mock_canvas = create_mock_canvas()
      mock_context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D
      mock_canvas.getContext = vi.fn(() =>
        mock_context
      ) as unknown as HTMLCanvasElement[`getContext`]
      mock_image = create_mock_image()
      mock_xml_serializer = { serializeToString: vi.fn(() => `<svg></svg>`) }
      globalThis.XMLSerializer = vi.fn(() =>
        mock_xml_serializer
      ) as unknown as typeof XMLSerializer
      globalThis.document.createElement = vi.fn((tag) =>
        tag === `canvas`
          ? mock_canvas
          : tag === `img`
          ? mock_image
          : document.createElement(tag)
      ) as typeof document.createElement
      globalThis.Image = vi.fn(() => mock_image) as unknown as typeof Image
    })

    it(`exports PNG with correct dimensions and DPI`, () => {
      export_svg_as_png(mock_svg, `f.png`, 150)
      expect(mock_canvas.width).toBe(208)
      expect(mock_canvas.height).toBe(208)
      expect(mock_image.src).toMatch(/^data:image\/svg\+xml;base64,/)
      mock_image.onload?.call(mock_image, new Event(`load`))
      expect(mock_context.clearRect).toHaveBeenCalledWith(0, 0, 208, 208)
      expect(mock_context.drawImage).toHaveBeenCalledWith(mock_image, 0, 0, 208, 208)
      expect(mock_canvas.toBlob).toHaveBeenCalled()
      expect(mock_download).toHaveBeenCalledWith(expect.any(Blob), `f.png`, `image/png`)
      expect(mock_cloned_svg.getAttribute(`font-family`)).toBe(`sans-serif`)
    })

    it.each([
      { dpi: undefined, width: 208, height: 208 },
      { dpi: 300, width: 417, height: 417 },
      { dpi: 144, width: 200, height: 200 },
    ])(`uses DPI $dpi correctly`, ({ dpi, width, height }) => {
      export_svg_as_png(mock_svg, `f.png`, dpi)
      expect(mock_canvas.width).toBe(width)
      expect(mock_canvas.height).toBe(height)
    })

    it.each([
      { svg: null, warn_msg: `SVG element not found for PNG export` },
      {
        svg: create_mock_svg(),
        warn_msg: `SVG viewBox not found for PNG export`,
        setup: (svg: SVGElement) => svg.removeAttribute(`viewBox`),
      },
      {
        svg: create_mock_svg(`0 0 0 0`),
        warn_msg: `Invalid SVG dimensions for PNG export`,
      },
      {
        svg: create_mock_svg(),
        warn_msg: `Canvas 2D context not available for PNG export`,
        setup: () => {
          mock_canvas.getContext = vi.fn(() =>
            null
          ) as unknown as HTMLCanvasElement[`getContext`]
        },
      },
    ])(`handles SVG issues: $warn_msg`, ({ svg, warn_msg, setup }) => {
      if (setup && svg) setup(svg)
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_svg_as_png(svg as SVGElement | null, `f.png`)
      expect(warn).toHaveBeenCalledWith(warn_msg)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it(`handles image load error`, () => {
      const err = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_svg_as_png(mock_svg, `f.png`, 150)
      if (typeof mock_image.onerror === `function`) {
        mock_image.onerror.call(mock_image, new Event(`error`))
      }
      expect(err).toHaveBeenCalledWith(`Failed to load SVG for PNG export`)
      expect(mock_download).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it(`handles toBlob null`, () => {
      mock_canvas.toBlob = vi.fn((cb: (b: Blob | null) => void) =>
        cb(null)
      ) as unknown as (HTMLCanvasElement & { __customRenderer?: unknown })[`toBlob`]
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      export_svg_as_png(mock_svg, `f.png`)
      mock_image.onload?.call(mock_image, new Event(`load`))
      expect(warn).toHaveBeenCalledWith(`Failed to generate PNG blob`)
      expect(mock_download).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it(`handles drawImage error`, () => {
      const error = new Error(`Draw failed`)
      mock_context.drawImage = vi.fn(() => {
        throw error
      })
      const err = vi.spyOn(console, `error`).mockImplementation(() => {})
      export_svg_as_png(mock_svg, `f.png`)
      mock_image.onload?.call(mock_image, new Event(`load`))
      expect(err).toHaveBeenCalledWith(`Error during PNG generation:`, error)
      expect(mock_download).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it(`handles non-integer dimensions`, () => {
      mock_svg.setAttribute(`viewBox`, `0 0 50.5 75.3`)
      export_svg_as_png(mock_svg, `f.png`, 144)
      expect(mock_canvas.width).toBe(101)
      expect(mock_canvas.height).toBe(151)
    })
  })
})
