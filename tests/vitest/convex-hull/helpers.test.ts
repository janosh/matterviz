import type { ElementSymbol } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import * as helpers from '$lib/convex-hull/helpers'
import { get_convex_hull_stats } from '$lib/convex-hull/thermodynamics'
import type { PhaseData } from '$lib/convex-hull/types'
import { describe, expect, test, vi } from 'vitest'

describe(`helpers: energy color scale + point color`, () => {
  test(`get_energy_color_scale returns null when not energy mode or empty`, () => {
    const color_scale: D3InterpolateName = `interpolateViridis`
    const scale_null = helpers.get_energy_color_scale(`stability`, color_scale, [])
    expect(scale_null).toBeNull()
  })

  test(`get_energy_color_scale maps distances to colors and get_point_color_for_entry uses it`, () => {
    const entries: { e_above_hull?: number }[] = [{ e_above_hull: 0 }, {
      e_above_hull: 0.5,
    }]
    const color_scale: D3InterpolateName = `interpolateViridis`
    const scale = helpers.get_energy_color_scale(`energy`, color_scale, entries)
    expect(scale).not.toBeNull()
    const c0 = helpers.get_point_color_for_entry(
      { e_above_hull: 0 },
      `energy`,
      undefined,
      scale,
    )
    const c1 = helpers.get_point_color_for_entry(
      { e_above_hull: 0.5 },
      `energy`,
      undefined,
      scale,
    )
    expect(typeof c0).toBe(`string`)
    expect(typeof c1).toBe(`string`)
    expect(c0).not.toBe(c1)
  })

  test(`get_point_color_for_entry stability mode`, () => {
    const stable = helpers.get_point_color_for_entry(
      { is_stable: true },
      `stability`,
      undefined,
      null,
    )
    const unstable = helpers.get_point_color_for_entry(
      { is_stable: false },
      `stability`,
      undefined,
      null,
    )
    expect(stable).toBe(`#0072B2`)
    expect(unstable).toBe(`#E69F00`)
  })
})

describe(`helpers: thresholds and tooltips`, () => {
  test(`calc_max_hull_dist_in_data returns robust default and range`, () => {
    expect(helpers.calc_max_hull_dist_in_data([])).toBeCloseTo(0.5)
    const val = helpers.calc_max_hull_dist_in_data([
      { e_above_hull: 0 } as PhaseData,
      { e_above_hull: 0.2 } as PhaseData,
    ])
    expect(val).toBeGreaterThan(0.2)
  })

  test.each([
    {
      name: `very few entries (≤25) → show all (use max_hull_dist)`,
      n_entries: 10,
      max_hull_dist: 0.5,
      static_default: 0.1,
      expected: 0.5,
    },
    {
      name: `at threshold (25 entries) → show all`,
      n_entries: 25,
      max_hull_dist: 0.5,
      static_default: 0.1,
      expected: 0.5,
    },
    {
      name: `many entries (≥100) → use static default`,
      n_entries: 100,
      max_hull_dist: 0.5,
      static_default: 0.1,
      expected: 0.1,
    },
    {
      name: `very many entries → use static default`,
      n_entries: 500,
      max_hull_dist: 0.5,
      static_default: 0.1,
      expected: 0.1,
    },
    {
      name: `mid-range entries (62) → interpolates based on position`,
      n_entries: 62,
      max_hull_dist: 0.5,
      static_default: 0.1,
      // t = (62 - 25) / (100 - 25) = 37/75 ≈ 0.4933
      // result = 0.5 * (1 - t) + 0.1 * t ≈ 0.3027
      expected: 0.5 * (1 - 37 / 75) + 0.1 * (37 / 75),
    },
    {
      name: `linear interpolation at 50 entries`,
      n_entries: 50,
      max_hull_dist: 0.6,
      static_default: 0.2,
      // t = (50 - 25) / (100 - 25) = 25/75 = 1/3
      // result = 0.6 * (1 - 1/3) + 0.2 * 1/3 = 0.6 * 2/3 + 0.2/3 = 0.4 + 0.0667 = 0.4667
      expected: 0.6 * (2 / 3) + 0.2 * (1 / 3),
    },
    {
      name: `handles edge case where max_hull_dist equals static_default`,
      n_entries: 50,
      max_hull_dist: 0.1,
      static_default: 0.1,
      expected: 0.1,
    },
  ])(
    `compute_auto_hull_dist_threshold: $name`,
    ({ n_entries, max_hull_dist, static_default, expected }) => {
      const result = helpers.compute_auto_hull_dist_threshold(
        n_entries,
        max_hull_dist,
        static_default,
      )
      expect(result).toBeCloseTo(expected, 4)
    },
  )

  test(`build_entry_tooltip_text contains key fields`, () => {
    const t1 = helpers.build_entry_tooltip_text(
      { composition: { Li: 1 }, energy: -1 } as PhaseData,
    )
    expect(t1).toMatch(/Li/)
    const t2 = helpers.build_entry_tooltip_text(
      {
        composition: { Li: 1, O: 1 },
        energy: -6,
        e_form_per_atom: -3,
        e_above_hull: 0,
        entry_id: `mp-1`,
      } as PhaseData,
    )
    expect(t2).toMatch(/E<sub>above hull<\/sub>/)
    expect(t2).toMatch(/E<sub>form<\/sub>/)
    expect(t2).toMatch(/ID/)
  })

  test.each([
    {
      name: `ternary stats with mixed stability`,
      elements: [`Li`, `O`, `Na`] as unknown as ElementSymbol[],
      max_arity: 3 as const,
      entries: [
        { composition: { Li: 1 }, energy: 0, e_above_hull: 0, energy_per_atom: 0 },
        { composition: { O: 2 }, energy: -10, e_above_hull: 0, energy_per_atom: -5 },
        {
          composition: { Li: 1, O: 1 },
          energy: -6,
          e_above_hull: 0.05,
          energy_per_atom: -3,
        },
        {
          composition: { Li: 1, Na: 1 },
          energy: -2,
          e_above_hull: 0,
          energy_per_atom: -1,
        },
        {
          composition: { Li: 1, O: 1, Na: 1 },
          energy: -8,
          e_above_hull: 0.1,
          energy_per_atom: -8 / 3,
        },
      ] as PhaseData[],
      expected: {
        total: 5,
        unary: 2,
        binary: 2,
        ternary: 1,
        quaternary: 0,
        elements: 3,
        system: `Na-Li-O`,
      },
    },
    {
      name: `quaternary stats counts quaternary entries`,
      elements: [`H`, `He`, `Li`, `Be`],
      max_arity: 4 as const,
      entries: [
        { composition: { H: 1 }, energy: 0, e_above_hull: 0, energy_per_atom: 0 },
        {
          composition: { H: 1, He: 1, Li: 1, Be: 1 },
          energy: -4,
          e_above_hull: 0.2,
          energy_per_atom: -1,
        },
      ] satisfies PhaseData[],
      expected: {
        total: 2,
        unary: 1,
        binary: 0,
        ternary: 0,
        quaternary: 1,
        elements: 4,
        system: `He-Li-Be-H`,
      },
    } as const,
  ])(`get_convex_hull_stats: $name`, ({ elements, max_arity, entries, expected }) => {
    const stats = get_convex_hull_stats(entries, [...elements], max_arity)
    expect(stats).not.toBeNull()
    if (!stats) return
    expect(stats.total).toBe(expected.total)
    expect(stats.unary).toBe(expected.unary)
    expect(stats.binary).toBe(expected.binary)
    expect(stats.ternary).toBe(expected.ternary)
    expect(stats.quaternary).toBe(expected.quaternary)
    expect(stats.elements).toBe(expected.elements)
    expect(stats.chemical_system).toBe(expected.system)
    expect(stats.energy_range.max).toBeGreaterThanOrEqual(stats.energy_range.min)
    expect(stats.hull_distance.max).toBeGreaterThanOrEqual(stats.hull_distance.avg)
  })
})

describe(`helpers: energy range preserves zero formation energy`, () => {
  test(`zero e_form_per_atom is not dropped in energy range`, () => {
    const entries: PhaseData[] = [
      {
        composition: { H: 1 },
        energy: 0,
        energy_per_atom: -1, // differs from e_form_per_atom to ensure we pick 0 over -1
        e_form_per_atom: 0, // critical zero value
        e_above_hull: 0,
      },
      {
        composition: { He: 1 },
        energy: -2,
        energy_per_atom: -2,
        e_form_per_atom: -2,
        e_above_hull: 0,
      },
    ]
    const stats = get_convex_hull_stats(entries, [`H`, `He`], 3)
    // min should be -2, max should be 0, proving 0 was retained (not replaced by -1)
    expect(stats?.energy_range.min).toBeCloseTo(-2)
    expect(stats?.energy_range.max).toBeCloseTo(0)
  })
})

describe(`helpers: mouse hit testing`, () => {
  test(`find_hull_entry_at_mouse returns null when no canvas`, () => {
    const hit = helpers.find_hull_entry_at_mouse(
      undefined as unknown as HTMLCanvasElement,
      { clientX: 0, clientY: 0 } as unknown as MouseEvent,
      [],
      (x: number, y: number, _z: number) => ({ x, y }),
    )
    expect(hit).toBeNull()
  })

  test(`find_hull_entry_at_mouse detects nearby entry`, () => {
    // Fake canvas with size and client rect
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      clientWidth: 600,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const plot_entries: { x: number; y: number; z: number; visible: boolean }[] = [{
      x: 100,
      y: 100,
      z: 0,
      visible: true,
    }]
    const project = (x: number, y: number) => ({ x, y })
    const hit = helpers.find_hull_entry_at_mouse(
      canvas,
      { clientX: 102, clientY: 102 } as unknown as MouseEvent,
      plot_entries,
      project,
    )
    expect(hit).toBe(plot_entries[0])
  })
})

describe(`helpers: fractional composition`, () => {
  test(`get_fractional_composition normalizes composition`, () => {
    const frac1 = helpers.get_fractional_composition({ Li: 1, O: 1 })
    expect(frac1.Li).toBeCloseTo(0.5)
    expect(frac1.O).toBeCloseTo(0.5)

    const frac2 = helpers.get_fractional_composition({ Li: 2, O: 2 })
    expect(frac2.Li).toBeCloseTo(0.5)
    expect(frac2.O).toBeCloseTo(0.5)

    const frac3 = helpers.get_fractional_composition({ Li: 1, O: 2 })
    expect(frac3.Li).toBeCloseTo(1 / 3)
    expect(frac3.O).toBeCloseTo(2 / 3)
  })

  test(`get_fractional_composition handles empty composition`, () => {
    const frac = helpers.get_fractional_composition({})
    expect(Object.keys(frac).length).toBe(0)
  })

  test(`get_fractional_composition ignores zero amounts`, () => {
    const frac = helpers.get_fractional_composition({ Li: 1, O: 0 })
    expect(frac.Li).toBe(1)
    expect(frac.O).toBeUndefined()
  })
})

describe(`helpers: polymorph statistics`, () => {
  const make_entry = (
    id: string,
    comp: Record<string, number>,
    e_hull?: number,
    e_atom?: number,
    e?: number,
    e_form?: number,
  ): PhaseData =>
    ({
      entry_id: id,
      composition: comp,
      e_above_hull: e_hull,
      energy_per_atom: e_atom,
      energy: e,
      e_form_per_atom: e_form,
    }) as PhaseData

  test.each([
    {
      name: `different compositions → no polymorphs`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0.1),
      all: [make_entry(`1`, { Li: 1, O: 1 }, 0.1), make_entry(`2`, { Li: 1, O: 2 }, 0.2)],
      exp: [0, 0, 0, 0],
    },
    {
      name: `same fractional comp → finds polymorphs, excludes self`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0.1),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0.1),
        make_entry(`2`, { Li: 2, O: 2 }, 0.2),
        make_entry(`3`, { Li: 0.5, O: 0.5 }, 0.05),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `counts higher/lower/equal correctly`,
      entry: make_entry(`2`, { Li: 1, O: 1 }, 0.1),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0.05),
        make_entry(`2`, { Li: 1, O: 1 }, 0.1),
        make_entry(`3`, { Li: 1, O: 1 }, 0.1),
        make_entry(`4`, { Li: 1, O: 1 }, 0.2),
      ],
      exp: [3, 1, 1, 1],
    },
    {
      name: `single entry → no polymorphs`,
      entry: make_entry(`1`, { Li: 1 }, 0),
      all: [make_entry(`1`, { Li: 1 }, 0)],
      exp: [0, 0, 0, 0],
    },
    {
      name: `normalizes stoichiometries (1:2 ≈ 2:4 ≈ 0.5:1)`,
      entry: make_entry(`1`, { Li: 2, O: 4 }, 0.1),
      all: [
        make_entry(`1`, { Li: 2, O: 4 }, 0.1),
        make_entry(`2`, { Li: 1, O: 2 }, 0.15),
        make_entry(`3`, { Li: 0.5, O: 1 }, 0.05),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `all polymorphs higher energy`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0),
        make_entry(`2`, { Li: 1, O: 1 }, 0.1),
        make_entry(`3`, { Li: 1, O: 1 }, 0.2),
      ],
      exp: [2, 2, 0, 0],
    },
    {
      name: `uses energy_per_atom not e_above_hull for ranking`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0.1, -5),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0.1, -5),
        make_entry(`2`, { Li: 1, O: 1 }, 0.2, -4.9),
        make_entry(`3`, { Li: 1, O: 1 }, 0.05, -5.1),
      ],
      exp: [2, 1, 1, 0], // energy_per_atom: -5 vs -4.9 (higher) vs -5.1 (lower)
    },
    {
      name: `REGRESSION: stable polymorphs (e_above_hull=0) ranked by energy_per_atom`,
      entry: make_entry(`1`, { C: 1 }, 0, -9.0), // diamond
      all: [
        make_entry(`1`, { C: 1 }, 0, -9.0), // diamond
        make_entry(`2`, { C: 1 }, 0, -8.9), // graphite (slightly higher energy)
        make_entry(`3`, { C: 1 }, 0, -9.1), // hypothetical lower-energy form
      ],
      exp: [2, 1, 1, 0], // NOT [2, 0, 0, 2] which was the bug!
    },
    {
      name: `prefers e_form_per_atom over energy_per_atom`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, undefined, -5.0, undefined, -3.0),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, undefined, -5.0, undefined, -3.0),
        make_entry(`2`, { Li: 1, O: 1 }, undefined, -5.1, undefined, -2.9),
        make_entry(`3`, { Li: 1, O: 1 }, undefined, -4.9, undefined, -3.1),
      ],
      exp: [2, 1, 1, 0], // Uses e_form: -3.0 vs -2.9 (higher) vs -3.1 (lower), ignores energy_per_atom
    },
    {
      name: `falls back to per-atom when hull missing`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0.1, -5),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0.1, -5),
        make_entry(`2`, { Li: 1, O: 1 }, undefined, -4.9),
        make_entry(`3`, { Li: 1, O: 1 }, 0.05, -5.1),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `falls back to energy/atoms when per-atom missing`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, undefined, undefined, -10),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, undefined, undefined, -10),
        make_entry(`2`, { Li: 1, O: 1 }, undefined, undefined, -12),
        make_entry(`3`, { Li: 1, O: 1 }, undefined, undefined, -8),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `prevents mixing hull (≥0) with raw energy (<0)`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0.1, undefined, -5),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0.1, undefined, -5),
        make_entry(`2`, { Li: 1, O: 1 }, undefined, undefined, -10),
      ],
      exp: [1, 0, 1, 0],
    },
    {
      name: `skips invalid energies (NaN/Infinity/missing)`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, 0.1),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, 0.1),
        make_entry(`2`, { Li: 1, O: 1 }, NaN),
        make_entry(`3`, { Li: 1, O: 1 }, Infinity),
        make_entry(`4`, { Li: 1, O: 1 }),
      ],
      exp: [0, 0, 0, 0],
    },
    {
      name: `returns zeros when entry itself invalid`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, NaN),
      all: [make_entry(`1`, { Li: 1, O: 1 }, NaN), make_entry(`2`, { Li: 1, O: 1 }, 0.1)],
      exp: [0, 0, 0, 0],
    },
    {
      name: `prefers energy_per_atom over raw energy`,
      entry: make_entry(`1`, { Li: 1, O: 1 }, undefined, -5, -10),
      all: [
        make_entry(`1`, { Li: 1, O: 1 }, undefined, -5, -10),
        make_entry(`2`, { Li: 1, O: 1 }, undefined, -4.9, -12),
        make_entry(`3`, { Li: 1, O: 1 }, undefined, -5.1, -8),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `floating-point tolerance in composition`,
      entry: make_entry(`1`, { Li: 1, O: 2 }, 0.1),
      all: [
        make_entry(`1`, { Li: 1, O: 2 }, 0.1),
        make_entry(`2`, { Li: 1 + 1e-10, O: 2 + 2e-10 }, 0.15),
      ],
      exp: [1, 1, 0, 0],
    },
  ])(`$name`, ({ entry, all, exp: [tot, hi, lo, eq] }) => {
    const stats_map = helpers.compute_all_polymorph_stats(all)
    const stats = stats_map.get(entry.entry_id ?? ``)
    expect(stats).toBeDefined()
    expect(stats).toEqual({ total: tot, higher: hi, lower: lo, equal: eq })
    if (stats) expect(stats.total).toBe(stats.higher + stats.lower + stats.equal)
  })
})

describe(`helpers: batch polymorph stats computation`, () => {
  test(`empty and single-entry edge cases`, () => {
    expect(helpers.compute_all_polymorph_stats([]).size).toBe(0)

    const single = helpers.compute_all_polymorph_stats([
      {
        composition: { Li: 1 },
        energy: -1,
        e_above_hull: 0,
        entry_id: `mp-1`,
      } as PhaseData,
    ])
    expect(single.size).toBe(1)
    expect(single.get(`mp-1`)).toEqual({ total: 0, higher: 0, lower: 0, equal: 0 })
  })

  test(`groups polymorphs by fractional composition and ranks by energy`, () => {
    const lio = (
      id: string,
      e_hull: number,
    ) => ({
      composition: { Li: 1, O: 1 },
      e_above_hull: e_hull,
      entry_id: id,
    } as PhaseData)
    const entries = [lio(`mp-1`, 0), lio(`mp-2`, 0.5), lio(`mp-3`, 1), {
      composition: { Li: 2 },
      e_above_hull: 0,
      entry_id: `mp-4`,
    } as PhaseData]

    const stats_map = helpers.compute_all_polymorph_stats(entries)
    expect(stats_map.size).toBe(4)

    expect(stats_map.get(`mp-1`)).toEqual({ total: 2, higher: 2, lower: 0, equal: 0 })
    expect(stats_map.get(`mp-2`)).toEqual({ total: 2, higher: 1, lower: 1, equal: 0 })
    expect(stats_map.get(`mp-3`)).toEqual({ total: 2, higher: 0, lower: 2, equal: 0 })
    expect(stats_map.get(`mp-4`)).toEqual({ total: 0, higher: 0, lower: 0, equal: 0 })
  })

  test(`normalizes stoichiometry and skips entries without entry_id`, () => {
    // Li:O ratio 1:2 and 2:4 are the same fractional composition
    const lio2_1 = {
      composition: { Li: 1, O: 2 },
      e_above_hull: 0,
      entry_id: `mp-1`,
    } as PhaseData
    const lio2_2 = {
      composition: { Li: 2, O: 4 },
      e_above_hull: 0.1,
      entry_id: `mp-2`,
    } as PhaseData
    const no_id = { composition: { Li: 1, O: 1 }, e_above_hull: 0 } as PhaseData

    const stats_map = helpers.compute_all_polymorph_stats([lio2_1, lio2_2, no_id])
    expect(stats_map.size).toBe(2) // no_id is skipped
    expect(stats_map.get(`mp-1`)?.total).toBe(1) // sees mp-2 as polymorph
    expect(stats_map.get(`mp-2`)?.total).toBe(1) // sees mp-1 as polymorph
  })
})

describe(`helpers: get_canvas_text_color`, () => {
  const mock_css = (css_value: string) => {
    globalThis.getComputedStyle = vi.fn(() => ({
      getPropertyValue: () => css_value,
    })) as unknown as typeof getComputedStyle
  }

  test.each([
    // Fallback cases: empty CSS or unsupported functions
    { css: ``, dark: true, expected: `#ffffff`, desc: `empty CSS (dark)` },
    { css: ``, dark: false, expected: `#212121`, desc: `empty CSS (light)` },
    {
      css: `light-dark(#1f2937, #d0d0d0)`,
      dark: true,
      expected: `#ffffff`,
      desc: `light-dark()`,
    },
    { css: `var(--color)`, dark: false, expected: `#212121`, desc: `var()` },
    {
      css: `var(--x, light-dark(#000, #fff))`,
      dark: true,
      expected: `#ffffff`,
      desc: `nested`,
    },
    // Valid CSS colors returned as-is
    { css: `#333`, dark: false, expected: `#333`, desc: `hex short` },
    { css: `#333333`, dark: false, expected: `#333333`, desc: `hex full` },
    { css: `rgb(51, 51, 51)`, dark: false, expected: `rgb(51, 51, 51)`, desc: `rgb()` },
    {
      css: `rgba(0, 0, 0, 0.87)`,
      dark: false,
      expected: `rgba(0, 0, 0, 0.87)`,
      desc: `rgba()`,
    },
    { css: `white`, dark: true, expected: `white`, desc: `named color` },
  ])(`$desc → $expected`, ({ css, dark, expected }) => {
    mock_css(css)
    expect(helpers.get_canvas_text_color(dark)).toBe(expected)
  })

  test(`uses provided element, falls back to documentElement when null`, () => {
    const mock_elem = {} as HTMLElement
    mock_css(`#abc`)
    helpers.get_canvas_text_color(false, mock_elem)
    expect(globalThis.getComputedStyle).toHaveBeenCalledWith(mock_elem)

    mock_css(`#def`)
    helpers.get_canvas_text_color(false, null)
    expect(globalThis.getComputedStyle).toHaveBeenCalledWith(document.documentElement)
  })
})
