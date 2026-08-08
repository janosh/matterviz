import {
  build_structure_props_from_settings,
  DEFAULTS,
  merge,
  SETTINGS_CONFIG,
} from '$lib/settings'
import {
  clear_structure_view_state,
  create_structure_view_state,
  deserialize_structure_view_state,
  load_structure_view_state,
  save_structure_view_state,
  serialize_structure_view_state,
  STRUCTURE_VIEW_STATE_STORAGE_KEY,
  STRUCTURE_VIEW_STATE_VERSION,
} from '$lib/settings/viewer-state'
import { describe, expect, test } from 'vitest'

describe(`Settings`, () => {
  describe(`merge function`, () => {
    test(`returns DEFAULTS for empty inputs`, () => {
      expect(merge()).toEqual(DEFAULTS)
      expect(merge({})).toEqual(DEFAULTS)
      expect(merge({ structure: undefined })).toEqual(DEFAULTS)
    })

    test(`overrides specified values while preserving defaults`, () => {
      const result = merge({
        color_scheme: `Jmol`,
        structure: { atom_radius: 1.5 },
        trajectory: { auto_play: true },
      })

      // Overrides applied
      expect(result.color_scheme).toBe(`Jmol`)
      expect(result.structure.atom_radius).toBe(1.5)
      expect(result.trajectory.auto_play).toBe(true)

      // Defaults preserved
      expect(result.structure.show_atoms).toBe(DEFAULTS.structure.show_atoms)
      expect(result.trajectory.fps).toBe(DEFAULTS.trajectory.fps)
      expect(result.scatter.point.size).toBe(DEFAULTS.scatter.point.size)
    })

    test(`merges symmetry overrides while preserving symmetry defaults`, () => {
      const result = merge({ symmetry: { symprec: 1e-2 } })
      expect(result.symmetry.symprec).toBe(1e-2)
      expect(result.symmetry.algo).toBe(DEFAULTS.symmetry.algo)
    })

    test(`partial updates don't affect other sections`, () => {
      const result = merge({
        structure: { atom_radius: 2.0 },
      })

      expect(result.structure.atom_radius).toBe(2.0)
      expect(result.trajectory).toEqual(DEFAULTS.trajectory)
      expect(result.composition).toEqual(DEFAULTS.composition)
    })
  })

  describe(`Edge cases and robustness`, () => {
    test(`merge preserves immutability of DEFAULTS`, () => {
      const original = { ...DEFAULTS }
      merge({ structure: { atom_radius: 999 } })
      expect(DEFAULTS).toEqual(original)
    })

    // Locks the shipped structure-viewer defaults. The clone test below deliberately does
    // not, since it compares DEFAULTS against values read from DEFAULTS.
    test(`structure viewer ships the intended defaults`, () => {
      expect(DEFAULTS.structure.auto_rotate).toBe(0) // no perpetual spin / render loop
      expect(DEFAULTS.structure.zoom_to_cursor).toBe(false) // wheel zoom stays centered
      expect(DEFAULTS.structure.site_label_bg_color).toBe(`transparent`)
      expect(SETTINGS_CONFIG.structure.fov.minimum).toBe(5) // below the default of 10
    })
  })

  describe(`Convex hull settings`, () => {
    test.each([
      [`ternary`, DEFAULTS.convex_hull.ternary, `uniform`],
      [`quaternary`, DEFAULTS.convex_hull.quaternary, `dominant_element`],
    ])(`%s has valid 3D hull face properties`, (_, settings, expected_color_mode) => {
      // Default color mode (ternary=uniform, quaternary=dominant_element)
      expect(settings.hull_face_color_mode).toBe(expected_color_mode)
      // Required properties with correct types
      expect(typeof settings.show_hull_faces).toBe(`boolean`)
      expect(typeof settings.hull_face_color).toBe(`string`)
      expect(settings.hull_face_opacity).toBeGreaterThanOrEqual(0)
      expect(settings.hull_face_opacity).toBeLessThanOrEqual(1)
    })
  })
})

test(`settings builder groups structure props`, () => {
  const props = build_structure_props_from_settings(DEFAULTS)

  expect(props.scene_props).toMatchObject(DEFAULTS.structure)
  expect(props.scene_props.gizmo).toBe(DEFAULTS.structure.show_gizmo)
  expect(props.lattice_props.cell_edge_width).toBe(DEFAULTS.structure.cell_edge_width)
})

describe(`Structure viewer state serialization`, () => {
  test(`keeps themed backgrounds unset and skips non-portable structure state`, () => {
    const scene_props = {
      get camera_position(): never {
        throw new Error(`camera_position must not be read`)
      },
    }
    const state = create_structure_view_state({ scene_props })
    expect(state.settings.background_color).toBeUndefined()
    expect(state.settings.structure).not.toHaveProperty(`camera_position`)
  })

  test(`round-trips validated settings through the shared JSON format`, () => {
    const state = create_structure_view_state({
      scene_props: {
        atom_radius: 1.25,
        camera_projection: `perspective`,
        vector_configs: { force: { visible: false } },
      },
      lattice_props: { cell_edge_opacity: 0.8 },
      color_scheme: `Jmol`,
      background_color: `#123456`,
      background_opacity: 0.4,
      show_image_atoms: false,
      atom_color_config: {
        mode: `coordination`,
        scale: `interpolatePlasma`,
        scale_type: `continuous`,
      },
      supercell_scaling: `2x3x1`,
      cell_type: `conventional`,
      multi_view: true,
      controls_pane_size: { width: 520, height: 640 },
    })

    const result = deserialize_structure_view_state(serialize_structure_view_state(state))
    if (!result.state) throw new Error(result.error)

    expect(result.state).toMatchObject({
      version: STRUCTURE_VIEW_STATE_VERSION,
      settings: {
        color_scheme: `Jmol`,
        background_color: `#123456`,
        background_opacity: 0.4,
        structure: {
          atom_radius: 1.25,
          camera_projection: `perspective`,
          cell_edge_opacity: 0.8,
          show_image_atoms: false,
          atom_color_mode: `coordination`,
          atom_color_scale: `interpolatePlasma`,
        },
      },
      viewer: {
        supercell_scaling: `2x3x1`,
        cell_type: `conventional`,
        multi_view: true,
        controls_pane_size: { width: 520, height: 640 },
      },
    })
    expect(result.state.settings.structure).not.toHaveProperty(`vector_configs`)
  })

  test(`replaces unknown, wrong-type, and out-of-range values with schema defaults`, () => {
    const result = deserialize_structure_view_state(
      JSON.stringify({
        version: STRUCTURE_VIEW_STATE_VERSION,
        unknown_top_level: true,
        settings: {
          color_scheme: 42,
          background_color: null,
          background_opacity: 2,
          unknown_group: { enabled: true },
          structure: {
            atom_radius: 99,
            show_atoms: `yes`,
            camera_projection: `fisheye`,
            rotation: [0, `bad`, 0],
            polyhedra_excluded_elements: [8],
            unknown_setting: `ignored`,
          },
        },
        viewer: {
          supercell_scaling: `0x2x2`,
          cell_type: `derived`,
          multi_view: `yes`,
          controls_pane_size: { width: -1, height: `large` },
          unknown_viewer_setting: true,
        },
      }),
    )
    if (!result.state) throw new Error(result.error)
    const { settings, viewer } = result.state

    expect(settings).toMatchObject({
      color_scheme: DEFAULTS.color_scheme,
      background_color: DEFAULTS.background_color,
      background_opacity: DEFAULTS.background_opacity,
      structure: {
        atom_radius: DEFAULTS.structure.atom_radius,
        show_atoms: DEFAULTS.structure.show_atoms,
        camera_projection: DEFAULTS.structure.camera_projection,
        rotation: DEFAULTS.structure.rotation,
        polyhedra_excluded_elements: DEFAULTS.structure.polyhedra_excluded_elements,
      },
    })
    expect(settings.structure).not.toHaveProperty(`unknown_setting`)
    expect(settings).not.toHaveProperty(`unknown_group`)
    expect(viewer).toEqual({
      supercell_scaling: `1x1x1`,
      cell_type: `original`,
      multi_view: false,
    })
  })

  test.each([
    [`corrupt JSON`, `{`, `Invalid JSON`],
    [`non-object JSON`, `[]`, `must be a JSON object`],
    [
      `unsupported version`,
      JSON.stringify({ version: 999 }),
      `Unsupported view-state version`,
    ],
  ])(`rejects %s`, (_description, json, expected_error) => {
    expect(deserialize_structure_view_state(json)).toEqual({
      error: expect.stringContaining(expected_error),
    })
  })

  test(`handles missing and corrupt localStorage without throwing`, () => {
    expect(load_structure_view_state()).toBeNull()

    localStorage.setItem(STRUCTURE_VIEW_STATE_STORAGE_KEY, `{bad json`)
    expect(load_structure_view_state()).toBeNull()
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()
  })

  test(`throws on invalid program-created state`, () => {
    const invalid_state = create_structure_view_state()
    Reflect.set(invalid_state, `version`, 999)

    expect(() => save_structure_view_state(invalid_state)).toThrow(
      `Cannot serialize structure view state version 999`,
    )
  })

  test(`persists non-default state and removes a restored default state`, () => {
    const customized = create_structure_view_state({
      scene_props: { atom_radius: 1.5 },
    })
    expect(save_structure_view_state(customized)).toBe(true)
    expect(load_structure_view_state()?.settings.structure.atom_radius).toBe(1.5)

    expect(save_structure_view_state(create_structure_view_state())).toBe(true)
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()
  })

  // backs "Reset all" in the controls pane: the next load must not resurrect the old settings
  test(`clearing drops persisted state`, () => {
    save_structure_view_state(
      create_structure_view_state({ scene_props: { atom_radius: 1.5 } }),
    )
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).not.toBeNull()

    expect(clear_structure_view_state()).toBe(true)
    expect(localStorage.getItem(STRUCTURE_VIEW_STATE_STORAGE_KEY)).toBeNull()
    expect(load_structure_view_state()).toBeNull()
  })
})
