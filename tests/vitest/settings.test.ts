import { DEFAULTS, merge } from '$lib/settings'
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
