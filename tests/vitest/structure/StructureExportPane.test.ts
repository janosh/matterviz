import type { AnyStructure } from '$lib'
import { export_canvas_as_png } from '$lib/io/export'
import { StructureExportPane } from '$lib/structure'
import * as export_funcs from '$lib/structure/export'
import { mount } from 'svelte'
import type { Camera, Scene } from 'three'
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
    wrapper_div = document.createElement(`div`)
    const canvas = document.createElement(`canvas`)
    wrapper_div.appendChild(canvas)
    document.body.appendChild(wrapper_div)
    mock_scene = {} as Scene
  })

  const get_button = (title_part: string) => {
    const matches = Array.from(document.querySelectorAll(`button`)).filter((btn) =>
      btn.title?.includes(title_part)
    )
    if (matches.length === 0) {
      throw new Error(`No button found with title containing "${title_part}"`)
    }
    if (matches.length > 1) {
      throw new Error(`Multiple buttons match "${title_part}": ${matches.length} found`)
    }
    return matches[0]
  }

  test(`displays all text export format buttons`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure },
    })

    const format_labels = [`JSON`, `XYZ`, `CIF`, `POSCAR`]
    for (const label of format_labels) {
      expect(document.body.textContent).toContain(label)
    }

    // 2 buttons per format (download + copy) * 4 formats = 8
    const text_section = Array.from(document.querySelectorAll(`h4`))
      .find((h4) => h4.textContent?.includes(`Export as text`))?.nextElementSibling
    const buttons = text_section?.querySelectorAll(`button`)
    expect(buttons?.length).toBe(8)
  })

  test.each([
    { format: `json`, label: `JSON`, fn_name: `export_structure_as_json` },
    { format: `xyz`, label: `XYZ`, fn_name: `export_structure_as_xyz` },
    { format: `cif`, label: `CIF`, fn_name: `export_structure_as_cif` },
    { format: `poscar`, label: `POSCAR`, fn_name: `export_structure_as_poscar` },
  ])(`calls correct export function for $label download`, async ({ label, fn_name }) => {
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure },
    })

    const export_fn = export_funcs[fn_name as keyof typeof export_funcs]
    expect(export_fn).not.toHaveBeenCalled()

    const download_btn = get_button(`Download ${label}`)
    expect(download_btn).toBeTruthy()

    download_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))
    await vi.waitFor(() => expect(export_fn).toHaveBeenCalledWith(simple_structure))
  })

  test.each([
    {
      label: `JSON`,
      str_fn_name: `structure_to_json_str`,
      expected_content: `{"test": "json"}`,
    },
    {
      label: `XYZ`,
      str_fn_name: `structure_to_xyz_str`,
      expected_content: `3\ntest\nH 0 0 0`,
    },
    {
      label: `CIF`,
      str_fn_name: `structure_to_cif_str`,
      expected_content: `data_test\n_cell_length_a 1.0`,
    },
    {
      label: `POSCAR`,
      str_fn_name: `structure_to_poscar_str`,
      expected_content: `test\n1.0\n1 0 0`,
    },
  ])(
    `copies $label content to clipboard`,
    async ({ label, str_fn_name, expected_content }) => {
      mount(StructureExportPane, {
        target: document.body,
        props: { structure: simple_structure },
      })

      const str_fn = export_funcs[str_fn_name as keyof typeof export_funcs]
      const copy_btn = get_button(`Copy ${label}`)
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
      props: { structure: simple_structure },
    })

    const copy_btn = get_button(`Copy JSON`)
    expect(copy_btn?.textContent).toContain(`📋`)

    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => expect(copy_btn?.textContent).toContain(`✅`))

    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => expect(copy_btn?.textContent).toContain(`📋`))

    vi.useRealTimers()
  })

  test(`handles missing structure gracefully for text exports`, async () => {
    const console_warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    mount(StructureExportPane, {
      target: document.body,
      props: { structure: undefined },
    })

    const copy_btn = get_button(`Copy JSON`)
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

  test(`PNG export button is enabled with canvas`, async () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure, wrapper: wrapper_div },
    })

    const png_btn = get_button(`PNG`)
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))
  })

  test(`PNG export button disabled when canvas absent or removed`, async () => {
    wrapper_div.innerHTML = ``
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure, wrapper: wrapper_div },
    })

    const png_btn = get_button(`PNG`)
    expect(png_btn?.disabled).toBe(true)

    wrapper_div.appendChild(document.createElement(`canvas`))
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))

    wrapper_div.innerHTML = ``
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(true))
  })

  test(`displays 3D model export formats`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure, scene: mock_scene },
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
      props: { structure: simple_structure, scene: mock_scene },
    })

    const export_fn = export_funcs[fn_name as keyof typeof export_funcs]

    const download_btn = get_button(`Download ${label}`)
    expect(download_btn).toBeTruthy()
    expect(download_btn?.disabled).toBe(false)

    download_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))
    await vi.waitFor(() =>
      expect(export_fn).toHaveBeenCalledWith(mock_scene, simple_structure)
    )
  })

  test(`3D export buttons are disabled without scene`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure, scene: undefined },
    })

    const models_section = Array.from(document.querySelectorAll(`h4`))
      .find((h4) => h4.textContent?.includes(`Export as 3D model`))?.nextElementSibling

    const buttons = models_section?.querySelectorAll(`button`)
    buttons?.forEach((btn) => expect(btn.disabled).toBe(true))
  })

  test(`toggle button title when closed`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { export_pane_open: false },
    })
    expect(doc_query(`.structure-export-toggle`).title).toBe(`Export Structure`)
  })

  test(`toggle button title when open`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { export_pane_open: true },
    })
    expect(doc_query(`.structure-export-toggle`).title).toBe(``)
  })

  test(`handles clipboard API errors gracefully`, async () => {
    const console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const clipboard_error = new Error(`Clipboard API not available`)

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValueOnce(clipboard_error) },
    })

    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure },
    })

    const copy_btn = get_button(`Copy JSON`)
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

    vi.mocked(export_funcs.structure_to_cif_str).mockImplementationOnce(() => {
      throw new Error(`No lattice found`)
    })
    const console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})

    mount(StructureExportPane, {
      target: document.body,
      props: { structure: structure_without_lattice },
    })

    const copy_btn = get_button(`Copy CIF`)
    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

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
      props: { structure: simple_structure, scene: mock_scene },
    })

    const text_section = Array.from(document.querySelectorAll(`h4`))
      .find((h4) => h4.textContent?.includes(`Export as text`))?.nextElementSibling

    const download_buttons = Array.from(text_section?.querySelectorAll(`button`) || [])
      .filter(
        (btn) => btn.title?.includes(`Download`),
      )
    expect(download_buttons.length).toBe(4)
    download_buttons.forEach((btn) => expect(btn.title).toContain(`Download`))

    const copy_buttons = Array.from(text_section?.querySelectorAll(`button`) || [])
      .filter(
        (btn) => btn.title?.includes(`Copy`) && btn.title?.includes(`clipboard`),
      )
    expect(copy_buttons.length).toBe(4)
    copy_buttons.forEach((btn) => {
      expect(btn.title).toContain(`Copy`)
      expect(btn.title).toContain(`clipboard`)
    })
  })

  test(`custom props are applied correctly`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        pane_props: { style: `max-height: 400px`, class: `custom-export-pane` },
        export_pane_open: false,
        toggle_props: { class: `custom-export-toggle` },
      },
    })

    const pane = doc_query(`.export-pane`)
    expect(pane.classList.contains(`custom-export-pane`)).toBe(true)
    expect(pane.style.maxHeight).toBe(`400px`)

    const toggle = doc_query(`.structure-export-toggle`)
    expect(toggle.classList.contains(`custom-export-toggle`)).toBe(true)
  })

  test(`PNG export button invokes export_canvas_as_png`, async () => {
    const mock_camera = { type: `PerspectiveCamera` } as Camera
    const png_dpi = 200

    mount(StructureExportPane, {
      target: document.body,
      props: {
        structure: simple_structure,
        wrapper: wrapper_div,
        png_dpi,
        camera: mock_camera,
        scene: mock_scene,
      },
    })

    const png_btn = get_button(`PNG`)
    expect(png_btn).toBeTruthy()
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))

    png_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_canvas_as_png).toHaveBeenCalledWith(
        wrapper_div.querySelector(`canvas`),
        simple_structure,
        png_dpi,
        mock_scene,
        mock_camera,
      )
    })
  })

  test(`PNG export button uses defaults when optional props missing`, async () => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        structure: simple_structure,
        wrapper: wrapper_div,
        scene: mock_scene,
        // default png_dpi is 150, camera undefined
      },
    })

    const png_btn = get_button(`PNG`)
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))
    png_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_canvas_as_png).toHaveBeenCalledWith(
        wrapper_div.querySelector(`canvas`),
        simple_structure,
        150,
        mock_scene,
        undefined,
      )
    })
  })
})
