import { Line } from '$lib'
import { interpolatePath } from 'd3-interpolate-path'
import { mount } from 'svelte'
import { sineIn } from 'svelte/easing'
import { describe, expect, test } from 'vitest'

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
    const points: [number, number][] = [[10, 10], [50, 50], [100, 20]]
    const origin: [number, number] = [0, 200]

    mount(Line, { target: document.body, props: { points, origin, ...props } })

    const paths = document.querySelectorAll(`path`)
    expect(paths.length).toBe(2)

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

  test(`calculates line path correctly for 2 and 3 points`, () => {
    const origin: [number, number] = [0, 100]

    // Test with 3 points (expects curve 'C')
    const points_3: [number, number][] = [[0, 100], [100, 0], [200, 100]]
    mount(Line, {
      target: document.body,
      props: { points: points_3, origin, line_tween: { duration: 0 } },
    })

    const paths_3 = document.querySelectorAll(`path`)
    expect(paths_3[0].getAttribute(`d`)).toMatch(/^M0,100C.*100,0.*C.*200,100$/)

    // Clean up target before remounting
    document.body.innerHTML = ``

    // Test with 2 points (expects line 'L')
    const points_2: [number, number][] = [[0, 100], [100, 0]]
    mount(Line, {
      target: document.body, // Reuse the cleaned div
      props: { points: points_2, origin, line_tween: { duration: 0 } },
    })

    const paths_2 = document.querySelectorAll(`path`)
    expect(paths_2[0].getAttribute(`d`)).toMatch(/^M0,100L100,0$/)
  })

  test(`calculates area path correctly with 2 points`, () => {
    const points: [number, number][] = [
      [0, 50],
      [100, 0],
    ]
    const origin: [number, number] = [0, 100] // Y origin at 100

    mount(Line, {
      target: document.body,
      props: { points, origin, line_tween: { duration: 0 } },
    })

    const area_path = document.querySelectorAll(`path`)[1]
    expect(area_path.getAttribute(`d`)).toMatch(/^M0,50L100,0L100,100L0,100Z$/)
  })

  test(`handles empty points array`, () => {
    const points: [number, number][] = []
    const origin: [number, number] = [0, 100]

    mount(Line, {
      target: document.body,
      props: { points, origin, tween_duration: 0 },
    })

    const paths = document.querySelectorAll(`path`)
    expect(paths.length).toBe(2)
    expect(paths[0].getAttribute(`d`)).toBe(``)
    expect(paths[1].getAttribute(`d`)).toBe(``)
  })

  test(`handles single point array`, () => {
    const points: [number, number][] = [[50, 50]]
    const origin: [number, number] = [0, 100]

    mount(Line, {
      target: document.body,
      props: { points, origin, line_tween: { duration: 0 } },
    })

    const paths = document.querySelectorAll(`path`)
    expect(paths.length).toBe(2)
    expect(paths[0].getAttribute(`d`)).toMatch(/^M50,50Z?$/)
    expect(paths[1].getAttribute(`d`)).toMatch(/^M50,50Z?L50,100L50,100Z$/)
  })

  test(`applies custom tween options (easing, interpolate)`, () => {
    const points: [number, number][] = [
      [10, 10],
      [50, 50],
    ]
    const origin: [number, number] = [0, 100]

    const custom_tween = {
      duration: 500,
      easing: sineIn, // Custom easing function
      interpolate: interpolatePath, // Custom interpolator for paths
    }

    mount(Line, {
      target: document.body,
      props: { points, origin, line_tween: custom_tween },
    })

    const paths = document.querySelectorAll(`path`)
    expect(paths.length).toBe(2)
    // Further checks on internal tween state are difficult in unit tests,
    // but mounting confirms the props were accepted.
  })

  test(`passes additional props to path elements`, () => {
    const points: [number, number][] = [
      [10, 10],
      [50, 50],
    ]
    const origin: [number, number] = [0, 100]
    const rest = {
      'data-testid': `custom-line`,
      'aria-label': `line chart element`,
    }

    mount(Line, {
      target: document.body,
      props: { points, origin, ...rest },
    })

    const paths = document.querySelectorAll(`path`)
    expect(paths.length).toBe(2)

    // Check that both paths received the rest props
    paths.forEach((path_element) => {
      expect(path_element.getAttribute(`data-testid`)).toBe(rest[`data-testid`])
      expect(path_element.getAttribute(`aria-label`)).toBe(rest[`aria-label`])
    })
  })
})
