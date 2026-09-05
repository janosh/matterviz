import { type AnyStructure, type MeasureMode, Structure } from '$lib'
import { create_frac_to_cart, type Vec3 } from '$lib/math'
import type { IsosurfaceLayer, IsosurfaceSettings, VolumetricData } from '$lib/isosurface'
import { auto_volume_layer, DEFAULT_ISOSURFACE_SETTINGS } from '$lib/isosurface'
import { DEFAULTS } from '$lib/settings'
import {
  create_structure_view_state,
  save_structure_view_state,
} from '$lib/settings/viewer-state'
import * as symmetry from '$lib/symmetry'
import type { StructureBond, StructureHandlerData, StructurePane } from '$lib/structure'
import { get_element_counts, OVERLAYS_INPUT_FRAME_NOTE } from '$lib/structure'
import type { Pbc } from '$lib/structure/pbc'
import { make_supercell } from '$lib/structure/supercell'
import { structures } from '$site/structures'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  assertHoverScopedShortcut,
  bind_props,
  create_drop_event,
  deferred_fetch_responses,
  doc_query,
  fcc_primitive_matrix,
  IDENTITY_MATRIX3,
  init_moyo_for_tests,
  keydown,
  make_crystal,
  make_grid,
  make_position_stream,
  make_volume,
  mouse,
  press_window_key,
  trigger_resize_observer,
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

// Mount Structure into document.body (queries are left to each test via doc_query). Every
// mount is unmounted after its test so component cleanup runs before happy-dom tears down:
// the edit toast's dismiss timer would otherwise fire into a vanished `document`.
const mounted: Record<string, unknown>[] = []
const mount_structure = (props: ComponentProps<typeof Structure>): void => {
  mounted.push(mount(Structure, { target: document.body, props }))
}
afterEach(() => {
  for (const component of mounted.splice(0)) void unmount(component)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const mount_bound_structure = (
  props: ComponentProps<typeof Structure>,
): { displayed_structure?: AnyStructure } => {
  const state = $state<{ displayed_structure?: AnyStructure }>({
    displayed_structure: undefined,
  })
  mount_structure(bind_props(props, state))
  return state
}

// Open the dropdown menu behind `trigger` and click the option labelled `label`
const pick_menu_option = async (trigger: string, label: string): Promise<void> => {
  doc_query<HTMLButtonElement>(trigger).click()
  await tick()
  const option = [...document.querySelectorAll<HTMLButtonElement>(`.view-mode-option`)].find(
    (button) => button.textContent?.trim() === label,
  )
  if (!option) throw new Error(`Missing menu option: ${label}`)
  option.click()
  flushSync()
  await tick()
}
const select_structure_layout = (label: string): Promise<void> =>
  pick_menu_option(`button[aria-label^="View layout:"]`, label)
const select_measure_mode = (label: string): Promise<void> =>
  pick_menu_option(`button[aria-label="Measure / Edit"]`, label)

const set_aria_input = (aria_label: string, value: string): void => {
  const input = doc_query<HTMLInputElement>(`input[aria-label="${aria_label}"]`)
  input.value = value
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
}

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

test(`loads strings, URLs and dropped files through the component API`, async () => {
  vi.stubGlobal(`fetch`, vi.fn().mockResolvedValue(new Response(SAMPLE_POSCAR_CONTENT)))
  const string_load = vi.fn<(data: StructureHandlerData) => void>()
  const url_load = vi.fn<(data: StructureHandlerData) => void>()
  const drop_load = vi.fn<(data: StructureHandlerData) => void>()
  mount_structure({ structure_string: SAMPLE_POSCAR_CONTENT, on_file_load: string_load })
  mount_structure({ data_url: `/loaded.poscar`, on_file_load: url_load })
  const drop_state = $state<{ structure?: AnyStructure }>({ structure: undefined })
  mount_structure(bind_props({ on_file_load: drop_load }, drop_state))
  await tick()
  document
    .querySelectorAll(`.structure`)
    .item(2)
    .dispatchEvent(create_drop_event(new File([SAMPLE_POSCAR_CONTENT], `dropped.poscar`)))

  await vi.waitFor(() => {
    expect(string_load).toHaveBeenCalledWith(
      expect.objectContaining({ filename: `string`, total_atoms: 5 }),
    )
    expect(url_load).toHaveBeenCalledWith(
      expect.objectContaining({ filename: `loaded.poscar`, source_url: `/loaded.poscar` }),
    )
    expect(drop_load).toHaveBeenCalledWith(
      expect.objectContaining({ filename: `dropped.poscar`, total_atoms: 5 }),
    )
  })
  expect(drop_state.structure?.sites).toHaveLength(5)
})

test(`data URLs win over inline text while caller-owned structures prevent fetching`, async () => {
  const fetch_spy = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response(SAMPLE_POSCAR_CONTENT)))
  vi.stubGlobal(`fetch`, fetch_spy)
  const on_file_load = vi.fn<(data: StructureHandlerData) => void>()
  mount_structure({
    data_url: `/priority.poscar`,
    structure_string: `ignored invalid text`,
    on_file_load,
  })
  mount_structure({ data_url: `/blocked.poscar`, structure })
  await vi.waitFor(() =>
    expect(on_file_load).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ filename: `priority.poscar`, total_atoms: 5 }),
    ),
  )
  expect(fetch_spy).toHaveBeenCalledOnce()
})

test(`drag hover state remains bindable and respects allow_file_drop`, async () => {
  const enabled = $state({ dragover: false })
  const disabled = $state({ dragover: false })
  mount_structure(bind_props({}, enabled))
  mount_structure(bind_props({ allow_file_drop: false }, disabled))
  await tick()
  const [enabled_zone, disabled_zone] = document.querySelectorAll(`.structure`)
  enabled_zone?.dispatchEvent(new DragEvent(`dragover`, { bubbles: true, cancelable: true }))
  disabled_zone?.dispatchEvent(new DragEvent(`dragover`, { bubbles: true, cancelable: true }))
  expect(enabled.dragover).toBe(true)
  expect(enabled_zone?.classList.contains(`dragover`)).toBe(true)
  expect(disabled.dragover).toBe(false)
  expect(disabled_zone?.classList.contains(`dragover`)).toBe(false)
  enabled_zone?.dispatchEvent(new DragEvent(`dragleave`, { bubbles: true }))
  expect(enabled.dragover).toBe(false)
})

test(`custom drop handlers retain raw content and source metadata`, async () => {
  const on_file_drop = vi.fn()
  mount_structure({ on_file_drop })
  await tick()
  const file = new File([SAMPLE_POSCAR_CONTENT], `custom.poscar`)
  doc_query(`.structure`).dispatchEvent(create_drop_event(file))
  await vi.waitFor(() =>
    expect(on_file_drop).toHaveBeenCalledWith(SAMPLE_POSCAR_CONTENT, file.name, {
      source_filename: file.name,
      file,
    }),
  )
})

test(`same-cell volumetric drops append volumes through the shared runtime`, async () => {
  const state = $state<{ volumetric_data?: VolumetricData[] }>({
    volumetric_data: undefined,
  })
  mount_structure(bind_props({}, state))
  await tick()
  const drop_zone = doc_query(`.structure`)
  drop_zone.dispatchEvent(create_drop_event(new File([SAMPLE_CHGCAR_CONTENT], `A.CHGCAR`)))
  await vi.waitFor(() => expect(state.volumetric_data).toHaveLength(1))
  drop_zone.dispatchEvent(create_drop_event(new File([SAMPLE_CHGCAR_CONTENT], `B.CHGCAR`)))
  await vi.waitFor(() => expect(state.volumetric_data).toHaveLength(2))
  expect(state.volumetric_data?.map(({ source_filename }) => source_filename)).toEqual([
    `A.CHGCAR`,
    `B.CHGCAR`,
  ])
})

// Layers index the volumes they were made for: a structure in a different cell drops the
// volumes AND their layers, so the next volume gets its own automatic layer instead of
// inheriting one scaled to the previous field (CHGCAR values are hundreds, cube values ~0.01)
test(`layers die with the volumes an unrelated structure replaces`, async () => {
  const other_cell = SAMPLE_CHGCAR_CONTENT.replace(
    `1 0 0\n0 1 0\n0 0 1`,
    `2 0 0\n0 2 0\n0 0 2`,
  )
  const state = $state<{
    volumetric_data?: VolumetricData[]
    isosurface_settings: IsosurfaceSettings
  }>({
    volumetric_data: undefined,
    isosurface_settings: { ...DEFAULT_ISOSURFACE_SETTINGS, halo: 0.2 },
  })
  mount_structure(bind_props({}, state))
  await tick()
  const drop_zone = doc_query(`.structure`)
  const drop = (content: string, filename: string) =>
    drop_zone.dispatchEvent(create_drop_event(new File([content], filename)))

  drop(SAMPLE_CHGCAR_CONTENT, `a.CHGCAR`)
  await vi.waitFor(() => expect(state.isosurface_settings.layers).toHaveLength(1))
  const settings_with_a = state.isosurface_settings

  drop(other_cell.split(`\n\n`)[0], `b.poscar`)
  await vi.waitFor(() => expect(state.volumetric_data).toEqual([]))
  expect(state.isosurface_settings).toEqual({ ...settings_with_a, layers: [] })

  drop(other_cell, `c.CHGCAR`)
  await vi.waitFor(() => expect(state.volumetric_data).toHaveLength(1))
  expect(state.isosurface_settings.layers).toEqual([
    auto_volume_layer(state.volumetric_data?.[0] as VolumetricData, 0),
  ])
})

test(`multi-file drops continue after failures and report one batch error`, async () => {
  const on_file_load = vi.fn<(data: StructureHandlerData) => void>()
  const state = $state<{ error_msg?: string }>({ error_msg: undefined })
  mount_structure(bind_props({ on_file_load }, state))
  await tick()
  doc_query(`.structure`).dispatchEvent(
    create_drop_event([
      new File([`garbage`], `bad.poscar`),
      new File([SAMPLE_POSCAR_CONTENT], `good.poscar`),
      new File([`more garbage`], `worse.cif`),
    ]),
  )
  await vi.waitFor(() => expect(state.error_msg).toMatch(/^Failed to load 2 files — /))
  expect(state.error_msg).toMatch(/bad\.poscar: .*; worse\.cif: /)
  expect(on_file_load).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ filename: `good.poscar`, total_atoms: 5 }),
  )
})

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

// Stub the Fullscreen API on the mounted viewer; `set_fullscreen_element` plays the browser
// entering/leaving fullscreen
const stub_fullscreen_api = () => {
  const request_fullscreen = vi.fn().mockResolvedValue(undefined)
  const exit_fullscreen = vi.fn().mockResolvedValue(undefined)
  const wrapper = doc_query(`.structure`)
  wrapper.requestFullscreen = request_fullscreen
  document.exitFullscreen = exit_fullscreen
  const set_fullscreen_element = async (value: Element | null) => {
    Object.defineProperty(document, `fullscreenElement`, { value, configurable: true })
    document.dispatchEvent(new Event(`fullscreenchange`))
    await tick()
  }
  return { wrapper, request_fullscreen, exit_fullscreen, set_fullscreen_element }
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

  test(`shows a dismissible symmetry warning when analysis fails`, async () => {
    vi.stubEnv(`VITEST`, ``)
    vi.spyOn(symmetry, `ensure_moyo_wasm_ready`).mockResolvedValueOnce(undefined)
    vi.spyOn(symmetry, `analyze_structure_symmetry`).mockRejectedValueOnce(
      new Error(`WASM unavailable`),
    )
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    try {
      mount_structure({ structure })
      await vi.waitFor(() =>
        expect(document.querySelector(`.symmetry-error`)).toBeInstanceOf(HTMLElement),
      )
      const warning = doc_query(`.symmetry-error`)
      expect(warning.textContent).toContain(`Symmetry analysis failed: WASM unavailable`)
      expect(warning.getAttribute(`role`)).toBe(`status`)
      doc_query<HTMLButtonElement>(`.symmetry-error button`).click()
      flushSync()
      expect(document.querySelector(`.symmetry-error`)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    }
  })

  test(`skips symmetry analysis when disabled`, async () => {
    vi.stubEnv(`VITEST`, ``)
    const ready_spy = vi.spyOn(symmetry, `ensure_moyo_wasm_ready`)
    const analyze_spy = vi.spyOn(symmetry, `analyze_structure_symmetry`)
    try {
      mount_structure({ structure, analyze_symmetry: false })
      flushSync()
      await tick()
      expect(ready_spy).not.toHaveBeenCalled()
      expect(analyze_spy).not.toHaveBeenCalled()
      expect(document.querySelector(`.symmetry-error`)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    }
  })

  test(`switches a volumetric structure between shared 3D and slice views`, async () => {
    const props = mount_volumetric({
      show_controls: `always`,
      display_mode: `structure`,
      slice_settings: { plane_mode: `hkl`, resolution: 2 },
    })
    await tick()

    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeNull()

    await select_structure_layout(`2D cross-section`)

    expect(props.display_mode).toBe(`slice`)
    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(`button[title="Measure / Edit"]`)).toBeNull()

    set_aria_input(`Slice position on canvas`, `0.75`)
    await tick()
    expect(props.slice_settings?.position).toBe(0.75)

    const controls_toggle = doc_query<HTMLButtonElement>(`button.structure-controls-toggle`)
    controls_toggle.click()
    await tick()
    expect(document.querySelector(`.controls-pane`)).toBeInstanceOf(HTMLElement)
    const plane_select = doc_query<HTMLSelectElement>(`select[aria-label="Slice plane mode"]`)
    expect(plane_select.value).toBe(`hkl`)
    set_aria_input(`Slice resolution`, `3`)
    await tick()
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
    const props = mount_volumetric({
      active_volume_idx: 9,
      display_mode: `slice`,
      slice_settings: { resolution: 2 },
    })
    await tick()

    expect(props.active_volume_idx).toBe(0)
    expect(document.querySelector(`[data-testid="volume-slice"]`)).toBeInstanceOf(HTMLElement)
  })

  test(`reveals atom color mode toggle while viewer is hovered or focused`, async () => {
    mount_structure({ structure })
    await tick()

    const viewer = doc_query(`.structure`)
    const mode_toggle = doc_query<HTMLButtonElement>(`.atom-legend .mode-toggle`)
    expect(getComputedStyle(mode_toggle).opacity).toBe(`0`)
    expect(mode_toggle.tabIndex).toBe(-1)

    viewer.focus()
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`1`)
    expect(mode_toggle.tabIndex).toBe(0)

    mode_toggle.focus()
    await tick()
    expect(document.activeElement).toBe(mode_toggle)
    expect(getComputedStyle(mode_toggle).opacity).toBe(`1`)

    mode_toggle.blur()
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`0`)
    expect(mode_toggle.tabIndex).toBe(-1)

    viewer.dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`1`)
    expect(mode_toggle.tabIndex).toBe(0)

    viewer.dispatchEvent(new PointerEvent(`pointerleave`))
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`0`)

    // second hover cycle: the unbound $bindable hovered prop must keep driving the toggle
    viewer.dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`1`)
    viewer.dispatchEvent(new PointerEvent(`pointerleave`))
    await tick()
    expect(getComputedStyle(mode_toggle).opacity).toBe(`0`)
  })

  test(`window keydown shortcuts are scoped to the hovered viewer`, async () => {
    const state = { active_pane: null as StructurePane | null }
    mount_structure(bind_props({ structure, enable_info_pane: true }, state))
    await tick()

    await assertHoverScopedShortcut({
      viewer: doc_query(`.structure`),
      trigger: () => press_window_key({ key: `i` }),
      read_state: () => state.active_pane === `info`,
    })
  })

  test(`hover keydown path bails in edit modes so destructive keys need focus`, async () => {
    const state = {
      active_pane: null as StructurePane | null,
      measure_mode: `edit-atoms` as MeasureMode,
    }
    mount_structure(bind_props({ structure, enable_info_pane: true }, state))
    await tick()
    expect(state.measure_mode, `edit-atoms should stick for a plain structure`).toBe(
      `edit-atoms`,
    )

    doc_query(`.structure`).dispatchEvent(new PointerEvent(`pointerenter`))
    await tick()
    // hovered (not focused) + edit mode → window forwarder ignores the key
    press_window_key({ key: `i` })
    expect(state.active_pane, `hover path ignored in edit mode`).toBeNull()
  })

  test(`edit-atoms A opens the element input and Escape closes it, even while that input has focus`, async () => {
    const edit_props: { measure_mode: MeasureMode } = { measure_mode: `edit-atoms` }
    mount_structure(bind_props(edit_props, { structure: structures[0] }))
    await tick()
    const press = (target: Element, key: string) =>
      target.dispatchEvent(keydown(key, { cancelable: true }))
    press(doc_query(`.structure`), `a`)
    await tick()
    const add_input = doc_query<HTMLInputElement>(`.add-atom-input input`)
    // the autofocused element input is where the next keystroke lands
    press(add_input, `Escape`)
    await tick()
    expect(document.querySelector(`.add-atom-input`)).toBeNull()
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
    [{ supercell_scaling: `2x1x1`, apply_supercell_scaling: false }, true],
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

  // Aperiodic boxes still support supercell repetition; molecules have no cell to repeat.
  test.each([
    [`fully periodic crystal`, [true, true, true], true],
    [`slab periodic along two axes`, [true, true, false], true],
    [`cluster in a vacuum box`, [false, false, false], true],
    [`molecule without a lattice`, null, false],
  ] satisfies [string, Pbc | null, boolean][])(
    `cell select shown for a %s: %s`,
    async (_name, pbc, shown) => {
      if (!(`lattice` in structure)) throw new Error(`Expected a crystal fixture`)
      const { lattice: _lattice, ...molecule } = structure
      mount_structure({
        structure: pbc ? { ...structure, lattice: { ...structure.lattice, pbc } } : molecule,
      })
      await tick()
      expect(document.querySelector(`.cell-select`) !== null).toBe(shown)
    },
  )

  test(`shows an already-materialized supercell without expanding it again`, async () => {
    vi.mocked(make_supercell).mockClear()
    const state = mount_bound_structure({
      structure,
      supercell_scaling: `3x3x3`,
      apply_supercell_scaling: false,
      show_image_atoms: false,
    })

    await vi.waitFor(() =>
      expect(state.displayed_structure?.sites).toHaveLength(structure.sites.length),
    )
    expect(vi.mocked(make_supercell)).not.toHaveBeenCalled()
    expect(doc_query(`.cell-select .toggle-btn`).textContent?.replaceAll(/\s/g, ``)).toBe(
      `3x3x3`,
    )
  })

  test(`displayed_structure keeps its identity across unrelated prop changes`, async () => {
    // A bound parent re-proxies every write, so rewriting the same structure on an
    // unrelated rerun would invalidate every consumer of displayed_structure
    const props = $state<ComponentProps<typeof Structure>>({
      structure,
      displayed_structure: undefined,
      active_volume_idx: 0,
      volumetric_data: undefined,
    })
    let runs = 0
    const destroy = $effect.root(() => {
      $effect(() => {
        void props.displayed_structure
        runs += 1
      })
    })
    mount_structure(props)
    await tick()
    const [displayed, runs_before] = [props.displayed_structure, runs]
    expect(displayed?.sites.length).toBeGreaterThan(0)
    props.active_volume_idx = 3
    await tick()
    expect(props.displayed_structure).toBe(displayed)
    expect(runs).toBe(runs_before)
    destroy()
  })

  test.each([
    [`aperiodic`, [false, false, false], [-0.1, 1.2, 2.1]],
    [`partially periodic`, [true, false, true], [0.9, 1.2, 0.1]],
  ] satisfies [string, Pbc, Vec3][])(
    `wraps displayed coordinates only on %s axes`,
    async (_name, pbc, expected) => {
      if (!(`lattice` in structure)) throw new Error(`Expected a crystal fixture`)
      const abc: Vec3 = [-0.1, 1.2, 2.1]
      const frac_to_cart = create_frac_to_cart(structure.lattice.matrix)
      const out_of_cell = {
        ...structure,
        lattice: { ...structure.lattice, pbc },
        sites: [
          {
            ...structure.sites[0],
            abc,
            xyz: frac_to_cart(abc),
          },
        ],
      }
      const state = mount_bound_structure({
        structure: out_of_cell,
        show_image_atoms: false,
      })

      await vi.waitFor(() => expect(state.displayed_structure).toBeDefined())
      const displayed_site = state.displayed_structure?.sites[0]
      expect(displayed_site?.abc).toEqual(expected)
      expect(displayed_site?.xyz).toEqual(frac_to_cart(expected))
    },
  )

  test(`falls back to untransformed structure when make_supercell throws`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    vi.mocked(make_supercell).mockImplementationOnce(() => {
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
      // a build that already fails at mount is reported, not only one that starts failing
      expect(doc_query(`.edit-toast .toast-message`).textContent).toBe(
        `Failed to create supercell: malformed scaling matrix`,
      )
    } finally {
      error_spy.mockRestore()
    }
  })

  // `wyckoff_positions` is the viewer's own mapped Wyckoff table (site indices on the displayed
  // cell), so consumers such as the symmetry demo need not re-run map_wyckoff_to_all_atoms
  test(`binds wyckoff_positions once symmetry analysis lands and remaps them per cell type`, async () => {
    vi.stubEnv(`VITEST`, ``)
    await init_moyo_for_tests()
    try {
      const prim_fcc_cu = make_crystal(fcc_primitive_matrix(3.61), [
        { element: `Cu`, abc: [0, 0, 0] },
      ])
      const state = $state<{
        sym_data: symmetry.SymmetryDataset | null
        wyckoff_positions: symmetry.WyckoffPos[]
        cell_type: symmetry.CellType
      }>({ sym_data: null, wyckoff_positions: [], cell_type: `original` })
      // no image atoms so site_indices are exactly the cell's own sites
      mount_structure(bind_props({ structure: prim_fcc_cu, show_image_atoms: false }, state))
      flushSync()
      expect(state.wyckoff_positions).toEqual([])
      await vi.waitFor(() => expect(state.sym_data).not.toBeNull())
      flushSync()
      expect(state.wyckoff_positions).toEqual([
        expect.objectContaining({ wyckoff: `4a`, elem: `Cu`, site_indices: [0] }),
      ])
      // the conventional fcc cell holds four copies of the lone 4a site
      state.cell_type = `conventional`
      flushSync()
      expect(state.wyckoff_positions).toHaveLength(1)
      expect(state.wyckoff_positions[0].site_indices).toEqual([0, 1, 2, 3])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // The symmetry-element and lattice-plane overlays only exist in the analyzed (input) cell and
  // are blanked for conventional/primitive views; that must be said (toast), not happen silently
  test.each([`symmetry`, `lattice planes`])(
    `toasts why the %s overlay vanishes when the cell leaves the input frame`,
    async (overlay) => {
      await init_moyo_for_tests()
      const prim_fcc_cu = make_crystal(fcc_primitive_matrix(3.61), [
        { element: `Cu`, abc: [0, 0, 0] },
      ])
      const sym_data = await symmetry.analyze_structure_symmetry(prim_fcc_cu)
      const symmetry_elements = symmetry.symmetry_elements_from_ops(sym_data.operations ?? [])
      expect(symmetry.has_visible_symmetry_overlay(symmetry_elements)).toBe(true)
      const props = $state<ComponentProps<typeof Structure>>({
        structure: prim_fcc_cu,
        scene_props:
          overlay === `symmetry`
            ? { symmetry_elements }
            : { lattice_planes: [{ hkl: [1, 1, 1] }] },
        cell_type: `original`,
        sym_data: null,
      })
      mount_structure(props)
      flushSync()
      // the mount-time analysis reset has run; hand the viewer its symmetry data now
      props.sym_data = sym_data
      flushSync()
      expect(document.querySelector(`.edit-toast .toast-message`)).toBeNull()

      props.cell_type = `conventional`
      flushSync()
      expect(doc_query(`.edit-toast .toast-message`).textContent).toBe(
        OVERLAYS_INPUT_FRAME_NOTE,
      )
    },
  )

  test(`shows safe bond editing controls by default`, async () => {
    mount_structure({ structure, measure_mode: `edit-bonds`, show_controls: true })
    await tick()

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

  // Only distance refuses picks at MAX_SELECTED_SITES. Angle and dihedral take a fixed
  // ordered tuple and roll the oldest pick out, so they never hit a wall worth badging.
  test.each([
    { mode: `distance`, shows_limit: true },
    { mode: `angle`, shows_limit: false },
    { mode: `dihedral`, shows_limit: false },
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

  test(`keeps view selection across coordinate updates in one structure series`, async () => {
    const props = $state<{
      structure: AnyStructure
      structure_series_key: unknown
      selected_sites: number[]
    }>({
      structure,
      structure_series_key: {},
      selected_sites: [],
    })
    mount_structure(props)
    await tick()
    props.selected_sites = [0]

    props.structure = {
      ...structure,
      sites: structure.sites.map((site, site_idx) =>
        site_idx === 0
          ? {
              ...site,
              xyz: [site.xyz[0] + 0.1, site.xyz[1], site.xyz[2]] as Vec3,
            }
          : site,
      ),
    }
    await tick()
    expect(props.selected_sites).toEqual([0])

    props.structure_series_key = {}
    await tick()
    expect(props.selected_sites).toEqual([])
  })

  test(`invalidates site-indexed state on topology changes without changing series`, async () => {
    const props = $state<{
      structure: AnyStructure
      structure_series_key: unknown
      selected_sites: number[]
      measured_sites: number[]
      highlighted_sites: number[]
      hovered_site_idx: number | null
    }>({
      structure,
      structure_series_key: {},
      selected_sites: [],
      measured_sites: [],
      highlighted_sites: [],
      hovered_site_idx: null,
    })
    mount_structure(props)
    await tick()
    props.selected_sites = [0]
    props.measured_sites = [0]
    props.highlighted_sites = [0]
    props.hovered_site_idx = 0

    props.structure = {
      ...structure,
      sites: structure.sites.map((site) => ({ ...site, xyz: [...site.xyz] as Vec3 })),
    }
    await tick()
    expect(props.selected_sites).toEqual([0])

    props.structure = { ...structure, sites: structure.sites.slice(1) }
    await tick()
    expect(props.selected_sites).toEqual([])
    expect(props.measured_sites).toEqual([])
    expect(props.highlighted_sites).toEqual([])
    expect(props.hovered_site_idx).toBeNull()
  })

  test(`clears stale picks in the same flush that shrinks the displayed structure`, async () => {
    // What StructureScene's overlays index sites with is the session's validated selection,
    // so a pick is never visible next to a displayed structure that lacks that site. Here the
    // bound props are observed after a synchronous flush: both have already moved together.
    const props = $state<{
      structure: AnyStructure
      measured_sites: number[]
      measure_mode: MeasureMode
      show_image_atoms: boolean
      supercell_scaling: string
      displayed_structure?: AnyStructure
    }>({
      structure,
      measured_sites: [],
      measure_mode: `distance`,
      show_image_atoms: true,
      supercell_scaling: `1x1x1`,
      displayed_structure: undefined,
    })
    mount_structure(props)
    await tick()
    const displayed_count = () => props.displayed_structure?.sites.length ?? 0
    const pick_last_displayed = () => {
      props.measured_sites = [0, 1, displayed_count() - 1]
      flushSync()
      expect(props.measured_sites).toHaveLength(3)
    }

    // image atoms: the last displayed site is an image that vanishes when they're hidden
    expect(displayed_count()).toBeGreaterThan(structure.sites.length)
    pick_last_displayed()
    props.show_image_atoms = false
    flushSync()
    expect(props.measured_sites).toEqual([])
    expect(displayed_count()).toBe(structure.sites.length)

    // supercell: grow, pick a site that only exists in the 2x2x2 cell, shrink back
    props.supercell_scaling = `2x2x2`
    flushSync()
    expect(displayed_count()).toBe(8 * structure.sites.length)
    pick_last_displayed()
    props.supercell_scaling = `1x1x1`
    flushSync()
    expect(props.measured_sites).toEqual([])
    expect(displayed_count()).toBe(structure.sites.length)
  })

  test(`discovers new vector keys within one structure series`, async () => {
    const with_vectors = (include_magmom: boolean): AnyStructure => ({
      ...structure,
      sites: structure.sites.map((site, site_idx) => ({
        ...site,
        properties: {
          ...site.properties,
          ...(site_idx === 0
            ? {
                force: [1, 0, 0],
                ...(include_magmom ? { magmom: [0, 1, 0] } : {}),
              }
            : {}),
        },
      })),
    })
    const props = $state({
      structure: with_vectors(false),
      structure_series_key: {},
      active_pane: `controls` as const,
    })
    mount_structure(props)
    await tick()
    expect(document.querySelector(`[aria-label="Reset force color to default"]`)).toBeNull()

    props.structure = with_vectors(true)
    await tick()
    expect(
      document.querySelector(`[aria-label="Reset force color to default"]`),
    ).not.toBeNull()
    expect(
      document.querySelector(`[aria-label="Reset magmom color to default"]`),
    ).not.toBeNull()
  })

  test(`preserves control chrome overrides and toggles fullscreen`, async () => {
    const on_fullscreen_change = vi.fn()
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    mount_structure({
      structure,
      show_controls: `always`,
      style: `--ctrl-btn-icon-size: 32px`,
      on_fullscreen_change,
    })
    const { wrapper, request_fullscreen, exit_fullscreen, set_fullscreen_element } =
      stub_fullscreen_api()
    request_fullscreen.mockRejectedValueOnce(new Error(`fullscreen denied`))
    await tick()

    expect(wrapper.style.getPropertyValue(`--ctrl-btn-icon-size`)).toBe(`32px`)

    const fullscreen_button = doc_query<HTMLButtonElement>(
      `.structure > section.control-buttons > .fullscreen-btn`,
    )

    fullscreen_button.click()
    // the flag flips on click and reverts once the browser rejects the request
    await vi.waitFor(() => expect(request_fullscreen).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(fullscreen_button.getAttribute(`aria-pressed`)).toBe(`false`),
    )
    expect(on_fullscreen_change).not.toHaveBeenCalled()

    fullscreen_button.click()
    await vi.waitFor(() => expect(request_fullscreen).toHaveBeenCalledTimes(2))

    await set_fullscreen_element(wrapper)
    expect(fullscreen_button.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(on_fullscreen_change).toHaveBeenLastCalledWith({ structure, fullscreen: true })

    fullscreen_button.click()
    await vi.waitFor(() => expect(exit_fullscreen).toHaveBeenCalledOnce())

    await set_fullscreen_element(null)
    expect(fullscreen_button.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(on_fullscreen_change).toHaveBeenLastCalledWith({ structure, fullscreen: false })
    expect(on_fullscreen_change).toHaveBeenCalledTimes(2)
  })

  // `fullscreen` is bindable: the parent's value follows the browser's fullscreen element, and
  // setting it from the parent requests/exits fullscreen like the button does
  test(`bind:fullscreen follows the fullscreen element and drives it`, async () => {
    const props = $state({ fullscreen: false })
    mount_structure(bind_props({ structure, show_controls: `always` as const }, props))
    const { wrapper, request_fullscreen, exit_fullscreen, set_fullscreen_element } =
      stub_fullscreen_api()
    await tick()

    doc_query<HTMLButtonElement>(
      `.structure > section.control-buttons > .fullscreen-btn`,
    ).click()
    await vi.waitFor(() => expect(request_fullscreen).toHaveBeenCalledOnce())
    await set_fullscreen_element(wrapper)
    expect(props.fullscreen).toBe(true)

    props.fullscreen = false
    await vi.waitFor(() => expect(exit_fullscreen).toHaveBeenCalledOnce())
    await set_fullscreen_element(null)
    expect(props.fullscreen).toBe(false)
    expect(wrapper.classList.contains(`fullscreen`)).toBe(false)
  })

  // `width`/`height` are bindable read-outs of the wrapper's client size, kept current through
  // the ResizeObserver behind bind:clientWidth/clientHeight (the 2x2 grid and the panes size
  // themselves from these)
  test(`bind:width/height report the wrapper size and follow resizes`, async () => {
    const width_spy = vi
      .spyOn(HTMLElement.prototype, `clientWidth`, `get`)
      .mockReturnValue(640)
    const height_spy = vi
      .spyOn(HTMLElement.prototype, `clientHeight`, `get`)
      .mockReturnValue(480)
    try {
      const props = $state({ width: 0, height: 0 })
      mount_structure(bind_props({ structure }, props))
      await tick()
      expect([props.width, props.height]).toEqual([640, 480])

      width_spy.mockReturnValue(1024)
      height_spy.mockReturnValue(768)
      trigger_resize_observer(doc_query(`.structure`))
      await tick()
      expect([props.width, props.height]).toEqual([1024, 768])
    } finally {
      width_spy.mockRestore()
      height_spy.mockRestore()
    }
  })

  // `persist_settings` reaches the controls pane: a saved browser view state is restored into
  // the viewer's bound settings only when opted in
  test.each([true, false])(
    `persist_settings=%s restores saved view state`,
    async (persist) => {
      save_structure_view_state(
        create_structure_view_state({
          color_scheme: `Jmol`,
          show_image_atoms: false,
          supercell_scaling: `2x2x1`,
          scene_props: { atom_radius: 1.35 },
        }),
      )
      const defaults = {
        color_scheme: DEFAULTS.color_scheme,
        show_image_atoms: true,
        supercell_scaling: `1x1x1`,
      }
      const props = $state({ ...defaults })
      mount_structure(
        bind_props(
          { structure, show_controls: `always` as const, persist_settings: persist },
          props,
        ),
      )
      await tick()
      expect(props).toEqual(
        persist
          ? { color_scheme: `Jmol`, show_image_atoms: false, supercell_scaling: `2x2x1` }
          : defaults,
      )
      // the scene settings land in the controls pane (atom radius slider)
      doc_query<HTMLButtonElement>(`button.structure-controls-toggle`).click()
      await tick()
      const radius_input = doc_query<HTMLInputElement>(
        `[data-key="atom_radius"] input[type="number"]`,
      )
      expect(Number(radius_input.value)).toBe(persist ? 1.35 : DEFAULTS.structure.atom_radius)
    },
  )

  // The Measure / Edit menu writes the bound measure_mode; distance is the default and stays
  // selectable from every other mode
  test(`Measure / Edit menu switches the bound measure_mode`, async () => {
    const props = $state<{ measure_mode: MeasureMode }>({ measure_mode: `angle` })
    mount_structure(bind_props({ structure, show_controls: true }, props))
    await tick()
    await select_measure_mode(`Distance`)
    expect(props.measure_mode).toBe(`distance`)
    await select_measure_mode(`Dihedral`)
    expect(props.measure_mode).toBe(`dihedral`)
    await select_measure_mode(`Edit Atoms`)
    expect(props.measure_mode).toBe(`edit-atoms`)
    // the toolbar for the active mode appears, and distance has none
    expect(document.querySelector(`.edit-mode-toolbar`)).not.toBeNull()
    await select_measure_mode(`Distance`)
    expect(props.measure_mode).toBe(`distance`)
    expect(document.querySelector(`.edit-mode-toolbar`)).toBeNull()
  })

  test(`info pane search selects a site and its card updates highlighted sites`, async () => {
    const state = $state({
      highlighted_sites: [] as number[],
      hovered_site_idx: null as number | null,
      selected_sites: [] as number[],
    })

    mount_structure(
      bind_props({ structure, active_pane: `info` as const, show_controls: true }, state),
    )
    await tick()

    const search = doc_query<HTMLInputElement>(`input[aria-label="Find site"]`)
    search.value = `${structure.sites[0].species[0].element}1`
    search.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    doc_query<HTMLButtonElement>(`.site-matches button`).click()
    await tick()
    expect(state.selected_sites).toEqual([0])

    const first_site_row = doc_query(
      `.site-card[title^="Click to select ${structure.sites[0].species[0].element}1"]`,
    )

    first_site_row.dispatchEvent(mouse(`mouseenter`))
    expect(state.highlighted_sites).toEqual([0])
    expect(state.hovered_site_idx).toBe(0)

    first_site_row.dispatchEvent(mouse(`mouseleave`))
    expect(state.highlighted_sites).toEqual([])
    expect(state.hovered_site_idx).toBeNull()

    first_site_row.click()
    expect(state.selected_sites).toEqual([])
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
  mount_structure({ structure, active_pane: `controls`, show_controls: true, scene_props })
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

  // by label, not by `[max="2"]`: several sliders share that bound, so a positional match
  // silently follows whichever section the pane happens to render first
  const auto_rotate_label = [...document.querySelectorAll(`.controls-pane label`)].find(
    (label) => label.textContent?.includes(`Auto-rotate speed`),
  )
  const auto_rotate_input =
    auto_rotate_label?.querySelector<HTMLInputElement>(`input[type="number"]`)
  expect(Number(auto_rotate_input?.value)).toBeCloseTo(0.5, 1)
})

// show_trajectory_lines lives outside scene_props (Trajectory binds it top-level), but a caller
// passing it inside scene_props must still be honored instead of silently falling to the default
test(`scene_props.show_trajectory_lines seeds the trail toggle`, async () => {
  const trajectory_position_stream = make_position_stream(
    Array.from({ length: 3 }, () => [[0, 0, 0]]),
    [`H`],
    {
      lattice_matrices: Array.from({ length: 3 }, () => IDENTITY_MATRIX3),
      pbc: [false, false, false],
      coords_unwrapped: true,
    },
  )
  mount_structure({
    structure,
    active_pane: `controls`,
    show_controls: true,
    scene_props: { show_trajectory_lines: true, trajectory_position_stream },
  })
  await tick()
  const toggle = doc_query<HTMLInputElement>(
    `[data-key="show_trajectory_lines"] input[type="checkbox"]`,
  )
  expect(toggle.checked).toBe(true)
})

test(`viewer-local setting changes do not mutate defaults or another viewer`, async () => {
  const auto_rotate_inputs = (): HTMLInputElement[] =>
    [...document.querySelectorAll(`label`)]
      .filter((label) => label.textContent?.includes(`Auto-rotate speed`))
      .flatMap((label) => {
        const input = label.querySelector<HTMLInputElement>(`input[type="number"]`)
        return input ? [input] : []
      })
  const default_auto_rotate = DEFAULTS.structure.auto_rotate
  mount_structure({ structure, active_pane: `controls`, show_controls: true })
  await tick()

  const [first_auto_rotate] = auto_rotate_inputs()
  if (!first_auto_rotate) throw new Error(`First viewer is missing its auto-rotate input`)
  first_auto_rotate.value = `1.5`
  first_auto_rotate.dispatchEvent(new Event(`input`, { bubbles: true }))
  flushSync()
  expect(DEFAULTS.structure.auto_rotate).toBe(default_auto_rotate)

  mount_structure({ structure, active_pane: `controls`, show_controls: true })
  await tick()
  const inputs = auto_rotate_inputs()
  expect(inputs).toHaveLength(2)
  expect(Number(inputs[0].value)).toBe(1.5)
  expect(Number(inputs[1].value)).toBe(default_auto_rotate)
})

// Atom label controls tests
describe(`atom label controls`, () => {
  test(`controls reflect scene_props bindings`, () => {
    mount_structure({
      structure,
      active_pane: `controls`,
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
      active_pane: `controls`,
      show_controls: true,
      scene_props: { show_site_labels: true, site_label_offset: [0, 0.75, 0.2] },
    })

    // Mount second instance
    mount_structure({
      structure,
      active_pane: `controls`,
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

  test(`layout dropdown is layered and switches multi_view`, async () => {
    const props = $state<ComponentProps<typeof Structure>>({
      structure,
      show_controls: `always`,
      multi_view: false,
    })
    mount_structure(props)
    await tick()

    doc_query(`button[aria-label="View layout: 3D single view"]`)
    expect(document.querySelector(`.view-mode-caret`)).toBeNull()
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(false)

    await select_structure_layout(`3D 2×2 grid`)
    expect(props.multi_view).toBe(true)
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(true)
    expect(document.querySelector(`.view-mode-dropdown`)).toBeNull()

    await select_structure_layout(`3D single view`)
    expect(props.multi_view).toBe(false)
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(false)
  })

  test(`toggle button is hidden when 'multi-view' control is in hidden list`, async () => {
    mount_structure({
      structure,
      active_pane: `controls` as const,
      show_controls: { mode: `always`, hidden: [`multi-view`] },
    })
    await tick()
    expect(document.querySelector(`button[aria-label^="View layout:"]`)).toBeNull()
  })

  // Panes need 300x200 px each with a 2 px gap: 602x402 for the default 4 views (2 rows),
  // 602x604 for 6 views (3 rows)
  test.each([
    [`below width`, 601, 402, 4, false],
    [`below height`, 602, 401, 4, false],
    [`at boundary`, 602, 402, 4, true],
    [`three rows below`, 602, 603, 6, false],
    [`three rows at boundary`, 602, 604, 6, true],
  ] as const)(
    `responsive multi-view availability: %s`,
    async (_scenario, client_width, client_height, view_count, expected_active) => {
      mock_viewer_size(client_width, client_height)
      const views = Array.from({ length: view_count }, () => ({}))
      mount_structure({ structure, multi_view: true, show_controls: `always`, views })
      await tick()
      await tick()

      expect(document.querySelector(`button[aria-label^="View layout:"]`) !== null).toBe(
        expected_active,
      )
      expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(expected_active)
    },
  )

  test(`collapsed multi-view preference can be cleared with its keyboard shortcut`, async () => {
    mock_viewer_size(599, 399)
    const state = { multi_view: true }
    mount_structure(bind_props({ structure, show_controls: `always` as const }, state))
    await tick()
    await tick()
    expect(doc_query(`.structure`).classList.contains(`multi-view`)).toBe(false)

    doc_query(`.structure`).dispatchEvent(keydown(`g`))
    await tick()
    expect(state.multi_view).toBe(false)
  })
})

// Camera target reset on supercell change and structure reload requires WebGL +
// OrbitControls — tested via Playwright E2E (tests/playwright/structure/).

describe(`data_url acquisition`, () => {
  const mock_fetch_response = (content: string, headers?: HeadersInit): void => {
    vi.stubGlobal(`fetch`, vi.fn().mockResolvedValue(new Response(content, { headers })))
  }
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

  test(`reports invalid structure_string content`, async () => {
    const on_error = vi.fn()
    mount_structure({ structure_string: `not parseable`, on_error })
    await vi.waitFor(() =>
      expect(on_error).toHaveBeenCalledWith(
        expect.objectContaining({
          error_msg: expect.stringMatching(/^Failed to parse string: /),
          filename: `string`,
        }),
      ),
    )
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

  // A host handler's failure is reported in its own words, with the payload's source identity
  test(`reports async data_url handler failures`, async () => {
    mock_fetch_response(SAMPLE_POSCAR_CONTENT)
    const on_error = vi.fn()
    mount_structure({
      data_url: `/test.poscar`,
      on_file_drop: () => Promise.reject(new Error(`handler failed`)),
      on_error,
    })
    await vi.waitFor(() =>
      expect(on_error).toHaveBeenCalledWith(
        expect.objectContaining({ error_msg: `handler failed` }),
      ),
    )
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

  // A host that passes isosurface_settings alongside data_url (pymatviz) wants its layers on
  // the loaded volume, not the automatic 20 %-of-|max| layer
  const caller_layer = {
    isovalue: 0.05,
    color: `#3b82f6`,
    opacity: 0.6,
    visible: true,
    show_negative: false,
    negative_color: `#ef4444`,
  }
  test.each<[string, IsosurfaceLayer[], (volumes: VolumetricData[]) => IsosurfaceLayer[]]>([
    [`caller layers`, [caller_layer], () => [caller_layer]],
    [`no layers`, [], (volumes) => [auto_volume_layer(volumes[0], 0)]],
  ])(
    `a data_url volume keeps %s supplied before it loaded`,
    async (_label, layers, expected_layers) => {
      mock_fetch_response(SAMPLE_CHGCAR_CONTENT)
      const state = {
        volumetric_data: undefined as VolumetricData[] | undefined,
        isosurface_settings: { ...DEFAULT_ISOSURFACE_SETTINGS, layers },
      }
      mount_structure(bind_props({ data_url: `/density.CHGCAR` }, state))

      await vi.waitFor(() => expect(state.volumetric_data).toHaveLength(1))
      expect(state.isosurface_settings.layers).toEqual(
        expected_layers(state.volumetric_data ?? []),
      )
    },
  )

  // Mount with `/a.json` as a pending (deferred) fetch and wait for the request to be issued
  const mount_pending_url = async (extra: ComponentProps<typeof Structure> = {}) => {
    const responses = deferred_fetch_responses()
    const props = $state<ComponentProps<typeof Structure>>({ data_url: `/a.json`, ...extra })
    mount_structure(props)
    await vi.waitFor(() => expect(responses.has(`/a.json`)).toBe(true))
    return { responses, props }
  }

  test(`ignores a stale structure URL completion`, async () => {
    const on_file_load = vi.fn()
    const { responses, props } = await mount_pending_url({ on_file_load })

    props.data_url = `/b.json`
    await vi.waitFor(() => expect(responses.has(`/b.json`)).toBe(true))
    responses
      .get(`/b.json`)
      ?.shift()
      ?.resolve(new Response(structure_json(`He`)))
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))

    responses
      .get(`/a.json`)
      ?.shift()
      ?.resolve(new Response(structure_json(`H`)))
    await tick()
    expect(on_file_load).toHaveBeenCalledTimes(1)
    expect(on_file_load.mock.calls[0][0].structure?.sites[0]?.species[0]?.element).toBe(`He`)
  })

  test(`an unrelated prop change does not abort and restart an in-flight data_url fetch`, async () => {
    const { responses, props } = await mount_pending_url({
      isosurface_settings: { ...DEFAULT_ISOSURFACE_SETTINGS },
      active_volume_idx: 0,
    })
    props.isosurface_settings = { ...DEFAULT_ISOSURFACE_SETTINGS }
    props.active_volume_idx = 2
    await tick()
    await tick()
    expect(responses.get(`/a.json`), `the first request is still the only one`).toHaveLength(1)
  })

  test(`on_error reports the requested URL, not a superseded data_url`, async () => {
    const on_error = vi.fn()
    const { responses, props } = await mount_pending_url({ on_error })

    props.data_url = `/b.json`
    await vi.waitFor(() => expect(responses.has(`/b.json`)).toBe(true))
    responses.get(`/a.json`)?.shift()?.reject(new Error(`network down`))
    await tick()
    expect(on_error).not.toHaveBeenCalled()

    responses.get(`/b.json`)?.shift()?.reject(new Error(`gone`))
    await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
    expect(on_error.mock.calls[0][0].filename).toBe(`b.json`)
  })

  test(`load error state renders StatusMessage`, async () => {
    vi.stubGlobal(
      `fetch`,
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve(``) }),
    )
    mount_structure({ data_url: `/missing-structure.json` })
    await vi.waitFor(() =>
      expect(document.querySelector(`.status-message.error`)).toBeInstanceOf(HTMLElement),
    )
    const status_msg = doc_query(`.status-message.error`)
    expect(status_msg.getAttribute(`role`)).toBe(`alert`)
    expect(status_msg.textContent).toContain(
      `Failed to fetch /missing-structure.json: HTTP 404`,
    )
  })

  // Deleting an atom writes a new structure object through the binding. Without re-claiming it
  // for the URL the loader reads it as caller-supplied and never fetches the next data_url.
  test(`an edited URL-loaded structure still follows a data_url change`, async () => {
    const fetch_mock = vi.fn((url: string | URL | Request) => {
      const element = request_url(url).includes(`b.json`) ? `He` : `H`
      return Promise.resolve(new Response(structure_json(element, 3)))
    })
    vi.stubGlobal(`fetch`, fetch_mock)
    const on_file_load = vi.fn<(data: StructureHandlerData) => void>()
    const props = $state<ComponentProps<typeof Structure>>({
      data_url: `/a.json`,
      structure: undefined,
      selected_sites: [],
      measure_mode: `edit-atoms`,
      on_file_load,
    })
    mount_structure(props)
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))
    await tick()
    props.selected_sites = [0]
    doc_query(`.structure`).dispatchEvent(keydown(`Delete`, { cancelable: true }))
    await tick()
    expect(props.structure?.sites).toHaveLength(2)

    props.data_url = `/b.json`
    await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(2))
    expect(props.structure?.sites[0]?.species[0]?.element).toBe(`He`)
  })
})
