import * as draw from '$lib/convex-hull/canvas-draw'
import * as helpers from '$lib/convex-hull/helpers'
import { calculate_e_above_hull, get_energy_per_atom } from '$lib/convex-hull/thermodynamics'
import type { ConvexHullEntry, PhaseData } from '$lib/convex-hull/types'
import { MAGNETIC_ORDERING_CATEGORY } from '$lib/convex-hull/types'
import { afterEach, describe, expect, test, vi } from 'vitest'

// Entry with only the fields given (no energy default): the polymorph metric selection
// depends on which energy fields are absent
const phase = (
  entry_id: string,
  composition: Record<string, number>,
  fields: Partial<PhaseData> = {},
): PhaseData => ({ entry_id, composition, ...fields }) as PhaseData

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

  test(`find_hull_entry_at_mouse uses the scaled marker radius plus 5px slack, front point first`, () => {
    const canvas = {
      getBoundingClientRect: () => ({ left: 10, top: 10 }),
    } as unknown as HTMLCanvasElement
    const entry = { x: 100, y: 100, z: 0, is_stable: false } as ConvexHullEntry
    const point = { entry, projected: { x: 100, y: 100, depth: 0 } }
    const hit = (client_x: number, scale = 1) =>
      draw.find_hull_entry_at_mouse(
        canvas,
        { clientX: client_x, clientY: 110 } as MouseEvent,
        [point],
        scale,
      )
    expect(hit(118)).toBe(entry) // 8 px away < 4 + 5
    expect(hit(120)).toBeNull() // 10 px away
    expect(hit(120, 2)).toBe(entry) // radius scales with the container: 4 * 2 + 5 = 13 > 10
    expect(draw.find_hull_entry_at_mouse(undefined, {} as MouseEvent, [point], 1)).toBeNull()
    // points are painted in array order, so the last one at the cursor is the one on top
    const behind = { ...point, entry: { ...entry, entry_id: `behind` } }
    expect(
      draw.find_hull_entry_at_mouse(
        canvas,
        { clientX: 110, clientY: 110 } as MouseEvent,
        [behind, point],
        1,
      ),
    ).toBe(entry)
  })

  test(`draw_corner_labels offsets 2D and 3D corners away from their centroid`, () => {
    const fillText = vi.fn()
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D
    const project = vi.fn((x: number, y: number, z: number) => ({ x, y, depth: z }))
    draw.draw_corner_labels(
      ctx,
      [
        [1, 0],
        [0, 1, 1],
      ],
      [0, 0, 0],
      {
        project,
        elements: [`H`, `He`],
        text_color: `black`,
        font_size: 16,
        offset: 0.1,
      },
    )

    expect(project).toHaveBeenNthCalledWith(1, 1.1, 0, 0)
    const direction_scale = 0.1 / Math.sqrt(2)
    expect(project).toHaveBeenNthCalledWith(2, 0, 1 + direction_scale, 1 + direction_scale)
    expect(fillText).toHaveBeenNthCalledWith(1, `H`, 1.1, 0)
    expect(fillText).toHaveBeenNthCalledWith(2, `He`, 0, 1 + direction_scale)
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
      // t = (62 - 25) / (100 - 25) = 37/75; result = 0.5 * (1 - t) + 0.1 * t
      expected: 0.302667,
    },
    {
      name: `linear interpolation at 50 entries`,
      n_entries: 50,
      max_hull_dist: 0.6,
      static_default: 0.2,
      // t = 1/3; result = 0.6 * 2/3 + 0.2 * 1/3
      expected: 0.466667,
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
  const lio = (entry_id: string, fields: Partial<PhaseData>) =>
    phase(entry_id, { Li: 1, O: 1 }, fields)

  // Stats for entry `1`, as [total, higher, lower, equal]. One row per energy-metric
  // selection branch (e_form > energy_per_atom > energy/atoms > e_above_hull > none).
  test.each([
    {
      name: `different compositions → no polymorphs`,
      all: [
        lio(`1`, { e_above_hull: 0.1 }),
        phase(`2`, { Li: 1, O: 2 }, { e_above_hull: 0.2 }),
      ],
      exp: [0, 0, 0, 0],
    },
    {
      name: `same fractional comp (1:1 ≈ 2:2 ≈ 0.5:0.5) → polymorphs, excludes self`,
      all: [
        lio(`1`, { e_above_hull: 0.1 }),
        phase(`2`, { Li: 2, O: 2 }, { e_above_hull: 0.2 }),
        phase(`3`, { Li: 0.5, O: 0.5 }, { e_above_hull: 0.05 }),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `counts higher/lower/equal`,
      all: [
        lio(`1`, { e_above_hull: 0.1 }),
        lio(`2`, { e_above_hull: 0.05 }),
        lio(`3`, { e_above_hull: 0.1 }),
        lio(`4`, { e_above_hull: 0.2 }),
      ],
      exp: [3, 1, 1, 1],
    },
    {
      // e_above_hull alone would report every polymorph as equal
      name: `REGRESSION: stable polymorphs (e_above_hull=0) ranked by energy_per_atom`,
      all: [
        phase(`1`, { C: 1 }, { e_above_hull: 0, energy_per_atom: -9.0 }), // diamond
        phase(`2`, { C: 1 }, { e_above_hull: 0, energy_per_atom: -8.9 }), // graphite
        phase(`3`, { C: 1 }, { e_above_hull: 0, energy_per_atom: -9.1 }),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      // energy_per_atom would rank 2 lower and 3 higher
      name: `prefers e_form_per_atom over energy_per_atom`,
      all: [
        lio(`1`, { energy_per_atom: -5.0, e_form_per_atom: -3.0 }),
        lio(`2`, { energy_per_atom: -5.1, e_form_per_atom: -2.9 }),
        lio(`3`, { energy_per_atom: -4.9, e_form_per_atom: -3.1 }),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      // energy/atoms would rank 2 lower and 3 higher
      name: `prefers energy_per_atom over raw energy`,
      all: [
        lio(`1`, { energy_per_atom: -5, energy: -10 }),
        lio(`2`, { energy_per_atom: -4.9, energy: -12 }),
        lio(`3`, { energy_per_atom: -5.1, energy: -8 }),
      ],
      exp: [2, 1, 1, 0],
    },
    {
      name: `falls back to energy/atoms when per-atom fields are missing`,
      all: [lio(`1`, { energy: -10 }), lio(`2`, { energy: -12 }), lio(`3`, { energy: -8 })],
      exp: [2, 1, 1, 0],
    },
    {
      name: `skips the group when any energy is invalid (NaN/Infinity/missing)`,
      all: [
        lio(`1`, { e_above_hull: 0.1 }),
        lio(`2`, { e_above_hull: NaN }),
        lio(`3`, { e_above_hull: Infinity }),
        lio(`4`, {}),
      ],
      exp: [0, 0, 0, 0],
    },
    {
      name: `floating-point tolerance in composition`,
      all: [
        phase(`1`, { Li: 1, O: 2 }, { e_above_hull: 0.1 }),
        phase(`2`, { Li: 1 + 1e-10, O: 2 + 2e-10 }, { e_above_hull: 0.15 }),
      ],
      exp: [1, 1, 0, 0],
    },
  ])(`$name`, ({ all, exp: [total, higher, lower, equal] }) => {
    const stats = helpers.compute_all_polymorph_stats(all).get(`1`)
    expect(stats).toEqual({ total, higher, lower, equal })
  })
})

describe(`helpers: batch polymorph stats computation`, () => {
  test(`empty and single-entry edge cases`, () => {
    expect(helpers.compute_all_polymorph_stats([]).size).toBe(0)
    const single = helpers.compute_all_polymorph_stats([
      phase(`mp-1`, { Li: 1 }, { energy: -1, e_above_hull: 0 }),
    ])
    expect(single.size).toBe(1)
    expect(single.get(`mp-1`)).toEqual({ total: 0, higher: 0, lower: 0, equal: 0 })
  })

  test(`normalizes stoichiometry and skips entries without entry_id`, () => {
    const stats_map = helpers.compute_all_polymorph_stats([
      // Li:O ratio 1:2 and 2:4 are the same fractional composition
      phase(`mp-1`, { Li: 1, O: 2 }, { e_above_hull: 0 }),
      phase(`mp-2`, { Li: 2, O: 4 }, { e_above_hull: 0.1 }),
      { composition: { Li: 1, O: 1 }, e_above_hull: 0 } as PhaseData, // no entry_id
    ])
    expect(stats_map.size).toBe(2) // the id-less entry is skipped
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
      { desc: `empty entries`, entries: [] as PhaseData[], expected: [] as number[] },
      {
        desc: `entries without temp data`,
        entries: [
          { composition: { Fe: 1 }, energy: 0 },
          { composition: { Li: 1 }, energy: 0 },
        ] as PhaseData[],
        expected: [],
      },
      {
        desc: `the union of temperatures from multiple entries`,
        entries: [
          make_entry([300, 600], [-1, -2]),
          make_entry([600, 900, 1200], [-1, -2, -3]),
        ],
        expected: [300, 600, 900, 1200],
      },
      {
        desc: `entries with mismatched array lengths ignored`,
        entries: [make_entry([300, 600], [-1]), make_entry([900], [-2])],
        expected: [900],
      },
      {
        desc: `entries with empty arrays ignored`,
        entries: [make_entry([], []), make_entry([300, 600], [-1, -2])],
        expected: [300, 600],
      },
    ])(`available_temperatures for $desc`, ({ entries, expected }) => {
      const result = helpers.analyze_temperature_data(entries)
      expect(result.has_temp_data).toBe(expected.length > 0)
      expect(result.available_temperatures).toEqual(expected)
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
    const static_entry: PhaseData = { composition: { Fe: 1 }, energy: -0.5 }
    test.each([
      {
        desc: `exact temperature match`,
        entries: [make_entry([300, 600], [-1, -2])],
        temp: 300,
        options: undefined,
        expected: [-1],
      },
      {
        desc: `interpolation when bracketed (default options)`,
        entries: [make_entry([300, 600], [-1, -2])],
        temp: 450,
        options: undefined,
        expected: [-1.5],
      },
      {
        desc: `interpolation disabled and no exact match → dropped`,
        entries: [make_entry([300, 600], [-1, -2])],
        temp: 450,
        options: { interpolate: false },
        expected: [],
      },
      {
        desc: `gap exceeds max_interpolation_gap → dropped`,
        entries: [make_entry([300, 900], [-1, -2])],
        temp: 600,
        options: { interpolate: true, max_interpolation_gap: 500 },
        expected: [],
      },
      {
        desc: `static entries (no temp data) kept unchanged`,
        entries: [static_entry, make_entry([300, 600], [-1, -2])],
        temp: 450,
        options: { interpolate: true },
        expected: [-0.5, -1.5],
      },
    ])(`$desc`, ({ entries, temp, options, expected }) => {
      const result = helpers.filter_entries_at_temperature(entries, temp, options)
      expect(result.map((entry) => entry.energy)).toEqual(
        expected.map((energy) => expect.closeTo(energy, 10)),
      )
      // G(T) is per atom; both fields are updated for temperature-dependent entries
      for (const entry of result.filter((ent) => ent.temperatures)) {
        expect(entry.energy_per_atom).toBe(entry.energy)
      }
    })

    // `correction` and the 0 K hull cache (`e_form_per_atom` and friends) both silently
    // outrank G(T) if left in the spread, so the temperature switch moves nothing.
    test(`drops correction and the cached hull quantities G(T) invalidates`, () => {
      const entry = make_entry([300, 600], [-9.8, -9.6], {
        composition: { Fe: 2, O: 3 },
        energy: -50,
        correction: -2.5,
        e_form_per_atom: -1.5, // all three computed at 0 K
        e_above_hull: 0.25,
        is_stable: false,
      })
      const [filtered] = helpers.filter_entries_at_temperature([entry], 600)
      for (const key of [
        `correction`,
        `e_form_per_atom`,
        `e_above_hull`,
        `is_stable`,
      ] as const) {
        expect(filtered[key], key).toBeUndefined()
      }
      // keeping the correction would make this -9.6 + (-2.5 / 5) = -10.1
      expect(get_energy_per_atom(filtered)).toBeCloseTo(-9.6, 12)
    })

    test(`hull distance follows G(T) rather than a stale cached formation energy`, () => {
      // Fe and O at -8 and -5 eV/atom put the tie line at -6.2, and a stable
      // Fe2O3 at -8.2 eV/atom (E_form -2.0) holds the hull below the query.
      const refs: PhaseData[] = [
        { composition: { Fe: 1 }, energy: -8, energy_per_atom: -8 },
        { composition: { O: 1 }, energy: -5, energy_per_atom: -5 },
        { composition: { Fe: 2, O: 3 }, energy: -41, energy_per_atom: -8.2 },
      ]
      // E_form -0.6 at 300 K and 0.0 at 900 K, so the distance above that hull
      // has to move by exactly 0.6 eV/atom between the two temperatures.
      const compound = make_entry([300, 900], [-6.8, -6.2], {
        composition: { Fe: 2, O: 3 },
        energy: -34,
        e_form_per_atom: -1.5, // stale: from the 0 K energy
      })

      const at_temp = (temperature: number): number => {
        const [filtered] = helpers.filter_entries_at_temperature([compound], temperature)
        return calculate_e_above_hull(filtered, refs)
      }

      expect(at_temp(300)).toBeCloseTo(1.4, 10)
      expect(at_temp(900)).toBeCloseTo(2.0, 10)
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
