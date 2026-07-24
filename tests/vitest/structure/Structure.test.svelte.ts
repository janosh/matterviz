import { type AnyStructure, type MeasureMode, Structure } from '$lib'
import type { VolumetricData } from '$lib/isosurface'
import type { StructureBond, StructureHandlerData } from '$lib/structure'
import { get_element_counts } from '$lib/structure'
import { make_supercell } from '$lib/structure/supercell'
import { structures } from '$site/structures'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  assertHoverScopedShortcut,
  bind_props,
  doc_query,
  make_grid,
  make_volume,
  press_window_key,
} from '../setup'

// Passthrough spy so individual tests can make make_supercell throw
vi.mock(`$lib/structure/supercell`, async (import_original) => {
  const original = await import_original<Record<string, unknown>>()
  return {
    ...original,
    make_supercell: vi.fn(original.make_supercell as typeof make_supercell),
  }
})

const structure = structures[0]

// Mount Structure into document.body (queries are left to each test via doc_query)
const mount_structure = (props: ComponentProps<typeof Structure>): void => {
  mount(Structure, { target: document.body, props })
}

const select_structure_layout = async (label: string): Promise<void> => {
  doc_query<HTMLButtonElement>(`button[aria-label^="View layout:"]`).click()
  await tick()
  const option = Array.from(
    document.querySelectorAll<HTMLButtonElement>(`.view-layout-dropdown .view-mode-option`),
  ).find((button) => button.textContent?.trim() === label)
  if (!option) throw new Error(`Missing structure layout option: ${label}`)
  option.click()
  flushSync()
  await tick()
}

const set_aria_input = (aria_label: string, value: string): void => {
  const input = doc_query<HTMLInputElement>(`input[aria-label="${aria_label}"]`)
  input.value = value
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
}

// Shared test utilities to reduce duplication
const SAMPLE_POSCAR_CONTENT = `BaTiO3 tetragonal
1.0
4.0 0.0 0.0
0.0 4.0 0.0
0.0 0.0 4.0
Ba Ti O
1 1 3
Direct
0.0 0.0 0.0
0.5 0.5 0.5
0.5 0.5 0.0
0.5 0.0 0.5
0.0 0.5 0.5`
const SAMPLE_CHGCAR_CONTENT = `test
1.0
1 0 0
0 1 0
0 0 1
H
1
Direct
0 0 0

2 2 2
1 2 3 4 5 6 7 8`
const volumetric_data = [
  make_volume(
    make_grid(2, 2, 2, (x_idx, y_idx, z_idx) => 4 * x_idx + 2 * y_idx + z_idx),
    {
      lattice: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      data_range: { min: 0, max: 7, abs_max: 7, mean: 3.5 },
      label: `Charge density`,
    },
  ),
]

const mount_volumetric = (
  overrides: Partial<ComponentProps<typeof Structure>> = {},
): ComponentProps<typeof Structure> => {
  const props = $state<ComponentProps<typeof Structure>>({
    structure,
    volumetric_data,
    ...overrides,
  })
  mount_structure(props)
  return props
}

const create_drop_event = (files: File[]): DragEvent => {
  const drag_event = new DragEvent(`drop`)
  Object.defineProperty(drag_event, `dataTransfer`, {
    value: { files, getData: () => `` },
  })
  return drag_event
}

const mock_fetch_response = (content: string, headers?: HeadersInit): void => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(content, { headers }))
}

// Tests for Structure component functionality
describe(`Structure`, () => {
  // Regression: bond-edit identity tokens (structure_identity) were stored in
  // deeply-proxied $state, so comparing them against the raw `structure` prop
  // triggered state_proxy_equality_mismatch on mount. They must use $state.raw.
  test(`mount does not emit state_proxy_equality_mismatch warning`, async () => {
    const warns: string[] = []
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(` `))
    })
    try {
      mount_structure({ structure })
      flushSync()
      await tick()
      flushSync()
    } finally {
      warn_spy.mockRestore()
    }
    const proxy_warns = warns.filter((warn) =>
      /state_proxy_equality_mismatch|effect_update_depth/i.test(warn),
    )
    expect(proxy_warns).toEqual([])
  })

  test(`switches a volumetric structure between shared 3D and slice views`, async () => {
    const on_slice_settings_change = vi.fn()
    const on_display_mode_change = vi.fn()
    const props = mount_volumetric({
      show_controls: `always`,
      display_mode: `structure`,
      slice_settings: { plane_mode: `hkl`, resolution: 2 },
      on_slice_settings_change,
      on_display_mode_change,
    })
    await tick()

    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeNull()

    await select_structure_layout(`2D cross-section`)

    expect(props.display_mode).toBe(`slice`)
    expect(on_display_mode_change).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ display_mode: `slice`, active_volume_idx: 0 }),
    )
    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(`button[title="Measure / Edit"]`)).toBeNull()

    const controls_toggle = doc_query<HTMLButtonElement>(`button.structure-controls-toggle`)
    controls_toggle.click()
    await tick()
    expect(document.querySelector(`.controls-pane`)).toBeInstanceOf(HTMLElement)
    const plane_select = doc_query<HTMLSelectElement>(`select[aria-label="Slice plane mode"]`)
    expect(plane_select.value).toBe(`hkl`)
    set_aria_input(`Slice resolution`, `3`)
    await tick()
    expect(on_slice_settings_change).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ plane_mode: `hkl`, resolution: 3 }),
    )
    expect(props.slice_settings).toEqual(
      expect.objectContaining({ plane_mode: `hkl`, resolution: 3 }),
    )

    for (const [value, color_range] of [
      [`1`, [1, 7]],
      [``, undefined],
    ] as const) {
      set_aria_input(`Slice color minimum`, value)
      await tick()
      expect(props.slice_settings?.color_range).toEqual(color_range)
    }
  })

  test(`reports externally bound volumetric view changes`, async () => {
    const on_display_mode_change = vi.fn()
    const on_slice_settings_change = vi.fn()
    const props = mount_volumetric({
      display_mode: `structure`,
      slice_settings: { plane_mode: `hkl`, resolution: 2 },
      on_display_mode_change,
      on_slice_settings_change,
    })
    await tick()

    expect(on_display_mode_change).not.toHaveBeenCalled()
    expect(on_slice_settings_change).not.toHaveBeenCalled()

    props.display_mode = `slice`
    props.slice_settings = { plane_mode: `cartesian`, resolution: 4 }
    await tick()
    expect(on_display_mode_change).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ display_mode: `slice`, active_volume_idx: 0 }),
    )

    expect(on_slice_settings_change).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        plane_mode: `cartesian`,
        resolution: 4,
        cartesian_normal: [0, 0, 1],
      }),
    )
  })

  test(`renders slice mode for volume-only data with no atomic sites`, async () => {
    mount_volumetric({
      structure: { ...structure, sites: [] },
      display_mode: `slice`,
      slice_settings: { plane_mode: `hkl`, resolution: 2 },
    })
    await tick()

    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeInstanceOf(HTMLElement)
    expect(document.body.textContent).not.toContain(`No sites found in structure`)
  })

  test(`keeps a 3D escape when volumes clear with the view control hidden`, async () => {
    const props = mount_volumetric({
      display_mode: `slice`,
      slice_settings: { resolution: 2 },
      show_controls: { mode: `always`, hidden: [`view-mode`] },
    })
    await tick()

    props.volumetric_data = []
    await tick()
    await select_structure_layout(`3D single view`)

    expect(props.display_mode).toBe(`structure`)
    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeNull()
  })

  test(`clamps stale active volume indices with controls closed`, async () => {
    const on_active_volume_idx_change = vi.fn()
    const props = mount_volumetric({
      active_volume_idx: 9,
      display_mode: `slice`,
      slice_settings: { resolution: 2 },
      on_active_volume_idx_change,
    })
    await tick()

    expect(props.active_volume_idx).toBe(0)
    expect(on_active_volume_idx_change).toHaveBeenCalledWith(
      expect.objectContaining({ active_volume_idx: 0, display_mode: `slice` }),
    )
    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeInstanceOf(HTMLElement)
  })

  test(`hides atom color mode toggle until viewer hover or focus`, async () => {
    mount_structure({ structure })
    await tick()

    const viewer = doc_query(`.structure`)
    const mode_toggle = doc_query<HTMLButtonElement>(`.atom-legend .mode-toggle`)
    expect(getComputedStyle(mode_toggle).opacity).toBe(`0`)
    expect(mode_toggle.tabIndex).toBe(-1)
    expect(viewer.classList.contains(`gizmo-visible`)).toBe(false)

    viewer.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    await tick()
    // fully opaque (not a dim peek) so it's clearly discoverable on viewer hover/focus
    expect(getComputedStyle(mode_toggle).opacity).toBe(`1`)
    expect(mode_toggle.tabIndex).toBe(0)
    expect(viewer.classList.contains(`gizmo-visible`)).toBe(true)

    viewer.dispatchEvent(new FocusEvent(`focusout`, { bubbles: true }))
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`0`)
    expect(viewer.classList.contains(`gizmo-visible`)).toBe(false)

    viewer.dispatchEvent(new MouseEvent(`mouseenter`))
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`1`)
    expect(viewer.classList.contains(`gizmo-visible`)).toBe(true)
  })

  test(`window keydown shortcuts are scoped to the hovered viewer`, async () => {
    const state = { info_pane_open: false }
    mount_structure(bind_props({ structure, enable_info_pane: true }, state))
    await tick()

    await assertHoverScopedShortcut({
      viewer: doc_query(`.structure`),
      fire: () => press_window_key({ key: `i`, ctrlKey: true }),
      read_state: () => state.info_pane_open,
    })
  })

  test(`hover keydown path bails in edit modes so destructive keys need focus`, async () => {
    const state = { info_pane_open: false, measure_mode: `edit-atoms` as MeasureMode }
    mount_structure(bind_props({ structure, enable_info_pane: true }, state))
    await tick()
    expect(state.measure_mode, `edit-atoms should stick for a plain structure`).toBe(
      `edit-atoms`,
    )

    doc_query(`.structure`).dispatchEvent(new MouseEvent(`mouseenter`))
    await tick()
    // hovered (not focused) + edit mode → window forwarder ignores the key
    press_window_key({ key: `i`, ctrlKey: true })
    expect(state.info_pane_open, `hover path ignored in edit mode`).toBe(false)
  })

  test(`edit-atoms Delete removes selected atom + remaps bonds, undo restores both`, async () => {
    // Deleting site 0 drops its bond and shifts the 1-2 bond down to 0-1; undo
    // must restore both structure sites and the remapped bindable bonds prop
    const orig_bonds: StructureBond[] = [
      { site_idx_1: 0, site_idx_2: 1, order: 1 },
      { site_idx_1: 1, site_idx_2: 2, order: 2 },
    ]
    const state = {
      structure: structures[0],
      bonds: structuredClone(orig_bonds),
      selected_sites: [] as number[],
    }
    const edit_props: { measure_mode: MeasureMode } = { measure_mode: `edit-atoms` }
    mount_structure(bind_props(edit_props, state))
    await tick()
    state.selected_sites = [0] // select after mount (on-load effect clears selection)
    const n_before = state.structure.sites.length

    // dispatch on the viewer (focused/element path) — handle_and_prevent should run
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent(`keydown`, { cancelable: true, bubbles: true, ...init })
      doc_query(`.structure`).dispatchEvent(event)
      return event
    }
    const delete_event = press({ key: `Delete` })
    await tick()
    expect(delete_event.defaultPrevented, `Delete should be handled`).toBe(true)
    expect(state.structure.sites).toHaveLength(n_before - 1)
    expect(state.bonds).toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])

    press({ key: `z`, ctrlKey: true })
    await tick()
    expect(state.structure.sites).toHaveLength(n_before)
    expect(state.bonds).toEqual(orig_bonds)
  })

  test.each([
    [{ supercell_scaling: `2x1x1` }, true],
    [{ supercell_scaling: `invalid` }, false],
    [{ supercell_scaling: `1×1×1` }, false],
    [{ cell_type: `conventional` }, true],
  ] as const)(
    `sets edit-bonds availability for %o to disabled=%s`,
    async (props, disabled) => {
      const state = { measure_mode: `distance` as MeasureMode }
      mount_structure(bind_props({ structure, show_controls: true, ...props }, state))

      const measure_btn = doc_query<HTMLButtonElement>(`button[title="Measure / Edit"]`)
      // icon-only button needs an accessible name (title alone is unreliable for AT)
      expect(measure_btn.getAttribute(`aria-label`)).toBe(`Measure / Edit`)
      measure_btn.click()
      await tick()
      const edit_bonds_button = [
        ...document.querySelectorAll<HTMLButtonElement>(`.view-mode-option`),
      ].find((button) => button.textContent?.includes(`Edit Bonds`))

      expect(edit_bonds_button).toBeDefined()
      expect(edit_bonds_button?.disabled).toBe(disabled)
      edit_bonds_button?.click()
      await tick()
      expect(state.measure_mode).toBe(disabled ? `distance` : `edit-bonds`)
    },
  )

  test(`falls back to untransformed structure when make_supercell throws`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    vi.mocked(make_supercell).mockImplementation(() => {
      throw new Error(`malformed scaling matrix`)
    })
    try {
      const state = { measure_mode: `edit-bonds` as MeasureMode }
      mount_structure(bind_props({ structure, supercell_scaling: `2x2x2` }, state))

      await vi.waitFor(() => {
        // error log proves make_supercell was called, threw, and was caught
        expect(error_spy).toHaveBeenCalledWith(
          `Failed to create supercell:`,
          expect.any(Error),
        )
        // legend reflects the untransformed base structure, not 8x supercell counts
        const legend_total = [
          ...document.querySelectorAll(`.element-legend .legend-item sub`),
        ].reduce((total, sub) => total + Number(sub.textContent), 0)
        const base_total = Object.values(get_element_counts(structure)).reduce(
          (total, amt) => total + amt,
          0,
        )
        expect(legend_total).toBe(base_total)
      })
      expect(state.measure_mode).toBe(`edit-bonds`)
    } finally {
      vi.mocked(make_supercell).mockReset()
      error_spy.mockRestore()
    }
  })

  test(`shows safe bond editing controls by default`, async () => {
    mount_structure({ structure, measure_mode: `edit-bonds`, show_controls: true })
    await tick()

    expect(doc_query(`.bond-edit-toolbar`)).toBeInstanceOf(HTMLElement)
    const selector = `.bond-edit-mode-toggle button[aria-pressed="true"]`
    const active_button = doc_query<HTMLButtonElement>(selector)
    const order_select = doc_query<HTMLSelectElement>(`.bond-edit-toolbar select`)
    expect(active_button.textContent).toContain(`Add`)
    expect(order_select.value).toBe(`1`)
    doc_query<HTMLButtonElement>(`.bond-edit-mode-toggle button[title^="Delete"]`).click()
    await tick()
    expect(doc_query<HTMLButtonElement>(selector).textContent).toContain(`Delete`)
    expect(document.querySelector(`.bond-edit-toolbar select`)).toBeNull()
    expect(
      doc_query<HTMLButtonElement>(`button[aria-label="Undo bond edit (Cmd/Ctrl+Z)"]`)
        .disabled,
    ).toBe(true)
  })

  test.each([
    { mode: `distance`, shows_limit: true },
    { mode: `angle`, shows_limit: true },
    { mode: `edit-bonds`, shows_limit: false },
    { mode: `edit-atoms`, shows_limit: false },
  ] as const)(
    `selection limit badge visibility in $mode mode`,
    async ({ mode, shows_limit }) => {
      mount_structure({
        structure,
        measured_sites: [0, 1, 2, 3, 4, 5, 6, 7],
        measure_mode: mode,
        show_controls: true,
      })
      await tick()

      expect(document.querySelector(`.selection-limit-text`) != null).toBe(shows_limit)
    },
  )

  test.each<{
    mode: MeasureMode
    measured_sites: number[]
    selected_sites: number[]
    shows_reset: boolean
  }>([
    { mode: `distance`, measured_sites: [0], selected_sites: [], shows_reset: true },
    { mode: `angle`, measured_sites: [0], selected_sites: [], shows_reset: true },
    { mode: `edit-bonds`, measured_sites: [0], selected_sites: [0], shows_reset: false },
  ])(
    `selection controls visibility in $mode mode`,
    async ({ mode, measured_sites, selected_sites, shows_reset }) => {
      mount_structure({
        structure,
        measured_sites,
        selected_sites,
        measure_mode: mode,
        show_controls: true,
      })
      await tick()

      expect(
        document.querySelector(`button[aria-label="Reset selection and bond edits"]`) != null,
      ).toBe(shows_reset)
    },
  )

  test(`toggle fullscreen mode`, async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined)
    const exitFullscreenMock = vi.fn()

    mount_structure({ structure, show_controls: true })

    // Find the wrapper element that was created by the component
    const wrapper = doc_query(`.structure`)

    // Mock wrapper element
    wrapper.requestFullscreen = requestFullscreenMock
    document.exitFullscreen = exitFullscreenMock
    await tick()

    // Click the fullscreen button
    const fullscreen_button = doc_query<HTMLButtonElement>(`.fullscreen-toggle`)

    fullscreen_button.click()

    expect(requestFullscreenMock).toHaveBeenCalledOnce()

    // Simulate fullscreen mode
    Object.defineProperty(document, `fullscreenElement`, {
      value: wrapper,
      configurable: true,
    })

    fullscreen_button.click()
    expect(exitFullscreenMock).toHaveBeenCalledOnce()

    // Reset fullscreenElement
    Object.defineProperty(document, `fullscreenElement`, {
      value: null,
      configurable: true,
    })
  })

  test(`drag and drop passes content and metadata to on_file_drop`, async () => {
    const filename = `test.poscar`
    const on_file_drop = vi.fn()
    mount_structure({
      structure: undefined,
      show_controls: true,
      on_file_drop,
    })

    doc_query(`.structure`).dispatchEvent(
      create_drop_event([new File([SAMPLE_POSCAR_CONTENT], filename)]),
    )
    await vi.waitFor(() =>
      expect(on_file_drop).toHaveBeenCalledWith(
        SAMPLE_POSCAR_CONTENT,
        filename,
        expect.objectContaining({ source_filename: filename }),
      ),
    )
  })

  test(`drag and drop without on_file_drop handler parses the file internally`, async () => {
    // No on_file_drop → component parses the dropped file itself and emits on_file_load.
    // Awaiting the callback is deterministic (no DOM polling), unlike a rendered-text race.
    const on_file_load = vi.fn<(data: StructureHandlerData) => void>()
    mount_structure({
      structure: undefined,
      show_controls: true,
      on_file_load,
    })

    const file = new File([SAMPLE_POSCAR_CONTENT], `test.poscar`, { type: `text/plain` })
    doc_query(`.structure`).dispatchEvent(create_drop_event([file]))

    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const loaded = on_file_load.mock.calls[0][0]
    expect(loaded).toMatchObject({ filename: `test.poscar`, total_atoms: 5 })
    const elements = loaded.structure?.sites.map((site) => site.species[0].element)
    expect(elements).toEqual(expect.arrayContaining([`Ba`, `Ti`, `O`]))
  })

  test(`info pane site hover updates highlighted sites`, async () => {
    const state = {
      highlighted_sites: [] as number[],
      hovered_site_idx: null as number | null,
      selected_sites: [] as number[],
    }

    mount_structure(
      bind_props({ structure, info_pane_open: true, show_controls: true }, state),
    )
    await tick()

    const first_site_row = document.querySelector(
      `.site-card[title^="Click to select ${structure.sites[0].species[0].element}1"]`,
    ) as HTMLDivElement
    expect(first_site_row).toBeInstanceOf(HTMLDivElement)

    first_site_row.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    expect(state.highlighted_sites).toEqual([0])
    expect(state.hovered_site_idx).toBe(0)

    first_site_row.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(state.highlighted_sites).toEqual([])
    expect(state.hovered_site_idx).toBeNull()

    first_site_row.click()
    expect(state.selected_sites).toEqual([0])
  })
})

describe(`Structure empty states`, () => {
  test.each([
    [`undefined structure`, undefined, `No structure provided`],
    [`structure without sites`, {}, `No sites found in structure`],
    [`structure with null sites`, { sites: null }, `No sites found in structure`],
    [`structure with empty sites`, { sites: [] }, `No sites found in structure`],
  ])(`shows the expected message for %s`, (_description, test_structure, message) => {
    mount_structure({ structure: test_structure as AnyStructure })
    expect(document.body.textContent).toContain(message)
  })
})

test(`camera projection and auto-rotate controls reflect scene_props`, async () => {
  const scene_props = { camera_projection: `perspective` as const, auto_rotate: 0.5 }
  mount_structure({ structure, controls_open: true, show_controls: true, scene_props })
  await tick()

  const projection_label = [...document.querySelectorAll(`label`)].find((label) =>
    label.textContent?.includes(`Projection`),
  )
  const projection_select = projection_label?.querySelector(`select`) as HTMLSelectElement
  expect(projection_select.value).toBe(`perspective`)
  expect([...projection_select.options].map((option) => option.value)).toEqual([
    `perspective`,
    `orthographic`,
  ])

  const auto_rotate_input = document.querySelector(
    `.controls-pane input[type="number"][max="2"]`,
  ) as HTMLInputElement
  expect(Number(auto_rotate_input.value)).toBeCloseTo(0.5, 1)
})

// Atom label controls tests
describe(`atom label controls`, () => {
  test(`controls reflect scene_props bindings`, () => {
    mount_structure({
      structure,
      controls_open: true,
      show_controls: true,
      scene_props: {
        show_site_labels: true,
        site_label_offset: [0.2, -0.5, 0.8],
        site_label_size: 1.2,
        site_label_padding: 4,
      },
    })

    const offset_inputs = document.querySelectorAll<HTMLInputElement>(
      `input[type="number"][min="-1"][max="1"][step="0.1"]`,
    )
    expect([...offset_inputs].map((input) => Number(input.value))).toEqual([0.2, -0.5, 0.8])

    const size_input = document.querySelector<HTMLInputElement>(
      `input[type="range"][min="0.5"][max="2"][step="0.1"]`,
    )
    const padding_input = document.querySelector<HTMLInputElement>(
      `input[type="number"][min="0"][max="10"][step="1"]`,
    )

    expect(size_input?.valueAsNumber).toBeCloseTo(1.2, 1)
    expect(padding_input?.valueAsNumber).toBe(4)
  })

  test(`state isolation between instances works`, async () => {
    // Mount first instance
    mount_structure({
      structure,
      controls_open: true,
      show_controls: true,
      scene_props: { show_site_labels: true, site_label_offset: [0, 0.75, 0.2] },
    })

    // Mount second instance
    mount_structure({
      structure,
      controls_open: true,
      show_controls: true,
      scene_props: { show_site_labels: true, site_label_offset: [0, 0.75, 0.7] },
    })

    const all_offset_inputs = document.querySelectorAll(
      `input[type="number"][min="-1"][max="1"][step="0.1"]`,
    )
    expect(all_offset_inputs.length).toBeGreaterThanOrEqual(6)

    const instance1_z = all_offset_inputs[2] as HTMLInputElement
    const instance2_z = all_offset_inputs[5] as HTMLInputElement

    expect(Number(instance1_z.value)).toBeCloseTo(0.2, 1)
    expect(Number(instance2_z.value)).toBeCloseTo(0.7, 1)

    instance1_z.value = `0.9`
    instance1_z.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()

    expect(Number(instance1_z.value)).toBeCloseTo(0.9, 1)
    expect(Number(instance2_z.value)).toBeCloseTo(0.7, 1)
  })
})

describe(`Structure string parsing`, () => {
  afterEach(() => vi.unstubAllGlobals())

  test(`loads structure_string and emits parsed structure metadata`, async () => {
    const state = $state<{ structure?: AnyStructure; loading: boolean }>({
      structure: undefined,
      loading: false,
    })
    const on_file_load = vi.fn<(data: StructureHandlerData) => void>()
    mount_structure(
      bind_props({ structure_string: SAMPLE_POSCAR_CONTENT, on_file_load }, state),
    )

    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledOnce())
    const load_data = on_file_load.mock.calls[0][0]
    expect(state.structure?.sites).toHaveLength(5)
    expect(new Set(state.structure?.sites.map((site) => site.species[0].element))).toEqual(
      new Set([`Ba`, `Ti`, `O`]),
    )
    expect(state.structure).toHaveProperty(`lattice`)
    expect(state.loading).toBe(false)
    expect(load_data).toMatchObject({
      total_atoms: 5,
      filename: `string`,
      file_size: new Blob([SAMPLE_POSCAR_CONTENT]).size,
    })
  })

  test(`reports invalid structure_string content`, async () => {
    const on_error = vi.fn()
    mount_structure({
      structure_string: `not parseable`,
      on_error,
    })
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledOnce())
  })

  test(`prioritizes data_url over structure_string`, async () => {
    let load_data: StructureHandlerData | undefined
    mock_fetch_response(SAMPLE_POSCAR_CONTENT)
    mount_structure({
      data_url: `/test.poscar`,
      structure_string: `ignored`,
      on_file_load: (data: StructureHandlerData) => (load_data = data),
    })
    await vi.waitFor(() => expect(load_data).toBeDefined())
    expect(load_data?.filename).toBe(`test.poscar`)
    expect(load_data?.source_filename).toBe(`test.poscar`)
    expect(load_data?.source_url).toBe(`/test.poscar`)
  })

  test(`keeps loading active until async data_url handlers finish`, async () => {
    mock_fetch_response(SAMPLE_POSCAR_CONTENT)
    let resolve_drop!: () => void
    const drop_done = new Promise<void>((resolve) => (resolve_drop = resolve))
    const on_file_drop = vi.fn(() => drop_done)
    const state = { loading: false }
    mount_structure(bind_props({ data_url: `/test.poscar`, on_file_drop }, state))

    await vi.waitFor(() => expect(on_file_drop).toHaveBeenCalledOnce())
    expect(state.loading).toBe(true)
    resolve_drop()
    await vi.waitFor(() => expect(state.loading).toBe(false))
  })

  test(`reports async data_url handler failures`, async () => {
    mock_fetch_response(SAMPLE_POSCAR_CONTENT)
    const on_error = vi.fn()
    const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      mount_structure({
        data_url: `/test.poscar`,
        on_file_drop: async () => {
          throw new Error(`handler failed`)
        },
        on_error,
      })
      await vi.waitFor(() =>
        expect(on_error).toHaveBeenCalledWith({
          error_msg: `Failed to load structure: handler failed`,
          filename: `test.poscar`,
        }),
      )
    } finally {
      console_error.mockRestore()
    }
  })

  test(`keeps compressed source identity separate from the logical filename`, async () => {
    mock_fetch_response(SAMPLE_POSCAR_CONTENT, { 'content-encoding': `gzip` })
    let load_data: StructureHandlerData | undefined
    mount_structure({
      data_url: `/test.poscar.gz`,
      on_file_load: (data: StructureHandlerData) => (load_data = data),
    })

    await vi.waitFor(() => expect(load_data).toBeDefined())
    expect(load_data?.filename).toBe(`test.poscar`)
    expect(load_data?.source_filename).toBe(`test.poscar.gz`)
    expect(load_data?.source_url).toBe(`/test.poscar.gz`)
  })

  test(`keeps compressed volumetric source identity separate from its dedupe key`, async () => {
    mock_fetch_response(SAMPLE_CHGCAR_CONTENT, { 'content-encoding': `gzip` })
    const state = { volumetric_data: undefined as VolumetricData[] | undefined }
    mount_structure(bind_props({ data_url: `/density.CHGCAR.gz` }, state))

    await vi.waitFor(() => expect(state.volumetric_data).toHaveLength(1))
    expect(state.volumetric_data?.[0]).toMatchObject({
      source: `density.CHGCAR`,
      source_filename: `density.CHGCAR.gz`,
    })
  })

  const structure_json = (element: string, count = 1) =>
    JSON.stringify({
      sites: Array.from({ length: count }, (_, idx) => ({
        species: [{ element, occu: 1, oxidation_state: 0 }],
        abc: [0, 0, 0],
        xyz: [idx, 0, 0],
        label: `${element}${idx + 1}`,
        properties: {},
      })),
    })
  const request_url = (url: string | URL | Request) =>
    typeof url === `string` ? url : url instanceof URL ? url.href : url.url

  test(`reloads URL-owned structure when data_url changes`, async () => {
    const loaded_elements: string[] = []
    const fetch_mock = vi.fn(async (url: string | URL | Request) => {
      const href = request_url(url)
      return new Response(structure_json(href.includes(`b.json`) ? `He` : `H`))
    })
    vi.stubGlobal(`fetch`, fetch_mock)
    const props = $state<ComponentProps<typeof Structure>>({
      data_url: `/a.json`,
      on_file_load: (data: StructureHandlerData) =>
        loaded_elements.push(data.structure?.sites[0]?.species[0]?.element ?? ``),
    })
    mount_structure(props)
    await vi.waitFor(() => expect(loaded_elements).toEqual([`H`]))

    props.data_url = `/b.json`
    await vi.waitFor(() => expect(fetch_mock).toHaveBeenCalledWith(`/b.json`))
    await vi.waitFor(() => expect(loaded_elements).toEqual([`H`, `He`]))
  })

  test(`caller-supplied structure takes precedence over data_url`, async () => {
    const fetch_mock = vi.fn()
    vi.stubGlobal(`fetch`, fetch_mock)
    mount_structure({ data_url: `/ignored.json`, structure })
    await tick()
    expect(fetch_mock).not.toHaveBeenCalled()
  })

  test(`ignores a stale structure URL completion`, async () => {
    const responses = new Map<string, (response: Response) => void>()
    const fetch_mock = vi.fn(
      (url: string | URL | Request) =>
        new Promise<Response>((resolve) => responses.set(request_url(url), resolve)),
    )
    vi.stubGlobal(`fetch`, fetch_mock)
    const on_file_load = vi.fn()
    const props = $state<ComponentProps<typeof Structure>>({
      data_url: `/a.json`,
      on_file_load,
    })
    mount_structure(props)
    await vi.waitFor(() => expect(responses.has(`/a.json`)).toBe(true))

    props.data_url = `/b.json`
    await vi.waitFor(() => expect(responses.has(`/b.json`)).toBe(true))
    responses.get(`/b.json`)?.(new Response(structure_json(`He`)))
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))

    responses.get(`/a.json`)?.(new Response(structure_json(`H`)))
    await tick()
    expect(on_file_load).toHaveBeenCalledTimes(1)
    expect(on_file_load.mock.calls[0][0].structure?.sites[0]?.species[0]?.element).toBe(`He`)
  })

  test(`on_error reports the requested URL, not a superseded data_url`, async () => {
    const responses = new Map<
      string,
      { resolve: (response: Response) => void; reject: (error: Error) => void }
    >()
    const fetch_mock = vi.fn(
      (url: string | URL | Request) =>
        new Promise<Response>((resolve, reject) => {
          responses.set(request_url(url), { resolve, reject })
        }),
    )
    vi.stubGlobal(`fetch`, fetch_mock)
    const on_error = vi.fn()
    const props = $state<ComponentProps<typeof Structure>>({
      data_url: `/a.json`,
      on_error,
    })
    mount_structure(props)
    await vi.waitFor(() => expect(responses.has(`/a.json`)).toBe(true))

    props.data_url = `/b.json`
    await vi.waitFor(() => expect(responses.has(`/b.json`)).toBe(true))
    responses.get(`/a.json`)?.reject(new Error(`network down`))
    await tick()
    expect(on_error).not.toHaveBeenCalled()

    responses.get(`/b.json`)?.reject(new Error(`gone`))
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
    expect(on_error.mock.calls[0][0].filename).toBe(`b.json`)
  })

  test(`load error state renders StatusMessage`, async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(``),
    })
    mount_structure({ data_url: `/missing-structure.json` })
    await vi.waitFor(() =>
      expect(document.querySelector(`.status-message.error`)).toBeInstanceOf(HTMLElement),
    )
    const status_msg = doc_query(`.status-message.error`)
    expect(status_msg.getAttribute(`role`)).toBe(`alert`)
    expect(status_msg.textContent).toContain(`Failed to load structure`)
  })
})

// Multi-side view (2x2 grid). The canvas grid itself is gated behind a
// `typeof WebGLRenderingContext !== 'undefined'` guard so it doesn't render in
// happy-dom; these cover the toggle button + wrapper class. The 4-canvas render
// and independent rotation are exercised by the playwright suite.
describe(`Multi-side view`, () => {
  const mock_viewer_size = (client_width: number, client_height: number): void => {
    vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(client_width)
    vi.spyOn(HTMLElement.prototype, `clientHeight`, `get`).mockReturnValue(client_height)
  }
  afterEach(() => vi.restoreAllMocks())

  test(`layout dropdown switches multi_view and wrapper class`, async () => {
    const props = $state<ComponentProps<typeof Structure>>({
      structure,
      show_controls: `always`,
      multi_view: false,
    })
    mount_structure(props)
    await tick()

    expect(doc_query(`button[aria-label="View layout: 3D single view"]`)).toBeInstanceOf(
      HTMLButtonElement,
    )
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(false)

    await select_structure_layout(`3D 2×2 grid`)
    expect(props.multi_view).toBe(true)
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(true)

    await select_structure_layout(`3D single view`)
    expect(props.multi_view).toBe(false)
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(false)
  })

  test(`toggle button is hidden when 'multi-view' control is in hidden list`, async () => {
    mount_structure({
      structure,
      controls_open: true,
      show_controls: { mode: `always`, hidden: [`multi-view`] },
    })
    await tick()
    expect(document.querySelector(`button[aria-label^="View layout:"]`)).toBeNull()
  })

  test.each([
    [`default width gap`, 601, 600, 4, 300, 200, 2, false],
    [`default height gap`, 800, 401, 4, 300, 200, 2, false],
    [`custom view rows below boundary`, 800, 603, 6, 300, 200, 2, false],
    [`custom view rows at boundary`, 800, 604, 6, 300, 200, 2, true],
    [`larger gap below boundary`, 409, 310, 4, 200, 150, 10, false],
    [`larger gap at boundary`, 410, 310, 4, 200, 150, 10, true],
    [`non-finite values use defaults`, 602, 402, 4, Number.NaN, Infinity, Number.NaN, true],
    [`non-finite width uses default`, 601, 402, 4, Number.NaN, 200, 2, false],
    [`non-finite height uses default`, 602, 401, 4, 300, Infinity, 2, false],
  ] as const)(
    `responsive multi-view availability: %s`,
    async (
      _scenario,
      client_width,
      client_height,
      view_count,
      min_pane_width,
      min_pane_height,
      view_gap,
      expected_active,
    ) => {
      mock_viewer_size(client_width, client_height)
      const views = Array.from({ length: view_count }, () => ({}))
      const state = { multi_view_active: !expected_active }
      mount_structure(
        bind_props(
          {
            structure,
            multi_view: true,
            multi_view_min_pane_width: min_pane_width,
            multi_view_min_pane_height: min_pane_height,
            multi_view_gap: view_gap,
            show_controls: `always` as const,
            views,
          },
          state,
        ),
      )
      await tick()
      await tick()

      expect(document.querySelector(`button[aria-label^="View layout:"]`) !== null).toBe(
        expected_active,
      )
      const expected_gap = Number.isFinite(view_gap) ? Math.max(0, view_gap) : 2
      expect(doc_query(`.structure`).style.getPropertyValue(`--struct-viewport-gap`)).toBe(
        `${expected_gap}px`,
      )
      expect(state.multi_view_active).toBe(expected_active)
    },
  )

  test(`collapsed multi-view preference can be cleared with its keyboard shortcut`, async () => {
    mock_viewer_size(599, 399)
    const state = { multi_view: true, multi_view_active: true }
    mount_structure(bind_props({ structure, show_controls: `always` as const }, state))
    await tick()
    await tick()

    doc_query(`.structure`).dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `g`, ctrlKey: true, bubbles: true }),
    )
    await tick()
    expect(state).toEqual({ multi_view: false, multi_view_active: false })
  })
})

// Camera target reset on supercell change and structure reload requires WebGL +
// OrbitControls — tested via Playwright E2E (tests/playwright/structure/).
