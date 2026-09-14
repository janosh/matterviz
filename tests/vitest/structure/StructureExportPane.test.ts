import type { AnyStructure } from '$lib'
import { download } from '$lib/io/fetch'
import app_css from '$lib/app.css?inline'
import { export_canvas_as_png, renderer_registry, scene_registry } from '$lib/io/export'
import {
  camera_flight_registry,
  create_camera_flight_controller,
} from '$lib/scene/camera-flight'
import { export_scene_as } from '$lib/scene'
import { StructureExportPane } from '$lib/structure'
import * as export_funcs from '$lib/structure/export'
import { mount, tick } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import type { ComponentProps } from 'svelte'
import {
  PerspectiveCamera,
  Vector3,
  type Camera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query, mock_canvas_context, simple_structure } from '../setup'

const mount_pane = (props: ComponentProps<typeof StructureExportPane>) =>
  mount(StructureExportPane, {
    target: document.body,
    props: { export_pane_open: true, ...props },
  })

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))

// Mock the export functions
vi.mock(`$lib/structure/export`, async (import_original) => {
  const structure_to_json_str = vi.fn(() => `{"test": "json"}`)
  const structure_to_xyz_str = vi.fn(() => `3\ntest\nH 0 0 0`)
  const structure_to_cif_str = vi.fn(() => `data_test\n_cell_length_a 1.0`)
  const structure_to_poscar_str = vi.fn(() => `test\n1.0\n1 0 0`)
  return {
    ...(await import_original<typeof export_funcs>()),
    create_structure_filename: vi.fn(() => `structure-basename`),
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
vi.mock(`$lib/scene/export`, () => ({ export_scene_as: vi.fn(() => Promise.resolve()) }))

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
    expect(matches, `buttons with title containing "${title_part}"`).toHaveLength(1)
    return matches[0]
  }

  test(`displays text export actions and linked format descriptions`, async () => {
    const validate = vi.spyOn(export_funcs, `xyz_export_unavailable_reason`)
    mount_pane({ structure: simple_structure, export_pane_open: false })
    expect(validate).not.toHaveBeenCalled()
    expect(document.querySelector(`.export-item`)).toBeNull()
    doc_query<HTMLButtonElement>(`.structure-export-toggle`).click()
    await tick()
    expect(validate).toHaveBeenCalledOnce()
    validate.mockRestore()

    const format_labels = [`JSON`, `XYZ`, `CIF`, `POSCAR`]
    for (const label of format_labels) {
      expect(document.body.textContent).toContain(label)
    }

    // 2 buttons per format (download + copy) * 4 formats = 8
    const text_section = Array.from(document.querySelectorAll(`h4`)).find((heading) =>
      heading.textContent?.includes(`Export as text`),
    )?.nextElementSibling
    const buttons = text_section?.querySelectorAll(`button`)
    expect(buttons?.length).toBe(8)
    doc_query(`.export-item span[aria-haspopup]`).dispatchEvent(new MouseEvent(`mouseenter`))
    await vi.waitFor(() =>
      expect(document.querySelector(`.popover a`)?.getAttribute(`href`)).toBe(
        `https://pymatgen.org`,
      ),
    )
  })

  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(`prediction actions require their callbacks (clear=%s, reset=%s)`, (clear, reset) => {
    const on_clear_prediction = vi.fn()
    const on_reset_prediction_surfaces = vi.fn()
    mount_pane({
      prediction: {
        input: simple_structure,
        run_id: 1,
        provenance: { model: `test`, version: `1`, units: {}, settings: {} },
      },
      on_clear_prediction: clear ? on_clear_prediction : undefined,
      on_reset_prediction_surfaces: reset ? on_reset_prediction_surfaces : undefined,
    })
    expect(get_button(`Download Export prediction`).disabled).toBe(false)
    for (const [label, enabled, callback] of [
      [`Clear prediction`, clear, on_clear_prediction],
      [`Reset prediction surfaces`, reset, on_reset_prediction_surfaces],
    ] as const) {
      const button = [...document.querySelectorAll(`button`)].find(
        (candidate) => candidate.textContent === label,
      )
      expect(Boolean(button), label).toBe(enabled)
      button?.click()
      expect(callback).toHaveBeenCalledTimes(enabled ? 1 : 0)
    }
  })

  test.each(
    (
      [
        [`json`, `{"test": "json"}`],
        [`xyz`, `3\ntest\nH 0 0 0`],
        [`cif`, `data_test\n_cell_length_a 1.0`],
        [`poscar`, `test\n1.0\n1 0 0`],
      ] as const
    ).flatMap(([format, content]) =>
      [`Download`, `Copy`].map((action) => ({ format, content, action })),
    ),
  )(
    `$action $format uses its serializer and chosen filename`,
    async ({ format, content, action }) => {
      vi.mocked(download).mockClear()
      mount_pane({ structure: simple_structure })
      const name_input = doc_query<HTMLInputElement>(`.export-destination input`)
      name_input.value = `Relaxed structure`
      name_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      get_button(`${action} ${format.toUpperCase()}`).click()
      const { to_str, ext, mime } = export_funcs.STRUCT_TEXT_FORMATS[format]
      await vi.waitFor(() => {
        expect(to_str).toHaveBeenCalledWith(simple_structure)
        if (action === `Download`)
          expect(download).toHaveBeenCalledWith(content, `Relaxed structure.${ext}`, mime)
        else expect(navigator.clipboard.writeText).toHaveBeenCalledWith(content)
      })
    },
  )

  test(`shows checkmark feedback after successful copy`, async () => {
    vi.useFakeTimers()
    mount_pane({ structure: simple_structure })

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

    mount_pane({ structure: undefined })

    const copy_btn = get_button(`Copy JSON`)
    const download_btn = get_button(`Download JSON`)
    expect(copy_btn.disabled).toBe(true)
    expect(download_btn.disabled).toBe(true)

    copy_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    // Flush microtasks then verify clipboard was not called
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  test(`PNG DPI input seeds the download title and updates it on edit`, async () => {
    mount_pane({ structure: simple_structure, wrapper: wrapper_div, png_dpi: 150 })

    const dpi_input = doc_query<HTMLInputElement>(
      `input[type="number"][title*="dots per inch"]`,
    )
    expect(dpi_input.value).toBe(`150`)
    expect(dpi_input.min).toBe(`50`)
    expect(dpi_input.max).toBe(`600`)
    expect(get_button(`PNG`).title).toContain(`(150 DPI)`)

    // editing the DPI updates the download button's title
    dpi_input.value = `200`
    dpi_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(get_button(`PNG`).title).toContain(`(200 DPI)`)
  })

  test(`PNG and camera flight share canvas readiness and one observer`, async () => {
    wrapper_div.innerHTML = ``
    const style = document.createElement(`style`)
    style.textContent = app_css
    document.body.append(style)
    const observe = vi.spyOn(MutationObserver.prototype, `observe`)
    mount_pane({
      structure: simple_structure,
      wrapper: wrapper_div,
      pane_props: { style: `font-size: 12px` },
    })
    await tick()
    const export_styles = getComputedStyle(doc_query(`.export-pane .pane-content`))
    const flight_styles = getComputedStyle(doc_query(`.camera-flight`))
    expect(export_styles.fontSize).toBe(`12px`)
    expect(flight_styles.fontSize).toBe(export_styles.fontSize)
    const disabled_buttons = () => [
      get_button(`PNG`).disabled,
      doc_query<HTMLButtonElement>(`.camera-flight .actions button`).disabled,
    ]
    expect(observe.mock.calls.filter(([target]) => target === wrapper_div)).toHaveLength(1)
    expect(disabled_buttons()).toEqual([true, true])

    wrapper_div.append(document.createElement(`canvas`))
    await vi.waitFor(() => expect(disabled_buttons()).toEqual([false, false]))

    wrapper_div.innerHTML = ``
    await vi.waitFor(() => expect(disabled_buttons()).toEqual([true, true]))
  })

  test(`replacing a structure discards the previous flight origin`, async () => {
    mock_canvas_context()
    vi.spyOn(HTMLCanvasElement.prototype, `toDataURL`).mockReturnValue(
      `data:image/webp;base64,thumbnail`,
    )
    const canvas = wrapper_div.querySelector(`canvas`)
    if (!canvas) throw new Error(`Missing viewer canvas`)
    const camera = new PerspectiveCamera(50)
    camera.position.set(0, 0, 10)
    const controller = create_camera_flight_controller(
      { object: camera, target: new Vector3() },
      () => ({ width: 800, height: 600 }),
      vi.fn(),
      vi.fn(),
    )
    camera_flight_registry.set(canvas, controller)
    renderer_registry.set(canvas, {
      init: async () => {},
      render: vi.fn(),
    } as unknown as WebGPURenderer)
    scene_registry.set(canvas, { scene: mock_scene, camera })
    const source = writable(simple_structure)
    const structure = fromStore(source)
    mount(StructureExportPane, {
      target: document.body,
      props: {
        get structure() {
          return structure.current
        },
        wrapper: wrapper_div,
        flight_pane_open: true,
      },
    })
    await tick()
    get_button(`Create a complete orbit`).click()
    await vi.waitFor(() => expect(document.querySelectorAll(`.waypoint`)).toHaveLength(9))
    doc_query<HTMLButtonElement>(`[aria-label="Go to view 3"]`).click()
    const home = [...document.querySelectorAll(`button`)].find((button) =>
      button.textContent?.includes(`Return to original view`),
    )
    await vi.waitFor(() => expect(home?.disabled).toBe(false))
    const inspected = controller.capture()
    source.set(structuredClone(simple_structure))
    await vi.waitFor(() => expect(home?.disabled).toBe(true))
    expect(controller.capture()).toEqual(inspected)
  })

  test(`slice export uses its explicit canvas and hides 3D formats`, async () => {
    const slice_canvas = document.createElement(`canvas`)
    mount_pane({
      structure: simple_structure,
      wrapper: wrapper_div,
      image_canvas: slice_canvas,
      image_filename: `charge-density-slice`,
      enable_3d_export: false,
    })

    get_button(`PNG`).click()
    await vi.waitFor(() => {
      expect(export_canvas_as_png).toHaveBeenCalledWith(
        slice_canvas,
        `charge-density-slice`,
        150,
        null,
        null,
        expect.any(Function),
      )
    })
    expect(document.body.textContent).not.toContain(`Export as 3D model`)
  })

  test.each([
    { format: `glb`, label: `GLB` },
    { format: `obj`, label: `OBJ` },
  ] as const)(
    `$label 3D export hands the scene to export_scene_as`,
    async ({ format, label }) => {
      vi.mocked(export_scene_as).mockClear()
      mount_pane({ structure: simple_structure, scene: mock_scene })

      const download_btn = get_button(`Download ${label}`)
      expect(download_btn.disabled).toBe(false)

      download_btn.dispatchEvent(new Event(`click`, { bubbles: true }))
      await vi.waitFor(() =>
        expect(export_scene_as).toHaveBeenCalledWith(
          mock_scene,
          format,
          `structure-basename`,
          expect.any(Function),
        ),
      )
      expect(export_funcs.create_structure_filename).toHaveBeenCalledWith(simple_structure)
    },
  )

  test(`3D export buttons are disabled without scene`, () => {
    mount_pane({ structure: simple_structure, scene: undefined })
    expect(get_button(`Download GLB`).disabled).toBe(true)
    expect(get_button(`Download OBJ`).disabled).toBe(true)
  })

  test.each([
    [false, `Export Structure`],
    [true, ``],
  ])(`toggle button title when export_pane_open=%s`, (export_pane_open, expected_title) => {
    mount_pane({ export_pane_open })
    expect(doc_query(`.structure-export-toggle`).title).toBe(expected_title)
  })

  test(`handles clipboard API errors gracefully`, async () => {
    const console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const clipboard_error = new Error(`Clipboard API not available`)

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValueOnce(clipboard_error) },
    })

    mount_pane({ structure: simple_structure })

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

  test.each([
    null,
    [
      [NaN, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
  ])(`invalid lattice %s disables formats that require it`, (matrix) => {
    const structure = {
      sites: simple_structure.sites.map(({ abc: _abc, ...site }) => site),
      ...(matrix && { lattice: { matrix } }),
    } as AnyStructure
    mount_pane({ structure })

    for (const label of [`CIF`, `POSCAR`]) {
      for (const action of [`Download`, `Copy`]) {
        const button = get_button(`${action} ${label}`)
        expect(button.disabled, label).toBe(true)
        expect(button.title, label).toContain(`unit cell`)
        const hint_id = button.getAttribute(`aria-describedby`)
        expect(hint_id).toBeTypeOf(`string`)
        expect(document.querySelector(`[id="${hint_id}"]`)?.textContent).toContain(`unit cell`)
      }
    }
    expect(document.body.textContent).toContain(
      matrix
        ? matrix[2][2] === 0
          ? `nonsingular unit cell`
          : `finite 3x3 lattice matrix`
        : `this structure has no lattice`,
    )
    for (const label of [`JSON`, `XYZ`]) {
      const disabled =
        label === `XYZ` &&
        Boolean(matrix?.some((row) => row.some((value) => !Number.isFinite(value))))
      expect(get_button(`Download ${label}`).disabled, label).toBe(disabled)
      expect(get_button(`Copy ${label}`).disabled, label).toBe(disabled)
    }
  })

  test.each([`abc`, `xyz`] as const)(
    `invalid %s disables only the format using those coordinates`,
    (source) => {
      const structure = {
        ...simple_structure,
        sites: simple_structure.sites.map((site) => ({ ...site, [source]: [NaN, 0, 0] })),
      }
      mount_pane({ structure })
      for (const label of [`XYZ`, `CIF`, `POSCAR`]) {
        const disabled = source === `xyz` ? label === `XYZ` : label !== `XYZ`
        for (const action of [`Download`, `Copy`]) {
          const button = get_button(`${action} ${label}`)
          expect(button.disabled).toBe(disabled)
          if (disabled) {
            expect(button.title).toContain(`three finite numeric components`)
            expect(
              document.querySelector(`[id="${button.getAttribute(`aria-describedby`)}"]`)
                ?.textContent,
            ).toContain(`three finite numeric components`)
          }
        }
      }
    },
  )

  test.each([`Download`, `Copy`])(
    `a throwing serializer on %s is logged, not thrown from the click handler`,
    (action) => {
      vi.mocked(export_funcs.STRUCT_TEXT_FORMATS.cif.to_str).mockImplementationOnce(() => {
        throw new Error(`serializer exploded`)
      })
      const console_error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
      mount_pane({ structure: simple_structure })

      expect(() => get_button(`${action} CIF`).click()).not.toThrow()
      expect(console_error_spy).toHaveBeenCalledWith(
        expect.stringContaining(
          action === `Download`
            ? `Export structure-basename failed`
            : `Failed to copy CIF to clipboard`,
        ),
        expect.any(Error),
      )
      console_error_spy.mockRestore()
    },
  )

  test(`custom props are applied correctly`, () => {
    mount_pane({
      pane_props: { style: `max-height: 400px`, class: `custom-export-pane` },
      export_pane_open: false,
      toggle_props: { class: `custom-export-toggle` },
    })

    const pane = doc_query(`.export-pane`)
    expect(pane.classList.contains(`custom-export-pane`)).toBe(true)
    expect(pane.style.maxHeight).toBe(`400px`)

    const toggle = doc_query(`.structure-export-toggle`)
    expect(toggle.classList.contains(`custom-export-toggle`)).toBe(true)
    expect(toggle.querySelector(`svg`)).not.toBeNull()
  })

  const mock_camera = { type: `PerspectiveCamera` } as Camera
  test.each([
    { desc: `explicit dpi + camera`, props: { png_dpi: 200, camera: mock_camera } },
    { desc: `default dpi (150), no camera`, props: {} },
  ])(`PNG export button invokes export_canvas_as_png with $desc`, async ({ props }) => {
    mount_pane({
      structure: simple_structure,
      wrapper: wrapper_div,
      scene: mock_scene,
      ...props,
    })

    const png_btn = get_button(`PNG`)
    await vi.waitFor(() => expect(png_btn?.disabled).toBe(false))
    png_btn?.dispatchEvent(new Event(`click`, { bubbles: true }))

    await vi.waitFor(() => {
      expect(export_canvas_as_png).toHaveBeenCalledWith(
        wrapper_div.querySelector(`canvas`),
        `structure-basename`,
        props.png_dpi ?? 150,
        mock_scene,
        props.camera,
        expect.any(Function),
      )
    })
  })
})

test(`prediction export reports invalid metadata in the pane`, async () => {
  mount_pane({
    prediction: {
      input: simple_structure,
      run_id: 1,
      provenance: { model: `test`, version: `1`, units: {}, settings: { invalid: new Map() } },
    },
  })
  doc_query<HTMLButtonElement>(`button[title="Download Export prediction"]`).click()
  await tick()
  expect(doc_query(`[role="alert"]`).textContent).toContain(`provenance.settings.invalid`)
  expect(doc_query(`[role="alert"]`).textContent).toContain(`retry`)
})
