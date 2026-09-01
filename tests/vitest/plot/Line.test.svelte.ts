import type { Vec2 } from '$lib'
import Line from '$lib/plot/core/components/Line.svelte'
import { SETTLE_MS } from '$lib/plot/core/settling-tween.svelte'
import { resolve_line_tween } from '$lib/plot/core/utils'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, expect_transition_properties } from '../setup'

describe(`resolve_line_tween (path-morph budget)`, () => {
  test.each([
    {
      name: `both at budget → morph`,
      load: { series: 16, points: 8000 },
      expected: undefined,
    },
    {
      name: `series over budget → disabled`,
      load: { series: 17, points: 0 },
      expected: { duration: 0 },
    },
    {
      name: `points over budget → disabled`,
      load: { series: 0, points: 8001 },
      expected: { duration: 0 },
    },
  ])(`$name`, ({ load, expected }) => {
    expect(resolve_line_tween(undefined, load)).toEqual(expected)
  })

  test(`explicit tween always wins, even far over budget`, () => {
    const tween = { duration: 500 }
    expect(resolve_line_tween(tween, { series: 999, points: 999_999 })).toBe(tween)
  })
})

describe(`Line`, () => {
  // Parameterized test for default and custom styles
  test.each([
    {
      name: `default styles`,
      props: {}, // Relies on component defaults
      expected_line: {
        stroke: `rgba(255, 255, 255, 0.5)`,
        strokeWidth: `2`,
        fill: `none`,
      },
      expected_area: {
        fill: `rgba(255, 255, 255, 0.1)`,
        stroke: null, // Default area_stroke is null
      },
    },
    {
      name: `custom styles`,
      props: {
        line_color: `red`,
        line_width: 3,
        area_color: `blue`,
        area_stroke: `green`,
      },
      expected_line: {
        stroke: `red`,
        strokeWidth: `3`,
        fill: `none`,
      },
      expected_area: {
        fill: `blue`,
        stroke: `green`,
      },
    },
    {
      name: `custom dash array`,
      props: { line_dash: `4 2` },
      expected_line: {
        stroke: `rgba(255, 255, 255, 0.5)`,
        strokeWidth: `2`,
        fill: `none`,
        strokeDasharray: `4 2`,
      },
      expected_area: {
        fill: `rgba(255, 255, 255, 0.1)`,
        stroke: null,
      },
    },
  ])(`renders with $name`, ({ props, expected_line, expected_area }) => {
    const points: Vec2[] = [
      [10, 10],
      [50, 50],
      [100, 20],
    ]
    const origin: Vec2 = [0, 200]

    mount(Line, { target: document.body, props: { points, origin, ...props } })

    const paths = document.querySelectorAll(`path`)
    expect(paths).toHaveLength(2)

    const line_path = paths[0]
    const area_path = paths[1]

    // Assert line styles
    expect(line_path.getAttribute(`fill`)).toBe(expected_line.fill)
    expect(line_path.getAttribute(`stroke`)).toBe(expected_line.stroke)
    expect(line_path.getAttribute(`stroke-width`)).toBe(expected_line.strokeWidth)
    expect(line_path.getAttribute(`stroke-dasharray`)).toBe(
      expected_line.strokeDasharray ?? null,
    )
    // Assert area styles using getAttribute
    expect(area_path.getAttribute(`fill`)).toBe(expected_area.fill)
    expect(area_path.getAttribute(`stroke`)).toBe(expected_area.stroke ?? null)
  })

  test(`does not CSS-transition path geometry`, () => {
    mount(Line, {
      target: document.body,
      props: { points: [[0, 0]], origin: [0, 0] },
    })
    const path = doc_query(`path`)
    expect(path).toBeInstanceOf(SVGElement)
    expect_transition_properties(path, [
      `stroke`,
      `stroke-width`,
      `stroke-dasharray`,
      `stroke-opacity`,
      `fill`,
      `fill-opacity`,
      `opacity`,
    ])
  })

  const three_points: Vec2[] = [
    [0, 100],
    [100, 0],
    [200, 100],
  ]
  // line path per curve and point count; the area closes the line along y = origin[1]
  test.each([
    {
      name: `monotone over 3 points`,
      points: three_points,
      curve: undefined,
      line: /^M0,100C.*100,0.*C.*200,100$/,
    },
    {
      name: `linear over 3 points`,
      points: three_points,
      curve: `linear`,
      line: /^M0,100L100,0L200,100$/,
    },
    {
      name: `2 points (a straight segment)`,
      points: [
        [0, 50],
        [100, 0],
      ],
      curve: undefined,
      line: /^M0,50L100,0$/,
      area: /^M0,50L100,0L100,100L0,100Z$/,
    },
  ] as const)(`draws $name`, ({ points, curve, line, area }) => {
    mount(Line, {
      target: document.body,
      props: {
        points: points.map((pt): Vec2 => [...pt]),
        origin: [0, 100],
        curve,
        line_tween: { duration: 0 },
      },
    })
    const paths = document.querySelectorAll(`path`)
    expect(paths[0].getAttribute(`d`)).toMatch(line)
    if (area) expect(paths[1].getAttribute(`d`)).toMatch(area)
  })

  test.each([`transparent`, `none`])(
    `skips area path when area_color=%s (still renders line + 2 paths)`,
    (area_color) => {
      const points: Vec2[] = [
        [0, 50],
        [100, 0],
      ]
      mount(Line, {
        target: document.body,
        props: { points, origin: [0, 100], area_color, line_tween: { duration: 0 } },
      })
      const paths = document.querySelectorAll(`path`)
      expect(paths).toHaveLength(2)
      expect(paths[0].getAttribute(`d`)).toMatch(/^M0,50L100,0$/)
      expect(paths[1].getAttribute(`d`)).toBe(``)
    },
  )

  // While morphing is off the template binds the raw path, but the tween keeps its own value.
  // Left frozen at whatever it last animated to, re-enabling would snap the line back there
  // and morph forward again, so the tween has to track the live path throughout.
  test(`re-enabling the morph does not rewind to where the tween was disabled`, () => {
    vi.useFakeTimers({ toFake: [`performance`] })
    try {
      const state = $state({
        points: [
          [0, 100],
          [100, 0],
        ] as Vec2[],
        line_tween: { duration: 0 },
      })
      mount(Line, {
        target: document.body,
        props: bind_props({ origin: [0, 100] as Vec2 }, state),
      })
      vi.advanceTimersByTime(SETTLE_MS + 1) // past the window where every change snaps anyway

      state.points = [
        [0, 0],
        [100, 100],
      ] // move the line while morphing is disabled
      flushSync()
      const while_disabled = document.querySelector(`path`)?.getAttribute(`d`)
      expect(while_disabled).toMatch(/^M0,0/)

      state.line_tween = { duration: 60_000 }
      flushSync()
      expect(document.querySelector(`path`)?.getAttribute(`d`)).toBe(while_disabled)
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([
    { name: `no points`, points: [], line: /^$/, area: /^$/ },
    {
      name: `a single point`,
      points: [[50, 50]],
      line: /^M50,50Z?$/,
      area: /^M50,50Z?L50,100L50,100Z$/,
    },
  ] as const)(`renders both paths for $name`, ({ points, line, area }) => {
    mount(Line, {
      target: document.body,
      props: {
        points: points.map((pt): Vec2 => [...pt]),
        origin: [0, 100],
        line_tween: { duration: 0 },
      },
    })
    const paths = document.querySelectorAll(`path`)
    expect(paths).toHaveLength(2)
    expect(paths[0].getAttribute(`d`)).toMatch(line)
    expect(paths[1].getAttribute(`d`)).toMatch(area)
  })

  test(`passes additional props to path elements`, () => {
    const points: Vec2[] = [
      [10, 10],
      [50, 50],
    ]
    const origin: Vec2 = [0, 100]
    const rest = {
      'data-testid': `custom-line`,
      'aria-label': `line chart element`,
    }

    mount(Line, {
      target: document.body,
      props: { points, origin, ...rest },
    })

    const paths = document.querySelectorAll(`path`)
    expect(paths).toHaveLength(2)

    // Check that both paths received the rest props
    paths.forEach((path_element) => {
      expect(path_element.getAttribute(`data-testid`)).toBe(rest[`data-testid`])
      expect(path_element.getAttribute(`aria-label`)).toBe(rest[`aria-label`])
    })
  })
})
