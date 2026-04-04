import { normalize_show_controls } from '$lib/controls'
import { default_controls } from '$lib/convex-hull'
import type {
  ConvexHullControlsType,
  HullFaceColorMode,
  PhaseData,
} from '$lib/convex-hull/types'
import {
  compute_hull_stability,
  get_arity,
  HULL_STABILITY_TOL,
  is_on_hull,
  is_unary_entry,
} from '$lib/convex-hull/helpers'
import { HULL_FACE_COLOR_MODES } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'

describe(`arity helpers`, () => {
  const make = (composition: Record<string, number>) => ({ composition }) as PhaseData

  test(`get_arity counts positive amounts only`, () => {
    expect(get_arity(make({ A: 1, B: 0, C: -1 }))).toBe(1)
  })

  const elements = `A B C D E F G H I J`.split(` `)
  test.each(
    Array.from({ length: 10 }, (_, idx) => {
      const n_elems = idx + 1
      const comp = Object.fromEntries(elements.slice(0, n_elems).map((el) => [el, 1]))
      return [n_elems, comp] as const
    }),
  )(`get_arity returns %i for %j`, (expected, comp) => {
    expect(get_arity(make(comp))).toBe(expected)
  })

  test(`is_unary_entry matches arity 1`, () => {
    expect(is_unary_entry(make({ A: 1 }))).toBe(true)
    expect(is_unary_entry(make({ A: 1, B: 1 }))).toBe(false)
  })
})

describe(`is_on_hull`, () => {
  const make = (overrides: Partial<PhaseData>) =>
    ({ composition: { A: 1 }, energy: -1, ...overrides }) as PhaseData

  test.each([
    [{ is_stable: true }, true, `explicitly stable`],
    [{ is_stable: true, e_above_hull: 0.5 }, true, `is_stable overrides large e_above_hull`],
    [{ e_above_hull: 0 }, true, `e_above_hull exactly 0`],
    [{ e_above_hull: 1e-7 }, true, `e_above_hull within default tolerance`],
    [{ e_above_hull: -1e-8 }, true, `negative e_above_hull (numerical noise)`],
    [{ e_above_hull: 0.1 }, false, `e_above_hull above tolerance`],
    [{ is_stable: false, e_above_hull: 0.1 }, false, `unstable with positive e_above_hull`],
    [{}, false, `neither is_stable nor e_above_hull set`],
    [{ is_stable: false }, false, `is_stable false, no e_above_hull`],
    [{ e_above_hull: undefined }, false, `e_above_hull undefined`],
    [{ exclude_from_hull: true, is_stable: true }, false, `excluded overrides is_stable`],
    [
      { exclude_from_hull: true, e_above_hull: 0 },
      false,
      `excluded overrides zero e_above_hull`,
    ],
    [
      { exclude_from_hull: true, is_stable: true, e_above_hull: 0 },
      false,
      `excluded with both`,
    ],
    [{ exclude_from_hull: false, is_stable: true }, true, `not excluded, stable`],
  ] as [Partial<PhaseData>, boolean, string][])(`%o → %s (%s)`, (overrides, expected) => {
    expect(is_on_hull(make(overrides))).toBe(expected)
  })

  test(`custom tolerance overrides default`, () => {
    const entry = make({ e_above_hull: 0.05 })
    expect(is_on_hull(entry)).toBe(false)
    expect(is_on_hull(entry, 0.1)).toBe(true)
  })
})

describe(`compute_hull_stability`, () => {
  test.each([
    [`above hull`, 0.05, false, 0.05, false],
    [`above hull, excluded`, 0.05, true, 0.05, false],
    [`exactly on hull`, 0, false, 0, true],
    [`on hull but excluded`, 0, true, 0, false],
    [`within tol, clamped to 0`, 1e-7, false, 0, true],
    [`within tol, excluded → raw preserved`, 1e-7, true, 1e-7, false],
    [`negative noise clamped to 0`, -1e-7, false, 0, true],
    [`negative noise, excluded → raw preserved`, -1e-7, true, -1e-7, false],
    [`large negative clamped to 0`, -0.05, false, 0, true],
    [`large negative, excluded → raw preserved`, -0.05, true, -0.05, false],
    [`custom tol=0.1 clamps 0.05 to 0`, 0.05, false, 0, true, 0.1],
    // exactly at tol: not clamped (< is strict) but still stable (<= is inclusive)
    [`exactly at tol boundary`, HULL_STABILITY_TOL, false, HULL_STABILITY_TOL, true],
    [`above tol boundary`, HULL_STABILITY_TOL * 10, false, HULL_STABILITY_TOL * 10, false],
  ] as [string, number, boolean, number, boolean, number?][])(
    `%s`,
    (_label, raw, excluded, expected_e, expected_stable, tol) => {
      const result = compute_hull_stability(raw, excluded, tol)
      expect(result.e_above_hull).toBe(expected_e)
      expect(result.is_stable).toBe(expected_stable)
    },
  )
})

describe(`ConvexHullControlsType.show`, () => {
  test(`default_controls.show is hover and supports hidden array`, () => {
    // Verify default is 'hover'
    expect(default_controls.show).toBe(`hover`)

    // Verify type accepts full ShowControlsProp with hidden controls
    const controls: ConvexHullControlsType = {
      show: { mode: `hover`, hidden: [`reset`, `fullscreen`] },
    }
    const config = normalize_show_controls(controls.show)
    expect(config.mode).toBe(`hover`)
    expect(config.class).toBe(`hover-visible`)
    expect(config.visible(`reset`)).toBe(false)
    expect(config.visible(`info-pane`)).toBe(true)
  })
})

describe(`HullFaceColorMode`, () => {
  // toEqual validates content, order, length, and array-ness in one assertion
  test(`HULL_FACE_COLOR_MODES contains expected modes in order`, () => {
    expect(HULL_FACE_COLOR_MODES).toEqual([
      `uniform`,
      `formation_energy`,
      `dominant_element`,
      `facet_index`,
    ] satisfies HullFaceColorMode[])
  })
})
