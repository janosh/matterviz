import type { AutoPaddingConfig, Sides } from '$lib/plot/core/layout'
import {
  AXIS_LABEL_HEIGHT,
  AXIS_TITLE_OFFSET,
  calc_auto_padding,
  centered_rect,
  compute_element_placement,
  DEFAULT_PLOT_PADDING,
  filter_padding,
  full_footprint_or,
  LABEL_GAP_DEFAULT,
  pad_rect,
  point_in_rect,
  rect_within_rect,
  resolve_axis_title_layout,
  sample_series_obstacle_points,
  stride_sample,
  y_axis_label_x,
  y2_axis_label_x,
} from '$lib/plot/core/layout'
import { clear_text_metrics_cache } from '$lib/plot/core/text-metrics'
import type { MeasuredAxis } from '$lib/plot/core/tick-layout'
import { resolve_tick_layout, TICK_LABEL_HEIGHT } from '$lib/plot/core/tick-layout'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { mock_canvas_context, mock_text_measurement } from '../setup'

describe(`layout utility functions`, () => {
  // tick_positions is required: layout reads real geometry rather than guessing equal slots.
  // Cases that only care about tick text project evenly spaced centres over a nominal axis.
  const slot_axis = (
    tick_values: (string | number)[],
    axis: Partial<MeasuredAxis> = {},
    axis_size = 400,
  ): MeasuredAxis => ({
    tick_positions: Array.from(
      { length: tick_values.length },
      (_unused, idx) => ((idx + 0.5) * axis_size) / tick_values.length,
    ),
    ...axis,
    tick_values,
  })

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

    // missing/undefined sides fall back to the defaults; 0 and negatives are kept as given
    it.each([
      [undefined, defaults],
      [{}, defaults],
      [
        { t: 0, b: undefined, r: -5 },
        { t: 0, b: 60, l: 60, r: -5 },
      ],
    ])(`filter_padding(%j) -> %j`, (padding, expected) => {
      expect(filter_padding(padding, defaults)).toEqual(expected)
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
      const non_finite = compute_element_placement({
        ...base_config,
        points: [{ x: NaN, y: NaN }],
      })
      expect(Number.isFinite(non_finite.score)).toBe(true)
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
      [`top-left cluster`, { x: 100, y: 60 }, [200, 100], 1],
      [`bottom-right cluster`, { x: 400, y: 280 }, [200, 150], -1],
    ] as const)(`places away from %s`, (_, point, [x_split, y_split], direction) => {
      const { x, y } = compute_element_placement({
        ...base_config,
        points: Array.from({ length: 15 }, () => point),
      })
      expect(Math.sign(x - x_split)).toBe(direction)
      expect(Math.sign(y - y_split)).toBe(direction)
    })
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

    // Callers thin dense series before projecting them, which lengthens each segment. Without
    // a cap, the interpolation would emit more filler points than the thinning saved.
    it(`caps interior samples on a very long segment`, () => {
      const long_segment = [
        { x: 0, y: 0 },
        { x: 100_000, y: 0 },
      ]
      const result = sample_series_obstacle_points(long_segment, true, 1)
      expect(result.length).toBeLessThanOrEqual(66) // 2 vertices + at most 64 interior
    })
  })

  describe(`stride_sample`, () => {
    it(`preserves short inputs, thins evenly, keeps endpoints`, () => {
      const short = [0, 1, 2]
      expect(stride_sample(short, 10)).toBe(short)
      expect(
        stride_sample(
          Array.from({ length: 10 }, (_, idx) => idx),
          10,
        ),
      ).toHaveLength(10)
      expect(
        stride_sample(
          Array.from({ length: 1000 }, (_, idx) => idx),
          10,
        ),
      ).toHaveLength(10)
      expect(
        stride_sample(
          Array.from({ length: 100 }, (_, idx) => idx),
          5,
        ),
      ).toEqual([0, 25, 50, 74, 99])
    })
  })

  describe(`x tick label layout`, () => {
    const px_per_char = 7
    beforeEach(() => mock_text_measurement(px_per_char))
    afterEach(() => vi.restoreAllMocks())
    const crowded = Array.from({ length: 12 }, () => `QUEUE_HOLD`)
    const plot_width = 400 - DEFAULT_PLOT_PADDING.l - DEFAULT_PLOT_PADDING.r
    const pad_for = ({
      x_axis,
      x2_axis,
      ...config
    }: Partial<AutoPaddingConfig>): Required<Sides> => {
      // Project over the plot width this call will actually produce, so a test that resolves
      // the same axis by hand sees the same tick geometry the padding pass did.
      const inner = (config.width ?? 400) - DEFAULT_PLOT_PADDING.l - DEFAULT_PLOT_PADDING.r
      const project_axis = (
        axis: Partial<MeasuredAxis> | undefined,
        fallback_ticks: (string | number)[],
      ): MeasuredAxis => {
        const { tick_positions: _tick_positions, ...axis_config } = axis ?? {}
        return slot_axis(axis_config.tick_values ?? fallback_ticks, axis_config, inner)
      }
      return calc_auto_padding({
        padding: {},
        default_padding: DEFAULT_PLOT_PADDING,
        width: 400,
        ...config,
        x_axis: project_axis(x_axis, crowded),
        x2_axis: x2_axis ? project_axis(x2_axis, []) : undefined,
      })
    }
    // The frame scores edge labels against the whole SVG, so a rotated edge label trails into
    // the side padding (it can no longer flip its anchor and climb into the plot). Tests about
    // the angle chosen give the axis that overhang; tests about wrapping keep a tight extent.
    const overhang = (width: number, room = DEFAULT_PLOT_PADDING.l) => ({
      axis_extent: { start: -room, end: width + room },
    })
    const rotation_for = (
      axis: Partial<MeasuredAxis>,
      side: `x` | `x2` | `y` | `y2`,
    ): number =>
      resolve_tick_layout(
        {
          ...overhang(plot_width),
          ...slot_axis(axis.tick_values ?? crowded, axis, plot_width),
        },
        plot_width,
        side,
      ).rotation
    const state_labels = [`PENDING`, `CANCELLED by 2054`]
    const x_layout = (
      tick_values: string[],
      width: number,
      axis: Partial<MeasuredAxis> = {},
    ) => resolve_tick_layout(slot_axis(tick_values, axis, width), width, `x`)
    const resolved_lines = (layout: ReturnType<typeof resolve_tick_layout>) =>
      layout.labels.map(({ lines }) => lines)

    // Negative throughout: labels anchored at their end trail left of the tick, so the
    // rightmost one cannot run off the plot.
    it.each([
      [`the minimum 1 px gap`, 71, 0],
      [`less than the minimum gap`, 70.99, -30],
      [`a shallow tilt`, 60, -30],
      [`a medium tilt`, 30, -45],
      [`a steeper tilt`, 24, -60],
      [`the steepest feasible angle`, 8, -60],
      [`no pitch at all to work with`, 0, 0],
    ])(`crowding at %s`, (_label, pitch, expected) => {
      const layout = x_layout(crowded, pitch * crowded.length, {
        ...overhang(pitch * crowded.length),
        tick_label: { max_lines: 1, auto_layout: { strategies: [`upright`, `rotate`] } },
      })
      expect(layout.rotation).toBe(expected)
    })

    it(`costs less height the shallower it tilts`, () => {
      const bands = [0, -30, -45, -60, -90].map(
        (rotation) => x_layout([`QUEUE_HOLD`], 100, { tick_label: { rotation } }).band,
      )
      expect(bands[0]).toBe(TICK_LABEL_HEIGHT)
      expect(bands.slice(1).every((band, idx) => band > bands[idx])).toBe(true)
    })

    it.each([
      [`words`, `CANCELLED by 2054`, 70, [`CANCELLED`, `by 2054`]],
      [`underscore-separated identifiers`, `QUEUE_HOLD`, 45, [`QUEUE_`, `HOLD`]],
      [`camel case`, `cancelledBy2054`, 65, [`cancelled`, `By2054`]],
      [`one-letter camel prefix`, `xAxis`, 25, [`x`, `Axis`]],
    ])(`wraps %s at semantic boundaries`, (_name, label, max_width, expected) => {
      const labels = Array(4).fill(label)
      const width = labels.length * (max_width + 6)
      const layout = x_layout(labels, width, {
        axis_extent: { start: 0, end: width },
        tick_label: { auto_layout: { strategies: [`wrap`], max_band: 100 } },
      })
      expect(layout.labels[1].lines).toEqual(expected)
    })

    it(`memoizes wrap measurements to a quadratic bound`, () => {
      const measure_text = vi.fn((label: string) => ({ width: label.length * px_per_char }))
      mock_canvas_context({ measureText: measure_text })
      clear_text_metrics_cache()
      const segments = [
        `alpha`,
        `beta`,
        `gamma`,
        `delta`,
        `epsilon`,
        `zeta`,
        `eta`,
        `theta`,
        `iota`,
        `kappa`,
        `lambda`,
        `mu`,
      ]
      x_layout([segments.join(` `)], 80, {
        tick_label: {
          max_lines: segments.length,
          auto_layout: { strategies: [`wrap`] },
        },
      })

      expect(measure_text.mock.calls.length).toBeLessThanOrEqual(segments.length ** 2 + 30)
    })

    it(`chooses wrapping or rotation from whichever uses less vertical space`, () => {
      const wrapped = x_layout(state_labels, 220)
      expect(wrapped.rotation).toBe(0)
      expect(wrapped.band).toBe(2 * TICK_LABEL_HEIGHT)
      expect(resolved_lines(wrapped)).toEqual([[`PENDING`], [`CANCELLED`, `by 2054`]])

      const wide = x_layout(state_labels, 260)
      expect(wide).toMatchObject({ rotation: 0, band: TICK_LABEL_HEIGHT })
      expect(resolved_lines(wide)).toEqual(state_labels.map((label) => [label]))

      const wrapping_disabled = x_layout(state_labels, 160, {
        ...overhang(160),
        tick_label: { max_lines: 1, auto_layout: { strategies: [`upright`, `rotate`] } },
      })
      expect(wrapping_disabled.rotation).toBe(-30)
      expect(resolved_lines(wrapping_disabled)).toEqual(state_labels.map((label) => [label]))
    })

    it.each([
      [`CANCELLED by 2054`, 90, [`CANCELLED`, `by 2054`]],
      [`CANCELLED by timeout 2054`, 60, [`CANCELLED`, `by timeout`, `2054`]],
    ] as const)(
      `wraps a lone long label instead of letting "%s" overflow`,
      (label, width, lines) => {
        const layout = x_layout([label], width, {
          tick_label: { auto_layout: { strategies: [`upright`, `wrap`] } },
        })
        expect(layout.rotation).toBe(0)
        expect(layout.band).toBe(lines.length * TICK_LABEL_HEIGHT)
        expect(resolved_lines(layout)).toEqual([lines])
      },
    )

    it(`wraps labels more compactly than rotating one long line`, () => {
      const labels = [`Formation Energy Per Atom`, `Band Gap PBE Value`]
      const wrap_and_rotate = {
        tick_label: { auto_layout: { strategies: [`wrap`, `rotate`] as const } },
      }
      const layout = x_layout(labels, 320, wrap_and_rotate)
      expect(layout.strategy).toBe(`wrap`)
      expect(layout.labels[0].lines.length).toBeGreaterThan(1)
      const unwrapped = x_layout(labels, 320, {
        tick_label: { max_lines: 1, auto_layout: { strategies: [`rotate`] as const } },
      })
      expect(layout.band).toBeLessThan(unwrapped.band)
    })

    it(`keeps a shallower unwrapped angle for only a marginal band saving`, () => {
      const labels = Array.from({ length: 12 }, () => `Formation Energy`)
      // no stagger: two upright rows would fit here and win on band; this case is about the angle
      const layout = x_layout(labels, 680, {
        ...overhang(680, 100),
        tick_label: { auto_layout: { strategies: [`upright`, `wrap`, `rotate`] } },
      })
      expect(layout.rotation).toBe(-30)
      expect(resolved_lines(layout)).toEqual(labels.map((label) => [label]))
    })

    it(`caps wrapping and keeps separators attached`, () => {
      expect(
        x_layout([`one two three four`], 50, {
          tick_label: { max_lines: 2, auto_layout: { strategies: [`upright`, `wrap`] } },
        }).labels[0].lines,
      ).toEqual([`one two`, `three four`])
      expect(
        x_layout([`alpha - beta`, `alpha - beta`], 120, {
          tick_label: { max_lines: 4, auto_layout: { strategies: [`upright`, `wrap`] } },
        }).labels[0].lines,
      ).toEqual([`alpha`, `- beta`])
      expect(resolved_lines(x_layout([`-alpha`], 10))).toEqual([[`-alpha`]])
    })

    // Named explicitly: these differ only by invisible code points, so `%s` would print
    // tests that look identical and a regression could not be traced back to one input.
    it.each([
      [`a non-breaking hyphen`, `solid\u2011state`],
      [`a no-break space`, `10\u00A0eV`],
      [`a narrow no-break space`, `10\u202FeV`],
    ])(`does not split across %s`, (_name, label) => {
      expect(resolved_lines(x_layout([label], 10))).toEqual([[label]])
    })

    it(`preserves explicit whitespace and newline breaks`, () => {
      expect(
        resolved_lines(x_layout([`  padded  `], 100, { tick_label: { rotation: 0 } })),
      ).toEqual([[`  padded  `]])
      const multiline = x_layout([`top\nbottom\n`], 100, { tick_label: { rotation: 45 } })
      expect(resolved_lines(multiline)).toEqual([[`top`, `bottom`]])
      expect(multiline.band).toBeGreaterThan(2 * TICK_LABEL_HEIGHT)
      for (const side of [`y`, `y2`] as const) {
        const vertical_layout = resolve_tick_layout(
          slot_axis([`top\nbottom\n`], {}, 100),
          100,
          side,
        )
        expect(resolved_lines(vertical_layout)).toEqual(resolved_lines(multiline))
      }
      const crowded_multiline = x_layout(
        [`abcdefghij\nklmnopqrst`, `abcdefghij\nklmnopqrst`],
        100,
        {
          ...overhang(100),
          tick_label: { auto_layout: { strategies: [`upright`, `rotate`] as const } },
        },
      )
      expect(crowded_multiline.rotation).toBe(-45)
      expect(resolved_lines(crowded_multiline)).toEqual([
        [`abcdefghij`, `klmnopqrst`],
        [`abcdefghij`, `klmnopqrst`],
      ])
    })

    it(`keeps an unbreakable word intact and rotates it when crowded`, () => {
      const label = `SUPERCALIFRAGILISTIC`
      const layout = x_layout([label, label], 220, {
        ...overhang(220, 100),
        tick_label: { auto_layout: { strategies: [`upright`, `rotate`] } },
      })
      expect(layout.rotation).toBe(-30)
      expect(resolved_lines(layout)).toEqual([[label], [label]])
    })

    const dense_numeric_axis = {
      tick_values: [`-6`, `-4`, `-2`, `0`, `2`, `4`, `6`],
      tick_positions: [0, 20, 40, 60, 80, 100, 120],
      axis_extent: { start: 120, end: 0 },
    }
    // Rotation follows the label side; vertical axes and lone labels stay upright.
    it.each([
      [`x labels`, {}, `x`, -1],
      [`inside x labels`, { tick_label: { inside: true } }, `x`, 1],
      [`x2 labels`, {}, `x2`, 1],
      [`inside x2 labels`, { tick_label: { inside: true } }, `x2`, -1],
      [`y labels`, dense_numeric_axis, `y`, 0],
      [`y2 labels`, dense_numeric_axis, `y2`, 0],
      [`a lone label`, { tick_values: [`SOME_VERY_LONG_LABEL`] }, `x`, 0],
    ] as [string, Partial<MeasuredAxis>, `x` | `x2` | `y` | `y2`, number][])(
      `tilt of %s`,
      (_label, axis, side, sign) => {
        expect(Math.sign(rotation_for(axis, side))).toBe(sign)
      },
    )

    it.each([
      [`no title`, {}, 0],
      [`a title`, { label: `state` }, LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT / 2],
    ] as [string, Partial<MeasuredAxis>, number][])(
      `reserves the tilted labels' band below an x axis with %s`,
      (_label, base_axis, title_room) => {
        // Pinned to rotation: with thin/ellipsis in play the winner hides labels instead of
        // tilting them, and this case is about the band a tilt reserves.
        const axis: Partial<MeasuredAxis> = {
          ...base_axis,
          tick_label: {
            ...base_axis.tick_label,
            auto_layout: { strategies: [`upright`, `rotate`] as const },
          },
        }
        const tick_values = axis.tick_values ?? crowded
        const {
          b: reserved,
          l,
          r,
        } = pad_for({
          x_axis: slot_axis(tick_values, axis, plot_width),
        })
        // same SVG-wide extent the padding pass scored the labels against
        const { band } = resolve_tick_layout(
          {
            ...slot_axis(tick_values, axis, 400 - l - r),
            axis_extent: { start: -l, end: 400 - l },
          },
          400 - l - r,
          `x`,
        )
        const needed = band + title_room
        expect(reserved).toBe(needed)
        expect(reserved).toBeGreaterThan(DEFAULT_PLOT_PADDING.b)
      },
    )

    it(`mirrors the tilt on x2 and reserves the room above`, () => {
      const rotate_only = {
        tick_label: { auto_layout: { strategies: [`upright`, `rotate`] as const } },
      }
      const angle = rotation_for(rotate_only, `x2`)
      expect(angle).toBe(-rotation_for(rotate_only, `x`))
      const x2_axis = slot_axis(crowded, {}, plot_width)
      const { t, l, r } = pad_for({ x_axis: slot_axis([]), x2_axis })
      const available_width = 400 - l - r
      const projected_axis = slot_axis(crowded, {}, available_width)
      const band = resolve_tick_layout(
        {
          ...projected_axis,
          tick_positions: projected_axis.tick_positions.map((position) => position + l),
          axis_extent: { start: 0, end: 400 },
        },
        available_width,
        `x2`,
      ).band
      expect(band).toBeGreaterThan(TICK_LABEL_HEIGHT)
      expect(t).toBeGreaterThan(TICK_LABEL_HEIGHT + 8)
      expect(t).toBeLessThanOrEqual(band + 8)
    })

    it(`reserves room for wrapped labels above an x2 axis`, () => {
      // Wide enough that the labels don't rotate, tight enough that they wrap. End labels
      // may overhang into the side padding, so the band has to be measured over the same
      // extent calc_auto_padding projects onto (zero padding here, so [0, axis_size]).
      const axis_size = 160
      const x2_axis = slot_axis(state_labels, {}, axis_size)
      const { t } = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        width: axis_size,
        x2_axis,
      })
      const band = resolve_tick_layout(
        { ...x2_axis, axis_extent: { start: 0, end: axis_size } },
        axis_size,
        `x2`,
      ).band
      expect(band).toBeGreaterThan(TICK_LABEL_HEIGHT)
      expect(t).toBeGreaterThan(TICK_LABEL_HEIGHT + 8)
      expect(t).toBeLessThanOrEqual(band + 8)
    })

    const default_b = DEFAULT_PLOT_PADDING.b
    it.each([
      [`labels that already fit upright`, { x_axis: slot_axis([`a`, `b`]) }, default_b],
      [`an explicit rotation of 0`, { x_axis: { tick_label: { rotation: 0 } } }, default_b],
      [`labels rendered inside`, { x_axis: { tick_label: { inside: true } } }, default_b],
      [`a bottom padding the caller set`, { padding: { b: 30 } }, 30],
    ])(`leaves the bottom padding alone with %s`, (_label, config, expected) => {
      expect(pad_for(config as Partial<AutoPaddingConfig>).b).toBe(expected)
    })
  })

  describe(`adaptive tick layout`, () => {
    // The root beforeEach in tests/vitest/setup.ts already drops the memoised metrics.
    const measured_px_per_character = 7
    beforeEach(() => mock_text_measurement(measured_px_per_character))
    afterEach(() => vi.restoreAllMocks())
    const positioned_axis = (
      tick_values: string[],
      tick_positions: number[],
      axis_size: number,
    ): MeasuredAxis => ({
      tick_values,
      tick_positions,
      axis_extent: { start: 0, end: axis_size },
    })
    const uniform_axis = (tick_values: string[], axis_size: number, inset = 0): MeasuredAxis =>
      positioned_axis(
        tick_values,
        tick_values.map((_, tick_idx) =>
          tick_values.length === 1
            ? axis_size / 2
            : inset + (tick_idx * (axis_size - 2 * inset)) / (tick_values.length - 1),
        ),
        axis_size,
      )

    it(`uses irregular projected positions for bounded thinning`, () => {
      const tick_values = [`Alpha label`, `Beta label`, `Gamma label`, `Delta label`]
      const layout = resolve_tick_layout(
        {
          ...positioned_axis(tick_values, [0, 42, 47, 200], 200),
          tick_label: {
            auto_layout: {
              strategies: [`upright`, `thin`],
              min_visible_ticks: 2,
              endpoint_policy: `preserve`,
            },
          },
        },
        200,
        `x`,
      )
      expect(layout.strategy).toBe(`thin`)
      expect(layout.visible_tick_indices).toEqual([0, 3])
      expect(layout.labels.map(({ visible }) => visible)).toEqual([true, false, false, true])
    })

    it(`uses density rather than collision-pair count for a 500-tick axis`, () => {
      const tick_count = 500
      const axis_size = 1200
      const tick_values = Array.from(
        { length: tick_count },
        (_unused, tick_idx) => `Phase ${tick_idx} formation energy average temperature`,
      )
      const layout = resolve_tick_layout(
        {
          ...uniform_axis(tick_values, axis_size),
          tick_label: {
            auto_layout: {
              strategies: [`thin`],
              min_visible_ticks: 2,
              endpoint_policy: `preserve`,
            },
          },
        },
        axis_size,
        `x`,
      )

      // Density-based, so both endpoints survive and the interior collapses to one tick —
      // a collision-pair count would have thinned all the way down to min_visible_ticks.
      expect(layout.strategy).toBe(`thin`)
      expect(layout.visible_tick_indices).toEqual([0, 250, 499])
    })

    it(`combines bounded thinning with rotation when neither strategy fits alone`, () => {
      const tick_count = 8
      const axis_size = 120
      const tick_values = Array.from(
        { length: tick_count },
        (_unused, tick_idx) => `Category label ${tick_idx}`,
      )
      const layout = resolve_tick_layout(
        {
          ...uniform_axis(tick_values, axis_size, 20),
          // side-padding overhang, as in a frame; without it only 90° keeps the first label in
          axis_extent: {
            start: -DEFAULT_PLOT_PADDING.l,
            end: axis_size + DEFAULT_PLOT_PADDING.r,
          },
          tick_label: {
            auto_layout: {
              strategies: [`thin`, `rotate`],
              min_visible_ticks: 4,
              max_angle: 90,
              max_band: 140,
              endpoint_policy: `preserve`,
            },
          },
        },
        axis_size,
        `x`,
      )

      expect(layout).toMatchObject({ strategy: `thin`, rotation: -60 })
      expect(layout.visible_tick_indices).toHaveLength(4)
    })

    it(`hides non-finite projected ticks while preserving source index alignment`, () => {
      const layout = resolve_tick_layout(
        {
          ...positioned_axis(
            [`zero`, `not-a-number`, `infinite`, `last`],
            [0, Number.NaN, Number.POSITIVE_INFINITY, 100],
            100,
          ),
          tick_label: { auto_layout: { strategies: [`upright`] } },
        },
        100,
        `x`,
      )

      expect(layout.labels).toHaveLength(4)
      expect(
        layout.labels.map(({ tick_index, visible }) => ({ tick_index, visible })),
      ).toEqual([
        { tick_index: 0, visible: true },
        { tick_index: 1, visible: false },
        { tick_index: 2, visible: false },
        { tick_index: 3, visible: true },
      ])
      expect(layout.visible_tick_indices).toEqual([0, 3])
    })

    it(`rotated y labels trade their anchor at the axis ends like upright x labels`, () => {
      // a 90° y label runs along the axis, so the edge labels anchor inward instead of
      // spilling past the first and last tick
      const layout = resolve_tick_layout(
        {
          ...uniform_axis([`Bottom edge`, `Top edge`], 100),
          tick_label: { rotation: 90 },
        },
        100,
        `y`,
      )
      const anchors = layout.labels.map(({ anchor }) => anchor)
      expect(new Set(anchors).size).toBe(2)
      expect(anchors).not.toContain(`middle`)
    })

    it(`chooses inward edge anchors from actual axis bounds`, () => {
      const layout = resolve_tick_layout(
        {
          ...uniform_axis([`Left edge`, `Right edge`], 100),
          tick_label: { auto_layout: { strategies: [`upright`] } },
        },
        100,
        `x`,
      )
      expect(layout.labels.map(({ anchor }) => anchor)).toEqual([`start`, `end`])
    })

    it(`keeps readable text when every default candidate violates a hard constraint`, () => {
      const layout = resolve_tick_layout(
        {
          ...uniform_axis([`temperature`, `temperature`, `temperature`], 100),
          tick_label: {
            auto_layout: { max_angle: 45, max_band: 40 },
          },
        },
        100,
        `x`,
      )
      expect(layout.strategy).not.toBe(`ellipsis`)
      expect(layout.visible_tick_indices.length).toBeGreaterThan(0)
      expect(
        layout.labels.filter(({ visible }) => visible).map(({ lines }) => lines.join(`\n`)),
      ).toEqual(Array(layout.visible_tick_indices.length).fill(`temperature`))
      expect(layout.labels.map(({ full_text }) => full_text)).toEqual(
        Array(3).fill(`temperature`),
      )
    })

    it.each([`y`, `y2`] as const)(
      `wraps %s-axis labels by default and honors max_lines`,
      (side) => {
        const layout = resolve_tick_layout(
          {
            tick_values: [`Formation Energy`],
            tick_positions: [50],
            axis_extent: { start: 100, end: 0 },
            tick_label: {
              max_lines: 2,
              auto_layout: { strategies: [`wrap`] },
            },
          },
          100,
          side,
        )
        expect(layout).toMatchObject({ rotation: 0, strategy: `wrap` })
        expect(layout.labels.map(({ lines }) => lines)).toEqual([[`Formation`, `Energy`]])
        expect(layout.band).toBe(`Formation`.length * measured_px_per_character)
      },
    )

    it(`uses ellipsis only when explicitly enabled and keeps the full text`, () => {
      const tick_values = [`Formation`, `Temperature`]
      const layout = resolve_tick_layout(
        {
          ...uniform_axis(tick_values, 120),
          tick_label: { auto_layout: { strategies: [`ellipsis`] } },
        },
        120,
        `x`,
      )
      expect(layout.strategy).toBe(`ellipsis`)
      expect(layout.labels.map(({ full_text }) => full_text)).toEqual(tick_values)
      expect(layout.labels.every(({ lines }) => lines[0].endsWith(`…`))).toBe(true)
    })

    it(`keeps explicit rotation when the axis geometry collapses`, () => {
      const layout = resolve_tick_layout(
        {
          tick_values: [`Jan`, `Feb`],
          tick_positions: [50, 50],
          tick_label: { rotation: 45 },
        },
        0,
        `x`,
      )
      expect(layout.rotation).toBe(45)
      expect(layout.labels.every(({ rotation }) => rotation === 45)).toBe(true)
    })

    it.each([
      [`y`, false, `end`],
      [`y`, true, `start`],
      [`y2`, false, `start`],
      [`y2`, true, `end`],
    ] as const)(`anchors collapsed %s labels inside=%s at %s`, (side, inside, expected) => {
      const layout = resolve_tick_layout(
        {
          tick_values: [`Label`],
          tick_positions: [0],
          tick_label: { inside },
        },
        0,
        side,
      )
      expect(layout.labels[0].anchor).toBe(expected)
    })

    it(`rejects mismatched geometry and unknown strategies`, () => {
      expect(() =>
        resolve_tick_layout({ tick_values: [`Jan`, `Feb`], tick_positions: [50] }, 0, `x`),
      ).toThrow(`tick_positions has 1 entries for 2 ticks`)
      expect(() =>
        resolve_tick_layout(
          {
            tick_values: [`Jan`, `Feb`],
            tick_positions: [50, 50],
            tick_label: { auto_layout: { strategies: [`unknown`] } },
          } as unknown as MeasuredAxis,
          0,
          `x`,
        ),
      ).toThrow(`Unknown tick auto_layout strategy "unknown"`)
    })
  })

  describe(`tick label texts`, () => {
    // Records the exact strings handed to the canvas, which is what proves the formatter
    // and the custom-label lookup ran before measurement rather than after it.
    const with_recorded_labels = <T>(
      px_per_char: number,
      run: () => T,
    ): { result: T; measured_labels: string[] } => {
      const measured_labels: string[] = []
      mock_canvas_context({
        measureText: (label: string) => {
          measured_labels.push(label)
          return { width: label.length * px_per_char }
        },
      })
      const context_spy = vi.mocked(HTMLCanvasElement.prototype.getContext)
      // Self-contained so two calls in one test cannot read each other's cached widths.
      clear_text_metrics_cache()
      try {
        return { result: run(), measured_labels }
      } finally {
        context_spy.mockRestore()
      }
    }
    const y_layout = (tick_values: (string | number)[], axis: Partial<MeasuredAxis> = {}) =>
      resolve_tick_layout(slot_axis(tick_values, axis, 300), 300, `y`)

    it(`lays out no labels when there are no ticks`, () => {
      expect(y_layout([]).labels).toEqual([])
    })

    it(`uses the same adaptive formatter as rendered numeric ticks`, () => {
      const { result, measured_labels } = with_recorded_labels(1, () => y_layout([4500]))
      expect(result.labels.map(({ lines }) => lines)).toEqual([[`4.5k`]])
      expect(measured_labels).toContain(`4.5k`)
      expect(measured_labels).not.toContain(`4500`)
    })

    it(`prefers a custom ticks Record over the numeric format`, () => {
      const ticks = { 0: `QUEUE_HOLD`, 1: `RUNNING`, 2: `DONE` }
      const { result, measured_labels } = with_recorded_labels(7, () =>
        y_layout([0, 1, 2], { format: `.2~g`, ticks }),
      )
      expect(result.labels.map(({ lines }) => lines)).toEqual([
        [`QUEUE_HOLD`],
        [`RUNNING`],
        [`DONE`],
      ])
      expect(measured_labels).toEqual(expect.arrayContaining(Object.values(ticks)))
      expect(measured_labels).not.toContain(`0`)
    })
  })

  describe(`calc_auto_padding`, () => {
    const defaults = { t: 20, b: 60, l: 60, r: 20 }
    const no_padding = { padding: {}, default_padding: { t: 0, b: 0, l: 0, r: 0 } }
    afterEach(() => vi.restoreAllMocks())

    it(`preserves explicit padding, fills missing from defaults`, () => {
      const result = calc_auto_padding({
        padding: { t: 10, l: 80 },
        default_padding: defaults,
      })
      // no y2 ticks -> r is the plain default (no tick-label/title reservation)
      expect(result).toEqual({ t: 10, l: 80, b: 60, r: 20 })
    })

    it(`keeps provided tick positions when plot width/height are omitted`, () => {
      mock_text_measurement(7)
      const config = {
        ...no_padding,
        x_axis: {
          tick_values: Array<string>(4).fill(`formation energy per atom`),
          tick_positions: [0, 33, 66, 100],
          axis_extent: { start: 0, end: 100 },
          tick_label: { auto_layout: { strategies: [`thin`, `rotate`] as const } },
        },
      }
      // Collapsing every tick onto 0 would under-reserve compared with the sized layout.
      expect(calc_auto_padding(config).b).toBe(calc_auto_padding({ ...config, width: 100 }).b)
    })

    it.each([
      [`l`, `y_axis`],
      [`r`, `y2_axis`],
    ] as const)(`%s padding reserves the outside tick offset for %s`, (side, axis_key) => {
      const result = calc_auto_padding({
        ...no_padding,
        [axis_key]: slot_axis([1]),
      })
      expect(result[side]).toBeCloseTo(15.2)
    })

    it(`explicit padding overrides auto-computed padding`, () => {
      const result = calc_auto_padding({
        padding: { l: 10, r: 10, t: 10 },
        default_padding: defaults,
        y_axis: slot_axis([100000, 200000]),
        y2_axis: slot_axis([100000, 200000]),
        x2_axis: slot_axis([1, 2, 3], { label: `Top` }),
      })
      expect(result.l).toBe(10)
      expect(result.r).toBe(10)
      expect(result.t).toBe(10)
    })

    it.each([
      [`ticks`, [0, 1, 2], TICK_LABEL_HEIGHT + 8],
      [`no ticks`, [], defaults.t],
    ])(`sets top padding for x2 with %s`, (_label, tick_values, expected) => {
      const { t } = calc_auto_padding({
        padding: {},
        default_padding: defaults,
        x2_axis: slot_axis(tick_values),
      })
      expect(t).toBe(expected)
    })

    it(`reserves x2 titles at their rendered offset without double counting`, () => {
      const top_padding = (tick_values: number[], axis: Partial<MeasuredAxis> = {}) =>
        calc_auto_padding({
          ...no_padding,
          x2_axis: slot_axis(tick_values, axis),
        }).t
      const title_axis = { label: `Energy` }
      const default_title_pad = AXIS_TITLE_OFFSET + AXIS_LABEL_HEIGHT / 2
      expect([top_padding([], title_axis), top_padding([1, 2], title_axis)]).toEqual([
        default_title_pad,
        default_title_pad,
      ])
      expect([
        top_padding([1, 2], { ...title_axis, label_shift: { y: 60 } }),
        top_padding([1, 2], { ...title_axis, label_shift: { y: -14 } }),
      ]).toEqual([60 + AXIS_LABEL_HEIGHT / 2, top_padding([1, 2])])
    })

    it(`top padding accounts for an outward x2 tick shift`, () => {
      const result = calc_auto_padding({
        ...no_padding,
        x2_axis: slot_axis([1], { tick_label: { shift: { y: -10 } } }),
      })
      expect(result.t).toBe(TICK_LABEL_HEIGHT + 8 + 10)
    })

    it(`bottom padding accounts for an outward x title shift`, () => {
      const bottom_with_shift = (title_shift = 0) =>
        calc_auto_padding({
          ...no_padding,
          x_axis: slot_axis([1, 2], { label: `Energy`, label_shift: { y: title_shift } }),
        }).b
      expect(bottom_with_shift(14) - bottom_with_shift()).toBe(14)
    })

    // y/y2 axis titles must reserve their rotated width + outer air, else a wide tick
    // label (e.g. "-789.389") pushes the title into the ticks (mirrors the x2 case).
    it.each([
      [`l`, `y_axis`],
      [`r`, `y2_axis`],
    ] as const)(`%s reserves title band + outer air for the %s title`, (side, axis_key) => {
      const without = calc_auto_padding({ ...no_padding, [axis_key]: slot_axis([1, 2]) })
      const with_label = calc_auto_padding({
        ...no_padding,
        [axis_key]: slot_axis([1, 2], { label: `Energy (eV)` }),
      })
      expect(with_label[side] - without[side]).toBe(LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT)
    })

    it(`left pad grows when y label_shift pushes the title outward`, () => {
      const base = {
        ...no_padding,
        y_axis: slot_axis([1, 10], { label: `E` }),
      }
      const unshifted = calc_auto_padding(base)
      const shifted = calc_auto_padding({
        ...base,
        y_axis: { ...base.y_axis, label_shift: { x: -14 } },
      })
      expect(shifted.l - unshifted.l).toBeCloseTo(14, 10)
    })

    it(`reserves a title band for interactive options without a literal label`, () => {
      const axis = slot_axis([], { options: [{ key: `energy`, label: `Energy` }] })
      const result = calc_auto_padding({
        ...no_padding,
        y2_axis: axis,
      })
      expect(result.r).toBe(resolve_axis_title_layout(axis).height)
    })

    it(`right pad grows with an outward y2 tick-label shift`, () => {
      const base = {
        ...no_padding,
        y2_axis: slot_axis([1, 10], { label: `E` }),
      }
      const unshifted = calc_auto_padding(base)
      const shifted = calc_auto_padding({
        ...base,
        y2_axis: { ...base.y2_axis, tick_label: { shift: { x: 20 } } },
      })
      expect(shifted.r - unshifted.r).toBeCloseTo(20, 10)
    })

    it(`measures multiline x and y title bands instead of using a fixed estimate`, () => {
      mock_text_measurement(7)
      const base = {
        ...no_padding,
        width: 240,
      }
      const padding_for = (axis_key: `x_axis` | `y_axis`, label: string) =>
        calc_auto_padding({ ...base, [axis_key]: slot_axis([], { label }) })
      // a wrapped x title keeps its first line in place and stacks the rest below, so each extra
      // line costs a full line of padding (centering the block would lift it into the ticks)
      expect(
        padding_for(`x_axis`, `Formation energy\nper atom`).b -
          padding_for(`x_axis`, `Formation energy`).b,
      ).toBe(AXIS_LABEL_HEIGHT)
      expect(
        padding_for(`y_axis`, `Formation energy\nper atom`).l -
          padding_for(`y_axis`, `Formation energy`).l,
      ).toBe(AXIS_LABEL_HEIGHT)
    })

    it(`measures the selected interactive trigger including unit and closed arrow`, () => {
      mock_text_measurement(6)
      const axis = {
        options: [
          { key: `energy`, label: `Energy`, unit: `eV` },
          { key: `volume`, label: `Long volume property`, unit: `Å³` },
        ],
        selected_key: `volume`,
      }
      const layout = resolve_axis_title_layout(axis)
      const plain_width = resolve_axis_title_layout({
        label: `Long volume property (Å³)`,
      }).width

      expect(layout).toMatchObject({
        label: `Long volume property (Å³)`,
        height: 24,
        interactive: true,
      })
      expect(layout.width).toBeGreaterThan(plain_width)
    })

    it(`decodes escaped axis-title entities exactly once`, () => {
      const { label } = resolve_axis_title_layout({ label: `A &amp;lt; B &lt; C` })
      expect(label).toBe(`A &lt; B < C`)
    })

    it(`retains subscript and superscript segments when axis titles wrap`, () => {
      mock_text_measurement(7)
      const layout = resolve_axis_title_layout(
        { label: `Formation E<sub>hull</sub> relative to x<sup>2</sup>` },
        80,
      )
      const segments = layout.lines.flatMap((line) => line.segments)

      expect(layout.lines.length).toBeGreaterThan(1)
      expect(layout.label).toBe(`Formation Ehull relative to x2`)
      expect(segments).toContainEqual({ text: `hull`, shift: `sub` })
      expect(segments).toContainEqual({ text: `2`, shift: `super` })
    })
  })

  describe(`y_axis_label_x / y2_axis_label_x`, () => {
    const title_center = AXIS_LABEL_HEIGHT / 2
    test.each([
      [`left auto-padding`, () => y_axis_label_x({}, 90, 30), 22],
      [`left explicit padding`, () => y_axis_label_x({}, 120, 30), 52],
      // a pad too tight to seat the tick band clamps the title to its own band
      [`left clamped to the title band`, () => y_axis_label_x({}, 40, 30), title_center],
      [
        `left inside ticks`,
        () => y_axis_label_x({ tick_label: { inside: true } }, 60, 30),
        30,
      ],
      [`right auto-padding`, () => y2_axis_label_x({}, 400, 90, 30), 378],
      [`right explicit padding`, () => y2_axis_label_x({}, 400, 120, 30), 348],
      [
        `right clamped to the title band`,
        () => y2_axis_label_x({}, 400, 40, 30),
        400 - title_center,
      ],
      [
        `right inside ticks`,
        () => y2_axis_label_x({ tick_label: { inside: true } }, 400, 60, 30),
        370,
      ],
    ])(`positions %s`, (_, get_position, expected) => {
      expect(get_position()).toBe(expected)
    })
  })
})
