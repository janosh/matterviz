import { DEFAULTS, SETTINGS_CONFIG } from '$lib/settings'
import {
  create_structure_view_state,
  load_structure_view_state,
  save_structure_view_state,
  serialize_structure_view_state,
  STRUCTURE_VIEW_STATE_STORAGE_KEY,
} from '$lib/settings/viewer-state'
import type { AnyStructure } from '$lib'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { default_vector_configs, StructureControls } from '$lib/structure'
import { next_atom_color_config } from '$lib/structure/atom-properties'
import { CNA_TYPE_PROPERTY } from '$lib/structure-id'
import type { TrajectoryPositionStream } from '$lib/trajectory'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  cubic_matrix,
  doc_query,
  expect_labelled_settings_grid,
  IDENTITY_MATRIX3,
  make_crystal,
  make_position_stream,
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

// simple_structure with two vector site properties, so the Site vectors section and its
// per-key scale inputs render
const vector_structure = {
  ...simple_structure,
  sites: simple_structure.sites.map((site) => ({
    ...site,
    properties: { ...site.properties, force: [0.1, 0, 0], magmom: [0, 0.2, 0] },
  })),
}

// three frames of one stationary H atom: enough for the trail-length controls to appear
const trail_stream = (): TrajectoryPositionStream =>
  make_position_stream(
    Array.from({ length: 3 }, () => [[0, 0, 0]]),
    [`H`],
    {
      lattice_matrices: Array.from({ length: 3 }, () => IDENTITY_MATRIX3),
      pbc: [false, false, false],
      coords_unwrapped: true,
    },
  )

describe(`StructureControls inputs`, () => {
  test.each([
    { scaling: `2x2x2`, invalid: false, title_includes: `Valid supercell scaling: 2x2x2` },
    {
      scaling: `invalid`,
      invalid: true,
      title_includes: `Invalid format. Use "2x2x2", "3x1x2", or "2"`,
    },
  ])(`supercell input state: $scaling`, async ({ scaling, invalid, title_includes }) => {
    await mount_controls({
      structure: simple_structure,
      controls_open: true,
      supercell_scaling: scaling,
    })
    const input = doc_query<HTMLInputElement>(`input[placeholder="1x1x1"]`)
    expect(input.getAttribute(`aria-invalid`)).toBe(String(invalid))
    const error_message = document.querySelector(`[data-testid="supercell-input-error"]`)
    expect(error_message !== null).toBe(invalid)
    expect(input.title).toContain(title_includes)
  })

  // Cell styling/tiling needs a lattice; image/vector controls and reduction need periodicity.
  test.each<[string, AnyStructure | undefined, boolean, boolean]>([
    [
      `structure without lattice`,
      { id: `test_no_lattice`, sites: simple_structure.sites },
      false,
      false,
    ],
    [`undefined structure`, undefined, false, false],
    [
      `aperiodic lattice`,
      make_crystal(cubic_matrix(10), [[`H`, [0, 0, 0]]], { pbc: [false, false, false] }),
      true,
      false,
    ],
    [`periodic crystal`, simple_structure, true, true],
  ])(`lattice-dependent controls for %s`, async (_name, structure, cell_rows, reducible) => {
    await mount_controls({ structure, controls_open: true })
    expect(document.querySelectorAll(`input[placeholder="1x1x1"]`).length > 0).toBe(cell_rows)
    expect(document.querySelectorAll(`[data-key="cell_edge_color"]`).length > 0).toBe(
      cell_rows,
    )
    expect(document.querySelectorAll(`[data-key="cell_type"]`).length > 0).toBe(reducible)
    for (const key of [`show_image_atoms`, `show_cell_vectors`]) {
      expect(document.querySelectorAll(`[data-key="${key}"]`).length > 0).toBe(reducible)
    }
    // the toggles that never depend on the cell stay put
    expect(document.querySelectorAll(`[data-key="show_atoms"]`)).toHaveLength(1)
    for (const option of document.querySelectorAll<HTMLOptionElement>(
      `[data-key="atom_color_mode"] option:disabled`,
    )) {
      const hint_id = option.getAttribute(`aria-describedby`)
      expect(hint_id).toBeTypeOf(`string`)
      expect(document.querySelector(`[id="${hint_id}"]`)?.textContent).toContain(option.title)
    }
  })

  const mount_zone_axis = async (matrix: Matrix3x3 = cubic_matrix(10)) => {
    await mount_controls({
      structure: make_crystal(matrix, [[`H`, [0, 0, 0]]]),
      controls_open: true,
    })
    const miller_input = doc_query<HTMLInputElement>(`.zone-axis .miller-input input`)
    return async (typed: string) => {
      miller_input.value = typed
      miller_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
    }
  }
  const zone_axis_error = () => document.querySelector(`.zone-axis .control-error`)
  const view_button = () =>
    [...document.querySelectorAll(`button`)].find((btn) => btn.textContent?.trim() === `View`)

  // zone_axis_direction throws on a cell it cannot resolve a direction in. Resolving it in a
  // $derived means the button is disabled and the reason shown BEFORE any click, so the throw
  // can never escape the handler. `000` never reaches the guard: MillerIndexInput does not
  // emit it, so the previous direction stays usable. The hkl/singular variant is covered
  // directly in scene/camera-orientation.test.ts — the mode is just an argument to the
  // identical guarded call, and happy-dom cannot drive a Svelte <select> binding.
  // oxfmt-ignore
  test.each([
    [`a well-formed cell`, cubic_matrix(10), `001`, null],
    [`a cell with a zero c vector`, [[10, 0, 0], [0, 10, 0], [0, 0, 0]], `001`, /Degenerate uvw direction/],
    [`all-zero indices`, cubic_matrix(10), `000`, null],
  ] as [string, Matrix3x3, string, RegExp | null][])(
    `zone axis View button on %s`,
    async (_name, matrix, typed, expected_error) => {
      const type_indices = await mount_zone_axis(matrix)
      await type_indices(typed)
      expect(view_button()?.disabled).toBe(expected_error !== null)
      if (expected_error) expect(zone_axis_error()?.textContent).toMatch(expected_error)
      else expect(zone_axis_error()).toBeNull()
    },
  )

  test.each([
    {
      site_label_bg_color: `color-mix(in srgb, #ff0000 60%, transparent)`,
      expected_hex_color: `#ff0000`,
      expected_opacity: 0.6,
    },
    {
      site_label_bg_color: `color-mix(in srgb, #00ff00 150%, transparent)`,
      expected_hex_color: `#00ff00`,
      expected_opacity: 1,
    },
  ])(
    `parses and resets site label background from $site_label_bg_color`,
    async ({ site_label_bg_color, expected_hex_color, expected_opacity }) => {
      await mount_controls({
        structure: simple_structure,
        controls_open: true,
        scene_props: { show_site_labels: true, site_label_bg_color },
      })

      const bg_color_input = doc_query<HTMLInputElement>(
        `input[aria-label="Site label background color"]`,
      )
      const opacity_input = doc_query<HTMLInputElement>(
        `[data-key="site_label_bg_opacity"] input[type="number"]`,
      )
      expect(bg_color_input.value).toBe(expected_hex_color)
      expect(opacity_input.valueAsNumber).toBe(expected_opacity)

      bg_color_input.value = `#123456`
      bg_color_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      opacity_input.value = `0.5`
      opacity_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()

      doc_query<HTMLButtonElement>(`button[aria-label="Reset labels to defaults"]`).click()
      await tick()

      // reset restores what the pane mounted with, so the two halves of the one bg string come
      // back together even though a separate row drives each
      expect(bg_color_input.value).toBe(expected_hex_color)
      expect(opacity_input.valueAsNumber).toBe(expected_opacity)
    },
  )
})

describe(`StructureControls schema rows`, () => {
  // Every uniform row is generated from SETTINGS_CONFIG: the entry's value type picks the
  // control and the control shows the bound value. Rows with accessors (the show_image_atoms /
  // show_trajectory_lines bindables) write back to their own target, not scene_props.
  test(`render the control matching each setting's type, value and bounds`, async () => {
    const state = $state({
      scene_props: {
        ...DEFAULTS.structure,
        show_bonds: `always` as const,
        show_polyhedra: `always` as const,
        show_site_labels: true,
        auto_bond_order: true,
        polyhedra_color_mode: `uniform` as const,
        bond_thickness: 0.2,
        cell_edge_color: `#123456`,
        show_cell_vectors: false,
      },
      show_image_atoms: false,
    })
    const target = await mount_bound_controls(state, {
      displacement_summary: { rmsd: 0.1, max_displacement: 0.2, error: null },
    })
    const query = (selector: string): HTMLElement => {
      const node = target.querySelector<HTMLElement>(selector)
      if (!node) throw new Error(`No element found for selector: ${selector}`)
      return node
    }
    const row_of = (key: string) => query(`[data-key="${key}"]`)

    const selects = [
      [`bonding_strategy`, DEFAULTS.structure.bonding_strategy],
      [`aromatic_display`, DEFAULTS.structure.aromatic_display],
      [`camera_projection`, DEFAULTS.structure.camera_projection],
      [`vector_color_mode`, undefined], // no vectors on this structure, so no row
      [`trajectory_line_wrap_mode`, undefined], // no trajectory stream either
    ] as const
    for (const [key, expected] of selects) {
      const select = target.querySelector<HTMLSelectElement>(`[data-key="${key}"] select`)
      expect(select?.value, key).toBe(expected)
      if (!select) continue
      expect([...select.options].map((option) => option.value)).toEqual(
        Object.keys(SETTINGS_CONFIG.structure[key].enum ?? {}),
      )
    }

    const checkboxes = [
      [`auto_bond_order`, true],
      [`same_size_atoms`, false],
      [`zoom_to_cursor`, false],
      [`show_cell_vectors`, false],
      [`show_image_atoms`, false], // local bindable row
      [`show_displacement_arrows`, true],
    ] as const
    for (const [key, expected] of checkboxes) {
      const checkbox = row_of(key).querySelector<HTMLInputElement>(`input[type="checkbox"]`)
      expect(checkbox?.checked, key).toBe(expected)
    }

    const swatches = [
      [`bond_color`, DEFAULTS.structure.bond_color],
      [`cell_edge_color`, `#123456`],
      [`displacement_arrow_color`, DEFAULTS.structure.displacement_arrow_color],
      [`site_label_color`, DEFAULTS.structure.site_label_color],
    ] as const
    for (const [key, expected] of swatches) {
      const swatch = row_of(key).querySelector<HTMLInputElement>(`input[type="color"]`)
      expect(swatch?.value, key).toBe(expected)
    }
    // uniform polyhedra color mode pairs the mode select with its color swatch in ONE row
    const polyhedra_color_row = row_of(`polyhedra_color`)
    expect(polyhedra_color_row.querySelector(`select`)?.value).toBe(`uniform`)
    expect(
      polyhedra_color_row.querySelector<HTMLInputElement>(`input[type="color"]`)?.value,
    ).toBe(DEFAULTS.structure.polyhedra_color)

    for (const [key, expected] of [
      [`bond_thickness`, 0.2],
      [`directional_light`, DEFAULTS.structure.directional_light],
      [`polyhedra_min_neighbors`, DEFAULTS.structure.polyhedra_min_neighbors],
    ] as const) {
      const schema = SETTINGS_CONFIG.structure[key]
      const inputs = [...row_of(key).querySelectorAll<HTMLInputElement>(`input`)]
      expect(inputs.map((input) => input.type).toSorted()).toEqual([`number`, `range`])
      for (const input of inputs) {
        expect(input.valueAsNumber, key).toBe(expected)
        expect(input.min).toBe(`${schema.minimum}`)
        expect(input.max).toBe(`${schema.maximum}`)
      }
    }

    // writes land on the row's own target
    const bond_color = query(`[data-key="bond_color"] input[type="color"]`)
    if (!(bond_color instanceof HTMLInputElement)) throw new Error(`bond color swatch missing`)
    set_input(bond_color, `#abcdef`)
    const cell_vectors = row_of(`show_cell_vectors`).querySelector<HTMLInputElement>(`input`)
    cell_vectors?.click()
    const image_atoms = row_of(`show_image_atoms`).querySelector<HTMLInputElement>(`input`)
    image_atoms?.click()
    const thickness =
      row_of(`bond_thickness`).querySelector<HTMLInputElement>(`input[type="number"]`)
    if (!thickness) throw new Error(`bond thickness input missing`)
    set_input(thickness, `0.35`)
    await tick()
    expect(state.scene_props.bond_color).toBe(`#abcdef`)
    expect(state.scene_props.bond_thickness).toBe(0.35)
    expect(state.scene_props.show_cell_vectors).toBe(true)
    expect(state.show_image_atoms).toBe(true)
    // ...and nothing leaked onto scene_props from the accessor row
    expect(state.scene_props.show_image_atoms).toBe(DEFAULTS.structure.show_image_atoms)
  })

  // The full row inventory with every conditional section open, in pane order. A row that
  // silently drops out of the schema tables (or loses its data-key) fails here by name.
  test(`render every control row and write each back to its own target`, async () => {
    const stream = trail_stream()
    const state = $state({
      scene_props: {
        ...DEFAULTS.structure,
        show_bonds: `always` as const,
        show_polyhedra: `always` as const,
        show_site_labels: true,
        auto_bond_order: true,
        polyhedra_color_mode: `uniform` as const,
        vector_color_mode: `uniform` as const,
        trajectory_position_stream: { ...stream, elements: [`H`, `O`], n_atoms: 2 },
      },
      show_image_atoms: true,
      show_trajectory_lines: true,
      multi_view: false,
    })
    const target = await mount_bound_controls(state, {
      structure: vector_structure,
      displacement_summary: { rmsd: 0.1, max_displacement: 0.2, error: null },
    })
    // oxfmt-ignore
    expect([...target.querySelectorAll<HTMLElement>(`[data-key]`)].map((row) => row.dataset.key)).toEqual([
      // Visibility
      `show_atoms`, `show_image_atoms`, `show_site_labels`, `show_site_indices`, `show_cell_vectors`, `vector_config:force`, `vector_config:magmom`, `show_bonds`, `show_polyhedra`,
      // Atoms
      `atom_radius`, `same_size_atoms`, `color_scheme`, `atom_color_mode`,
      // Bonds
      `bonding_strategy`, `auto_bond_order`, `aromatic_display`, `bond_color`, `bond_thickness`,
      // Polyhedra
      `polyhedra_opacity`, `polyhedra_color`, `polyhedra_edges`, `polyhedra_hide_center_atoms`, `polyhedra_min_neighbors`, `polyhedra_max_neighbors`, `polyhedra_centers`,
      // Labels
      `site_label_color`, `site_label_size`, `site_label_padding`, `site_label_bg_hex`, `site_label_bg_opacity`, `site_label_offset`,
      // Site vectors
      `vector_scale`, `vector_normalize`, `vector_uniform_thickness`, `vector_color_mode`, `vector_color`, `vector_origin_gap`, `vector_scale:force`, `vector_scale:magmom`,
      // Cell
      `cell_type`, `supercell_scaling`, `cell_edge_color`, `cell_edge_opacity`, `cell_surface_color`, `cell_surface_opacity`,
      // Camera
      `camera_projection`, `auto_rotate`, `zoom_to_cursor`, `multi_view`, `rotation`, `zone_axis`,
      `rotate_speed`, `zoom_speed`, `pan_speed`, `rotation_damping`,
      // Scene
      `background_color`, `background_opacity`, `directional_light`, `ambient_light`,
      // Overlays
      `show_displacement_arrows`, `displacement_arrow_scale`, `displacement_arrow_color`,
      `show_trajectory_lines`, `trajectory_line_elements`, `trajectory_line_trail_frames`, `trajectory_line_frame_stride`, `trajectory_line_color_mode`, `trajectory_line_wrap_mode`,
    ])

    // Every schema-backed slider writes a number (never the input's string) to the object
    // that owns the key, and every schema-backed checkbox flips its own target.
    const owner_of = (key: string): Record<string, unknown> =>
      key in state && key !== `scene_props` ? state : state.scene_props
    const schema_rows = [...target.querySelectorAll<HTMLElement>(`label[data-key]`)].filter(
      (row) => (row.dataset.key ?? ``) in SETTINGS_CONFIG.structure,
    )
    expect(schema_rows.length).toBeGreaterThan(40)
    for (const row of schema_rows) {
      const key = row.dataset.key ?? ``
      const owner = owner_of(key)
      const number = row.querySelector<HTMLInputElement>(`input[type="number"]`)
      const checkbox = row.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
      if (number) {
        const written = (Number(number.min) + Number(number.max)) / 2
        set_input(number, `${written}`)
        await tick()
        expect(owner[key], key).toBe(written)
      } else if (checkbox && !key.startsWith(`show_`)) {
        // (show_* toggles unmount the sections the later rows live in)
        const before = owner[key]
        checkbox.click()
        await tick()
        expect(owner[key], key).toBe(!before)
      }
    }
    // the cell rows are plain scene_props rows
    expect(state.scene_props.cell_edge_opacity).toBe(0.5)
  })

  test(`conditional rows follow their gate`, async () => {
    const state = $state({
      scene_props: {
        ...DEFAULTS.structure,
        show_bonds: `always` as const,
        auto_bond_order: false,
      },
    })
    const target = await mount_bound_controls(state)
    expect(target.querySelector(`[data-key="aromatic_display"]`)).toBeNull()
    state.scene_props.auto_bond_order = true
    await tick()
    expect(target.querySelector(`[data-key="aromatic_display"] select`)).not.toBeNull()
  })

  test(`per-axis inputs replace one component and leave the others`, async () => {
    const state = $state({
      scene_props: {
        ...DEFAULTS.structure,
        show_site_labels: true,
        site_label_offset: [0.1, 0.2, 0.3] as Vec3,
        rotation: [0, Math.PI, 0] as Vec3,
      },
    })
    const target = await mount_bound_controls(state)
    const offset_inputs = target.querySelectorAll<HTMLInputElement>(
      `[data-key="site_label_offset"] input`,
    )
    expect(offset_inputs).toHaveLength(3)
    set_input(offset_inputs[2], `-0.5`)
    const rotation_inputs = target.querySelectorAll<HTMLInputElement>(
      `[data-key="rotation"] input[type="number"]`,
    )
    expect([...rotation_inputs].map((input) => input.valueAsNumber)).toEqual([0, 180, 0])
    set_input(rotation_inputs[0], `450`) // clamped to 360, i.e. wraps to 0
    set_input(rotation_inputs[2], `90`)
    await tick()
    expect(state.scene_props.site_label_offset).toEqual([0.1, 0.2, -0.5])
    expect(state.scene_props.rotation).toEqual([0, Math.PI, Math.PI / 2])
  })

  // Rotation number inputs clamp to [0, 360] then wrap 360 -> 0; the paired slider shows it
  test.each([
    [`999`, 0], // above max clamps to 360, which wraps to 0
    [`-90`, 0], // below min clamps to 0
    [`360`, 0], // the wrap boundary itself
    [`359`, 359],
    [`180`, 180],
  ])(`rotation input %s lands on %i degrees`, async (typed, degrees) => {
    const state = $state({ scene_props: { ...DEFAULTS.structure } })
    const target = await mount_bound_controls(state)
    const [number_input] = target.querySelectorAll<HTMLInputElement>(
      `[data-key="rotation"] input[type="number"]`,
    )
    const [range_input] = target.querySelectorAll<HTMLInputElement>(
      `[data-key="rotation"] input[type="range"]`,
    )
    set_input(number_input, typed)
    await tick()
    expect(range_input.valueAsNumber).toBe(degrees)
    expect(state.scene_props.rotation[0]).toBeCloseTo((degrees * Math.PI) / 180, 12)
  })
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
    expect(groups[0]?.matches(`:first-of-type`)).toBe(true)
    expect(groups[3]?.matches(`:first-of-type`)).toBe(false)

    doc_query<HTMLButtonElement>(`.open-search`).click()
    await tick()
    const search = doc_query<HTMLInputElement>(`input[type="search"]`)
    set_input(search, `damp`)
    await tick()
    expect(groups[0]?.hasAttribute(`data-search-hidden`)).toBe(true)
    expect(groups[1]?.hasAttribute(`data-search-hidden`)).toBe(false)
    expect(groups[1]?.open).toBe(true)
    expect(groups[2]?.hasAttribute(`data-search-hidden`)).toBe(true)
    expect(groups[3]?.hasAttribute(`data-search-hidden`)).toBe(true)
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
      expect(inputs[1].getAttribute(`aria-label`)).toBe(config.description)
    }
  })
})

const mount_persisted_controls = async () => {
  save_structure_view_state(
    create_structure_view_state({
      scene_props: { atom_radius: 1.35, ambient_light: 2.5, cell_edge_opacity: 0.75 },
      show_trajectory_lines: true,
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
      scene_props: { atom_radius: 1.35, ambient_light: 2.5, cell_edge_opacity: 0.75 },
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
