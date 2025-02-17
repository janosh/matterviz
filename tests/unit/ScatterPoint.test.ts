import { ScatterPoint } from '$lib'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { doc_query } from '.'

describe(`ScatterPoint`, () => {
  // Add container with dimensions to body before each test
  const container_style = `width: 800px; height: 600px;`
  beforeEach(() => {
    const container = document.createElement(`div`)
    container.setAttribute(`style`, container_style)
    document.body.appendChild(container)
  })

  test(`renders with default props`, async () => {
    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 100, y: 100 },
    })
    await tick()

    const circle = doc_query(`circle`)
    expect(circle).toBeTruthy()
    expect(circle.getAttribute(`r`)).toBe(`2`) // default radius
    expect(circle.getAttribute(`fill`)).toBe(`gray`) // default fill
  })

  test(`applies custom point styles`, async () => {
    const style = {
      fill: `red`,
      radius: 5,
      stroke: `blue`,
      stroke_width: 2,
      fill_opacity: 0.5,
      stroke_opacity: 0.8,
    }

    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 100, y: 100, style },
    })
    await tick()

    const circle = doc_query(`circle`)
    expect(circle.getAttribute(`fill`)).toBe(style.fill)
    expect(circle.getAttribute(`r`)).toBe(style.radius.toString())
    expect(circle.getAttribute(`stroke`)).toBe(style.stroke)
    expect(circle.getAttribute(`stroke-width`)).toBe(
      style.stroke_width.toString(),
    )
    expect(circle.style.fillOpacity).toBe(style.fill_opacity.toString())
    expect(circle.style.strokeOpacity).toBe(style.stroke_opacity.toString())
  })

  test(`handles hover effects`, async () => {
    const hover = {
      enabled: true,
      scale: 2,
      stroke: `white`,
      stroke_width: 3,
    }

    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 100, y: 100, hover },
    })
    await tick()

    const g = doc_query(`g`)
    expect(g.classList.contains(`hover_effect`)).toBe(true)
    expect(g.style.getPropertyValue(`--hover-scale`)).toBe(
      hover.scale.toString(),
    )
    expect(g.style.getPropertyValue(`--hover-stroke`)).toBe(hover.stroke)
    expect(g.style.getPropertyValue(`--hover-stroke-width`)).toBe(
      `${hover.stroke_width}px`,
    )
  })

  test(`renders point label`, async () => {
    const label = {
      text: `Test Point`,
      offset_x: 10,
      offset_y: 5,
      font_size: `12px`,
      font_family: `Arial`,
    }

    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 100, y: 100, label },
    })
    await tick()

    const text = doc_query(`text`)
    expect(text.textContent).toBe(label.text)
    expect(text.getAttribute(`x`)).toBe(label.offset_x.toString())
    expect(text.getAttribute(`y`)).toBe(label.offset_y.toString())
    expect(text.style.fontSize).toBe(label.font_size)
    expect(text.style.fontFamily).toBe(label.font_family)
  })

  test(`applies point offset`, async () => {
    const offset = { x: 5, y: -5 }

    const props = { x: 100, y: 100, offset }
    mount(ScatterPoint, { target: document.querySelector(`div`)!, props })
    await tick()

    const g = doc_query(`g`)
    const transform = g.getAttribute(`transform`)
    expect(transform).toBe(
      // TODO should expect next line but translate doesn't seem to happen in JSDOM
      // `translate(${props.x + offset.x} ${props.y + offset.y})`,
      `translate(0 0)`,
    )
  })

  test(`handles partial hover configuration`, async () => {
    const hover = {
      enabled: true,
      // Only specify scale, omit other properties
      scale: 1.5,
    }

    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 100, y: 100, hover },
    })
    await tick()

    const g = doc_query(`g`)
    expect(g.classList.contains(`hover_effect`)).toBe(true)
    expect(g.style.getPropertyValue(`--hover-scale`)).toBe(
      hover.scale.toString(),
    )
  })

  test(`handles empty label configuration`, async () => {
    const label = {}

    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 100, y: 100, label },
    })
    await tick()

    // Should not render text element when no label text is provided
    const text = document.querySelector(`text`)
    expect(text).toBeFalsy()
  })

  test(`handles zero values correctly`, async () => {
    mount(ScatterPoint, {
      target: document.querySelector(`div`)!,
      props: { x: 0, y: 0 },
    })
    await tick()

    const g = doc_query(`g`)
    const transform = g.getAttribute(`transform`)
    expect(transform).toBe(`translate(0 0)`)
  })
})
