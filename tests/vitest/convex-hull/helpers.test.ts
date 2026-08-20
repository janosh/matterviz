import * as draw from '$lib/convex-hull/canvas-draw'
import * as helpers from '$lib/convex-hull/helpers'
import type { ConvexHullEntry, PhaseData } from '$lib/convex-hull/types'
import { MAGNETIC_ORDERING_CATEGORY } from '$lib/convex-hull/types'
import { afterEach, describe, expect, test, vi } from 'vitest'

describe(`helpers: energy color scale + point color`, () => {
  test(`get_energy_color_scale: null outside energy mode/empty, distinct colours otherwise, non-finite ignored`, () => {
    expect(helpers.get_energy_color_scale(`stability`, `interpolateViridis`, [])).toBeNull()
    expect(helpers.get_energy_color_scale(`energy`, `interpolateViridis`, [])).toBeNull()
    const scale = helpers.get_energy_color_scale(`energy`, `interpolateViridis`, [
      { e_above_hull: 0 },
      { e_above_hull: Number.NaN },
      { e_above_hull: Number.POSITIVE_INFINITY },
      { e_above_hull: 0.5 },
    ])
    const color_at = (e_above_hull: number) =>
      helpers.get_point_color_for_entry({ e_above_hull }, `energy`, undefined, scale)
    expect(color_at(0)).toMatch(/^(?<prefix>#|rgb)/)
    expect(color_at(0)).not.toBe(color_at(0.5))
    // Domain is [0, 0.5]: the infinite value did not stretch it
    expect(color_at(0.5)).toBe(color_at(0.5 + 1e-9))
    // No distance → neutral grey
    expect(helpers.get_point_color_for_entry({}, `energy`, undefined, scale)).toBe(`#666`)
  })

  test(`stability mode colours and explicit is_stable=false overriding zero distance`, () => {
    const colors = { stable: `#111`, unstable: `#222` }
    const point_color = (entry: { is_stable?: boolean; e_above_hull?: number }) =>
      helpers.get_point_color_for_entry(entry, `stability`, colors, null)
    expect(point_color({ is_stable: true })).toBe(`#111`)
    expect(point_color({ e_above_hull: 0 })).toBe(`#111`)
    expect(point_color({ e_above_hull: 0.1 })).toBe(`#222`)
    const entry = { is_stable: false, e_above_hull: 0 }
    expect(helpers.entry_is_stable(entry)).toBe(false)
    expect(helpers.visible_entries([entry], true, false)).toEqual([])
    expect(helpers.visible_entries([entry], false, true)).toEqual([entry])
    expect(point_color(entry)).toBe(`#222`)
    expect(
      helpers.get_point_color_for_entry({ is_stable: true }, `stability`, undefined, null),
    ).toBe(`#0072B2`)
  })

  test.each([
    [undefined, false, { e_above_hull: undefined, is_stable: undefined }],
    [NaN, false, { e_above_hull: undefined, is_stable: undefined }],
    [1e-9, false, { e_above_hull: 0, is_stable: true }],
    [-0.2, false, { e_above_hull: 0, is_stable: true }],
    [0.3, false, { e_above_hull: 0.3, is_stable: false }],
    [-0.2, true, { e_above_hull: -0.2, is_stable: false }],
  ])(`compute_hull_stability(%s, exclude=%s) → %o`, (raw, exclude, expected) => {
    expect(helpers.compute_hull_stability(raw, exclude)).toEqual(expected)
  })

  test(`entry_within_hull_dist keeps stable entries and finite distances within the cutoff`, () => {
    expect(helpers.entry_within_hull_dist({ is_stable: true, e_above_hull: 5 }, 0.1)).toBe(
      true,
    )
    expect(helpers.entry_within_hull_dist({ e_above_hull: 0.1 }, 0.1)).toBe(true)
    expect(helpers.entry_within_hull_dist({ e_above_hull: 0.2 }, 0.1)).toBe(false)
    expect(helpers.entry_within_hull_dist({}, 0.1)).toBe(false) // unknown ≠ stable
  })

  test(`hull_distance_range floors the max at 0.1 and skips non-finite values`, () => {
    const entry = (e_above_hull?: number) => ({ composition: {}, energy: 0, e_above_hull })
    expect(helpers.hull_distance_range([])).toEqual([0, 0.1])
    expect(helpers.hull_distance_range([entry(0.02), entry(NaN), entry(0.05)])).toEqual([
      0.02, 0.1,
    ])
    expect(helpers.hull_distance_range([entry(0.3), entry(0.5)])).toEqual([0.3, 0.5])
  })
})

describe(`canvas-draw: markers and hit testing`, () => {
  afterEach(() => vi.unstubAllGlobals())

  // canvas hover/selection drawing must not throw on non-finite sizes
  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    `create_marker_path handles non-finite size %s`,
    (size) => {
      class StubPath2D {
        constructor(public data?: string) {}
        arc(): void {}
      }
      vi.stubGlobal(`Path2D`, StubPath2D)
      // Falls back to a zero-radius marker instead of throwing
      expect(draw.create_marker_path(size)).toEqual(draw.create_marker_path(0))
    },
  )

  test(`marker_path_data returns d3 symbols for known markers, null otherwise`, () => {
    expect(draw.marker_path_data(5, `circle`)).toMatch(/^M/)
    expect(draw.marker_path_data(5, `triangle`)).not.toBe(draw.marker_path_data(5, `circle`))
    expect(draw.marker_path_data(5, `blob` as never)).toBeNull()
  })

  test(`find_hull_entry_at_mouse uses the projected marker radius plus 5px slack`, () => {
    const canvas = {
      getBoundingClientRect: () => ({ left: 10, top: 10 }),
      clientWidth: 600,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const entry = { x: 100, y: 100, z: 0, is_stable: false } as ConvexHullEntry
    const project = (x: number, y: number) => ({ x, y, depth: 0 })
    const hit = (client_x: number) =>
      draw.find_hull_entry_at_mouse(
        canvas,
        { clientX: client_x, clientY: 110 } as MouseEvent,
        [entry],
        project,
      )
    expect(hit(118)).toBe(entry) // 8 px away < 4 + 5
    expect(hit(120)).toBeNull() // 10 px away
    expect(
      draw.find_hull_entry_at_mouse(undefined, {} as MouseEvent, [entry], project),
    ).toBeNull()
  })
})

describe(`helpers: thresholds and tooltips`, () => {
  test(`calc_max_hull_dist_in_data returns robust default and range`, () => {
    expect(helpers.calc_max_hull_dist_in_data([])).toBeCloseTo(0.5)
    const val = helpers.calc_max_hull_dist_in_data([
      { e_above_hull: 0 } as PhaseData,
      { e_above_hull: 0.2 } as PhaseData,
    ])
    expect(val).toBeCloseTo(0.201, 10)
  })

  test(`auto_threshold_reset re-derives on source change unless the user moved the slider`, () => {
    const next = helpers.auto_threshold_reset(0.1)
    const source_a = [1]
    const source_b = [2]
    expect(next(source_a, 0.1, 0.4)).toBe(0.4) // first call: adopt auto value
    expect(next(source_a, 0.4, 0.4)).toBeUndefined() // same source: leave alone
    expect(next(source_b, 0.4, 0.3)).toBe(0.3) // new source, untouched slider: re-derive
    expect(next(source_a, 0.25, 0.4)).toBeUndefined() // user changed it: preserve
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
    const t1 = helpers.build_entry_tooltip_text({
      composition: { Li: 1 },
      energy: -1,
    })
    expect(t1).toBe(`Li (Lithium)\n`)
    const t2 = helpers.build_entry_tooltip_text({
      composition: { Li: 1, O: 1 },
      energy: -6,
      e_form_per_atom: -3,
      e_above_hull: 0,
      entry_id: `mp-1`,
    })
    expect(t2).toBe(
      `\nComposition: Li: ½, O: ½\nE<sub>above hull</sub>: 0 eV/atom\nE<sub>form</sub>: −3 eV/atom\nID: mp-1`,
    )
  })
})

describe(`helpers: composition label entries`, () => {
  const phase = (
    entry_id: string,
    composition: Record<string, number>,
    fields: Partial<PhaseData> = {},
  ): PhaseData => ({ entry_id, composition, energy: 0, ...fields })

  test.each([
    {
      name: `keeps one lowest-energy label entry per normalized composition`,
      entries: [
        phase(`higher-fe-o`, { Fe: 2, O: 3 }, { energy: -1, e_form_per_atom: -0.2 }),
        phase(`lower-fe-o`, { Fe: 4, O: 6 }, { energy: -2, e_form_per_atom: -0.4 }),
        phase(`li-o`, { Li: 1, O: 1 }, { energy: -3, e_form_per_atom: -0.1 }),
      ],
      expected: [`lower-fe-o`, `li-o`],
    },
    {
      name: `does not merge distinct stoichiometries with the same elements`,
      entries: [
        phase(`fe-o`, { Fe: 1, O: 1 }, { e_form_per_atom: -1 }),
        phase(`fe2-o3`, { Fe: 2, O: 3 }, { e_form_per_atom: -2 }),
      ],
      expected: [`fe-o`, `fe2-o3`],
    },
    {
      name: `falls back to per-atom energy computed from total energy`,
      entries: [
        phase(`higher-total`, { A: 2, B: 2 }, { energy: -4 }),
        phase(`lower-total`, { A: 1, B: 1 }, { energy: -3 }),
      ],
      expected: [`lower-total`],
    },
    {
      name: `keeps explicit energy_per_atom ahead of computed total energy`,
      entries: [
        phase(`explicit-per-atom`, { A: 1, B: 1 }, { energy: 0, energy_per_atom: -4 }),
        phase(`computed-per-atom`, { A: 2, B: 2 }, { energy: -12 }),
      ],
      expected: [`explicit-per-atom`],
    },
    {
      name: `skips entries with empty compositions`,
      entries: [phase(`empty`, { Fe: 0 })],
      expected: [],
    },
  ])(`$name`, ({ entries, expected }) => {
    const label_entries = helpers.get_composition_label_entries(entries)
    expect(label_entries.map((entry) => entry.entry_id)).toEqual(expected)
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
      },
    ])
    expect(single.size).toBe(1)
    expect(single.get(`mp-1`)).toEqual({ total: 0, higher: 0, lower: 0, equal: 0 })
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

describe(`helpers: is_entry_highlighted`, () => {
  type E = { entry_id?: string; structure_id?: string }
  const both: E = { entry_id: `mp-1`, structure_id: `s-1` }
  const only_eid: E = { entry_id: `mp-2` }
  const only_sid: E = { structure_id: `s-2` }

  test.each([
    // Edge cases
    [`empty list`, both, [], false],
    [`entry has no ids (string)`, {}, [`mp-1`], false],
    [`entry has no ids (object)`, {}, [both], false],
    // String matching
    [`string matches entry_id`, both, [`mp-1`], true],
    [`string matches structure_id`, both, [`s-1`], true],
    [`string matches only entry_id`, only_eid, [`mp-2`], true],
    [`string matches only structure_id`, only_sid, [`s-2`], true],
    [`string no match`, both, [`x`, `y`], false],
    // Object matching
    [`object structure_id match`, both, [{ structure_id: `s-1` }], true],
    [`object structure_id no match`, both, [{ structure_id: `x` }], false],
    [`object entry_id fallback`, both, [{ entry_id: `mp-1` }], true],
    [`object entry_id no match`, both, [{ entry_id: `x` }], false],
    // REGRESSION: structure_id takes precedence, ignores entry_id match
    [
      `REGRESSION: structure_id priority`,
      both,
      [{ entry_id: `mp-1`, structure_id: `x` }],
      false,
    ],
    // Mixed list
    [`mixed list finds match`, both, [`no`, { structure_id: `s-1` }], true],
    // Null/undefined handling
    [`null/undefined in list`, both, [null, undefined, { entry_id: `mp-1` }], true],
  ] as [string, E, (string | E | null | undefined)[], boolean][])(
    `%s`,
    (_, entry, list, expected) => {
      expect(helpers.is_entry_highlighted(entry, list as (string | E)[])).toBe(expected)
    },
  )
})

describe(`helpers: temperature interpolation`, () => {
  const make_entry = (
    temps: number[],
    energies: number[],
    extra: Partial<PhaseData> = {},
  ): PhaseData => ({
    composition: { Fe: 1 },
    energy: 0,
    temperatures: temps,
    free_energies: energies,
    ...extra,
  })

  describe(`analyze_temperature_data`, () => {
    test.each([
      [`empty entries`, [] as PhaseData[]],
      [
        `entries without temp data`,
        [
          { composition: { Fe: 1 }, energy: 0 },
          { composition: { Li: 1 }, energy: 0 },
        ] as PhaseData[],
      ],
    ])(`returns has_temp_data=false for %s`, (_desc, entries) => {
      const result = helpers.analyze_temperature_data(entries)
      expect(result.has_temp_data).toBe(false)
      expect(result.available_temperatures).toEqual([])
    })

    test(`returns union of temperatures from multiple entries`, () => {
      const entries = [
        make_entry([300, 600], [-1, -2]),
        make_entry([600, 900, 1200], [-1, -2, -3]),
      ]
      const result = helpers.analyze_temperature_data(entries)
      expect(result.has_temp_data).toBe(true)
      expect(result.available_temperatures).toEqual([300, 600, 900, 1200])
    })

    test(`ignores entries with mismatched array lengths`, () => {
      const entries: PhaseData[] = [
        {
          composition: { Fe: 1 },
          energy: 0,
          temperatures: [300, 600],
          free_energies: [-1],
        },
        make_entry([900], [-2]),
      ]
      const result = helpers.analyze_temperature_data(entries)
      expect(result.has_temp_data).toBe(true)
      expect(result.available_temperatures).toEqual([900])
    })

    test(`ignores entries with empty arrays`, () => {
      const entries: PhaseData[] = [
        { composition: { Fe: 1 }, energy: 0, temperatures: [], free_energies: [] },
        make_entry([300, 600], [-1, -2]),
      ]
      const result = helpers.analyze_temperature_data(entries)
      expect(result.available_temperatures).toEqual([300, 600])
    })
  })

  describe(`interpolate_energy_at_temperature`, () => {
    test.each([
      [`midpoint of [300,600]`, make_entry([300, 600], [-1, -2]), 450, 500, -1.5],
      [`quarter of [300,600]`, make_entry([300, 600], [-1, -2]), 375, 500, -1.25],
      // non-uniform spacing: 650 is halfway between knots 400 and 900
      [`non-uniform spacing`, make_entry([300, 400, 900], [-1, -1.2, -2]), 650, 600, -1.6],
      // unsorted temps: tightest bracket 300-600 (gap 300) within max_gap 400
      [
        `tightest bracket (unsorted)`,
        make_entry([900, 300, 600], [-3, -1, -2]),
        450,
        400,
        -1.5,
      ],
    ])(`interpolates %s`, (_desc, entry, temp, max_gap, expected) => {
      expect(helpers.interpolate_energy_at_temperature(entry, temp, max_gap)).toBeCloseTo(
        expected,
      )
    })

    test.each([
      [`T below range`, make_entry([300, 600], [-1, -2]), 200, 500],
      [`T above range`, make_entry([300, 600], [-1, -2]), 700, 500],
      [`gap exceeds max_gap`, make_entry([300, 900], [-1, -2]), 600, 500],
      // unsorted: tightest bracket 300-600 (gap 300) still exceeds max_gap 200
      [
        `tightest bracket exceeds max_gap`,
        make_entry([900, 300, 600], [-3, -1, -2]),
        450,
        200,
      ],
    ])(`returns null when %s`, (_desc, entry, temp, max_gap) => {
      expect(helpers.interpolate_energy_at_temperature(entry, temp, max_gap)).toBeNull()
    })
  })

  describe(`filter_entries_at_temperature with interpolation`, () => {
    test(`includes entries with exact temperature match`, () => {
      const entries = [make_entry([300, 600], [-1, -2])]
      const result = helpers.filter_entries_at_temperature(entries, 300)
      expect(result).toHaveLength(1)
      expect(result[0].energy).toBe(-1)
      expect(result[0].energy_per_atom).toBe(-1) // G(T) is per atom; both fields updated
    })

    test(`interpolates when exact match missing but bracketed (default options)`, () => {
      const entries = [make_entry([300, 600], [-1, -2])]
      const result = helpers.filter_entries_at_temperature(entries, 450)
      expect(result).toHaveLength(1)
      expect(result[0].energy).toBeCloseTo(-1.5)
    })

    test(`excludes entries when interpolation disabled and no exact match`, () => {
      const entries = [make_entry([300, 600], [-1, -2])]
      const result = helpers.filter_entries_at_temperature(entries, 450, {
        interpolate: false,
      })
      expect(result).toHaveLength(0)
    })

    test(`excludes entries when gap exceeds max_interpolation_gap`, () => {
      const entries = [make_entry([300, 900], [-1, -2])]
      const result = helpers.filter_entries_at_temperature(entries, 600, {
        interpolate: true,
        max_interpolation_gap: 500,
      })
      expect(result).toHaveLength(0)
    })

    test(`keeps static entries (no temp data) unchanged`, () => {
      const static_entry: PhaseData = { composition: { Fe: 1 }, energy: -0.5 }
      const entries = [static_entry, make_entry([300, 600], [-1, -2])]
      const result = helpers.filter_entries_at_temperature(entries, 450, {
        interpolate: true,
      })
      expect(result).toHaveLength(2)
      expect(result[0].energy).toBe(-0.5) // static entry unchanged
      expect(result[1].energy).toBeCloseTo(-1.5) // interpolated
    })
  })

  describe(`get_entry_label`, () => {
    test.each([
      {
        desc: `uses reduced_formula when available`,
        entry: { reduced_formula: `LiFeO2`, composition: { Li: 1, Fe: 1, O: 2 } },
        expected: `LiFeO2`,
      },
      {
        desc: `uses name as fallback`,
        entry: { name: `lithium iron oxide`, composition: { Li: 1, Fe: 1, O: 2 } },
        expected: `lithium iron oxide`,
      },
      {
        desc: `prefers reduced_formula over name`,
        entry: {
          reduced_formula: `LiFeO2`,
          name: `lithium iron oxide`,
          composition: { Li: 1, Fe: 1, O: 2 },
        },
        expected: `LiFeO2`,
      },
      {
        desc: `builds formula from composition when both missing`,
        entry: { composition: { Li: 1, Fe: 1, O: 2 } },
        expected: `LiFeO2`,
      },
      {
        desc: `omits subscript 1 for single atoms`,
        entry: { composition: { Na: 1, Cl: 1 } },
        expected: `NaCl`,
      },
      {
        desc: `formats fractional amounts`,
        entry: { composition: { Fe: 2, O: 3 } },
        expected: `Fe2O3`,
      },
      {
        desc: `filters zero-count elements`,
        entry: { composition: { Li: 1, Fe: 0, O: 2 } },
        expected: `LiO2`,
      },
      {
        desc: `handles single element`,
        entry: { composition: { Fe: 1 } },
        expected: `Fe`,
      },
      {
        desc: `handles large integer compositions (unreduced cell)`,
        entry: { composition: { La: 12, Ni: 6, O: 25 } },
        expected: `La12Ni6O25`,
      },
      {
        desc: `handles multi-atom unary composition`,
        entry: { composition: { La: 4 } },
        expected: `La4`,
      },
    ] as { desc: string; entry: Record<string, unknown>; expected: string }[])(
      `$desc`,
      ({ entry, expected }) => {
        expect(helpers.get_entry_label(entry as { composition: Record<string, number> })).toBe(
          expected,
        )
      },
    )

    test(`sorts by elements order when provided`, () => {
      const entry = { composition: { O: 3, Fe: 1, Li: 2 } }
      // Without elements: alphabetical order from Object.entries
      const without = helpers.get_entry_label(entry)
      expect(without).toBe(`O3FeLi2`)
      // With elements: sorted by provided order
      const with_order = helpers.get_entry_label(entry, [`Li`, `Fe`, `O`])
      expect(with_order).toBe(`Li2FeO3`)
    })
  })
})

describe(`helpers: entry categories (magnetic preset)`, () => {
  const mag_entry = (overrides: Partial<PhaseData> = {}): PhaseData => ({
    composition: { Fe: 1, O: 1 },
    energy: -1,
    ...overrides,
  })
  const magnetic = MAGNETIC_ORDERING_CATEGORY
  const cat = (entry: PhaseData) => helpers.get_entry_category(entry, magnetic)

  // oxfmt-ignore
  test.each([
    [`FM`, `FM`], [`fm`, `FM`], [` Ferromagnetic `, `FM`], [`FiM`, `FiM`],
    [`ferrimagnetic`, `FiM`], [`AFM`, `AFM`], [`Antiferromagnetic`, `AFM`], [`NM`, `NM`],
    [`non-magnetic`, `NM`], [`nonmagnetic`, `NM`], [`diamagnetic`, `NM`],
    [`Unknown`, null], [``, null],
  ] as const)(`magnetic preset normalizes '%s' to %s`, (raw, expected) => {
    expect(cat(mag_entry({ magnetic_ordering: raw }))).toBe(expected)
  })

  // oxfmt-ignore
  test.each([
    [`no magnetic fields`, mag_entry(), null],
    [`non-string field`, mag_entry({ data: { ordering: 42 } }), null],
    [`data.magnetic_ordering`, mag_entry({ data: { magnetic_ordering: `AFM` } }), `AFM`],
    [`data.ordering (MP convention)`, mag_entry({ data: { ordering: `FiM` } }), `FiM`],
    [`attributes.magnetic_ordering`, mag_entry({ attributes: { magnetic_ordering: `NM` } }), `NM`],
    [`attributes.ordering`, mag_entry({ attributes: { ordering: `fm` } }), `FM`],
    [`top-level field winning over data dict`, mag_entry({ magnetic_ordering: `FM`, data: { ordering: `AFM` } }), `FM`],
    [`unrecognized top-level falling through to data`, mag_entry({ magnetic_ordering: `Unknown`, data: { ordering: `AFM` } }), `AFM`],
    [`property order beats source order`, mag_entry({ ordering: `FM`, data: { magnetic_ordering: `AFM` } } as Partial<PhaseData>), `AFM`],
  ] as [string, PhaseData, string | null][])(
    `get_entry_category reads %s`,
    (_desc, entry, expected) => expect(cat(entry)).toBe(expected),
  )

  test(`apply_category_markers assigns shapes by ordering, respects explicit markers`, () => {
    const entries = [
      mag_entry({ magnetic_ordering: `FM` }),
      mag_entry({ magnetic_ordering: `FiM` }),
      mag_entry({ magnetic_ordering: `AFM` }),
      mag_entry({ magnetic_ordering: `NM` }),
      { ...mag_entry({ magnetic_ordering: `FM` }), marker: `star` as const },
      mag_entry(), // no ordering -> no marker assigned
    ]
    const markers = helpers.apply_category_markers(entries, magnetic).map((ent) => ent.marker)
    expect(markers).toEqual([`triangle`, `diamond`, `square`, `circle`, `star`, undefined])
  })

  test.each([
    [`no magnetic data`, [mag_entry(), mag_entry({ composition: { Li: 1 } })], magnetic],
    [`null config`, [mag_entry({ magnetic_ordering: `FM` })], null],
  ] as [string, PhaseData[], typeof magnetic | null][])(
    `apply_category_markers returns input array identity-unchanged with %s`,
    (_desc, entries, config) =>
      expect(helpers.apply_category_markers(entries, config)).toBe(entries),
  )

  test(`visible_entries filters by hidden category values`, () => {
    const entries = [
      mag_entry({ magnetic_ordering: `FM`, is_stable: true }),
      mag_entry({ magnetic_ordering: `AFM`, is_stable: true }),
      mag_entry({ magnetic_ordering: `AFM`, is_stable: false, e_above_hull: 0.1 }),
      mag_entry({ is_stable: true }), // no ordering -> unaffected by category filters
    ]
    const visible = (...args: [boolean, boolean, typeof magnetic | null, string[]]) =>
      helpers.visible_entries(entries, ...args)
    expect(visible(true, true, magnetic, [`AFM`])).toEqual([entries[0], entries[3]])
    // Stability filter still applies on top of the category filter
    expect(visible(false, true, magnetic, [`FM`])).toEqual([entries[2]])
    // No hidden values or no category config -> all visible
    expect(visible(true, true, magnetic, [])).toEqual(entries)
    expect(visible(true, true, null, [`AFM`])).toEqual(entries)
  })

  test(`custom category config resolves values, markers and filtering`, () => {
    const electronic = {
      label: `Electronic`,
      property: `electronic_class`,
      markers: { metal: `circle`, semiconductor: `diamond`, insulator: `square` },
      aliases: { 'semi-conductor': `semiconductor` },
    } as const
    const entry = (electronic_class?: string) =>
      ({ composition: { Si: 1 }, energy: -1, electronic_class }) as PhaseData
    // Case-insensitive canonical match + alias normalization + data dict fallback
    expect(helpers.get_entry_category(entry(`Metal`), electronic)).toBe(`metal`)
    expect(helpers.get_entry_category(entry(`semi-conductor`), electronic)).toBe(
      `semiconductor`,
    )
    expect(helpers.get_entry_category(entry(`half-metal`), electronic)).toBeNull()
    expect(
      helpers.get_entry_category(
        { ...entry(), data: { electronic_class: `insulator` } },
        electronic,
      ),
    ).toBe(`insulator`)
    // Marker assignment + filtering use the same config
    const entries = [entry(`metal`), entry(`insulator`), entry()]
    expect(
      helpers.apply_category_markers(entries, electronic).map((ent) => ent.marker),
    ).toEqual([`circle`, `square`, undefined])
    expect(helpers.visible_entries(entries, true, true, electronic, [`metal`])).toEqual([
      entries[1],
      entries[2],
    ])
  })

  test(`build_entry_tooltip_text includes magnetic ordering when present`, () => {
    expect(
      helpers.build_entry_tooltip_text(mag_entry({ magnetic_ordering: `FiM` })),
    ).toContain(`Magnetic: FiM`)
    expect(helpers.build_entry_tooltip_text(mag_entry())).not.toContain(`Magnetic`)
  })
})
