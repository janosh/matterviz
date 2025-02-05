import { ScatterPlot } from '$lib'
import { tick } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { doc_query } from '.'

describe(`ScatterPlot`, () => {
  // Add container with dimensions to body before each test
  const container_style = `width: 800px; height: 600px;`
  beforeEach(() => {
    const container = document.createElement(`div`)
    container.setAttribute(`style`, container_style)
    document.body.appendChild(container)
  })

  test(`renders with default props`, async () => {
    new ScatterPlot({ target: document.querySelector(`div`)! })
    await tick()

    const scatter = doc_query(`.scatter`)
    expect(scatter).toBeTruthy()
    expect(getComputedStyle(scatter).width).toBe(`100%`)
  })

  test(`applies custom style`, async () => {
    const style = `height: 300px; background: black;`
    new ScatterPlot({
      target: document.querySelector(`div`)!,
      props: { style },
    })
    await tick()

    const scatter = doc_query(`.scatter`)
    expect(scatter.getAttribute(`style`)).toBe(style)
  })
})
