import {
  type AutoPaddingConfig,
  auto_tick_rotation,
  AXIS_LABEL_HEIGHT,
  AXIS_LABEL_OUTER,
  calc_auto_padding,
  centered_rect,
  compute_element_placement,
  constrain_tooltip_position,
  DEFAULT_PLOT_PADDING,
  filter_padding,
  full_footprint_or,
  LABEL_GAP_DEFAULT,
  measure_max_tick_width,
  measure_text_width,
  type MeasuredAxis,
  pad_rect,
  point_in_rect,
  rect_within_rect,
  resolve_tick_layout,
  sample_series_obstacle_points,
  type Sides,
  tick_label_band,
  TICK_LABEL_HEIGHT,
  y_axis_label_x,
  y2_axis_label_x,
} from '$lib/plot/core/layout'
import type { Vec2 } from '$lib/math'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { mock_text_measurement } from '../setup'

describe(`layout utility functions`, () => {
  describe(`rectangle helpers`, () => {
    test.each([
      {
        name: `pad_rect expands equally around all sides`,
        call: () => pad_rect({ x: 10, y: 20, width: 30, height: 40 }, 2),
        expected: { x: 8, y: 18, width: 34, height: 44 },
      },
      {
        name: `centered_rect treats y as the top edge`,
        call: () => centered_rect(50, 20, 30, 10),
        expected: { x: 35, y: 20, width: 30, height: 10 },
      },
    ])(`$name`, ({ call, expected }) => {
      expect(call()).toEqual(expected)
    })

    const bounds = { x: 0, y: 0, width: 10, height: 10 }
    test.each([
      { name: `inside`, rect: { x: 1, y: 1, width: 8, height: 8 }, expected: true },
      { name: `touching edge`, rect: { x: 0, y: 0, width: 10, height: 10 }, expected: true },
      { name: `over left edge`, rect: { x: -1, y: 1, width: 8, height: 8 }, expected: false },
      { name: `over top edge`, rect: { x: 1, y: -1, width: 8, height: 8 }, expected: false },
      { name: `over right edge`, rect: { x: 8, y: 1, width: 4, height: 8 }, expected: false },
      { name: `over bottom edge`, rect: { x: 1, y: 8, width: 8, height: 4 }, expected: false },
    ])(`rect_within_rect: $name`, ({ rect, expected }) => {
      expect(rect_within_rect(rect, bounds)).toBe(expected)
    })

    test.each([
      [{ x: 5, y: 5 }, true],
      [{ x: 0, y: 0 }, true],
      [{ x: 10, y: 10 }, true],
      [{ x: -1, y: 11 }, false],
    ] as const)(`point_in_rect(%o) -> %s`, (point, expected) => {
      expect(point_in_rect(point, bounds)).toBe(expected)
    })
  })

  describe(`filter_padding`, () => {
    const defaults = { t: 20, b: 60, l: 60, r: 20 }

    it.each([
      [undefined, defaults],
      [null, defaults],
      [{}, defaults],
      [
        { t: 10, l: 30 },
        { t: 10, b: 60, l: 30, r: 20 },
      ],
      [
        { t: 5, b: 10, l: 15, r: 25 },
        { t: 5, b: 10, l: 15, r: 25 },
      ],
      [
        { t: 10, b: undefined, r: 5 },
        { t: 10, b: 60, l: 60, r: 5 },
      ],
      [
        { t: 0, b: 0 },
        { t: 0, b: 0, l: 60, r: 20 },
      ],
      [{ t: -5 }, { t: -5, b: 60, l: 60, r: 20 }],
    ])(`filter_padding(%j) -> %j`, (padding, expected) => {
      expect(filter_padding(padding, defaults)).toEqual(expected)
    })
  })

  describe(`constrain_tooltip_position`, () => {
    test.each([
      [`within bounds`, 300, 200, 100, 50, 800, 600, 310, 210],
      [`flips left`, 750, 200, 100, 50, 800, 600, 640, 210],
      [`flips up`, 300, 560, 100, 50, 800, 600, 310, 500],
      [`bottom-right corner (flips both)`, 800, 600, 100, 50, 800, 600, 690, 540],
      [`top-left corner (clamp)`, -10, -10, 100, 50, 800, 600, 0, 0],
      [`zero-size tooltip`, 300, 200, 0, 0, 800, 600, 310, 210],
      [`tooltip > viewport`, 300, 200, 900, 700, 800, 600, 0, 0],
      [`at flip threshold`, 690, 200, 100, 50, 800, 600, 700, 210],
      [`past flip threshold`, 691, 200, 100, 50, 800, 600, 581, 210],
    ] as const)(`%s`, (_, cx, cy, tw, th, vw, vh, ex, ey) => {
      expect(constrain_tooltip_position(cx, cy, tw, th, vw, vh)).toEqual({ x: ex, y: ey })
    })

    // Custom offsets use a 100x50 tooltip in an 800x600 viewport.
    test.each([
      [`neg y above cursor`, 300, 200, 5, -10, 305, 140],
      [`neg y flips down near top`, 300, 50, 5, -10, 305, 60],
      [`neg x left of cursor`, 400, 300, -10, 10, 290, 310],
      [`neg x flips right near left`, 50, 300, -10, 10, 60, 310],
      [`both negative`, 400, 300, -10, -10, 290, 240],
    ] as const)(`offset: %s`, (_, cx, cy, ox, oy, ex, ey) => {
      expect(
        constrain_tooltip_position(cx, cy, 100, 50, 800, 600, {
          offset_x: ox,
          offset_y: oy,
        }),
      ).toEqual({ x: ex, y: ey })
    })
  })

  describe(`compute_element_placement`, () => {
    const base_config = {
      plot_bounds: { x: 50, y: 20, width: 400, height: 300 },
      element_size: { width: 100, height: 60 },
      axis_clearance: 40,
      exclude_rects: [],
      points: [] as { x: number; y: number }[],
    }

    it(`keeps no-data placement inside the configured axis clearance`, () => {
      const result = compute_element_placement(base_config)
      const { plot_bounds, element_size, axis_clearance } = base_config
      expect(result.x).toBeGreaterThanOrEqual(plot_bounds.x + axis_clearance)
      expect(result.y).toBeGreaterThanOrEqual(plot_bounds.y + axis_clearance)
      expect(result.x + element_size.width).toBeLessThanOrEqual(
        plot_bounds.x + plot_bounds.width - axis_clearance,
      )
      expect(result.y + element_size.height).toBeLessThanOrEqual(
        plot_bounds.y + plot_bounds.height - axis_clearance,
      )
      expect(Number.isFinite(result.score)).toBe(true)
    })

    it(`keeps descendants overflowing left and top inside the valid region`, () => {
      const element = document.createElement(`div`)
      const child = document.createElement(`span`)
      element.append(child)
      Object.defineProperties(element, {
        offsetWidth: { value: 100 },
        offsetHeight: { value: 60 },
      })
      element.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 100, y: 100, width: 100, height: 60 })
      child.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 80, y: 85, width: 140, height: 90 })

      expect(full_footprint_or(element, { width: 1, height: 1 })).toEqual({
        width: 140,
        height: 90,
        offset_x: -20,
        offset_y: -15,
      })
      const result = compute_element_placement({
        plot_bounds: { x: 0, y: 0, width: 300, height: 200 },
        element,
        element_size: { width: 1, height: 1 },
        axis_clearance: 10,
        points: [],
      })

      expect(result).toMatchObject({ x: 30, y: 25 })
    })

    it(`defaults axis_clearance to 12 so legends hug the corner`, () => {
      const { axis_clearance: _omitted, ...config } = base_config
      const result = compute_element_placement(config)
      const { plot_bounds, element_size } = base_config
      const x_margin = Math.min(
        result.x - plot_bounds.x,
        plot_bounds.x + plot_bounds.width - (result.x + element_size.width),
      )
      const y_margin = Math.min(
        result.y - plot_bounds.y,
        plot_bounds.y + plot_bounds.height - (result.y + element_size.height),
      )
      expect(x_margin).toBe(12)
      expect(y_margin).toBe(12)
    })

    it(`penalizes overlap with exclusion rectangles`, () => {
      const exclusion_rect = { x: 50, y: 20, width: 500, height: 400 }
      const points = [{ x: 250, y: 150 }]

      const result = compute_element_placement({
        ...base_config,
        exclude_rects: [exclusion_rect],
        points,
      })

      expect(result.score).toBeLessThan(-500)
    })

    test.each([
      [`top-left cluster`, { x: 100, y: 60 }, [200, Infinity], [100, Infinity]],
      [`bottom-right cluster`, { x: 400, y: 280 }, [-Infinity, 200], [-Infinity, 150]],
    ] as [string, { x: number; y: number }, Vec2, Vec2][])(
      `places away from %s`,
      (_, point, [x_min, x_max], [y_min, y_max]) => {
        const { x, y } = compute_element_placement({
          ...base_config,
          points: Array.from({ length: 15 }, () => point),
        })
        expect(x).toBeGreaterThan(x_min)
        expect(x).toBeLessThan(x_max)
        expect(y).toBeGreaterThan(y_min)
        expect(y).toBeLessThan(y_max)
      },
    )
  })

  describe(`sample_series_obstacle_points`, () => {
    const sparse_line = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]

    it.each([
      { name: `points-only series`, points: sparse_line, draws_line: false, step: 12 },
      {
        name: `zero-length segment`,
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        draws_line: true,
        step: 12,
      },
      { name: `non-positive step`, points: sparse_line, draws_line: true, step: 0 },
    ])(`adds no interior samples for $name`, ({ points, draws_line, step }) => {
      expect(sample_series_obstacle_points(points, draws_line, step)).toEqual(points)
    })

    it(`samples interior points along the segment when the series draws a line`, () => {
      const result = sample_series_obstacle_points(sparse_line, true, 12)
      expect(result).toHaveLength(12)
      for (const point of result) expect(point.x).toBeCloseTo(point.y)
      const interior = result.filter((point) => point.x > 0 && point.x < 100)
      expect(interior).toHaveLength(10)
    })

    it(`breaks the line at non-finite vertices (no sampling across gaps)`, () => {
      const with_gap = [
        { x: 0, y: 0 },
        { x: NaN, y: NaN },
        { x: 100, y: 100 },
      ]
      const result = sample_series_obstacle_points(with_gap, true, 12)
      expect(result).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ])
    })
  })

  describe(`x tick label auto-rotation`, () => {
    const px_per_char = 7
    beforeEach(() => mock_text_measurement(px_per_char))
    afterEach(() => vi.restoreAllMocks())
    const crowded = Array.from({ length: 12 }, () => `QUEUE_HOLD`)
    const widest_px = `QUEUE_HOLD`.length * px_per_char
    const plot_width = 400 - DEFAULT_PLOT_PADDING.l - DEFAULT_PLOT_PADDING.r
    const pad_for = ({ x_axis, ...config }: Partial<AutoPaddingConfig>): Required<Sides> =>
      calc_auto_padding({
        padding: {},
        default_padding: DEFAULT_PLOT_PADDING,
        width: 400,
        ...config,
        x_axis: { tick_values: crowded, ...x_axis },
      })
    const rotation_for = (axis: MeasuredAxis, side: `x` | `x2` | `y` | `y2`): number =>
      resolve_tick_layout({ tick_values: crowded, ...axis }, plot_width, side).rotation

    // Negative throughout: labels anchored at their end trail left of the tick, so the
    // rightmost one cannot run off the plot.
    it.each([
      [`labels that already fit`, 100, 0],
      [`a shallow tilt`, 60, -30],
      [`a steeper tilt`, 30, -60],
      [`vertical labels`, 24, -90],
      // Below one line height even vertical labels touch; 90 is the best on offer.
      [`the steepest angle it has`, 8, -90],
      [`no pitch at all to work with`, 0, 0],
    ])(`crowding at %s`, (_label, pitch, expected) => {
      expect(auto_tick_rotation(widest_px, pitch)).toBe(expected)
    })

    it(`costs less height the shallower it tilts`, () => {
      const bands = [0, -30, -45, -60, -90].map((angle) => tick_label_band(widest_px, angle))
      expect(bands[0]).toBe(TICK_LABEL_HEIGHT)
      expect(bands.slice(1).every((band, idx) => band > bands[idx])).toBe(true)
    })

    // Rotation follows the label side; y axes and lone labels stay upright.
    it.each([
      [`x labels`, {}, `x`, -1],
      [`inside x labels`, { tick: { label: { inside: true } } }, `x`, 1],
      [`x2 labels`, {}, `x2`, 1],
      [`inside x2 labels`, { tick: { label: { inside: true } } }, `x2`, -1],
      [`y labels`, {}, `y`, 0],
      [`a lone label`, { tick_values: [`SOME_VERY_LONG_LABEL`] }, `x`, 0],
    ] as [string, MeasuredAxis, `x` | `x2` | `y` | `y2`, number][])(
      `tilt of %s`,
      (_label, axis, side, sign) => {
        expect(Math.sign(rotation_for(axis, side))).toBe(sign)
      },
    )

    it.each([
      [`no title`, {}, 0],
      [`a title`, { label: `state` }, LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT / 2],
    ] as [string, MeasuredAxis, number][])(
      `reserves the tilted labels' band below an x axis with %s`,
      (_label, axis, title_room) => {
        const { b: reserved, l, r } = pad_for({ x_axis: axis })
        const rotation = auto_tick_rotation(widest_px, (400 - l - r) / crowded.length)
        const needed = tick_label_band(widest_px, rotation) + title_room + AXIS_LABEL_OUTER
        expect(reserved).toBe(needed)
        expect(reserved).toBeGreaterThan(DEFAULT_PLOT_PADDING.b)
      },
    )

    it(`mirrors the tilt on x2 and reserves the room above`, () => {
      const angle = rotation_for({}, `x2`)
      expect(angle).toBe(-rotation_for({}, `x`))
      const band = tick_label_band(widest_px, angle)
      expect(band).toBeGreaterThan(TICK_LABEL_HEIGHT)
      const { t } = pad_for({ x_axis: { tick_values: [] }, x2_axis: { tick_values: crowded } })
      expect(t).toBe(band + 8 + AXIS_LABEL_OUTER)
    })

    const default_b = DEFAULT_PLOT_PADDING.b
    it.each([
      [`labels that already fit upright`, { x_axis: { tick_values: [`a`, `b`] } }, default_b],
      [
        `an explicit rotation of 0`,
        { x_axis: { tick: { label: { rotation: 0 } } } },
        default_b,
      ],
      [`labels rendered inside`, { x_axis: { tick: { label: { inside: true } } } }, default_b],
      [`a bottom padding the caller set`, { padding: { b: 30 } }, 30],
    ])(`leaves the bottom padding alone with %s`, (_label, config, expected) => {
      expect(pad_for(config).b).toBe(expected)
    })
  })

  describe(`measure_max_tick_width`, () => {
    it.each([
      [`there are no ticks to measure`, () => measure_max_tick_width([], `.2s`)],
      [`jsdom reports no text metrics`, () => measure_text_width(`hello`)],
      [`numeric ticks hit that same empty canvas`, () => measure_max_tick_width([1, 2, 3])],
    ])(`returns 0 when %s`, (_label, measure) => {
      expect(measure()).toBe(0)
    })

    it(`uses the same adaptive formatter as rendered numeric ticks`, () => {
      const measured_labels: string[] = []
      const context_spy = vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
        font: ``,
        measureText: (label: string) => {
          measured_labels.push(label)
          return { width: label.length }
        },
      } as unknown as CanvasRenderingContext2D)
      try {
        expect(measure_max_tick_width([4500])).toBe(4)
        expect(measured_labels).toEqual([`4.5k`])
      } finally {
        context_spy.mockRestore()
      }
    })

    it(`prefers a custom ticks Record over the numeric format`, () => {
      const measured_labels: string[] = []
      const context_spy = vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
        font: ``,
        measureText: (label: string) => {
          measured_labels.push(label)
          return { width: label.length * 7 }
        },
      } as unknown as CanvasRenderingContext2D)
      try {
        expect(
          measure_max_tick_width([0, 1, 2], `.2~g`, {
            0: `QUEUE_HOLD`,
            1: `RUNNING`,
            2: `DONE`,
          }),
        ).toBe(`QUEUE_HOLD`.length * 7)
        expect(measured_labels).toEqual([`QUEUE_HOLD`, `RUNNING`, `DONE`])
      } finally {
        context_spy.mockRestore()
      }
    })
  })

  describe(`calc_auto_padding`, () => {
    const defaults = { t: 20, b: 60, l: 60, r: 20 }

    it(`preserves explicit padding, fills missing from defaults`, () => {
      const result = calc_auto_padding({
        padding: { t: 10, l: 80 },
        default_padding: defaults,
      })
      // no y2 ticks -> r is the plain default (no tick-label/title reservation)
      expect(result).toEqual({ t: 10, l: 80, b: 60, r: 20 })
    })

    it.each([
      [`l`, `y_axis`],
      [`r`, `y2_axis`],
    ] as const)(`%s padding reserves the outside tick offset for %s`, (side, axis_key) => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        [axis_key]: { tick_values: [1] },
      })
      expect(result[side]).toBe(8)
    })

    it(`explicit padding overrides auto-computed padding`, () => {
      const result = calc_auto_padding({
        padding: { l: 10, r: 10, t: 10 },
        default_padding: defaults,
        y_axis: { tick_values: [100000, 200000] },
        y2_axis: { tick_values: [100000, 200000] },
        x2_axis: { tick_values: [1, 2, 3], label: `Top` },
      })
      expect(result.l).toBe(10)
      expect(result.r).toBe(10)
      expect(result.t).toBe(10)
    })

    it.each([
      [`ticks`, [0, 1, 2], TICK_LABEL_HEIGHT + 8 + AXIS_LABEL_OUTER],
      [`no ticks`, [], defaults.t],
    ])(`sets top padding for x2 with %s`, (_label, tick_values, expected) => {
      const { t } = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values },
      })
      expect(t).toBe(expected)
    })

    it(`reserves x2 title, gap, and outward shifts`, () => {
      const base = { padding: {}, default_padding: { t: 0, b: 0, l: 0, r: 0 } }
      const no_ticks = calc_auto_padding({
        ...base,
        x2_axis: { tick_values: [], label: `Energy` },
      })
      const without = calc_auto_padding({
        ...base,
        x2_axis: { tick_values: [1, 2] },
      })
      const with_label = calc_auto_padding({
        ...base,
        x2_axis: { tick_values: [1, 2], label: `Energy` },
      })
      const top_with_shift = (title_shift: number) =>
        calc_auto_padding({
          ...base,
          x2_axis: { tick_values: [1, 2], label: `Energy`, label_shift: { y: title_shift } },
        }).t
      expect(no_ticks.t).toBe(AXIS_LABEL_HEIGHT + AXIS_LABEL_OUTER)
      expect(with_label.t - without.t).toBe(LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT)
      expect([top_with_shift(14) - with_label.t, top_with_shift(-14) - with_label.t]).toEqual([
        14, 0,
      ])
    })

    it(`top padding accounts for an outward x2 tick shift`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        x2_axis: { tick_values: [1], tick: { label: { shift: { y: -10 } } } },
      })
      expect(result.t).toBe(TICK_LABEL_HEIGHT + 8 + 10 + AXIS_LABEL_OUTER)
    })

    // y/y2 axis titles must reserve their rotated width + outer air, else a wide tick
    // label (e.g. "-789.389") pushes the title into the ticks (mirrors the x2 case).
    it.each([
      [`l`, `y_axis`],
      [`r`, `y2_axis`],
    ] as const)(`%s reserves title band + outer air for the %s title`, (side, axis_key) => {
      const base = { padding: {}, default_padding: { t: 0, b: 0, l: 0, r: 0 } }
      const without = calc_auto_padding({ ...base, [axis_key]: { tick_values: [1, 2] } })
      const with_label = calc_auto_padding({
        ...base,
        [axis_key]: { tick_values: [1, 2], label: `Energy (eV)` },
      })
      expect(with_label[side] - without[side]).toBe(
        LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT + AXIS_LABEL_OUTER,
      )
    })

    it(`left pad grows when y label_shift pushes the title outward`, () => {
      const base = {
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        y_axis: { tick_values: [1, 10], label: `E` },
      }
      const unshifted = calc_auto_padding(base)
      const shifted = calc_auto_padding({
        ...base,
        y_axis: { ...base.y_axis, label_shift: { x: -14 } },
      })
      expect(shifted.l - unshifted.l).toBe(14)
    })

    it(`reserves a title band for interactive options without a literal label`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        y2_axis: {
          tick_values: [],
          options: [{ key: `energy`, label: `Energy` }],
        },
      })
      expect(result.r).toBe(AXIS_LABEL_HEIGHT + AXIS_LABEL_OUTER)
    })

    it(`right pad grows with an outward y2 tick-label shift`, () => {
      const base = {
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        y2_axis: { tick_values: [1, 10], label: `E` },
      }
      const unshifted = calc_auto_padding(base)
      const shifted = calc_auto_padding({
        ...base,
        y2_axis: { ...base.y2_axis, tick: { label: { shift: { x: 20 } } } },
      })
      expect(shifted.r - unshifted.r).toBe(20)
    })
  })

  describe(`y_axis_label_x / y2_axis_label_x`, () => {
    const title_center = AXIS_LABEL_OUTER + AXIS_LABEL_HEIGHT / 2
    test.each([
      [`left auto-padding`, () => y_axis_label_x({}, 90, 30), title_center],
      [`left explicit padding`, () => y_axis_label_x({}, 120, 30), 52],
      [
        `left inside ticks`,
        () => y_axis_label_x({ tick: { label: { inside: true } } }, 60, 30),
        30,
      ],
      [`right auto-padding`, () => y2_axis_label_x({}, 400, 90, 30), 400 - title_center],
      [`right explicit padding`, () => y2_axis_label_x({}, 400, 120, 30), 348],
      [
        `right inside ticks`,
        () => y2_axis_label_x({ tick: { label: { inside: true } } }, 400, 60, 30),
        370,
      ],
    ])(`positions %s`, (_, get_position, expected) => {
      expect(get_position()).toBe(expected)
    })
  })
})
