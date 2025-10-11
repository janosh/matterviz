import type { AnyStructure } from '$lib'
import { StructureExportPane } from '$lib/structure'
import * as export_funcs from '$lib/structure/export'
import { mount } from 'svelte'
import type { Scene } from 'three'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, simple_structure } from '../setup'

// Mock the export functions
vi.mock(`$lib/structure/export`, () => ({
  export_structure_as_json: vi.fn(),
  export_structure_as_xyz: vi.fn(),
  export_structure_as_cif: vi.fn(),
  export_structure_as_poscar: vi.fn(),
  export_structure_as_glb: vi.fn(),
  export_structure_as_obj: vi.fn(),
  structure_to_json_str: vi.fn(() => `{"test": "json"}`),
  structure_to_xyz_str: vi.fn(() => `3\ntest\nH 0 0 0`),
  structure_to_cif_str: vi.fn(() => `data_test\n_cell_length_a 1.0`),
  structure_to_poscar_str: vi.fn(() => `test\n1.0\n1 0 0`),
}))

vi.mock(`$lib/io/export`, () => ({
  export_canvas_as_png: vi.fn(),
}))

describe(`StructureExportPane`, () => {
  let wrapper_div: HTMLDivElement
  let mock_scene: Scene

  beforeEach(() => {
    vi.clearAllMocks()
    wrapper_div = document.createElement(`div`)
    const canvas = document.createElement(`canvas`)
    wrapper_div.appendChild(canvas)
    document.body.appendChild(wrapper_div)

    // Create minimal mock Scene object
    mock_scene = {} as Scene

    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  test(`renders when export_pane_open is true`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
      },
    })

    expect(document.querySelector(`.export-pane`)).toBeTruthy()
    expect(document.body.textContent).toContain(`Export Text Formats`)
    expect(document.body.textContent).toContain(`Export Images`)
    expect(document.body.textContent).toContain(`Export 3D Models`)
  })

  test(`does not render export-pane content when closed`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: false,
        structure: simple_structure,
      },
    })

    // Toggle button should exist
    expect(document.querySelector(`.structure-export-toggle`)).toBeTruthy()
  })

  test(`displays all text export format buttons`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
      },
    })

    const format_labels = [`JSON`, `XYZ`, `CIF`, `POSCAR`]
    for (const label of format_labels) {
      expect(document.body.textContent).toContain(label)
    }

    // Should have download and copy buttons for each format (2 buttons × 4 formats = 8)
    const buttons = document.querySelectorAll(`.export-buttons button`)
    expect(buttons.length).toBeGreaterThanOrEqual(8)
  })

  test.each([
    { format: `json`, label: `JSON`, fn_name: `export_structure_as_json` },
    { format: `xyz`, label: `XYZ`, fn_name: `export_structure_as_xyz` },
    { format: `cif`, label: `CIF`, fn_name: `export_structure_as_cif` },
    { format: `poscar`, label: `POSCAR`, fn_name: `export_structure_as_poscar` },
  ])(
    `calls correct export function for $label download`,
    async ({ label, fn_name }) => {
      mount(StructureExportPane, {
        target: document.body,
        props: {
          export_pane_open: true,
          structure: simple_structure,
        },
      })

      const export_fn = export_funcs[fn_name as keyof typeof export_funcs]
      expect(export_fn).not.toHaveBeenCalled()

      // Find download button for this format (⬇ button)
      const format_div = Array.from(document.querySelectorAll(`.export-buttons > div`))
        .find(
          (div) => div.textContent?.includes(label),
        )
      expect(format_div).toBeTruthy()

      const download_btn = format_div?.querySelector(`button[title*="Download"]`)
      expect(download_btn).toBeTruthy()

      download_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))
      await vi.waitFor(() => expect(export_fn).toHaveBeenCalledWith(simple_structure))
    },
  )

  test.each([
    {
      format: `json`,
      label: `JSON`,
      str_fn_name: `structure_to_json_str`,
      expected_content: `{"test": "json"}`,
    },
    {
      format: `xyz`,
      label: `XYZ`,
      str_fn_name: `structure_to_xyz_str`,
      expected_content: `3\ntest\nH 0 0 0`,
    },
    {
      format: `cif`,
      label: `CIF`,
      str_fn_name: `structure_to_cif_str`,
      expected_content: `data_test\n_cell_length_a 1.0`,
    },
    {
      format: `poscar`,
      label: `POSCAR`,
      str_fn_name: `structure_to_poscar_str`,
      expected_content: `test\n1.0\n1 0 0`,
    },
  ])(
    `copies $label content to clipboard correctly`,
    async ({ label, str_fn_name, expected_content }) => {
      mount(StructureExportPane, {
        target: document.body,
        props: {
          export_pane_open: true,
          structure: simple_structure,
        },
      })

      const str_fn = export_funcs[str_fn_name as keyof typeof export_funcs]

      // Find copy button for this format (📋 button)
      const format_div = Array.from(document.querySelectorAll(`.export-buttons > div`))
        .find(
          (div) => div.textContent?.includes(label),
        )
      const copy_btn = format_div?.querySelector(`button[title*="Copy"]`)
      expect(copy_btn).toBeTruthy()

      copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

      await vi.waitFor(() => {
        expect(str_fn).toHaveBeenCalledWith(simple_structure)
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected_content)
      })
    },
  )

  test(`shows checkmark feedback after successful copy`, async () => {
    vi.useFakeTimers()

    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
      },
    })

    const format_div = Array.from(document.querySelectorAll(`.export-buttons > div`))
      .find(
        (div) => div.textContent?.includes(`JSON`),
      )
    const copy_btn = format_div?.querySelector(`button[title*="Copy"]`)

    // Initial state should show clipboard emoji
    expect(copy_btn?.textContent).toContain(`📋`)

    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(copy_btn?.textContent).toContain(`✅`)
    })

    // After 1 second, should revert to clipboard emoji
    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => {
      expect(copy_btn?.textContent).toContain(`📋`)
    })

    vi.useRealTimers()
  })

  test(`handles missing structure gracefully for text exports`, async () => {
    const console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: undefined,
      },
    })

    const format_div = Array.from(document.querySelectorAll(`.export-buttons > div`))
      .find(
        (div) => div.textContent?.includes(`JSON`),
      )
    const copy_btn = format_div?.querySelector(`button[title*="Copy"]`)

    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(console_warn_spy).toHaveBeenCalledWith(
        expect.stringContaining(`No structure available for copying`),
      )
    })

    console_warn_spy.mockRestore()
  })

  test(`PNG export section renders with default DPI`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        wrapper: wrapper_div,
        png_dpi: 150,
      },
    })

    const dpi_input = doc_query<HTMLInputElement>(
      `input[type="number"][title*="dots per inch"]`,
    )
    expect(dpi_input.value).toBe(`150`)
    expect(dpi_input.min).toBe(`50`)
    expect(dpi_input.max).toBe(`500`)
  })

  test(`PNG export button is disabled without canvas`, () => {
    const empty_wrapper = document.createElement(`div`)
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        wrapper: empty_wrapper,
      },
    })

    const png_buttons = Array.from(document.querySelectorAll(`button`)).filter(
      (btn) => btn.title?.includes(`PNG`),
    )
    expect(png_buttons.length).toBeGreaterThan(0)
    expect(png_buttons[0]?.disabled).toBe(true)
  })

  test(`PNG export button is enabled with canvas`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        wrapper: wrapper_div,
      },
    })

    const png_buttons = Array.from(document.querySelectorAll(`button`)).filter(
      (btn) => btn.title?.includes(`PNG`),
    )
    expect(png_buttons[0]?.disabled).toBe(false)
  })

  test(`displays 3D model export formats`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        scene: mock_scene,
      },
    })

    expect(document.body.textContent).toContain(`GLB`)
    expect(document.body.textContent).toContain(`OBJ`)
  })

  test.each([
    { format: `glb`, label: `GLB`, fn_name: `export_structure_as_glb` },
    { format: `obj`, label: `OBJ`, fn_name: `export_structure_as_obj` },
  ])(`calls correct export function for $label 3D export`, async ({ label, fn_name }) => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        scene: mock_scene,
      },
    })

    const export_fn = export_funcs[fn_name as keyof typeof export_funcs]

    // Find the 3D model export section
    const h4_elements = Array.from(document.querySelectorAll(`h4`))
    const models_h4 = h4_elements.find((h4) =>
      h4.textContent?.includes(`Export 3D Models`)
    )
    expect(models_h4).toBeTruthy()

    const models_section = models_h4?.nextElementSibling
    expect(models_section).toBeTruthy()

    const format_div = Array.from(models_section?.querySelectorAll(`div`) || []).find((
      div,
    ) => div.textContent?.includes(label))
    const download_btn = format_div?.querySelector(`button`)
    expect(download_btn).toBeTruthy()
    expect(download_btn?.disabled).toBe(false)

    download_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_fn).toHaveBeenCalledWith(mock_scene, simple_structure)
    })
  })

  test(`3D export buttons are disabled without scene`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        scene: undefined,
      },
    })

    const h4_elements = Array.from(document.querySelectorAll(`h4`))
    const models_h4 = h4_elements.find((h4) =>
      h4.textContent?.includes(`Export 3D Models`)
    )
    const models_section = models_h4?.nextElementSibling

    const buttons = models_section?.querySelectorAll(`button`)
    buttons?.forEach((btn) => {
      expect(btn.disabled).toBe(true)
    })
  })

  test(`toggle button has correct title when closed`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: false,
      },
    })

    const toggle = doc_query(`.structure-export-toggle`)
    expect(toggle.title).toBe(`Export Structure`)
  })

  test(`toggle button has empty title when open`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
      },
    })

    const toggle = doc_query(`.structure-export-toggle`)
    expect(toggle.title).toBe(``)
  })

  test(`handles clipboard API errors gracefully`, async () => {
    const console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const clipboard_error = new Error(`Clipboard API not available`)

    // Mock clipboard.writeText to reject
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValueOnce(clipboard_error),
      },
    })

    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
      },
    })

    const format_div = Array.from(document.querySelectorAll(`.export-buttons > div`))
      .find(
        (div) => div.textContent?.includes(`JSON`),
      )
    const copy_btn = format_div?.querySelector(`button[title*="Copy"]`)

    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(console_error_spy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to copy JSON to clipboard`),
        clipboard_error,
      )
    })

    console_error_spy.mockRestore()
  })

  test(`handles structures without lattice for CIF and POSCAR formats`, async () => {
    const structure_without_lattice: AnyStructure = {
      id: `test_no_lattice`,
      sites: simple_structure.sites,
    }

    // Mock the functions to throw errors for formats that require lattice
    vi.mocked(export_funcs.structure_to_cif_str).mockImplementation(() => {
      throw new Error(`No lattice found`)
    })
    vi.mocked(export_funcs.structure_to_poscar_str).mockImplementation(() => {
      throw new Error(`No lattice found`)
    })

    const console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})

    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: structure_without_lattice,
      },
    })

    // Try to copy CIF
    const cif_div = Array.from(document.querySelectorAll(`.export-buttons > div`)).find((
      div,
    ) => div.textContent?.includes(`CIF`))
    const cif_copy_btn = cif_div?.querySelector(`button[title*="Copy"]`)
    cif_copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(console_error_spy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to copy CIF to clipboard`),
        expect.any(Error),
      )
    })

    console_error_spy.mockRestore()
  })

  test(`text export format buttons have appropriate titles`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        structure: simple_structure,
        scene: mock_scene,
      },
    })

    // Get all buttons from the text export section
    const h4_elements = Array.from(document.querySelectorAll(`h4`))
    const text_h4 = h4_elements.find((h4) =>
      h4.textContent?.includes(`Export Text Formats`)
    )
    expect(text_h4).toBeTruthy()

    const text_section = text_h4?.nextElementSibling
    expect(text_section).toBeTruthy()

    // Check download buttons (exact text match)
    const download_buttons = Array.from(
      text_section?.querySelectorAll(`button`) || [],
    ).filter((btn) => btn.textContent?.trim() === `⬇`)
    expect(download_buttons.length).toBe(4) // JSON, XYZ, CIF, POSCAR

    download_buttons.forEach((btn) => {
      const title = btn.getAttribute(`title`)
      expect(title).toBeTruthy()
      expect(title).toContain(`Download`)
    })

    // Check copy buttons (exact text match)
    const copy_buttons = Array.from(
      text_section?.querySelectorAll(`button`) || [],
    ).filter((btn) => btn.textContent?.trim() === `📋`)
    expect(copy_buttons.length).toBe(4) // JSON, XYZ, CIF, POSCAR

    copy_buttons.forEach((btn) => {
      const title = btn.getAttribute(`title`)
      expect(title).toBeTruthy()
      expect(title).toContain(`Copy`)
      expect(title).toContain(`clipboard`)
    })
  })

  test(`custom pane_props are applied correctly`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: true,
        pane_props: { style: `max-height: 400px`, class: `custom-export-pane` },
      },
    })

    const pane = doc_query(`.export-pane`)
    expect(pane.classList.contains(`custom-export-pane`)).toBe(true)
    expect(pane.style.maxHeight).toBe(`400px`)
  })

  test(`custom toggle_props are applied correctly`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        export_pane_open: false,
        toggle_props: { class: `custom-export-toggle` },
      },
    })

    const toggle = doc_query(`.structure-export-toggle`)
    expect(toggle.classList.contains(`custom-export-toggle`)).toBe(true)
  })
})
