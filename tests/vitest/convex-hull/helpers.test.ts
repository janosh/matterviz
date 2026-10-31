import * as draw from '#lib/convex-hull/canvas-draw.js'
import * as helpers from '#lib/convex-hull/helpers.js'
import {
  calculate_e_above_hull,
  get_energy_per_atom,
} from '#lib/convex-hull/thermodynamics.js'
import type { ConvexHullEntry, PhaseData } from '#lib/convex-hull/types.js'
import { MAGNETIC_ORDERING_CATEGORY } from '#lib/convex-hull/types.js'
import type { ElementSymbol } from '#lib/element/index.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import { resolve_color_scale } from '#lib/plot/core/scales.js'
import * as d3_sc from 'd3-scale-chromatic'
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

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

  // A bare name keeps the colors of the pre-ColorScaleConfig API (pinned); a config's
  // value_range replaces the [min, max(max, 0.1)] auto range
  test.each<[ColorScale, (string | undefined)[]]>([
    [`interpolateViridis`, [`#440154`, `#471063`, `#453882`, `#2eb37c`, `#fde725`, `#fde725`]],
    [
      { scheme: `interpolateViridis`, value_range: [0, 1] },
      [0, 0.013, 0.05, 0.2, 0.31, 0.5].map(d3_sc.interpolateViridis),
    ],
  ])(`get_energy_color_scale maps hull distances through %j`, (color_scale, colors) => {
    const entries = [0, 0.013, 0.05, 0.2, 0.31].map((e_above_hull) => ({ e_above_hull }))
    const scale = helpers.get_energy_color_scale(`energy`, color_scale, entries)
    expect([0, 0.013, 0.05, 0.2, 0.31, 0.5].map((val) => scale?.(val))).toEqual(colors)
  })

  // The energy color bar draws resolve_color_scale over hull_distance_range, so the points
  // must take exactly its colors (a flat [0.3, 0.3] range once put them at the palette start)
  test.each([[[0.3, 0.3]], [[0, 0.05]], [[0.2, 0.5]]])(
    `points match the energy bar over %j`,
    (dists) => {
      const entries = dists.map((e_above_hull) => ({ e_above_hull }))
      const bar = resolve_color_scale(
        `interpolateViridis`,
        helpers.hull_distance_range(entries),
      )
      const points = helpers.get_energy_color_scale(`energy`, `interpolateViridis`, entries)
      for (const val of [...dists, 0.1]) expect(points?.(val)).toBe(bar.color_fn(val))
    },
  )

  // Faces share the points' color_scale, whose value_range spans hull distances (>= 0): faces
  // (formation energies <= 0) take only its scheme, and their color bar draws the same colors
  test.each<ColorScale>([`interpolateViridis`, { value_range: [0, 0.5] }])(
    `formation-energy faces and their color bar share one range for %j`,
    (color_scale) => {
      const e_forms = [-1, -0.5, -0.2, 0]
      const faces = e_forms.map((e_form, facet_idx) => ({ e_form, facet_idx }))
      const face_color = draw.face_color_resolver(faces as draw.HullFace[], {
        mode: `formation_energy`,
        uniform_color: `#123456`,
        color_scale,
        element_colors: {},
        elements: [],
      })
      const face_colors = faces.map((face) => face_color(face as draw.HullFace))
      expect(face_colors).toEqual([`#440154`, `#21918c`, `#7ad151`, `#fde725`])
      const bar = draw.face_color_scale(color_scale, e_forms)
      expect(bar.color_scale.value_range).toEqual([-1, 0])
      expect(e_forms.map(bar.color_fn)).toEqual(face_colors)
      // a near-flat hull still spans 0.1 eV/atom instead of a zero-width range
      expect(
        draw.face_color_scale(color_scale, [-0.3, -0.29]).color_scale.value_range,
      ).toEqual([-0.3, -0.3 + 0.1])
    },
  )

  test(`hull_face_sets averages each face, 4 per tetrahedron, shared faces once`, () => {
    const vertex = (e_form_per_atom: number) => ({ e_form_per_atom }) as ConvexHullEntry
    const triangle = [vertex(-0.3), vertex(0), vertex(-0.6)]
    const tetrahedron = [vertex(-0.4), vertex(0), vertex(-0.8), vertex(-1.2)]
    // shares its first 3 vertices' face with `tetrahedron`, drawn only for the first
    const neighbor = [...tetrahedron.slice(0, 3), vertex(-2)]
    const face_sets = draw.hull_face_sets([triangle, tetrahedron, neighbor])
    expect(face_sets.map((face) => face.e_form)).toEqual(
      [-0.3, -2 / 3, -0.8, -1.6 / 3, -0.4, -2.8 / 3, -3.2 / 3, -0.8].map((value) =>
        expect.closeTo(value, 12),
      ),
    )
    expect(face_sets.map((face) => face.facet_idx)).toEqual([0, 1, 1, 1, 1, 2, 2, 2])
    // each of the 8 distinct vertices is projected once per frame
    const project = vi.fn(() => ({ x: 0, y: 0, depth: 0 }))
    expect(draw.build_hull_faces(face_sets, project)).toHaveLength(8)
    expect(project).toHaveBeenCalledTimes(8)
  })

  test(`stability mode colours and explicit is_stable=false overriding zero distance`, () => {
    const colors = { stable: `#111`, unstable: `#222` }
    const point_color = (entry: { is_stable?: boolean; e_above_hull?: number }) =>
      helpers.get_point_color_for_entry(entry, `stability`, colors, null)
    expect(point_color({ is_stable: true })).toBe(`#111`)
    expect(point_color({ e_above_hull: 0 })).toBe(`#111`)
    expect(point_color({ e_above_hull: 0.1 })).toBe(`#222`)
    const entry = { is_stable: false, e_above_hull: 0 }
    expect(helpers.visible_entries([entry], true, false, null, [])).toEqual([])
    expect(helpers.visible_entries([entry], false, true, null, [])).toEqual([entry])
    expect(point_color(entry)).toBe(`#222`)
    expect(
      helpers.get_point_color_for_entry({ is_stable: true }, `stability`, undefined, null),
    ).toBe(`#0072B2`)
  })

  test(`entry_within_hull_dist keeps stable entries and finite distances within the cutoff`, () => {
    const entries = [
      { is_stable: true, e_above_hull: 5 },
      { e_above_hull: 0.1 },
      { e_above_hull: 0.2 },
      {},
    ]
    const within = entries.map((entry) => helpers.entry_within_hull_dist(entry, 0.1))
    expect(within).toEqual([true, true, false, false]) // unknown distance ≠ stable
  })

  test(`hull_distance_range floors the max at 0.1 and skips non-finite values`, () => {
    const entry = (e_above_hull?: number) => ({ composition: {}, energy: 0, e_above_hull })
    expect(helpers.hull_distance_range([])).toEqual([0, 0.1])
    const mixed = [entry(0.02), entry(NaN), entry(0.05)]
    expect(helpers.hull_distance_range(mixed)).toEqual([0.02, 0.1])
    expect(helpers.hull_distance_range([entry(0.3), entry(0.5)])).toEqual([0.3, 0.5])
  })
})

describe(`canvas-draw: markers and hit testing`, () => {
  class StubPath2D {
    constructor(public data?: string) {}
    arc(): void {}
  }
  beforeEach(() => vi.stubGlobal(`Path2D`, StubPath2D))
  afterEach(() => vi.unstubAllGlobals())

  // canvas hover/selection drawing falls back to a zero-radius marker instead of throwing
  test.each([NaN, Infinity, -Infinity])(`create_marker_path handles size %s`, (size) => {
    expect(draw.create_marker_path(size, `circle`)).toEqual(
      draw.create_marker_path(0, `circle`),
    )
  })

  // a NaN formation energy is skipped instead of turning the whole depth scale NaN
  test(`energy_range_of spans 0 and the finite formation energies`, () => {
    const entries = [-1.5, Number.NaN, 0.5, undefined].map(
      (e_form_per_atom) => ({ e_form_per_atom }) as ConvexHullEntry,
    )
    const { min, max, center, z_scale } = draw.energy_range_of(entries)
    expect([min, max, center, z_scale]).toEqual([-1.5, 0.5, -0.5, 0.375])
  })

  // Where labels compete for room, hull phases claim it before phases above the hull, however
  // deep the latter's E_form: ranking by E_form alone gave the space to an unstable LiO
  test(`draw_hull_labels places stable phases' labels before unstable ones`, () => {
    const painted: string[] = []
    const ctx = {
      font: ``,
      measureText: (text: string) => ({ width: 6 * text.length }),
      fillText: (text: string) => painted.push(text),
      save: () => {},
      restore: () => {},
    } as unknown as CanvasRenderingContext2D
    // Only the slot below the shared point fits the canvas, so one label can be placed
    const at = { x: 12, y: 0, z: 0 }
    const entries = [
      {
        ...at,
        reduced_formula: `LiO`,
        composition: { Li: 1, O: 1 },
        e_form_per_atom: -0.5,
        e_above_hull: 0.1,
        is_stable: false,
      },
      {
        ...at,
        reduced_formula: `FeO`,
        composition: { Fe: 1, O: 1 },
        e_form_per_atom: -0.1,
        e_above_hull: 0,
        is_stable: true,
      },
    ] as ConvexHullEntry[]
    draw.draw_hull_labels(ctx, entries, {
      project: (x, y) => ({ x, y, depth: 0 }),
      elements: [`Li`, `Fe`, `O`],
      scale: 1,
      text_color: `black`,
      width: 24,
      height: 100,
      show_stable_labels: true,
      show_unstable_labels: true,
      max_hull_dist_show_labels: 1,
    })
    expect(painted).toEqual([`FeO`])
  })

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
    const hit = (client_x: number, scale = 1, points = [point]) =>
      draw.find_hull_entry_at_mouse(
        canvas,
        { clientX: client_x, clientY: 110 } as MouseEvent,
        draw.build_hull_pick_index(points, scale),
      )
    expect(hit(118)).toBe(entry) // 8 px away < 4 + 5
    expect(hit(119)).toBeNull() // strict radius boundary
    expect(hit(120)).toBeNull() // 10 px away
    expect(hit(120, 2)).toBe(entry) // radius scales with the container: 4 * 2 + 5 = 13 > 10
    const index = draw.build_hull_pick_index([point], 1)
    expect(draw.find_hull_entry_at_mouse(undefined, {} as MouseEvent, index)).toBeNull()
    // points are painted in array order, so the last one at the cursor is the one on top
    const behind = { ...point, entry: { ...entry, entry_id: `behind` } }
    expect(hit(110, 1, [behind, point])).toBe(entry)
  })

  // `both` is size + colour, as in the 2D ScatterPlot path. ring_growth: how far past
  // size * size_multiplier the ring reaches, in marker radii (null = no ring); at time 0 the
  // pulse sits mid-cycle (pulse_val = 0.5), so its ring grows by 0.5 * pulse_val. raw_stroke:
  // the ring strokes the user's color as given, its own alpha included
  test.each([
    [`color`, true, null, false],
    [`size`, false, 0, true],
    [`both`, true, 0, true],
    [`pulse`, false, 0.25, false],
  ] as const)(
    `pulse overlay draws highlight effect %s`,
    (effect, recolored, ring_growth, raw_stroke) => {
      const calls: unknown[][] = [] // [method or property, ...args]
      const ctx = new Proxy({} as CanvasRenderingContext2D, {
        get: (_target, key) =>
          key === `canvas`
            ? { width: 1, height: 1 }
            : (...args: unknown[]) => calls.push([key, ...args]),
        set: (_target, key, value) => calls.push([key, value]) > 0,
      })
      const entry = { x: 0, y: 0, z: 0, is_stable: false } as ConvexHullEntry
      const color = `rgba(18, 52, 86, 0.5)`
      const highlight_style = { ...helpers.merge_highlight_style({ effect }), color }
      const opts = { scale: 1, shadow_factor: 0, selected_entry: null, highlight_style }
      const hull_opts = {
        ...opts,
        is_highlighted: () => true,
        get_point_color: () => `#000000`,
      }
      const point = { entry, projected: { x: 0, y: 0, depth: 0 } }
      draw.draw_pulse_overlay(ctx, [point], hull_opts, { time: 0, opacity: 1 })
      const last_fill = calls.findLast(([key]) => key === `fillStyle`)?.[1]
      expect(last_fill).toBe(recolored ? color : `#000000`)
      const size = draw.point_radius(entry)
      const radius = size * highlight_style.size_multiplier + (ring_growth ?? 0) * size
      expect(calls.some((call) => call[0] === `arc` && call[3] === radius)).toBe(
        ring_growth !== null,
      )
      const strokes = calls.filter(([key]) => key === `strokeStyle`).map((call) => call[1])
      expect(strokes.includes(color)).toBe(raw_stroke)
    },
  )

  test(`draw_corner_labels offsets 2D and 3D corners away from their centroid`, () => {
    const fillText = vi.fn()
    const ctx = { save: vi.fn(), restore: vi.fn(), fillText }
    const project = vi.fn((coord_x: number, coord_y: number, coord_z: number) => ({
      x: coord_x,
      y: coord_y,
      depth: coord_z,
    }))
    const elements: ElementSymbol[] = [`H`, `He`]
    const opts = { project, elements, text_color: `black`, font_size: 16, offset: 0.1 }
    const corners = [
      [1, 0],
      [0, 1, 1],
    ]
    draw.draw_corner_labels(ctx as never, corners, [0, 0, 0], opts)
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
    const dists = [{ e_above_hull: 0 }, { e_above_hull: 0.2 }] as PhaseData[]
    expect(helpers.calc_max_hull_dist_in_data(dists)).toBeCloseTo(0.201, 10)
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

  // show all (max_hull_dist) up to 25 entries, the static default from 100, linear between
  test.each([
    [`few entries`, 10, 0.5, 0.1, 0.5],
    [`at the lower threshold`, 25, 0.5, 0.1, 0.5],
    [`at the upper threshold`, 100, 0.5, 0.1, 0.1],
    [`very many entries`, 500, 0.5, 0.1, 0.1],
    [`interpolated mid-range`, 62, 0.5, 0.1, 0.5 * (1 - 37 / 75) + 0.1 * (37 / 75)],
    [`interpolated at 50 entries`, 50, 0.6, 0.2, 0.6 * (2 / 3) + 0.2 / 3],
  ])(
    `compute_auto_hull_dist_threshold: %s (n=%i)`,
    (_name, n_entries, max_hull_dist, static_default, expected) => {
      expect(
        helpers.compute_auto_hull_dist_threshold(n_entries, max_hull_dist, static_default),
      ).toBeCloseTo(expected, 12)
    },
  )

  test(`build_entry_tooltip_text lists name, composition, energies and id`, () => {
    expect(
      helpers.build_entry_tooltip_text({ composition: { Li: 1 }, energy: -1 }, null),
    ).toBe(`Li (Lithium)\n`)
    const compound = {
      composition: { Li: 1, O: 1 },
      energy: -6,
      e_form_per_atom: -3,
      e_above_hull: 0,
      entry_id: `mp-1`,
    }
    expect(helpers.build_entry_tooltip_text(compound, null)).toBe(
      `\nComposition: Li: ½, O: ½\nE_above_hull: 0 eV/atom\nE_form: −3 eV/atom\nID: mp-1`,
    )
    // an absolute energy_per_atom is not a formation energy, so it is not labelled as one
    const absolute_only = { composition: { Li: 1, O: 1 }, energy: -12, energy_per_atom: -6 }
    expect(helpers.build_entry_tooltip_text(absolute_only, null)).not.toContain(`E_form`)
  })
})

describe(`helpers: composition label entries`, () => {
  // oxfmt-ignore
  test.each([
    { name: `keeps one lowest-energy label entry per normalized composition`,
      entries: [phase(`higher-fe-o`, { Fe: 2, O: 3 }, { energy: -1, e_form_per_atom: -0.2 }),
        phase(`lower-fe-o`, { Fe: 4, O: 6 }, { energy: -2, e_form_per_atom: -0.4 }),
        phase(`li-o`, { Li: 1, O: 1 }, { energy: -3, e_form_per_atom: -0.1 })],
      expected: [`lower-fe-o`, `li-o`] },
    { name: `does not merge distinct stoichiometries with the same elements`,
      entries: [phase(`fe-o`, { Fe: 1, O: 1 }, { e_form_per_atom: -1 }),
        phase(`fe2-o3`, { Fe: 2, O: 3 }, { e_form_per_atom: -2 })], expected: [`fe-o`, `fe2-o3`] },
    { name: `falls back to per-atom energy computed from total energy`,
      entries: [phase(`higher-total`, { A: 2, B: 2 }, { energy: -4 }),
        phase(`lower-total`, { A: 1, B: 1 }, { energy: -3 })], expected: [`lower-total`] },
    { name: `keeps explicit energy_per_atom ahead of computed total energy`,
      entries: [phase(`explicit-per-atom`, { A: 1, B: 1 }, { energy: 0, energy_per_atom: -4 }),
        phase(`computed-per-atom`, { A: 2, B: 2 }, { energy: -12 })],
      expected: [`explicit-per-atom`] },
    // per-entry metrics compared A's E_form (-0.1) with B's absolute -4 eV/atom
    { name: `compares polymorphs by their common metric, not each one's first`,
      entries: [phase(`abs-lower`, { A: 1, B: 1 }, { energy: -10, e_form_per_atom: -0.1 }),
        phase(`abs-higher`, { A: 1, B: 1 }, { energy: -8 })], expected: [`abs-lower`] },
    { name: `skips entries with empty compositions`, entries: [phase(`empty`, { Fe: 0 })], expected: [] },
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
  // oxfmt-ignore
  test.each([
    { name: `different compositions → no polymorphs`,
      all: [lio(`1`, { e_above_hull: 0.1 }), phase(`2`, { Li: 1, O: 2 }, { e_above_hull: 0.2 })],
      exp: [0, 0, 0, 0] },
    { name: `same fractional comp (1:1 ≈ 2:2 ≈ 0.5:0.5) → polymorphs, excludes self`,
      all: [lio(`1`, { e_above_hull: 0.1 }), phase(`2`, { Li: 2, O: 2 }, { e_above_hull: 0.2 }),
        phase(`3`, { Li: 0.5, O: 0.5 }, { e_above_hull: 0.05 })], exp: [2, 1, 1, 0] },
    { name: `counts higher/lower/equal`,
      all: [lio(`1`, { e_above_hull: 0.1 }), lio(`2`, { e_above_hull: 0.05 }),
        lio(`3`, { e_above_hull: 0.1 }), lio(`4`, { e_above_hull: 0.2 })], exp: [3, 1, 1, 1] },
    { name: `duplicate IDs exclude every copy but anonymous entries still count`,
      all: [lio(`1`, { energy_per_atom: -2 }), lio(``, { energy_per_atom: -2 }),
        lio(`2`, { energy_per_atom: 0 }), lio(`1`, { energy_per_atom: -1 }),
        lio(`3`, { energy_per_atom: -1 })], exp: [3, 1, 1, 1] },
    // e_above_hull alone would report every polymorph as equal (1 diamond, 2 graphite)
    { name: `REGRESSION: stable polymorphs (e_above_hull=0) ranked by energy_per_atom`,
      all: [phase(`1`, { C: 1 }, { e_above_hull: 0, energy_per_atom: -9.0 }),
        phase(`2`, { C: 1 }, { e_above_hull: 0, energy_per_atom: -8.9 }),
        phase(`3`, { C: 1 }, { e_above_hull: 0, energy_per_atom: -9.1 })], exp: [2, 1, 1, 0] },
    // energy_per_atom would rank 2 lower and 3 higher
    { name: `prefers e_form_per_atom over energy_per_atom`,
      all: [lio(`1`, { energy_per_atom: -5.0, e_form_per_atom: -3.0 }),
        lio(`2`, { energy_per_atom: -5.1, e_form_per_atom: -2.9 }),
        lio(`3`, { energy_per_atom: -4.9, e_form_per_atom: -3.1 })], exp: [2, 1, 1, 0] },
    // energy/atoms would rank 2 lower and 3 higher
    { name: `prefers energy_per_atom over raw energy`,
      all: [lio(`1`, { energy_per_atom: -5, energy: -10 }),
        lio(`2`, { energy_per_atom: -4.9, energy: -12 }),
        lio(`3`, { energy_per_atom: -5.1, energy: -8 })], exp: [2, 1, 1, 0] },
    // -5 - 1/2 = -5.5 eV/atom with its MP correction, below the uncorrected -5.2
    { name: `applies the MP correction to energy_per_atom`,
      all: [lio(`1`, { energy_per_atom: -5, correction: -1 }), lio(`2`, { energy_per_atom: -5.2 })],
      exp: [1, 1, 0, 0] },
    { name: `falls back to energy/atoms when per-atom fields are missing`,
      all: [lio(`1`, { energy: -10 }), lio(`2`, { energy: -12 }), lio(`3`, { energy: -8 })],
      exp: [2, 1, 1, 0] },
    { name: `skips the group when any energy is invalid (NaN/Infinity/missing)`,
      all: [lio(`1`, { e_above_hull: 0.1 }), lio(`2`, { e_above_hull: NaN }),
        lio(`3`, { e_above_hull: Infinity }), lio(`4`, {})], exp: [0, 0, 0, 0] },
    { name: `floating-point tolerance in composition`,
      all: [phase(`1`, { Li: 1, O: 2 }, { e_above_hull: 0.1 }),
        phase(`2`, { Li: 1 + 1e-10, O: 2 + 2e-10 }, { e_above_hull: 0.15 })], exp: [1, 1, 0, 0] },
  ])(`$name`, ({ all, exp: [total, higher, lower, equal] }) => {
    const stats = helpers.compute_all_polymorph_stats(all).get(`1`)
    expect(stats).toEqual({ total, higher, lower, equal })
  })
})

describe(`helpers: batch polymorph stats computation`, () => {
  test.each([0, 1, 1000])(`ranks %s entries without quadratic energy reads`, (length) => {
    let reads = 0
    const entries = Array.from({ length }, (_, idx) => ({
      entry_id: `mp-${idx}`,
      composition: { Li: 1 },
      energy: idx,
      get energy_per_atom() {
        reads++
        return idx
      },
    }))
    const stats = helpers.compute_all_polymorph_stats(entries)
    expect(stats.size).toBe(length)
    for (let idx = 0; idx < length; idx++) {
      expect(stats.get(`mp-${idx}`)).toEqual({
        total: length - 1,
        higher: length - idx - 1,
        lower: idx,
        equal: 0,
      })
    }
    expect(reads).toBeLessThanOrEqual(10 * length)
  })

  test(`normalizes stoichiometry and skips entries without entry_id`, () => {
    const stats_map = helpers.compute_all_polymorph_stats([
      // Li:O ratio 1:2 and 2:4 are the same fractional composition
      phase(`mp-1`, { Li: 1, O: 2 }, { e_above_hull: 0 }),
      phase(`mp-2`, { Li: 2, O: 4 }, { e_above_hull: 0.1 }),
      { composition: { Li: 1, O: 1 }, e_above_hull: 0 } as PhaseData, // no entry_id
    ])
    expect([...stats_map.keys()]).toEqual([`mp-1`, `mp-2`]) // the id-less entry is skipped
    expect(stats_map.get(`mp-1`)?.total).toBe(1) // sees mp-2 as polymorph
  })
})

describe(`helpers: is_entry_highlighted`, () => {
  type E = { entry_id?: string; structure_id?: string }
  const both: E = { entry_id: `mp-1`, structure_id: `s-1` }
  const only_eid: E = { entry_id: `mp-2` }
  const only_sid: E = { structure_id: `s-2` }

  // oxfmt-ignore
  test.each([
    // Edge cases
    [`empty list`, both, [], false],
    [`entry has no ids (string)`, {}, [`mp-1`], false],
    [`entry has no ids (object)`, {}, [both], false],
    [`id-less or null item never matches an entry without entry_id`, only_sid, [{}, null], false],
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
    [`REGRESSION: structure_id priority`, both, [{ entry_id: `mp-1`, structure_id: `x` }], false],
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
    const no_temps = [
      { composition: { Fe: 1 }, energy: 0 },
      { composition: { Li: 1 }, energy: 0 },
    ]
    // oxfmt-ignore
    test.each([
      [`empty entries`, [], []],
      [`entries without temp data`, no_temps, []],
      [`the union of temperatures from multiple entries`,
        [make_entry([300, 600], [-1, -2]), make_entry([600, 900, 1200], [-1, -2, -3])],
        [300, 600, 900, 1200]],
      [`entries with mismatched array lengths ignored`, [make_entry([300, 600], [-1]), make_entry([900], [-2])], [900]],
      [`entries with empty arrays ignored`, [make_entry([], []), make_entry([300, 600], [-1, -2])], [300, 600]],
    ] as [string, PhaseData[], number[]][])(
      `available_temperatures for %s`,
      (_desc, entries, expected) => {
        const result = helpers.analyze_temperature_data(entries)
        expect(result.has_temp_data).toBe(expected.length > 0)
        expect(result.available_temperatures).toEqual(expected)
      },
    )
  })

  // without interpolation a non-tabulated T would drop every entry with G(T) data, so it
  // snaps to the nearest tabulated one (as does an out-of-range T with interpolation)
  test.each([
    [700, [], true, 700],
    [700, [300, 900], true, 700],
    [undefined, [300, 900], true, 300],
    [1200, [300, 900], true, 900],
    [100, [300, 900], true, 300],
    [700, [300, 900], false, 900],
    [400, [300, 900], false, 300],
    [600, [300, 900], false, 300],
    [900, [300, 900], false, 900],
    [undefined, [], true, undefined],
  ] as const)(`get_valid_temperature(%s, %j, %s) = %s`, (temp, temps, interp, want) =>
    expect(helpers.get_valid_temperature(temp, temps, interp)).toBe(want),
  )

  // undefined only comes back for an undefined temperature, so a defined one needs no fallback
  test(`get_valid_temperature narrows its return type for a defined temperature`, () => {
    expectTypeOf(helpers.get_valid_temperature(700, [], true)).toEqualTypeOf<number>()
    const maybe_temp = undefined as number | undefined
    expectTypeOf(helpers.get_valid_temperature(maybe_temp, [], true)).toEqualTypeOf<
      number | undefined
    >()
  })

  describe(`interpolate_energy_at_temperature`, () => {
    // oxfmt-ignore
    test.each([
      [`midpoint of [300,600]`, make_entry([300, 600], [-1, -2]), 450, 500, -1.5],
      [`quarter of [300,600]`, make_entry([300, 600], [-1, -2]), 375, 500, -1.25],
      // non-uniform spacing: 650 is halfway between knots 400 and 900
      [`non-uniform spacing`, make_entry([300, 400, 900], [-1, -1.2, -2]), 650, 600, -1.6],
      // unsorted temps: tightest bracket 300-600 (gap 300) within max_gap 400
      [`tightest bracket (unsorted)`, make_entry([900, 300, 600], [-3, -1, -2]), 450, 400, -1.5],
    ])(`interpolates %s`, (_desc, entry, temp, max_gap, expected) => {
      expect(helpers.interpolate_energy_at_temperature(entry, temp, max_gap)).toBeCloseTo(
        expected,
      )
    })

    // oxfmt-ignore
    test.each([
      [`T below range`, make_entry([300, 600], [-1, -2]), 200, 500],
      [`T above range`, make_entry([300, 600], [-1, -2]), 700, 500],
      [`gap exceeds max_gap`, make_entry([300, 900], [-1, -2]), 600, 500],
      // unsorted: tightest bracket 300-600 (gap 300) still exceeds max_gap 200
      [`tightest bracket exceeds max_gap`, make_entry([900, 300, 600], [-3, -1, -2]), 450, 200],
    ])(`returns null when %s`, (_desc, entry, temp, max_gap) => {
      expect(helpers.interpolate_energy_at_temperature(entry, temp, max_gap)).toBeNull()
    })
  })

  describe(`filter_entries_at_temperature with interpolation`, () => {
    const static_entry: PhaseData = { composition: { Fe: 1 }, energy: -0.5 }
    const tabulated = make_entry([300, 600], [-1, -2])
    const wide_gap = make_entry([300, 900], [-1, -2])
    type FilterOptions = Parameters<typeof helpers.filter_entries_at_temperature>[2]
    // interpolation is on by default
    test.each([
      [`exact temperature match`, [tabulated], 300, undefined, [-1]],
      [`interpolation when bracketed`, [tabulated], 450, undefined, [-1.5]],
      [`interpolation off → dropped`, [tabulated], 450, { interpolate: false }, []],
      [`gap too wide → dropped`, [wide_gap], 600, { max_interpolation_gap: 500 }, []],
      [`static entries kept unchanged`, [static_entry, tabulated], 450, {}, [-0.5, -1.5]],
    ] as [string, PhaseData[], number, FilterOptions, number[]][])(
      `%s`,
      (_desc, entries, temp, options, expected) => {
        const result = helpers.filter_entries_at_temperature(entries, temp, options)
        expect(result.map((entry) => entry.energy)).toEqual(
          expected.map((energy) => expect.closeTo(energy, 10)),
        )
        // G(T) is per atom; both fields are updated for temperature-dependent entries
        for (const entry of result.filter((ent) => ent.temperatures)) {
          expect(entry.energy_per_atom).toBe(entry.energy)
        }
      },
    )

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
      const hull_keys = [`correction`, `e_form_per_atom`, `e_above_hull`, `is_stable`] as const
      for (const key of hull_keys) expect(filtered[key], key).toBeUndefined()
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
    const li_fe_o2 = { Li: 1, Fe: 1, O: 2 }
    const elements: ElementSymbol[] = [`Li`, `Fe`, `La`, `Ni`, `O`]
    // oxfmt-ignore
    test.each([
      [`reduced_formula`, { reduced_formula: `LiFeO2`, composition: li_fe_o2 }, `LiFeO2`],
      [`name fallback`, { name: `lithium iron oxide`, composition: li_fe_o2 }, `lithium iron oxide`],
      [`reduced_formula over name`,
        { reduced_formula: `LiFeO2`, name: `lithium iron oxide`, composition: li_fe_o2 }, `LiFeO2`],
      // built from the composition: subscript 1 omitted, zero counts dropped, unreduced cells kept
      [`composition fallback`, { composition: li_fe_o2 }, `LiFeO2`],
      [`zero-count elements`, { composition: { Li: 1, Fe: 0, O: 2 } }, `LiO2`],
      [`single element`, { composition: { Fe: 1 } }, `Fe`],
      [`unreduced cell`, { composition: { La: 12, Ni: 6, O: 25 } }, `La12Ni6O25`],
      [`multi-atom unary`, { composition: { La: 4 } }, `La4`],
      // counts keep their digits: 2 significant figures printed Ni1.3e2O2.6e2 and Li2.3
      [`large cell`, { composition: { Ni: 128, O: 256 } }, `Ni128O256`],
      [`fractional count`, { composition: { Li: 2.25, O: 1 } }, `Li2.25O`],
      // the given element order, not the composition key order
      [`elements order`, { composition: { O: 3, Fe: 1, Li: 2 } }, `Li2FeO3`],
    ] as [string, { composition: Record<string, number> }, string][])(
      `%s → %s`,
      (_desc, entry, expected) => {
        expect(helpers.get_entry_label(entry, elements)).toBe(expected)
      },
    )
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
    const category = (ent: PhaseData) => helpers.get_entry_category(ent, electronic)
    // Case-insensitive canonical match + alias normalization + data dict fallback
    expect(category(entry(`Metal`))).toBe(`metal`)
    expect(category(entry(`semi-conductor`))).toBe(`semiconductor`)
    expect(category(entry(`half-metal`))).toBeNull()
    expect(category({ ...entry(), data: { electronic_class: `insulator` } })).toBe(`insulator`)
    // Marker assignment + filtering use the same config
    const entries = [entry(`metal`), entry(`insulator`), entry()]
    expect(
      helpers.apply_category_markers(entries, electronic).map((ent) => ent.marker),
    ).toEqual([`circle`, `square`, undefined])
    const visible = helpers.visible_entries(entries, true, true, electronic, [`metal`])
    expect(visible).toEqual([entries[1], entries[2]])
  })

  test(`build_entry_tooltip_text includes magnetic ordering when present`, () => {
    expect(
      helpers.build_entry_tooltip_text(mag_entry({ magnetic_ordering: `FiM` }), magnetic),
    ).toContain(`Magnetic: FiM`)
    expect(helpers.build_entry_tooltip_text(mag_entry(), magnetic)).not.toContain(`Magnetic`)
  })
})
