import { DEFAULTS, type DefaultSettings, merge, SETTINGS_CONFIG } from '$lib/settings'
import { describe, expect, test } from 'vitest'

describe(`Settings`, () => {
  describe(`SETTINGS_CONFIG`, () => {
    test.each([
      [`structure`],
      [`trajectory`],
      [`plot`],
      [`scatter`],
      [`composition`],
      [`color_scheme`],
      [`background_color`],
    ])(`has required section: %s`, (section) => {
      expect(SETTINGS_CONFIG).toHaveProperty(section)
    })

    test.each([
      [`color_scheme`, SETTINGS_CONFIG.color_scheme],
      [`structure.atom_radius`, SETTINGS_CONFIG.structure.atom_radius],
      [`trajectory.auto_play`, SETTINGS_CONFIG.trajectory.auto_play],
      [`plot.grid_lines`, SETTINGS_CONFIG.plot.grid_lines],
      [`scatter.point.size`, SETTINGS_CONFIG.scatter.point.size],
      [`composition.display_mode`, SETTINGS_CONFIG.composition.display_mode],
    ])(`setting %s has value and description`, (_, setting) => {
      expect(setting).toHaveProperty(`value`)
      expect(setting).toHaveProperty(`description`)
      expect(typeof (setting as { description: string }).description).toBe(`string`)
    })

    test.each([
      [`structure.atom_radius`, SETTINGS_CONFIG.structure.atom_radius],
      [`structure.sphere_segments`, SETTINGS_CONFIG.structure.sphere_segments],
      [`trajectory.fps`, SETTINGS_CONFIG.trajectory.fps],
      [`plot.zoom_factor`, SETTINGS_CONFIG.plot.zoom_factor],
      [`scatter.point.size`, SETTINGS_CONFIG.scatter.point.size],
    ])(`numeric setting %s has valid constraints`, (_, setting) => {
      expect(typeof setting.value).toBe(`number`)
      expect(typeof setting.minimum).toBe(`number`)
      expect(setting.maximum).toBeDefined()
      expect(typeof setting.maximum).toBe(`number`)
      expect(setting.minimum).toBeLessThan(setting.maximum as number)
    })

    test.each([
      [`structure.bonding_strategy`, SETTINGS_CONFIG.structure.bonding_strategy],
      [`structure.camera_projection`, SETTINGS_CONFIG.structure.camera_projection],
      [`trajectory.display_mode`, SETTINGS_CONFIG.trajectory.display_mode],
      [`plot.x_scale_type`, SETTINGS_CONFIG.plot.x_scale_type],
      [`plot.y_scale_type`, SETTINGS_CONFIG.plot.y_scale_type],
      [`scatter.symbol_type`, SETTINGS_CONFIG.scatter.symbol_type],
      [`composition.display_mode`, SETTINGS_CONFIG.composition.display_mode],
    ])(`enum setting %s has valid options containing default`, (_, setting) => {
      expect(setting.enum).not.toBeNull()
      expect(Object.keys(setting.enum ?? {}).length).toBeGreaterThan(0)
      expect(Object.keys(setting.enum ?? {})).toContain(setting?.value)
    })
  })

  describe(`DEFAULTS extraction`, () => {
    test.each([
      [`color_scheme`, DEFAULTS.color_scheme, `string`],
      [`background_opacity`, DEFAULTS.background_opacity, `number`],
      [`structure.show_gizmo`, DEFAULTS.structure.show_gizmo, `boolean`],
      [`structure.atom_radius`, DEFAULTS.structure.atom_radius, `number`],
      [`structure.show_atoms`, DEFAULTS.structure.show_atoms, `boolean`],
      [`structure.bond_color`, DEFAULTS.structure.bond_color, `string`],
      [`trajectory.auto_play`, DEFAULTS.trajectory.auto_play, `boolean`],
      [`trajectory.fps`, DEFAULTS.trajectory.fps, `number`],
    ])(`%s has type %s`, (_, value, expected_type) => {
      expect(typeof value).toBe(expected_type)
    })

    test.each([
      [`structure.camera_position`, DEFAULTS.structure.camera_position],
      [`structure.site_label_offset`, DEFAULTS.structure.site_label_offset],
      [`trajectory.fps_range`, DEFAULTS.trajectory.fps_range],
    ])(`%s is an array`, (_, value) => {
      expect(Array.isArray(value)).toBe(true)
    })

    test.each(
      [
        [`structure`, `atom_radius`],
        [`trajectory`, `auto_play`],
        [`composition`, `display_mode`],
      ] as const,
    )(`DEFAULTS.%s has property %s`, (section, prop) => {
      expect(DEFAULTS[section]).toHaveProperty(prop)
    })

    test.each([
      [`structure.camera_position`, DEFAULTS.structure.camera_position, 3],
      [`structure.site_label_offset`, DEFAULTS.structure.site_label_offset, 3],
      [`trajectory.fps_range`, DEFAULTS.trajectory.fps_range, 2],
    ])(`%s has length %i`, (_, arr, len) => {
      expect(arr).toHaveLength(len)
    })
  })

  describe(`merge function`, () => {
    test(`returns DEFAULTS when called without arguments`, () => {
      expect(merge()).toEqual(DEFAULTS)
      expect(merge({})).toEqual(DEFAULTS)
    })

    test(`overrides specified values while preserving defaults`, () => {
      const result = merge({
        color_scheme: `Jmol`,
        structure: { atom_radius: 1.5 },
        trajectory: { auto_play: true },
      } as Partial<DefaultSettings>)

      // Overrides applied
      expect(result.color_scheme).toBe(`Jmol`)
      expect(result.structure.atom_radius).toBe(1.5)
      expect(result.trajectory.auto_play).toBe(true)

      // Defaults preserved
      expect(result.structure.show_atoms).toBe(DEFAULTS.structure.show_atoms)
      expect(result.trajectory.fps).toBe(DEFAULTS.trajectory.fps)
      expect(result.scatter.point.size).toBe(DEFAULTS.scatter.point.size)
    })

    test(`partial updates don't affect other sections`, () => {
      const result = merge(
        { structure: { atom_radius: 2.0 } } as Partial<DefaultSettings>,
      )

      expect(result.structure.atom_radius).toBe(2.0)
      expect(result.trajectory).toEqual(DEFAULTS.trajectory)
      expect(result.composition).toEqual(DEFAULTS.composition)
    })
  })

  describe(`Edge cases and robustness`, () => {
    test(`handles undefined structure input without throwing`, () => {
      expect(() => merge({ structure: undefined } as Partial<DefaultSettings>)).not
        .toThrow()
    })

    test(`merge preserves immutability of DEFAULTS`, () => {
      const original = { ...DEFAULTS }
      merge({ structure: { atom_radius: 999 } } as Partial<DefaultSettings>)
      expect(DEFAULTS).toEqual(original)
    })

    test(`structuredClone prevents mutations from affecting DEFAULTS`, () => {
      // Regression test for "fast spinning" bug: $state(DEFAULTS.structure) without cloning
      // shared the object reference, so mutations leaked between component instances.
      // After browser back/forward navigation, auto_rotate was 150 instead of 0.2.
      const cloned = structuredClone(DEFAULTS.structure)

      // Simulate the mutation that caused the bug (150 = png_dpi value that leaked)
      cloned.auto_rotate = 150
      cloned.rotate_speed = 0.2

      // DEFAULTS must remain at original values
      expect(DEFAULTS.structure.auto_rotate).toBe(0.2)
      expect(DEFAULTS.structure.rotate_speed).toBe(1.0)
    })
  })
})
