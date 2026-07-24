import type { AnyStructure } from '$lib'
import { export_canvas_as_png } from '$lib/io/export'
import { StructureExportPane } from '$lib/structure'
import * as export_funcs from '$lib/structure/export'
import { mount } from 'svelte'
import type { Camera, Scene } from 'three'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, simple_structure } from '../setup'

// Mock the export functions
vi.mock(`$lib/structure/export`, () => {
  const structure_to_json_str = vi.fn(() => `{"test": "json"}`)
  const structure_to_xyz_str = vi.fn(() => `3\ntest\nH 0 0 0`)
  const structure_to_cif_str = vi.fn(() => `data_test\n_cell_length_a 1.0`)
  const structure_to_poscar_str = vi.fn(() => `test\n1.0\n1 0 0`)
  return {
    export_structure_as: vi.fn(),
    export_structure_as_glb: vi.fn(),
    export_structure_as_obj: vi.fn(),
    structure_to_json_str,
    structure_to_xyz_str,
    structure_to_cif_str,
    structure_to_poscar_str,
    STRUCT_TEXT_FORMATS: {
      json: { to_str: structure_to_json_str, ext: `json`, mime: `application/json` },
      xyz: { to_str: structure_to_xyz_str, ext: `xyz`, mime: `text/plain` },
      cif: { to_str: structure_to_cif_str, ext: `cif`, mime: `chemical/x-cif` },
      poscar: { to_str: structure_to_poscar_str, ext: `poscar`, mime: `text/plain` },
    },
  }
})

vi.mock(`$lib/io/export`, async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  export_canvas_as_png: vi.fn(),
}))

describe(`StructureExportPane`, () => {
  let wrapper_div: HTMLDivElement
  let mock_scene: Scene

  beforeEach(() => {
    wrapper_div = document.createElement(`div`)
    const canvas = document.createElement(`canvas`)
    wrapper_div.append(canvas)
    document.body.append(wrapper_div)
    mock_scene = {} as Scene
  })

  const get_button = (title_part: string) => {
    const matches = Array.from(document.querySelectorAll(`button`)).filter((btn) =>
      btn.title?.includes(title_part),
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
    const text_section = Array.from(document.querySelectorAll(`h4`)).find((h4) =>
      h4.textContent?.includes(`Export as text`),
    )?.nextElementSibling
    const buttons = text_section?.querySelectorAll(`button`)
    expect(buttons?.length).toBe(8)
  })

  test.each([
    { format: `json`, label: `JSON` },
    { format: `xyz`, label: `XYZ` },
    { format: `cif`, label: `CIF` },
    { format: `poscar`, label: `POSCAR` },
  ])(`calls correct export function for $label download`, async ({ format, label }) => {
    vi.mocked(export_funcs.export_structure_as).mockClear() // shared across test.each runs
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure },
    })

    expect(export_funcs.export_structure_as).not.toHaveBeenCalled()

    const download_btn = get_button(`Download ${label}`)
    expect(download_btn).toBeDefined()

    download_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))
    await vi.waitFor(() =>
      expect(export_funcs.export_structure_as).toHaveBeenCalledWith(format, simple_structure),
    )
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
      expect(copy_btn).toBeDefined()

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

  test(`text export buttons are disabled and copy no-ops without structure`, async () => {
    vi.mocked(navigator.clipboard.writeText).mockClear()

    mount(StructureExportPane, {
      target: document.body,
      props: { structure: undefined },
    })

    const copy_btn = get_button(`Copy JSON`)
    const download_btn = get_button(`Download JSON`)
    expect(copy_btn.disabled).toBe(true)
    expect(download_btn.disabled).toBe(true)

    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    // Flush microtasks then verify clipboard was not called
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
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
    expect(dpi_input.max).toBe(`600`)
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

    wrapper_div.append(document.createElement(`canvas`))
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))

    wrapper_div.innerHTML = ``
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(true))
  })

  test(`slice export uses its explicit canvas and hides 3D formats`, async () => {
    const slice_canvas = document.createElement(`canvas`)
    mount(StructureExportPane, {
      target: document.body,
      props: {
        structure: simple_structure,
        wrapper: wrapper_div,
        image_canvas: slice_canvas,
        image_filename: `charge-density-slice`,
        enable_3d_export: false,
      },
    })

    get_button(`PNG`).click()
    await vi.waitFor(() => {
      expect(export_canvas_as_png).toHaveBeenCalledWith(
        slice_canvas,
        `charge-density-slice`,
        150,
        null,
        null,
      )
    })
    expect(document.body.textContent).not.toContain(`Export as 3D model`)
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
    expect(download_btn).toBeDefined()
    expect(download_btn?.disabled).toBe(false)

    download_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))
    await vi.waitFor(() =>
      expect(export_fn).toHaveBeenCalledWith(mock_scene, simple_structure),
    )
  })

  test(`3D export buttons are disabled without scene`, () => {
    mount(StructureExportPane, {
      target: document.body,
      props: { structure: simple_structure, scene: undefined },
    })

    const models_section = Array.from(document.querySelectorAll(`h4`)).find((h4) =>
      h4.textContent?.includes(`Export as 3D model`),
    )?.nextElementSibling

    const buttons = models_section?.querySelectorAll(`button`)
    buttons?.forEach((btn) => expect(btn.disabled).toBe(true))
  })

  test.each([
    [false, `Export Structure`],
    [true, ``],
  ])(`toggle button title when export_pane_open=%s`, (export_pane_open, expected_title) => {
    mount(StructureExportPane, {
      target: document.body,
      props: { export_pane_open },
    })
    expect(doc_query(`.structure-export-toggle`).title).toBe(expected_title)
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

  const mock_camera = { type: `PerspectiveCamera` } as Camera
  test.each([
    { desc: `explicit dpi + camera`, props: { png_dpi: 200, camera: mock_camera } },
    { desc: `default dpi (150), no camera`, props: {} },
  ])(`PNG export button invokes export_canvas_as_png with $desc`, async ({ props }) => {
    mount(StructureExportPane, {
      target: document.body,
      props: {
        structure: simple_structure,
        wrapper: wrapper_div,
        scene: mock_scene,
        ...props,
      },
    })

    const png_btn = get_button(`PNG`)
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))
    png_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_canvas_as_png).toHaveBeenCalledWith(
        wrapper_div.querySelector(`canvas`),
        simple_structure,
        props.png_dpi ?? 150,
        mock_scene,
        props.camera,
      )
    })
  })
})
