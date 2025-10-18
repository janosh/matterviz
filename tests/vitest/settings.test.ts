import { DEFAULTS, type DefaultSettings, merge, SETTINGS_CONFIG } from '$lib/settings'
import { describe, expect, test } from 'vitest'

describe(`Settings`, () => {
  describe(`SETTINGS_CONFIG`, () => {
    test(`should have valid structure with required sections`, () => {
      expect(SETTINGS_CONFIG).toHaveProperty(`structure`)
      expect(SETTINGS_CONFIG).toHaveProperty(`trajectory`)
      expect(SETTINGS_CONFIG).toHaveProperty(`plot`)
      expect(SETTINGS_CONFIG).toHaveProperty(`scatter`)
      expect(SETTINGS_CONFIG).toHaveProperty(`composition`)
      expect(SETTINGS_CONFIG).toHaveProperty(`color_scheme`)
      expect(SETTINGS_CONFIG).toHaveProperty(`background_color`)
    })

    test(`should have consistent setting schema format`, () => {
      const check_setting = (setting: unknown) => {
        expect(setting).toHaveProperty(`value`)
        expect(setting).toHaveProperty(`description`)
        expect(typeof (setting as { description: string }).description).toBe(`string`)
      }

      // Sample across different types and sections
      check_setting(SETTINGS_CONFIG.color_scheme)
      check_setting(SETTINGS_CONFIG.structure.atom_radius)
      check_setting(SETTINGS_CONFIG.trajectory.auto_play)
      check_setting(SETTINGS_CONFIG.plot.grid_lines)
      check_setting(SETTINGS_CONFIG.scatter.point.size)
      check_setting(SETTINGS_CONFIG.composition.display_mode)
    })

    test(`should have numeric constraints where appropriate`, () => {
      const numeric_settings = [
        SETTINGS_CONFIG.structure.atom_radius,
        SETTINGS_CONFIG.structure.sphere_segments,
        SETTINGS_CONFIG.trajectory.fps,
        SETTINGS_CONFIG.plot.zoom_factor,
        SETTINGS_CONFIG.scatter.point.size,
      ]

      numeric_settings.forEach((setting) => {
        expect(typeof setting.value).toBe(`number`)
        expect(typeof setting.minimum).toBe(`number`)
        expect(typeof setting.maximum).toBe(`number`)
        expect(setting.minimum).toBeLessThan(setting.maximum ?? -Infinity)
      })
    })

    test(`should have enum options for categorical settings`, () => {
      const enum_settings = [
        SETTINGS_CONFIG.structure.bonding_strategy,
        SETTINGS_CONFIG.structure.camera_projection,
        SETTINGS_CONFIG.trajectory.display_mode,
        SETTINGS_CONFIG.plot.x_scale_type,
        SETTINGS_CONFIG.plot.y_scale_type,
        SETTINGS_CONFIG.scatter.symbol_type,
        SETTINGS_CONFIG.composition.display_mode,
      ]

      enum_settings.forEach((setting) => {
        expect(typeof setting.enum).toBe(`object`)
        expect(setting.enum).not.toBeNull()
        expect(Object.keys(setting.enum ?? {}).length).toBeGreaterThan(0)
        expect(Object.keys(setting.enum ?? {})).toContain(setting?.value)
      })
    })
  })

  describe(`DEFAULTS extraction`, () => {
    test(`should extract values with correct types`, () => {
      // Check top-level types
      expect(typeof DEFAULTS.color_scheme).toBe(`string`)
      expect(typeof DEFAULTS.background_opacity).toBe(`number`)
      expect(typeof DEFAULTS.structure.show_gizmo).toBe(`boolean`)

      // Check nested structure types
      expect(typeof DEFAULTS.structure.atom_radius).toBe(`number`)
      expect(typeof DEFAULTS.structure.show_atoms).toBe(`boolean`)
      expect(typeof DEFAULTS.structure.bond_color).toBe(`string`)
      expect(Array.isArray(DEFAULTS.structure.camera_position)).toBe(true)

      // Check nested trajectory types
      expect(typeof DEFAULTS.trajectory.auto_play).toBe(`boolean`)
      expect(typeof DEFAULTS.trajectory.fps).toBe(`number`)
      expect(Array.isArray(DEFAULTS.trajectory.fps_range)).toBe(true)
    })

    test(`should maintain proper nested structure`, () => {
      expect(DEFAULTS).toHaveProperty(`structure`)
      expect(DEFAULTS).toHaveProperty(`trajectory`)
      expect(DEFAULTS).toHaveProperty(`plot`)
      expect(DEFAULTS).toHaveProperty(`scatter`)
      expect(DEFAULTS).toHaveProperty(`composition`)
      expect(DEFAULTS.structure).toHaveProperty(`atom_radius`)
      expect(DEFAULTS.trajectory).toHaveProperty(`auto_play`)
      expect(DEFAULTS.composition).toHaveProperty(`display_mode`)
    })

    test(`should extract array values with correct length`, () => {
      expect(DEFAULTS.structure.camera_position).toHaveLength(3)
      expect(DEFAULTS.structure.site_label_offset).toHaveLength(3)
      expect(DEFAULTS.trajectory.fps_range).toHaveLength(2)
    })
  })

  describe(`merge function`, () => {
    test(`should return defaults when no user settings provided`, () => {
      const result = merge()
      expect(result).toEqual(DEFAULTS)
    })

    test(`should override user settings while preserving defaults`, () => {
      const user_settings = {
        color_scheme: `Jmol`,
        structure: { atom_radius: 1.5 },
        trajectory: { auto_play: true },
      } as Partial<DefaultSettings>

      const result = merge(user_settings)

      // Check overrides work
      expect(result.color_scheme).toBe(`Jmol`)
      expect(result.structure.atom_radius).toBe(1.5)
      expect(result.trajectory.auto_play).toBe(true)

      // Check structure is preserved
      expect(result).toHaveProperty(`structure`)
      expect(result).toHaveProperty(`trajectory`)
      expect(result).toHaveProperty(`composition`)

      // Check defaults are preserved where not overridden
      expect(result.structure.show_atoms).toBe(DEFAULTS.structure.show_atoms)
      expect(result.trajectory.fps).toBe(DEFAULTS.trajectory.fps)
      // Check nested point/line properties are preserved
      expect(result.scatter.point.size).toBe(DEFAULTS.scatter.point.size)
      expect(result.scatter.line.width).toBe(DEFAULTS.scatter.line.width)
    })

    test(`should handle partial updates without affecting other sections`, () => {
      const user_settings = { structure: { atom_radius: 2.0 } } as Partial<
        DefaultSettings
      >
      const result = merge(user_settings)

      expect(result.structure.atom_radius).toBe(2.0)
      expect(result.trajectory).toEqual(DEFAULTS.trajectory)
      expect(result.composition).toEqual(DEFAULTS.composition)
    })
  })

  describe(`Edge cases and robustness`, () => {
    test(`should handle empty/undefined inputs gracefully`, () => {
      expect(() => merge()).not.toThrow()
      expect(() => merge({})).not.toThrow()
      expect(() => merge({ structure: undefined } as Partial<DefaultSettings>)).not
        .toThrow()

      expect(merge()).toEqual(DEFAULTS)
      expect(merge({})).toEqual(DEFAULTS)
    })

    test(`should preserve immutability of DEFAULTS`, () => {
      const original = { ...DEFAULTS }
      merge({ structure: { atom_radius: 999 } } as Partial<DefaultSettings>)
      expect(DEFAULTS).toEqual(original)
    })

    test(`should maintain TypeScript type compatibility`, () => {
      const defaults: DefaultSettings = DEFAULTS
      const merged: DefaultSettings = merge({ color_scheme: `test` })

      expect(defaults).toBeDefined()
      expect(merged).toBeDefined()
      expect(typeof merged.color_scheme).toBe(`string`)
      expect(typeof merged.structure.atom_radius).toBe(`number`)
    })

    test(`should handle merge operations efficiently`, () => {
      const start = performance.now()
      for (let idx = 0; idx < 100; idx++) {
        merge({ structure: { atom_radius: Math.random() } } as Partial<DefaultSettings>)
      }
      expect(performance.now() - start).toBeLessThan(20)
    })
  })
})
