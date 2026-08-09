import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
import {
  create_structure_view_state,
  load_structure_view_state,
  save_structure_view_state,
  serialize_structure_view_state,
  STRUCTURE_VIEW_STATE_STORAGE_KEY,
} from '$lib/settings/viewer-state'
import { default_vector_configs, StructureControls } from '$lib/structure'
import { next_atom_color_config } from '$lib/structure/atom-properties'
import { CNA_TYPE_PROPERTY } from '$lib/structure-id'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  doc_query,
  expect_labelled_settings_grid,
  make_crystal,
  simple_structure,
  trigger_resize_observer,
} from '../setup'

const mount_controls = async (
  props: ComponentProps<typeof StructureControls>,
): Promise<HTMLElement> => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(StructureControls, { target, props })
  await tick()
  return target
}
const mount_bound_controls = (
  state: Record<string, unknown>,
  props: ComponentProps<typeof StructureControls> = {},
): Promise<HTMLElement> =>
  mount_controls(
    bind_props({ structure: simple_structure, controls_open: true, ...props }, state),
  )
const set_input = (input: HTMLInputElement, value: string): void => {
  input.value = value
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
}
const find_label = (root: ParentNode, text: string, exact = false) =>
  [...root.querySelectorAll(`label`)].find((label) =>
    exact ? label.textContent?.trim() === text : label.textContent?.includes(text),
  )
// jsdom has no file picker, so hand the input a FileList stand-in and fire the change it would.
// The handler reads the file asynchronously, so settle on the status line it writes at the end
// rather than on anything it does before awaiting.
const import_settings_file = async (
  target: HTMLElement,
  contents: string,
  expect_status: RegExp,
  name = `shared-view.json`,
): Promise<void> => {
  const input = doc_query<HTMLInputElement>(`input[aria-label="Import viewer settings JSON"]`)
  const file = new File([], name)
  Object.defineProperty(file, `text`, { value: () => Promise.resolve(contents) })
  Object.defineProperty(input, `files`, { configurable: true, value: [file] })
  input.dispatchEvent(new Event(`change`, { bubbles: true }))
  await vi.waitFor(() => {
    expect(target.querySelector(`small.settings-import-status`)?.textContent).toMatch(
      expect_status,
    )
  })
}
type AtomColorConfigProps = NonNullable<
  ComponentProps<typeof StructureControls>['atom_color_config']
>

const trail_stream = (): TrajectoryPositionStream => ({
  positions: new Float64Array(9),
  n_frames: 3,
  n_atoms: 1,
  elements: [`H`],
  lattice_matrices: Array.from({ length: 3 }, () => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]),
  pbc: [false, false, false],
  coords_unwrapped: true,
  frame_stride: 1,
  steps: [0, 1, 2],
})

describe(`StructureControls layout`, () => {
  test(`integrates topic groups and settings search`, async () => {
    const target = await mount_controls({ structure: simple_structure, controls_open: true })
    const groups = [...target.querySelectorAll<HTMLDetailsElement>(`details.settings-group`)]
    expect(
      groups.map((group) => [group.querySelector(`.group-title`)?.textContent, group.open]),
    ).toEqual([
      [`Appearance`, true],
      [`Camera`, false],
      [`Scene`, false],
      [`Preferences`, false],
    ])

    doc_query<HTMLButtonElement>(`.open-search`).click()
    await tick()
    const search = doc_query<HTMLInputElement>(`input[type="search"]`)
    set_input(search, `damp`)
    await tick()
    expect(groups[0]?.hasAttribute(`data-search-hidden`)).toBe(true)
    expect(groups[1]?.hasAttribute(`data-search-hidden`)).toBe(false)
    expect(groups[1]?.open).toBe(true)
    expect(groups[2]?.hasAttribute(`data-search-hidden`)).toBe(true)
    expect(
      target
        .querySelector<HTMLElement>(`[data-key="rotation_damping"]`)
        ?.hasAttribute(`data-search-hidden`),
    ).toBe(false)
  })

  test(`uses labelled grids and schema-backed sliders`, async () => {
    const stream = trail_stream()
    const target = await mount_controls({
      structure: simple_structure,
      controls_open: true,
      show_trajectory_lines: true,
      scene_props: {
        show_bonds: `always`,
        show_polyhedra: `always`,
        show_site_labels: true,
        trajectory_position_stream: stream,
      },
      displacement_summary: { rmsd: 0.1, max_displacement: 0.2, error: null },
    })
    expect_labelled_settings_grid(target)
    expect(
      target.querySelectorAll(`section.grid > label, section.grid > .setting`).length,
    ).toBeGreaterThan(20)

    const sliders = [
      [`Radius`, `atom_radius`, undefined, 0.05],
      [`Auto-rotate speed`, `auto_rotate`, undefined, 0.01],
      [`Trail length`, `trajectory_line_trail_frames`, stream.n_frames, undefined],
      [`Frame stride`, `trajectory_line_frame_stride`, undefined, undefined],
    ] as const
    for (const [label_text, setting, max, step] of sliders) {
      const config = SETTINGS_CONFIG.structure[setting]
      const label = find_label(target, label_text)
      if (!label) throw new Error(`${label_text} slider is missing`)
      const inputs = [...label.querySelectorAll<HTMLInputElement>(`input`)]
      expect(inputs).toHaveLength(2)
      for (const input of inputs) {
        expect(input.min).toBe(`${config.minimum}`)
        expect(input.max).toBe(`${max ?? config.maximum}`)
        const expected_step = step ?? config.multipleOf
        if (expected_step !== undefined) expect(input.step).toBe(`${expected_step}`)
      }
      expect(label.dataset.originalTitle).toBe(config.description)
    }
  })
})

const mount_persisted_controls = async () => {
  save_structure_view_state(
    create_structure_view_state({
      scene_props: {
        atom_radius: 1.35,
        ambient_light: 2.5,
        show_trajectory_lines: true,
      },
      lattice_props: { cell_edge_opacity: 0.75 },
      color_scheme: `Jmol`,
      background_color: `#123456`,
      background_opacity: 0.4,
      show_image_atoms: false,
      supercell_scaling: `2x2x1`,
      multi_view: true,
    }),
  )
  const state = $state({
    scene_props: { ...DEFAULTS.structure },
    lattice_props: {
      cell_edge_opacity: DEFAULTS.structure.cell_edge_opacity,
      cell_surface_opacity: DEFAULTS.structure.cell_surface_opacity,
      cell_edge_color: DEFAULTS.structure.cell_edge_color,
      cell_surface_color: DEFAULTS.structure.cell_surface_color,
      cell_edge_width: DEFAULTS.structure.cell_edge_width,
      show_cell_vectors: DEFAULTS.structure.show_cell_vectors,
    },
    color_scheme: DEFAULTS.color_scheme,
    background_color: undefined,
    background_opacity: DEFAULTS.background_opacity,
    show_image_atoms: DEFAULTS.structure.show_image_atoms,
    show_trajectory_lines: false,
    supercell_scaling: `1x1x1`,
    multi_view: false,
  })
  const target = await mount_bound_controls(state, { persist_settings: true })
  return { target, state }
}

describe(`StructureControls reactive props`, () => {
  test(`restores persisted settings and treats them as the reset snapshot`, async () => {
    const { state, target } = await mount_persisted_controls()
    expect(state).toMatchObject({
      scene_props: { atom_radius: 1.35, ambient_light: 2.5 },
      lattice_props: { cell_edge_opacity: 0.75 },
      color_scheme: `Jmol`,
      background_color: `#123456`,
      background_opacity: 0.4,
      show_image_atoms: false,
      show_trajectory_lines: true,
      supercell_scaling: `2x2x1`,
      multi_view: true,
    })
    // Persisted values define this session's reset snapshot, so they do not immediately
    // masquerade as unsaved changes.
    expect(target.querySelector(`button[aria-label="Reset atoms to defaults"]`)).toBeNull()
  })

  test(`persists changed settings and pane size after debounce`, async () => {
    const { state } = await mount_persisted_controls()
    state.scene_props.atom_radius = 1.6
    const pane = doc_query(`.controls-pane`)
    pane.style.width = `520px`
    pane.style.height = `610px`
    trigger_resize_observer(pane)
    await vi.waitFor(() =>
      expect(load_structure_view_state()).toMatchObject({
        settings: { structure: { atom_radius: 1.6 } },
        viewer: { controls_pane_size: { width: 520, height: 610 } },
      }),
    )
  })

  // Nothing else may change alongside it: comparing against the mount baseline rather than the
  // last save would leave 1.6 on disk, and a second moving part would mask that by making the
  // serialized state differ from the baseline anyway.
  test(`re-saves a setting driven away from and back to its restored value`, async () => {
    const { state } = await mount_persisted_controls()
    state.scene_props.atom_radius = 1.6
    await vi.waitFor(() =>
      expect(load_structure_view_state()?.settings.structure.atom_radius).toBe(1.6),
    )

    state.scene_props.atom_radius = 1.35
    await vi.waitFor(() =>
      expect(load_structure_view_state()?.settings.structure.atom_radius).toBe(1.35),
    )
  })

  test(`reset-all restores defaults and clears persisted state`, async () => {
    const { state } = await mount_persisted_controls()
    state.scene_props.vector_configs = {
      force: { visible: false, color: `#ff0000`, scale: 4 },
    }
    doc_query<HTMLButtonElement>(`button.reset-all-settings`).click()
    await tick()
    expect(state.scene_props.atom_radius).toBe(DEFAULTS.structure.atom_radius)
    expect(state.scene_props.ambient_light).toBe(DEFAULTS.structure.ambient_light)
    expect(state.scene_props.vector_configs).toEqual({})
    expect(state.color_scheme).toBe(DEFAULTS.color_scheme)
    expect(state.background_color).toBeUndefined()
    expect(state.show_trajectory_lines).toBe(DEFAULTS.structure.show_trajectory_lines)
    expect(state.supercell_scaling).toBe(`1x1x1`)
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()
  })

  test(`persistence is opt-in and disabled by default`, async () => {
    save_structure_view_state(
      create_structure_view_state({ scene_props: { atom_radius: 1.5 } }),
    )
    const state = $state({ scene_props: { ...DEFAULTS.structure } })
    await mount_bound_controls(state)

    expect(state.scene_props.atom_radius).toBe(DEFAULTS.structure.atom_radius)
    // Saves are debounced, so asserting after a single tick would hold even with persistence
    // switched on. Drive the clock past the timer to prove nothing was ever queued.
    vi.useFakeTimers()
    try {
      state.scene_props.atom_radius = 2
      await tick()
      await vi.advanceTimersByTimeAsync(1000)
    } finally {
      vi.useRealTimers()
    }
    expect(load_structure_view_state()?.settings.structure.atom_radius).toBe(1.5)
  })

  test(`copies and imports viewer settings through the visible actions`, async () => {
    const state = $state({ scene_props: { ...DEFAULTS.structure } })
    const target = await mount_bound_controls(state, { persist_settings: false })
    vi.mocked(navigator.clipboard.writeText).mockClear()
    doc_query<HTMLButtonElement>(`button[aria-label="Copy viewer settings JSON"]`).click()
    const copied = vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0]
    expect(JSON.parse(copied ?? `{}`)).toMatchObject({
      version: 1,
      settings: { structure: { atom_radius: DEFAULTS.structure.atom_radius } },
    })

    const shared = create_structure_view_state({
      scene_props: { atom_radius: 1.8, camera_projection: `perspective` },
    })
    await import_settings_file(
      target,
      serialize_structure_view_state(shared),
      /Imported shared-view\.json/,
    )
    expect(state.scene_props.atom_radius).toBe(1.8)
    expect(state.scene_props.camera_projection).toBe(`perspective`)
  })

  test.each([
    [`malformed JSON`, `{"nope":`, /Invalid JSON/],
    [
      `unsupported version`,
      JSON.stringify({ version: 999 }),
      /Unsupported view-state version 999; expected 1/,
    ],
  ])(`import rejects %s and leaves settings untouched`, async (_label, payload, status) => {
    const state = $state({ scene_props: { ...DEFAULTS.structure, atom_radius: 1.4 } })
    const target = await mount_bound_controls(state, { persist_settings: false })
    await import_settings_file(target, payload, status)
    expect(target.querySelector(`small.settings-import-status[role="alert"]`)).not.toBeNull()
    expect(state.scene_props.atom_radius).toBe(1.4)
  })

  test(`atom color mode row reset restores its derived scale type`, async () => {
    const state = $state<{ atom_color_config: AtomColorConfigProps }>({
      atom_color_config: next_atom_color_config(
        {
          mode: `element`,
          scale: DEFAULTS.structure.atom_color_scale,
          scale_type: DEFAULTS.structure.atom_color_scale_type,
        },
        DEFAULTS.structure.atom_color_mode,
        [],
      ),
    })
    const structure = structuredClone(simple_structure)
    const first_site = structure.sites[0]
    if (!first_site) throw new Error(`Expected the structure fixture to contain a site`)
    first_site.properties = {
      ...first_site.properties,
      selective_dynamics: [true, true, true],
    }
    const target = await mount_bound_controls(state, { structure })

    const mode_select = doc_query<HTMLSelectElement>(`[data-key="atom_color_mode"] select`)
    mode_select.value = `selective_dynamics`
    mode_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(state.atom_color_config.scale_type).toBe(`categorical`)

    doc_query<HTMLButtonElement>(`[data-key="atom_color_mode"] .setting-reset-button`).click()
    await tick()

    expect(state.atom_color_config).toMatchObject({
      mode: DEFAULTS.structure.atom_color_mode,
      scale_type: DEFAULTS.structure.atom_color_scale_type,
    })
    expect(
      target.querySelector(`[data-key="atom_color_mode"] .setting-reset-button`),
    ).toBeNull()
  })

  // The label colors are CSS strings the scene owns, read through derived bindings rather than
  // mirrored into local state. Only the hex behind a fully transparent background has nowhere
  // in that string to live, so that one value is remembered here.
  test(`site label colors round-trip through scene props`, async () => {
    const bg_color = `color-mix(in srgb, #000000 20%, transparent)`
    const state = $state({
      scene_props: {
        show_site_labels: true,
        site_label_color: `#111111`,
        site_label_bg_color: bg_color,
      },
    })

    const target = await mount_bound_controls(state)
    // mounting the pane reads those strings, it does not rewrite them
    expect(state.scene_props.site_label_color).toBe(`#111111`)
    expect(state.scene_props.site_label_bg_color).toBe(bg_color)

    state.scene_props = {
      ...state.scene_props,
      site_label_color: `#00ff00`,
      site_label_bg_color: `color-mix(in srgb, #123456 70%, transparent)`,
    }
    await tick()

    const opacity_input = doc_query<HTMLInputElement>(
      `[data-key="site_label_bg_opacity"] input[type="number"]`,
    )
    expect(
      target.querySelector<HTMLInputElement>(`input[aria-label="Site label color"]`)?.value,
    ).toBe(`#00ff00`)
    expect(
      target.querySelector<HTMLInputElement>(`input[aria-label="Site label background color"]`)
        ?.value,
    ).toBe(`#123456`)
    expect(opacity_input.valueAsNumber).toBe(0.7)

    // zero opacity collapses to `transparent` rather than an equivalent color-mix, and the
    // swatch keeps the hex so raising the slider again brings the same color back
    set_input(opacity_input, `0`)
    await tick()
    expect(state.scene_props.site_label_bg_color).toBe(`transparent`)
    set_input(opacity_input, `0.5`)
    await tick()
    expect(state.scene_props.site_label_bg_color).toBe(
      `color-mix(in srgb, #123456 50%, transparent)`,
    )
  })

  test(`updates the scale type when the selected property changes`, async () => {
    const structure = {
      ...simple_structure,
      sites: simple_structure.sites.map((site) => ({
        ...site,
        properties: { ...site.properties, charge: 0.5, [CNA_TYPE_PROPERTY]: 1 },
      })),
    }
    const state = $state({
      atom_color_config: {
        mode: `property` as const,
        property_key: `charge`,
        scale: DEFAULTS.structure.atom_color_scale,
        scale_type: `continuous` as const,
      },
    })
    await mount_bound_controls(state, { structure })

    const prop_select = doc_query<HTMLSelectElement>(
      `[data-key="atom_color_property_key"] select`,
    )
    prop_select.value = CNA_TYPE_PROPERTY
    prop_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()

    expect(state.atom_color_config).toMatchObject({
      property_key: CNA_TYPE_PROPERTY,
      scale_type: `categorical`,
    })
  })

  test(`polyhedra center checkbox tracks configured intent, not just render state`, async () => {
    const state = $state({
      scene_props: {
        show_polyhedra: `crystals` as const,
        polyhedra_included_elements: [`O`],
        polyhedra_excluded_elements: [] as string[],
      },
    })

    // nothing rendered yet (e.g. O blocked by CN cap), but O is force-included
    const target = await mount_bound_controls(state, { polyhedra_rendered_elements: [] })

    const center_checkbox = (symbol: string) =>
      find_label(target, symbol, true)?.querySelector<HTMLInputElement>(
        `input[type="checkbox"]`,
      )

    // force-included element shows checked even when not (yet) rendered
    expect(center_checkbox(`O`)?.checked).toBe(true)
    // a non-included, non-rendered element stays unchecked
    expect(center_checkbox(`H`)?.checked).toBe(false)

    // toggling the force-included element off must be reversible from the same control
    center_checkbox(`O`)?.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(state.scene_props.polyhedra_included_elements).not.toContain(`O`)
    expect(center_checkbox(`O`)?.checked).toBe(false)
  })

  test(`renders multi-character element symbols as single center checkboxes`, async () => {
    // flatMap only flattens arrays, not strings, so 2-letter symbols like Fe must
    // stay intact (not split into F + e). Guards against a flatMap -> spread regression.
    const fe_oxide = make_crystal(10, [
      [`Fe`, [0, 0, 0], 3],
      [`O`, [0.15, 0, 0], -2],
    ])
    const state = $state({ scene_props: { show_polyhedra: `crystals` as const } })

    const target = await mount_bound_controls(state, { structure: fe_oxide })

    const center_label = (symbol: string) => find_label(target, symbol, true)

    expect(center_label(`Fe`)).toBeDefined()
    // no split-character artifacts from string iteration
    expect(center_label(`F`)).toBeUndefined()
    expect(center_label(`e`)).toBeUndefined()
  })

  // Sections wire `current_values` and their reset from one shared key list. Check three
  // sections to ensure changes reveal their reset and restore defaults — including Site
  // vectors, whose per-key scales live in vector_configs rather than under a scene_props key
  // and so have to be tracked by hand.
  test(`offers section resets only after changes and restores defaults`, async () => {
    // two vector keys so the per-key scale inputs render at all
    const vector_structure = {
      ...simple_structure,
      sites: simple_structure.sites.map((site) => ({
        ...site,
        properties: { ...site.properties, force: [0.1, 0, 0], magmom: [0, 0.2, 0] },
      })),
    }
    // every key defined at its default, so the mount-time snapshot the reset offer compares
    // against isn't perturbed by `bind:` writing back into an undefined prop
    const state = $state({
      scene_props: { ...DEFAULTS.structure, atom_radius: 1.4 },
    })

    const target = await mount_bound_controls(state, {
      structure: vector_structure,
      displacement_summary: { rmsd: 0.12, max_displacement: 0.34, error: null },
    })
    const vector_defaults = default_vector_configs([`force`, `magmom`])
    state.scene_props.vector_configs = vector_defaults
    await tick()

    const reset_button = (section: string) =>
      target.querySelector<HTMLButtonElement>(
        `button[aria-label="Reset ${section} to defaults"]`,
      )
    // nothing differs from the mount-time snapshot yet, so no section offers a reset
    expect(reset_button(`atoms`)).toBeNull()
    expect(reset_button(`displacement overlay`)).toBeNull()
    expect(reset_button(`polyhedra`)).toBeNull()
    expect(reset_button(`site vectors`)).toBeNull()
    expect(reset_button(`visibility`)).toBeNull()

    const force_scale = doc_query<HTMLInputElement>(
      `[data-key="vector_scale:force"] input[type="number"]`,
    )
    set_input(force_scale, `2.5`)

    state.scene_props.displacement_arrow_color = `#123456`
    state.scene_props.atom_radius = 2.2
    state.scene_props.polyhedra_excluded_elements = [`O`]
    await tick()
    const force_config = state.scene_props.vector_configs?.force
    if (!force_config) throw new Error(`force vector config is missing`)
    expect(force_config.scale).toBe(2.5)
    expect(reset_button(`visibility`)).toBeNull()

    force_config.color = `#ff0000`
    await tick()
    expect(reset_button(`visibility`)).not.toBeNull()
    reset_button(`visibility`)?.click()
    await tick()
    expect(state.scene_props.vector_configs?.force).toMatchObject({
      color: vector_defaults.force?.color,
      scale: 2.5,
    })

    for (const section of [`displacement overlay`, `atoms`, `polyhedra`, `site vectors`]) {
      reset_button(section)?.click()
    }
    await tick()

    expect(state.scene_props.displacement_arrow_color).toBe(
      DEFAULTS.structure.displacement_arrow_color,
    )
    expect(state.scene_props.atom_radius).toBe(1.4)
    expect(state.scene_props.polyhedra_excluded_elements).toEqual([])
    expect(state.scene_props.vector_configs?.force?.scale).toBeNull()
  })

  test(`refreshes site-vector reset snapshots when vector keys change`, async () => {
    const structure_with_vector = (key: string) => ({
      ...simple_structure,
      sites: simple_structure.sites.map((site) => ({
        ...site,
        properties: { ...site.properties, [key]: [0.1, 0.2, 0.3] },
      })),
    })
    const state = $state({
      structure: structure_with_vector(`force`),
      scene_props: { ...DEFAULTS.structure },
    })
    const target = await mount_bound_controls(state, { persist_settings: false })

    state.structure = structure_with_vector(`magmom`)
    await tick()
    expect(
      target.querySelector(`button[aria-label="Reset site vectors to defaults"]`),
    ).toBeNull()
  })

  test.each<[string, TrajectoryPositionStream | null | undefined, boolean, boolean, boolean]>([
    [`hidden without a stream slot`, undefined, false, false, false],
    [`toggle only while stream is pending`, null, false, true, false],
    [`length controls once a stream arrives`, trail_stream(), true, true, true],
    [`length controls stay gated on the trails toggle`, trail_stream(), false, true, false],
  ])(
    `trajectory trails chrome: %s`,
    async (_desc, stream, show_trails, expect_toggle, expect_length) => {
      const state = $state({
        show_trajectory_lines: show_trails,
        scene_props: { trajectory_position_stream: stream },
      })
      const target = await mount_bound_controls(state)

      expect(Boolean(find_label(target, `Show trajectory trails`))).toBe(expect_toggle)
      expect(target.textContent?.includes(`Trail length`) ?? false).toBe(expect_length)
    },
  )

  test(`explains unavailable multi-view and enables it when space becomes available`, async () => {
    const state = $state<{
      multi_view: boolean
      multi_view_unavailable_reason: string | undefined
    }>({
      multi_view: false,
      multi_view_unavailable_reason: `Requires at least 600×400 px. Enlarge the viewer or use fullscreen.`,
    })

    const target = await mount_controls(bind_props({ controls_open: true }, state))

    const multi_view_row = find_label(target, `Multi-view grid`)
    const multi_view_input = multi_view_row?.querySelector<HTMLInputElement>(`input`)
    expect(multi_view_input?.disabled).toBe(true)
    const hint_id = multi_view_input?.getAttribute(`aria-describedby`) ?? ``
    expect(document.querySelector(`#${hint_id}`)?.textContent).toContain(
      state.multi_view_unavailable_reason,
    )

    state.multi_view = true
    await tick()
    expect(multi_view_input?.disabled).toBe(false)
    multi_view_input?.click()
    expect(state.multi_view).toBe(false)

    state.multi_view_unavailable_reason = undefined
    await tick()
    expect(multi_view_input?.disabled).toBe(false)
    multi_view_input?.click()
    expect(state.multi_view).toBe(true)
  })
})
