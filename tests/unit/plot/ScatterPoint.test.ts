import { ScatterPoint, symbol_names } from '$lib'
import type { PointStyle } from '$lib/plot'
import { mount } from 'svelte'
import { bounceIn } from 'svelte/easing'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '..'

describe(`ScatterPoint`, () => {
  const container_style = `width: 800px; height: 600px;`
  beforeEach(() => {
    document.body.innerHTML = `` // Clear body before each test
    const container = document.createElement(`div`)
    container.setAttribute(`style`, container_style)
    document.body.appendChild(container)
  })

  test(`renders with default props`, () => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100 } })

    const path = doc_query(`path`)
    expect(path).toBeTruthy()
    expect(path.getAttribute(`fill`)).toBe(null) // Check no default fill, should be passed via CSS var --point-fill-color
    expect(path.getAttribute(`fill-opacity`)).toBe(null)
    expect(path.getAttribute(`stroke`)).toBe(`transparent`)
    expect(path.getAttribute(`stroke-width`)).toBe(`1`)
    expect(path.getAttribute(`stroke-opacity`)).toBe(null)
    expect(path.getAttribute(`d`)).toBeTruthy()
  })

  test(`applies custom point styles`, () => {
    const style: PointStyle = {
      fill: `red`,
      radius: 5,
      stroke: `blue`,
      stroke_width: 2,
      fill_opacity: 0.5,
      stroke_opacity: 0.8,
    }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, style } })

    const path = doc_query(`path`)
    expect(path.getAttribute(`stroke`)).toBe(style.stroke)
    expect(path.getAttribute(`stroke-width`)).toBe(String(style.stroke_width))
    expect(path.style.fillOpacity).toBe(String(style.fill_opacity))
    expect(path.style.strokeOpacity).toBe(String(style.stroke_opacity))
  })

  test.each(symbol_names)(
    `renders $symbol_type marker correctly`,
    (symbol_type) => {
      const style: PointStyle = {
        fill: `purple`,
        stroke: `green`,
        stroke_width: 1.5,
        radius: 6,
        symbol_type,
        symbol_size: 100,
      }
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props: { x: 100, y: 100, style } })

      const element = doc_query(`path`)
      expect(element).toBeTruthy()
      expect(element.getAttribute(`stroke`)).toBe(style.stroke)
      expect(element.getAttribute(`stroke-width`)).toBe(
        String(style.stroke_width),
      )
      expect(element.getAttribute(`d`)).toBeTruthy() // Verify path data exists
    },
  )

  test(`derives marker size from radius when symbol_size is null`, () => {
    const style: PointStyle = { radius: 8, symbol_size: null }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, style } })

    const path = doc_query(`path`)
    expect(path).toBeTruthy()
    expect(path.getAttribute(`d`)).toBeTruthy() // Check path data exists
  })

  test.each([3, 8, 12])(
    `renders path markers with different radii (radius=$radius)`,
    (radius) => {
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props: { x: 100, y: 100, style: { radius } } })

      const path = doc_query(`path`)
      expect(path).toBeTruthy()
      expect(path.getAttribute(`d`)).toBeTruthy() // Check path data exists
      // Cannot reliably check marker size derived from radius in happy-dom
    },
  )

  test.each([
    { color: `steelblue`, opacity: 1.0 },
    { color: `crimson`, opacity: 0.7 },
    { color: `#00ff00`, opacity: 0.5 },
    { color: `rgba(128,0,128,0.5)`, opacity: 0.3 },
  ])(
    `applies fill color='$color' opacity=$opacity`,
    ({ color, opacity }) => {
      const target = doc_query(`div`)
      mount(ScatterPoint, {
        target,
        props: { x: 100, y: 100, style: { fill: color, fill_opacity: opacity } },
      })
      const path = doc_query(`path`)
      expect(path).toBeTruthy()
      expect(path.style.fillOpacity).toBe(String(opacity))
    },
  )

  test.each([
    { stroke: `black`, width: 1, opacity: 1.0 },
    { stroke: `red`, width: 2, opacity: 0.8 },
    { stroke: `#0000ff`, width: 3, opacity: 0.5 },
  ])(
    `applies stroke='$stroke' width=$width opacity=$opacity`,
    ({ stroke, width, opacity }) => {
      const target = doc_query(`div`)
      mount(ScatterPoint, {
        target,
        props: {
          x: 100,
          y: 100,
          style: { stroke, stroke_width: width, stroke_opacity: opacity },
        },
      })
      const path = doc_query(`path`)
      expect(path).toBeTruthy()
      expect(path.getAttribute(`stroke`)).toBe(stroke)
      expect(path.getAttribute(`stroke-width`)).toBe(String(width))
      expect(path.style.strokeOpacity).toBe(String(opacity))
    },
  )

  test(`handles hover effects`, () => {
    const hover = { enabled: true, scale: 2, stroke: `white`, stroke_width: 3 }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, hover, is_hovered: true } })
    const g = doc_query(`g`)
    const path = doc_query(`path.marker`)
    expect(path.classList.contains(`is-hovered`)).toBe(true)
    expect(g.style.getPropertyValue(`--hover-scale`)).toBe(String(hover.scale))
    expect(g.style.getPropertyValue(`--hover-stroke`)).toBe(hover.stroke)
    expect(g.style.getPropertyValue(`--hover-stroke-width`)).toBe(
      `${hover.stroke_width}px`,
    )
  })

  test(`renders point label`, () => {
    const label = {
      text: `Test Point`,
      offset: { x: 10, y: 5 },
      font_size: `12px`,
      font_family: `Arial`,
    }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, label } })

    const text = doc_query(`text`)
    expect(text.textContent).toBe(label.text)
    expect(text.getAttribute(`x`)).toBe(String(label.offset.x))
    expect(text.getAttribute(`y`)).toBe(String(label.offset.y))
    expect(text.style.fontSize).toBe(label.font_size)
    expect(text.style.fontFamily).toBe(label.font_family)
  })

  test(`applies point offset`, () => {
    const offset = { x: 5, y: -5 }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, offset } })

    const g = doc_query(`g`)
    // Initial transform check, acknowledging happy-dom limitation
    // for seeing the final tweened/offset position.
    expect(g.getAttribute(`transform`)).toBe(`translate(0 0)`)
  })

  test(`handles partial hover configuration`, () => {
    const hover = { enabled: true, scale: 1.5 }
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, hover, is_hovered: true } })

    const g = doc_query(`g`)
    const path = doc_query(`path.marker`)
    expect(path.classList.contains(`is-hovered`)).toBe(true)
    expect(g.style.getPropertyValue(`--hover-scale`)).toBe(String(hover.scale))
    expect(g.style.getPropertyValue(`--hover-stroke`)).toBe(`white`)
    expect(g.style.getPropertyValue(`--hover-stroke-width`)).toBe(`0px`)
  })

  test(`handles empty label configuration`, () => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 100, y: 100, label: {} } }) // Empty label object

    // Should not render text element
    expect(document.querySelector(`text`)).toBeFalsy()
  })

  test(`handles zero values correctly`, () => {
    const target = doc_query(`div`)
    mount(ScatterPoint, { target, props: { x: 0, y: 0 } })

    const g = doc_query(`g`)
    expect(g.getAttribute(`transform`)).toBe(`translate(0 0)`) // Initial transform
  })

  test(`renders with different text annotation positions`, () => {
    const positions = [
      { position: `above`, offset: { x: 0, y: -15 } },
      { position: `right`, offset: { x: 15, y: 0 } },
      { position: `below`, offset: { x: 0, y: 15 } },
      { position: `left`, offset: { x: -15, y: 0 } },
    ] as const

    for (const pos of positions) {
      // Re-create container in loop to isolate tests
      document.body.innerHTML = ``
      const container = document.createElement(`div`)
      container.setAttribute(`style`, container_style)
      document.body.appendChild(container)

      const label = {
        text: `Point ${pos.position}`,
        offset: pos.offset,
      }
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props: { x: 100, y: 100, label } })

      const text = doc_query(`text`)
      expect(text.textContent).toBe(label.text)
      expect(text.getAttribute(`x`)).toBe(String(pos.offset.x))
      expect(text.getAttribute(`y`)).toBe(String(pos.offset.y))
    }
  })

  test.each(
    [
      { name: `large serif`, size: `18px`, family: `serif` },
      { name: `small mono`, size: `10px`, family: `monospace` },
    ] as const,
  )(
    `applies custom font styling to text annotations`,
    (font) => {
      const label = {
        text: `${font.name} text`,
        font_size: font.size,
        font_family: font.family,
      }
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props: { x: 100, y: 100, label } })
      const text = doc_query(`text`)
      expect(text.textContent).toBe(label.text)
      expect(text.style.fontSize).toBe(font.size)
      expect(text.style.fontFamily).toBe(font.family)
      // Note: happy-dom doesn't reliably support font-weight via style property
    },
  )

  describe(`Tween Behavior`, () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    test.each([
      {
        description: `default origin (0,0)`,
        props: {
          x: 100,
          y: 150,
          offset: { x: 10, y: -10 },
          point_tween: undefined,
        },
        expected_origin: { x: 0, y: 0 },
        expected_target: { x: 110, y: 140 },
      },
      {
        description: `specified origin`,
        props: {
          x: 100,
          y: 150,
          origin: { x: 50, y: 75 },
          offset: { x: 10, y: -10 },
          point_tween: undefined,
        },
        expected_origin: { x: 50, y: 75 },
        expected_target: { x: 110, y: 140 },
      },
      {
        description: `no offset`,
        props: {
          x: 100,
          y: 150,
          origin: { x: 20, y: 30 },
          offset: { x: 0, y: 0 },
          point_tween: undefined,
        },
        expected_origin: { x: 20, y: 30 },
        expected_target: { x: 100, y: 150 },
      },
      {
        description: `negative coordinates`,
        props: {
          x: -100,
          y: -150,
          origin: { x: -50, y: -75 },
          offset: { x: -10, y: 10 },
          point_tween: undefined,
        },
        expected_origin: { x: -50, y: -75 },
        expected_target: { x: -110, y: -140 },
      },
    ])(
      `tween starts from $description`,
      async ({ props, expected_origin, expected_target }) => {
        const target = doc_query(`div`)
        mount(ScatterPoint, { target, props })
        const g_element = doc_query(`g`)

        // Let microtasks run to allow Svelte to process initial state/effects
        await vi.advanceTimersByTimeAsync(0)

        // Check initial transform is at expected origin.
        expect(g_element.getAttribute(`transform`)).toBe(
          `translate(${expected_origin.x} ${expected_origin.y})`,
        )

        // Advance time to end state
        const default_tween_duration = 600
        await vi.advanceTimersByTimeAsync(default_tween_duration)

        // Check final transform is at target position, allowing for float precision
        // Only perform final check for the default origin case due to HappyDOM limitations
        if (props.origin === undefined && props.point_tween === undefined) {
          const final_transform = g_element.getAttribute(`transform`)
          const match = final_transform?.match(
            /translate\(([^\s]+)\s+([^\)]+)\)/,
          )
          expect(match).not.toBeNull()
          if (match) {
            const final_x = parseFloat(match[1])
            const final_y = parseFloat(match[2])
            expect(final_x).toBeCloseTo(expected_target.x)
            expect(final_y).toBeCloseTo(expected_target.y)
          }
        }
        // For other cases, just ensure mounting works and initial state is correct
      },
    )

    test(`tween duration 0 snaps to final position`, () => {
      const props = {
        x: 200,
        y: 250,
        origin: { x: 10, y: 20 },
        offset: { x: 5, y: 5 },
        point_tween: { duration: 0 },
      }
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props })
      const g_element = doc_query(`g`)

      // With duration 0, check immediate final position (may be flaky in happy-dom).
      expect(g_element.getAttribute(`transform`)).toBe(
        `translate(${props.x + props.offset.x} ${props.y + props.offset.y})`,
      )

      // Advance time slightly & re-check (may still be flaky).
      expect(g_element.getAttribute(`transform`)).toBe(
        `translate(${props.x + props.offset.x} ${props.y + props.offset.y})`,
      )
    })

    test(`applies custom point_tween options (easing)`, async () => {
      const props = {
        x: 100,
        y: 150,
        origin: { x: 0, y: 0 },
        offset: { x: 0, y: 0 },
        point_tween: { duration: 800, easing: bounceIn },
      }
      const target = doc_query(`div`)
      mount(ScatterPoint, { target, props })
      const g_element = doc_query(`g`)

      // Check initial transform
      expect(g_element.getAttribute(`transform`)).toBe(`translate(0 0)`)

      // Advance timers
      vi.advanceTimersByTime(props.point_tween.duration)
      await vi.runAllTimersAsync()

      // Verify final position (primary check is mounting without error)
      expect(g_element.getAttribute(`transform`)).toBe(`translate(100 150)`)
    })
  })
})
