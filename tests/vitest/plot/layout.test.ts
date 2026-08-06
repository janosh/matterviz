import {
  type AutoPaddingConfig,
  AXIS_LABEL_HEIGHT,
  AXIS_LABEL_OUTER,
  calc_auto_padding,
  centered_rect,
  clear_tick_metrics_cache,
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
  resolve_axis_title_layout,
  resolve_tick_layout,
  sample_series_obstacle_points,
  type Sides,
  TICK_LABEL_HEIGHT,
  y_axis_label_x,
  y2_axis_label_x,
} from '$lib/plot/core/layout'
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
  })

  describe(`x tick label layout`, () => {
    const px_per_char = 7
    beforeEach(() => mock_text_measurement(px_per_char))
    afterEach(() => vi.restoreAllMocks())
    const crowded = Array.from({ length: 12 }, () => `QUEUE_HOLD`)
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
    const state_labels = [`PENDING`, `CANCELLED by 2054`]
    const x_layout = (tick_values: string[], width: number, axis: MeasuredAxis = {}) =>
      resolve_tick_layout({ tick_values, ...axis }, width, `x`)

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
      const layout = x_layout(crowded, pitch * crowded.length, {
        tick: { label: { max_lines: 1 } },
      })
      expect(layout.rotation).toBe(expected)
    })

    it(`costs less height the shallower it tilts`, () => {
      const bands = [0, -30, -45, -60, -90].map(
        (rotation) => x_layout([`QUEUE_HOLD`], 100, { tick: { label: { rotation } } }).band,
      )
      expect(bands[0]).toBe(TICK_LABEL_HEIGHT)
      expect(bands.slice(1).every((band, idx) => band > bands[idx])).toBe(true)
    })

    it.each([
      [`words`, `CANCELLED by 2054`, 70, [`CANCELLED`, `by 2054`]],
      [`underscore-separated identifiers`, `QUEUE_HOLD`, 45, [`QUEUE_`, `HOLD`]],
      [`camel case`, `cancelledBy2054`, 65, [`cancelled`, `By2054`]],
      [`one-letter camel prefix`, `xAxis`, 25, [`x`, `Axis`]],
      [`one-letter value prefix`, `yValue`, 30, [`y`, `Value`]],
      [`one-letter density prefix`, `eDensity`, 48, [`e`, `Density`]],
    ])(`wraps %s at semantic boundaries`, (_name, label, max_width, expected) => {
      const labels = Array(4).fill(label)
      const width = labels.length * (max_width + 6)
      const layout = x_layout(labels, width, {
        tick_positions: labels.map(
          (_unused, label_idx) => ((label_idx + 0.5) * width) / labels.length,
        ),
        axis_extent: { start: 0, end: width },
        tick: { label: { auto_layout: { strategies: [`wrap`], max_band: 100 } } },
      })
      expect(layout.lines[1]).toEqual(expected)
    })

    it(`memoizes wrap measurements to a quadratic bound`, () => {
      const measure_text = vi.fn((label: string) => ({ width: label.length * px_per_char }))
      vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
        font: ``,
        measureText: measure_text,
      } as unknown as CanvasRenderingContext2D)
      clear_tick_metrics_cache()
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
        tick: {
          label: {
            max_lines: segments.length,
            auto_layout: { strategies: [`wrap`] },
          },
        },
      })

      expect(measure_text.mock.calls.length).toBeLessThanOrEqual(segments.length ** 2 + 30)
    })

    it(`chooses wrapping or rotation from whichever uses less vertical space`, () => {
      const wrapped = x_layout(state_labels, 220)
      expect(wrapped).toMatchObject({
        rotation: 0,
        band: 2 * TICK_LABEL_HEIGHT,
        lines: [[`PENDING`], [`CANCELLED`, `by 2054`]],
      })

      const wide = x_layout(state_labels, 260)
      expect(wide).toMatchObject({ rotation: 0, band: TICK_LABEL_HEIGHT })
      expect(wide.lines).toEqual(state_labels.map((label) => [label]))

      const wrapping_disabled = x_layout(state_labels, 220, {
        tick: { label: { max_lines: 1 } },
      })
      expect(wrapping_disabled.rotation).toBe(-30)
      expect(wrapping_disabled.lines).toEqual(state_labels.map((label) => [label]))
    })

    it(`wraps a lone long label instead of letting it overflow`, () => {
      expect(x_layout([`CANCELLED by 2054`], 90)).toMatchObject({
        rotation: 0,
        band: 2 * TICK_LABEL_HEIGHT,
        lines: [[`CANCELLED`, `by 2054`]],
      })
      expect(x_layout([`CANCELLED by timeout 2054`], 60)).toMatchObject({
        rotation: 0,
        band: 3 * TICK_LABEL_HEIGHT,
        lines: [[`CANCELLED`, `by timeout`, `2054`]],
      })
    })

    it(`rotates a wrapped block when that uses less room than one long rotated line`, () => {
      const labels = [`Formation Energy Per Atom`, `Band Gap PBE Value`]
      const layout = x_layout(labels, 120)
      expect(layout.lines).toEqual([
        [`Formation`, `Energy`, `Per Atom`],
        [`Band`, `Gap PBE`, `Value`],
      ])
      expect(layout.rotation).toBe(-90)
      expect(layout.band).toBe(63)
      const unwrapped = x_layout(labels, 120, { tick: { label: { max_lines: 1 } } })
      expect(layout.band).toBeLessThan(unwrapped.band)
    })

    it(`keeps a shallower unwrapped angle for only a marginal band saving`, () => {
      const labels = Array.from({ length: 12 }, () => `Formation Energy`)
      const layout = x_layout(labels, 680)
      expect(layout.rotation).toBe(-30)
      expect(layout.lines).toEqual(labels.map((label) => [label]))
    })

    it(`caps wrapping and keeps separators attached`, () => {
      expect(
        x_layout([`one two three four`], 50, {
          tick: { label: { max_lines: 2 } },
        }).lines[0],
      ).toEqual([`one two`, `three four`])
      expect(
        x_layout([`alpha - beta`, `alpha - beta`], 120, {
          tick: { label: { max_lines: 4 } },
        }).lines[0],
      ).toEqual([`alpha`, `- beta`])
      expect(x_layout([`-alpha`], 10).lines).toEqual([[`-alpha`]])
    })

    // Named explicitly: these differ only by invisible code points, so `%s` would print
    // tests that look identical and a regression could not be traced back to one input.
    it.each([
      [`a non-breaking hyphen`, `solid\u2011state`],
      [`a no-break space`, `10\u00A0eV`],
      [`a narrow no-break space`, `10\u202FeV`],
    ])(`does not split across %s`, (_name, label) => {
      expect(x_layout([label], 10).lines).toEqual([[label]])
    })

    it(`preserves explicit whitespace and newline breaks`, () => {
      expect(
        x_layout([`  padded  `], 100, { tick: { label: { rotation: 0 } } }).lines,
      ).toEqual([[`  padded  `]])
      const multiline = x_layout([`top\nbottom\n`], 100, { tick: { label: { rotation: 45 } } })
      expect(multiline.lines).toEqual([[`top`, `bottom`]])
      expect(multiline.band).toBeGreaterThan(2 * TICK_LABEL_HEIGHT)
      expect(
        x_layout([`abcdefghij\nklmnopqrst`, `abcdefghij\nklmnopqrst`], 100),
      ).toMatchObject({
        rotation: -60,
        lines: [
          [`abcdefghij`, `klmnopqrst`],
          [`abcdefghij`, `klmnopqrst`],
        ],
      })
    })

    it(`shrinks bottom padding to the wrapped label band`, () => {
      const padding_for = (max_lines?: number) =>
        pad_for({
          width: 300,
          x_axis: {
            label: `slurm_state`,
            tick_values: state_labels,
            tick: { label: { max_lines } },
          },
        }).b
      expect(padding_for()).toBe(
        2 * TICK_LABEL_HEIGHT + LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT / 2 + AXIS_LABEL_OUTER,
      )
      expect(padding_for()).toBeLessThan(padding_for(1))
    })

    it.each([180, 220, 500])(
      `keeps rendered and reserved bands equal at width %i`,
      (width) => {
        const axis = {
          label: `slurm_state`,
          tick_values: state_labels,
        }
        const padding = pad_for({ width, x_axis: axis })
        const { band, rotation } = resolve_tick_layout(
          axis,
          width - padding.l - padding.r,
          `x`,
        )
        const expected =
          rotation === 0 && band <= TICK_LABEL_HEIGHT
            ? DEFAULT_PLOT_PADDING.b
            : Math.max(
                DEFAULT_PLOT_PADDING.b,
                band + LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT / 2 + AXIS_LABEL_OUTER,
              )
        expect(padding.b).toBe(expected)
      },
    )

    it(`keeps an unbreakable word intact and rotates it when crowded`, () => {
      const label = `SUPERCALIFRAGILISTIC`
      const layout = x_layout([label, label], 220)
      expect(layout.rotation).toBe(-30)
      expect(layout.lines).toEqual([[label], [label]])
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
        const { band } = resolve_tick_layout(
          { tick_values: crowded, ...axis },
          400 - l - r,
          `x`,
        )
        const needed = band + title_room + AXIS_LABEL_OUTER
        expect(reserved).toBe(needed)
        expect(reserved).toBeGreaterThan(DEFAULT_PLOT_PADDING.b)
      },
    )

    it(`mirrors the tilt on x2 and reserves the room above`, () => {
      const angle = rotation_for({}, `x2`)
      expect(angle).toBe(-rotation_for({}, `x`))
      const band = resolve_tick_layout({ tick_values: crowded }, plot_width, `x2`).band
      expect(band).toBeGreaterThan(TICK_LABEL_HEIGHT)
      const { t } = pad_for({ x_axis: { tick_values: [] }, x2_axis: { tick_values: crowded } })
      expect(t).toBe(band + 8 + AXIS_LABEL_OUTER)
    })

    it(`reserves the full wrapped label band above an x2 axis`, () => {
      const { t } = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        width: 220,
        x2_axis: { tick_values: state_labels },
      })
      expect(t).toBe(2 * TICK_LABEL_HEIGHT + 8 + AXIS_LABEL_OUTER)
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

  describe(`adaptive tick layout`, () => {
    // The root beforeEach in tests/vitest/setup.ts already drops the memoised metrics.
    beforeEach(() => mock_text_measurement(7))
    afterEach(() => vi.restoreAllMocks())

    it(`uses irregular projected positions for bounded thinning`, () => {
      const tick_values = [`Alpha label`, `Beta label`, `Gamma label`, `Delta label`]
      const layout = resolve_tick_layout(
        {
          tick_values,
          tick_positions: [0, 42, 47, 200],
          axis_extent: { start: 0, end: 200 },
          tick: {
            label: {
              auto_layout: {
                strategies: [`upright`, `thin`],
                min_visible_ticks: 2,
                endpoint_policy: `preserve`,
              },
            },
          },
        },
        200,
        `x`,
      )
      expect(layout.strategy).toBe(`thin`)
      expect(layout.visible_tick_indices).toEqual([0, 3])
      expect(layout.visible_ticks).toEqual([`Alpha label`, `Delta label`])
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
          tick_values,
          tick_positions: Array.from(
            { length: tick_count },
            (_unused, tick_idx) => (tick_idx * axis_size) / (tick_count - 1),
          ),
          axis_extent: { start: 0, end: axis_size },
          tick: {
            label: {
              auto_layout: {
                strategies: [`thin`],
                min_visible_ticks: 2,
                endpoint_policy: `preserve`,
              },
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
          tick_values,
          tick_positions: Array.from(
            { length: tick_count },
            (_unused, tick_idx) => 20 + (tick_idx * (axis_size - 40)) / (tick_count - 1),
          ),
          axis_extent: { start: 0, end: axis_size },
          tick: {
            label: {
              auto_layout: {
                strategies: [`thin`, `rotate`],
                min_visible_ticks: 4,
                max_angle: 90,
                max_band: 140,
                endpoint_policy: `preserve`,
              },
            },
          },
        },
        axis_size,
        `x`,
      )

      expect(layout).toMatchObject({ strategy: `thin`, rotation: -90 })
      expect(layout.visible_tick_indices).toHaveLength(4)
    })

    it(`hides non-finite projected ticks while preserving source index alignment`, () => {
      const layout = resolve_tick_layout(
        {
          tick_values: [`zero`, `not-a-number`, `infinite`, `last`],
          tick_positions: [0, Number.NaN, Number.POSITIVE_INFINITY, 100],
          axis_extent: { start: 0, end: 100 },
          tick: { label: { auto_layout: { strategies: [`upright`] } } },
        },
        100,
        `x`,
      )

      expect(layout.labels).toHaveLength(4)
      expect(layout.lines).toHaveLength(4)
      expect(
        layout.labels.map(({ tick_index, visible }) => ({ tick_index, visible })),
      ).toEqual([
        { tick_index: 0, visible: true },
        { tick_index: 1, visible: false },
        { tick_index: 2, visible: false },
        { tick_index: 3, visible: true },
      ])
      expect(layout.visible_tick_indices).toEqual([0, 3])
      expect(layout.visible_ticks).toEqual([`zero`, `last`])
    })

    it(`chooses inward edge anchors from actual axis bounds`, () => {
      const layout = resolve_tick_layout(
        {
          tick_values: [`Left edge`, `Right edge`],
          tick_positions: [0, 100],
          axis_extent: { start: 0, end: 100 },
          tick: { label: { auto_layout: { strategies: [`upright`] } } },
        },
        100,
        `x`,
      )
      expect(layout.labels.map(({ anchor }) => anchor)).toEqual([`start`, `end`])
    })

    it(`keeps readable text when every default candidate violates a hard constraint`, () => {
      const layout = resolve_tick_layout(
        {
          tick_values: [`temperature`, `temperature`, `temperature`],
          tick_positions: [0, 50, 100],
          axis_extent: { start: 0, end: 100 },
          tick: {
            label: {
              auto_layout: { max_angle: 45, max_band: 40 },
            },
          },
        },
        100,
        `x`,
      )
      expect(layout.strategy).not.toBe(`ellipsis`)
      expect(
        layout.labels.filter(({ visible }) => visible).map(({ display_text }) => display_text),
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
            tick: {
              label: {
                max_lines: 2,
                auto_layout: { strategies: [`wrap`] },
              },
            },
          },
          100,
          side,
        )
        expect(layout).toMatchObject({
          rotation: 0,
          strategy: `wrap`,
          lines: [[`Formation`, `Energy`]],
        })
        expect(layout.band).toBe(63)
      },
    )

    it(`never renders blank or bare-ellipsis labels under default scoring`, () => {
      const tick_count = 50
      const axis_size = 800
      const layout = resolve_tick_layout(
        {
          tick_values: Array.from(
            { length: tick_count },
            (_unused, tick_idx) => `Formation energy per atom ${tick_idx}`,
          ),
          tick_positions: Array.from(
            { length: tick_count },
            (_unused, tick_idx) => (tick_idx * axis_size) / (tick_count - 1),
          ),
          axis_extent: { start: 0, end: axis_size },
        },
        axis_size,
        `x`,
      )
      const visible_texts = layout.labels
        .filter(({ visible }) => visible)
        .map(({ display_text }) => display_text)

      expect(visible_texts.length).toBeGreaterThanOrEqual(2)
      expect(
        visible_texts.every(
          (display_text) => display_text.trim() !== `` && !/^…+$/u.test(display_text.trim()),
        ),
      ).toBe(true)
    })

    it(`keeps explicit rotation and full accessibility text`, () => {
      const layout = resolve_tick_layout(
        {
          tick_values: [`Full label`],
          tick_positions: [50],
          axis_extent: { start: 0, end: 100 },
          tick: {
            label: {
              rotation: 37,
              auto_layout: { strategies: [`ellipsis`, `thin`] },
            },
          },
        },
        100,
        `x`,
      )
      expect(layout.rotation).toBe(37)
      expect(layout.labels[0]).toMatchObject({
        full_text: `Full label`,
        display_text: `Full label`,
        visible: true,
        rotation: 37,
      })
    })

    it(`uses the same resolved band for padding`, () => {
      const x_axis = {
        label: `State`,
        tick_values: [`PENDING`, `CANCELLED by timeout`],
        tick_positions: [0, 140],
        axis_extent: { start: 0, end: 140 },
        tick: { label: { auto_layout: { strategies: [`wrap`] as const } } },
      }
      const layout = resolve_tick_layout(x_axis, 140, `x`)
      const padding = calc_auto_padding({
        padding: { l: 0, r: 0 },
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        width: 140,
        height: 100,
        x_axis,
      })
      expect(padding.b).toBe(
        layout.band + LABEL_GAP_DEFAULT + AXIS_LABEL_HEIGHT / 2 + AXIS_LABEL_OUTER,
      )
    })
  })

  describe(`measure_max_tick_width`, () => {
    it(`returns 0 when there are no ticks to measure`, () => {
      expect(measure_max_tick_width([], `.2s`)).toBe(0)
    })

    it(`uses deterministic pre-mount metrics when canvas has no text metrics`, () => {
      expect(measure_text_width(`hello`)).toBe(36)
      expect(measure_max_tick_width([1, 2, 3])).toBeCloseTo(7.2)
    })

    // Records the exact strings handed to the canvas, which is what proves the formatter
    // and the custom-label lookup ran before measurement rather than after it.
    const with_recorded_labels = <T>(
      px_per_char: number,
      run: () => T,
    ): { result: T; measured_labels: string[] } => {
      const measured_labels: string[] = []
      const context_spy = vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
        font: ``,
        measureText: (label: string) => {
          measured_labels.push(label)
          return { width: label.length * px_per_char }
        },
      } as unknown as CanvasRenderingContext2D)
      // Self-contained so two calls in one test cannot read each other's cached widths.
      clear_tick_metrics_cache()
      try {
        return { result: run(), measured_labels }
      } finally {
        context_spy.mockRestore()
      }
    }

    it(`uses the same adaptive formatter as rendered numeric ticks`, () => {
      const { result, measured_labels } = with_recorded_labels(1, () =>
        measure_max_tick_width([4500]),
      )
      expect(result).toBe(4)
      expect(measured_labels).toEqual([`4.5k`])
    })

    it(`prefers a custom ticks Record over the numeric format`, () => {
      const { result, measured_labels } = with_recorded_labels(7, () =>
        measure_max_tick_width([0, 1, 2], `.2~g`, {
          0: `QUEUE_HOLD`,
          1: `RUNNING`,
          2: `DONE`,
        }),
      )
      expect(result).toBe(`QUEUE_HOLD`.length * 7)
      expect(measured_labels).toEqual([`QUEUE_HOLD`, `RUNNING`, `DONE`])
    })
  })

  describe(`calc_auto_padding`, () => {
    const defaults = { t: 20, b: 60, l: 60, r: 20 }
    afterEach(() => vi.restoreAllMocks())

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
      expect(result[side]).toBeCloseTo(15.2)
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
      const axis = {
        tick_values: [],
        options: [{ key: `energy`, label: `Energy` }],
      }
      const result = calc_auto_padding({
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
        y2_axis: axis,
      })
      expect(result.r).toBe(resolve_axis_title_layout(axis).height + AXIS_LABEL_OUTER)
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

    it(`measures multiline x and y title bands instead of using a fixed estimate`, () => {
      mock_text_measurement(7)
      const base = {
        padding: {},
        default_padding: { t: 0, b: 0, l: 0, r: 0 },
      }
      const short_x = calc_auto_padding({
        ...base,
        width: 240,
        x_axis: { label: `Formation energy`, tick_values: [] },
      })
      const multiline_x = calc_auto_padding({
        ...base,
        width: 240,
        x_axis: { label: `Formation energy\nper atom`, tick_values: [] },
      })
      const short_y = calc_auto_padding({
        ...base,
        y_axis: { label: `Formation energy`, tick_values: [] },
      })
      const multiline_y = calc_auto_padding({
        ...base,
        y_axis: { label: `Formation energy\nper atom`, tick_values: [] },
      })

      expect(multiline_x.b - short_x.b).toBe(AXIS_LABEL_HEIGHT / 2)
      expect(multiline_y.l - short_y.l).toBe(AXIS_LABEL_HEIGHT)
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
