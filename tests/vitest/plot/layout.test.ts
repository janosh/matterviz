import {
  auto_tick_rotation,
  AXIS_LABEL_HEIGHT,
  AXIS_LABEL_OUTER,
  calc_auto_padding,
  centered_rect,
  DEFAULT_PLOT_PADDING,
  compute_element_placement,
  constrain_tooltip_position,
  filter_padding,
  full_footprint_or,
  LABEL_GAP_DEFAULT,
  measure_max_tick_width,
  measure_text_width,
  pad_rect,
  point_in_rect,
  rect_within_rect,
  sample_series_obstacle_points,
  tick_label_band,
  TICK_LABEL_HEIGHT,
  x_axis_title_offset,
  y_axis_label_x,
  y2_axis_label_x,
} from '$lib/plot/core/layout'
import { describe, expect, it, test, vi } from 'vitest'

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
      // Null/undefined/empty -> defaults
      [undefined, defaults],
      [null, defaults],
      [{}, defaults],
      // Partial override
      [
        { t: 10, l: 30 },
        { t: 10, b: 60, l: 30, r: 20 },
      ],
      // Full override
      [
        { t: 5, b: 10, l: 15, r: 25 },
        { t: 5, b: 10, l: 15, r: 25 },
      ],
      // Filters undefined values (preserves defaults)
      [
        { t: 10, b: undefined, r: 5 },
        { t: 10, b: 60, l: 60, r: 5 },
      ],
      // Zero values are preserved (not filtered)
      [
        { t: 0, b: 0 },
        { t: 0, b: 0, l: 60, r: 20 },
      ],
      // Negative values are preserved
      [{ t: -5 }, { t: -5, b: 60, l: 60, r: 20 }],
    ])(`filter_padding(%j) -> %j`, (padding, expected) => {
      expect(filter_padding(padding, defaults)).toEqual(expected)
    })
  })

  describe(`constrain_tooltip_position`, () => {
    // [desc, cursor_x, cursor_y, tip_w, tip_h, vp_w, vp_h, exp_x, exp_y]
    // Default offset is 10px in each direction
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

    // Custom offsets — all use 100x50 tooltip in 800x600 viewport
    // [desc, cursor_x, cursor_y, offset_x, offset_y, exp_x, exp_y]
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
      // margin to the nearest horizontal/vertical edge equals the default clearance
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
      [
        `top-left cluster`,
        Array.from({ length: 15 }, () => ({ x: 100, y: 60 })),
        `bottom-right`,
      ],
      [
        `bottom-right cluster`,
        Array.from({ length: 15 }, () => ({ x: 400, y: 280 })),
        `top-left`,
      ],
    ])(`places away from %s`, (_, points, expected_region) => {
      const result = compute_element_placement({
        ...base_config,
        points,
      })
      if (expected_region === `bottom-right`) {
        expect(result.x).toBeGreaterThan(200)
        expect(result.y).toBeGreaterThan(100)
      } else if (expected_region === `top-left`) {
        expect(result.x).toBeLessThan(200)
        expect(result.y).toBeLessThan(150)
      }
    })
  })

  describe(`sample_series_obstacle_points`, () => {
    const sparse_line = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ] // one long segment

    // Cases that add no interior samples → output is exactly the input vertices
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
      // every interior sample lies on the segment (here x === y)
      for (const point of result) expect(point.x).toBeCloseTo(point.y)
      // interior samples fall strictly between the endpoints
      const interior = result.filter((point) => point.x > 0 && point.x < 100)
      expect(interior).toHaveLength(10)
    })

    it(`breaks the line at non-finite vertices (no sampling across gaps)`, () => {
      const with_gap = [
        { x: 0, y: 0 },
        { x: NaN, y: NaN }, // gap: e.g. missing/clamped data
        { x: 100, y: 100 },
      ]
      const result = sample_series_obstacle_points(with_gap, true, 12)
      // only the two finite vertices survive; the gap prevents segment sampling
      expect(result).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ])
    })
  })

  describe(`x tick label auto-rotation`, () => {
    // jsdom has no text metrics, so stand in a proportional-ish 7px per character.
    const with_measured_text = <T>(run: () => T): T => {
      const spy = vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
        font: ``,
        measureText: (label: string) => ({ width: label.length * 7 }),
      } as unknown as CanvasRenderingContext2D)
      try {
        return run()
      } finally {
        spy.mockRestore()
      }
    }
    // The labels from a Slurm state histogram, the case that motivated this.
    const states = [`PENDING`, `RUNNING`, `QUEUE_HOLD`]

    it(`leaves labels upright when they already fit`, () => {
      expect(with_measured_text(() => auto_tick_rotation(states, 100))).toBe(0)
    })

    // Negative throughout: labels anchored at their end trail left of the tick, so the
    // rightmost one cannot run off the plot.
    it.each([
      [`a shallow tilt`, 60, -30],
      [`a steeper tilt`, 30, -60],
      [`vertical labels`, 24, -90],
      // Below one line height even vertical labels touch; 90 is the best on offer.
      [`the steepest angle it has`, 8, -90],
    ])(`crowding at %s`, (_label, pitch, expected) => {
      expect(with_measured_text(() => auto_tick_rotation(states, pitch))).toBe(expected)
    })

    it(`never rotates what cannot collide`, () => {
      expect(with_measured_text(() => auto_tick_rotation([`SOME_VERY_LONG_LABEL`], 5))).toBe(0)
      expect(with_measured_text(() => auto_tick_rotation(states, 0))).toBe(0)
    })

    it(`seats the axis title just past the labels, however far they reach`, () => {
      const [upright, tilted] = with_measured_text(() => [
        x_axis_title_offset(states, 0),
        x_axis_title_offset(states, -45),
      ])
      // Unrotated, this is the historical constant callers hardcoded.
      expect(upright).toBe(TICK_LABEL_HEIGHT + LABEL_GAP_DEFAULT)
      // Rotated, it clears the taller block by exactly the same gap — no more, no less,
      // which is what keeps the extra space from becoming a dead band.
      expect(tilted).toBeCloseTo(
        with_measured_text(() => tick_label_band(states, -45)) + LABEL_GAP_DEFAULT,
        10,
      )
      expect(tilted).toBeGreaterThan(upright)
    })

    it(`reserves the title's own band below the labels`, () => {
      const width = 400
      const crowded = Array.from({ length: 12 }, () => `QUEUE_HOLD`)
      const {
        b: reserved,
        l,
        r,
      } = with_measured_text(() =>
        calc_auto_padding({
          padding: {},
          default_padding: DEFAULT_PLOT_PADDING,
          width,
          x_axis: { label: `state`, tick_values: crowded },
        }),
      )
      // Same pitch the padding used: ticks span the plot, not the whole figure.
      const needed = with_measured_text(() => {
        const rotation = auto_tick_rotation(crowded, (width - l - r) / crowded.length)
        return x_axis_title_offset(crowded, rotation) + AXIS_LABEL_HEIGHT / 2
      })
      // Enough for the title to sit fully inside, and not a band more than that plus the
      // usual outer air.
      expect(reserved).toBeGreaterThanOrEqual(needed)
      expect(reserved).toBeLessThanOrEqual(needed + AXIS_LABEL_OUTER)
    })

    it(`costs less height the shallower it tilts`, () => {
      const bands = with_measured_text(() =>
        [0, -30, -45, -60, -90].map((angle) => tick_label_band(states, angle)),
      )
      expect(bands[0]).toBe(TICK_LABEL_HEIGHT)
      // Strictly increasing: this is why the search takes the first angle that fits
      // rather than jumping straight to 90.
      expect(bands).toEqual([...bands].toSorted((left, right) => left - right))
      expect(new Set(bands).size).toBe(bands.length)
    })

    it(`reserves bottom padding only once labels actually rotate`, () => {
      const base = { padding: {}, default_padding: DEFAULT_PLOT_PADDING, width: 400 }
      const [roomy, cramped] = with_measured_text(() => [
        calc_auto_padding({ ...base, x_axis: { tick_values: [`a`, `b`] } }),
        calc_auto_padding({
          ...base,
          x_axis: { tick_values: Array.from({ length: 12 }, () => `QUEUE_HOLD`) },
        }),
      ])
      expect(roomy.b).toBe(DEFAULT_PLOT_PADDING.b)
      expect(cramped.b).toBeGreaterThan(DEFAULT_PLOT_PADDING.b)
    })

    it.each([
      [`an explicit rotation of 0`, { tick: { label: { rotation: 0 } } }],
      [`labels rendered inside the plot`, { tick: { label: { inside: true } } }],
    ])(`keeps the default bottom padding with %s`, (_label, axis) => {
      const pad = with_measured_text(() =>
        calc_auto_padding({
          padding: {},
          default_padding: DEFAULT_PLOT_PADDING,
          width: 400,
          x_axis: { ...axis, tick_values: Array.from({ length: 12 }, () => `QUEUE_HOLD`) },
        }),
      )
      expect(pad.b).toBe(DEFAULT_PLOT_PADDING.b)
    })

    it(`never overrides bottom padding the caller set`, () => {
      const pad = with_measured_text(() =>
        calc_auto_padding({
          padding: { b: 30 },
          default_padding: DEFAULT_PLOT_PADDING,
          width: 400,
          x_axis: { tick_values: Array.from({ length: 12 }, () => `QUEUE_HOLD`) },
        }),
      )
      expect(pad.b).toBe(30)
    })
  })

  describe(`measure_max_tick_width`, () => {
    it(`returns 0 for empty ticks`, () => {
      expect(measure_max_tick_width([], `.2s`)).toBe(0)
    })

    it(`returns 0 in jsdom (no canvas rendering)`, () => {
      expect(measure_text_width(`hello`)).toBe(0)
      expect(measure_max_tick_width([1, 2, 3])).toBe(0)
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

    it(`reserves the top tick band and outer air for x2 ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values: [0, 1, 2] },
      })
      expect(result.t).toBe(TICK_LABEL_HEIGHT + 8 + AXIS_LABEL_OUTER)
    })

    it(`does not expand top padding when x2 has no ticks`, () => {
      const result = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: { tick_values: [] },
      })
      expect(result.t).toBe(defaults.t)
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
