import type { Vec2 } from '#lib'
import Line from '#lib/plot/core/components/Line.svelte'
import { SETTLE_MS } from '#lib/plot/core/settling-tween.svelte.js'
import { resolve_line_tween } from '#lib/plot/core/utils.js'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, expect_transition_properties } from '../setup'

describe(`resolve_line_tween (path-morph budget)`, () => {
  test.each([
    [`both at budget → morph`, { series: 16, points: 8000 }, undefined],
    [`series over budget → disabled`, { series: 17, points: 0 }, { duration: 0 }],
    [`points over budget → disabled`, { series: 0, points: 8001 }, { duration: 0 }],
  ])(`%s`, (_name, load, expected) => {
    expect(resolve_line_tween(undefined, load)).toEqual(expected)
  })

  test(`explicit tween always wins, even far over budget`, () => {
    const tween = { duration: 500 }
    expect(resolve_line_tween(tween, { series: 999, points: 999_999 })).toBe(tween)
  })
})

describe(`Line`, () => {
  const default_line = `rgba(255, 255, 255, 0.5)`
  // [name, props, line stroke, stroke-width, stroke-dasharray]
  test.each([
    [`default styles`, {}, default_line, `2`, null],
    [`custom styles`, { line_color: `red`, line_width: 3 }, `red`, `3`, null],
    [`custom dash array`, { line_dash: `4 2` }, default_line, `2`, `4 2`],
    [`a solid dash as none`, { line_dash: `solid` }, default_line, `2`, null],
  ] as const)(`renders with %s`, (_name, props, stroke, width, dash) => {
    // oxfmt-ignore
    const points: Vec2[] = [[10, 10], [50, 50], [100, 20]]
    mount(Line, { target: document.body, props: { points, ...props } })
    const line_path = doc_query(`path`)
    expect(document.querySelectorAll(`path`)).toHaveLength(1)
    expect(line_path.getAttribute(`fill`)).toBe(`none`)
    expect(line_path.getAttribute(`stroke`)).toBe(stroke)
    expect(line_path.getAttribute(`stroke-width`)).toBe(width)
    expect(line_path.getAttribute(`stroke-dasharray`)).toBe(dash)
  })

  test(`does not CSS-transition path geometry`, () => {
    mount(Line, { target: document.body, props: { points: [[0, 0]] } })
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

  // oxfmt-ignore
  const three_points: Vec2[] = [[0, 100], [100, 0], [200, 100]]
  // oxfmt-ignore
  const two_points: Vec2[] = [[0, 50], [100, 0]]
  // Line path per curve and point count
  // oxfmt-ignore
  test.each([
    [`monotone over 3 points`, three_points, {}, /^M0,100C.*100,0.*C.*200,100$/],
    [`linear over 3 points`, three_points, { curve: `linear` }, /^M0,100L100,0L200,100$/],
    [`2 points (a straight segment)`, two_points, {}, /^M0,50L100,0$/],
    [`no points`, [], {}, /^$/],
    [`a single point`, [[50, 50]], {}, /^M50,50Z?$/],
  ] as const)(`draws %s`, (_name, points, extra, line) => {
    mount(Line, {
      target: document.body,
      props: {
        points: points.map((point): Vec2 => [...point]),
        line_tween: { duration: 0 },
        ...extra,
      },
    })
    expect(doc_query(`path`).getAttribute(`d`)).toMatch(line)
  })

  // While morphing is off the template binds the raw path, but the tween must keep tracking
  // it: left frozen, re-enabling would snap the line back and morph forward again
  test(`re-enabling the morph does not rewind to where the tween was disabled`, () => {
    vi.useFakeTimers({ toFake: [`performance`] })
    try {
      const state = $state({ points: two_points, line_tween: { duration: 0 } })
      mount(Line, {
        target: document.body,
        props: bind_props({}, state),
      })
      vi.advanceTimersByTime(SETTLE_MS + 1) // past the window where every change snaps anyway

      // move the line while morphing is disabled
      // oxfmt-ignore
      state.points = [[0, 0], [100, 100]]
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

  test(`passes additional props to the path`, () => {
    const rest = { 'data-testid': `custom-line`, 'aria-label': `line chart element` }
    mount(Line, { target: document.body, props: { points: two_points, ...rest } })
    const path = doc_query(`path`)
    expect(path.getAttribute(`data-testid`)).toBe(rest[`data-testid`])
    expect(path.getAttribute(`aria-label`)).toBe(rest[`aria-label`])
  })
})
