import { AtomColorLegend } from '$lib'
import type { AtomColorConfig, AtomPropertyColors } from '$lib/structure/atom-properties'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`AtomColorLegend`, () => {
  const create_property_colors = (
    unique_values: (number | string)[],
    colors: string[],
  ): AtomPropertyColors => ({
    unique_values,
    colors,
    values: unique_values,
    min_value: typeof unique_values[0] === `number` ? unique_values[0] : 0,
    max_value: typeof unique_values[unique_values.length - 1] === `number`
      ? unique_values[unique_values.length - 1]
      : 0,
  })

  test(`does not render when mode is element`, () => {
    const config: Partial<AtomColorConfig> = { mode: `element` }
    mount(AtomColorLegend, {
      target: document.body,
      props: { atom_color_config: config },
    })
    expect(document.querySelector(`.atom-color-legend`)).toBeNull()
  })

  test(`renders continuous gradient for multiple values`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors(
      [1, 2, 3],
      [`rgb(0, 0, 255)`, `rgb(128, 0, 128)`, `rgb(255, 0, 0)`],
    )

    mount(AtomColorLegend, {
      target: document.body,
      props: { atom_color_config: config, property_colors },
    })

    const legend = document.querySelector(`.atom-color-legend`)
    expect(legend).not.toBeNull()

    const gradient_bar = document.querySelector(`.gradient-bar`) as HTMLElement
    expect(gradient_bar).not.toBeNull()
  })

  test(`handles single unique value without division by zero`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors([5], [`rgb(255, 0, 0)`])

    // The key test: this should not throw any errors and should not generate NaN
    expect(() => {
      mount(AtomColorLegend, {
        target: document.body,
        props: { atom_color_config: config, property_colors },
      })
    }).not.toThrow()

    const gradient_bar = document.querySelector(`.gradient-bar`) as HTMLElement
    expect(gradient_bar).not.toBeNull()

    // The component should render successfully without NaN values
    const legend = document.querySelector(`.atom-color-legend`)
    expect(legend?.innerHTML).not.toContain(`NaN`)
  })

  test(`handles two unique values correctly`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors(
      [1, 2],
      [`rgb(0, 0, 255)`, `rgb(255, 0, 0)`],
    )

    mount(AtomColorLegend, {
      target: document.body,
      props: { atom_color_config: config, property_colors },
    })

    const gradient_bar = document.querySelector(`.gradient-bar`) as HTMLElement
    expect(gradient_bar).not.toBeNull()

    // Should not contain NaN anywhere in the legend
    const legend = document.querySelector(`.atom-color-legend`)
    expect(legend?.innerHTML).not.toContain(`NaN`)
  })

  test(`renders categorical legend for categorical scale_type`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `wyckoff`,
      scale_type: `categorical`,
    }
    const property_colors = create_property_colors(
      [`a`, `b`, `c`],
      [`rgb(255, 0, 0)`, `rgb(0, 255, 0)`, `rgb(0, 0, 255)`],
    )

    mount(AtomColorLegend, {
      target: document.body,
      props: { atom_color_config: config, property_colors },
    })

    const categorical = document.querySelector(`.categorical-legend`)
    expect(categorical).not.toBeNull()

    const items = document.querySelectorAll(`.legend-item`)
    expect(items).toHaveLength(3)

    const swatches = document.querySelectorAll(`.color-swatch`)
    expect(swatches).toHaveLength(3)
  })

  test(`displays min and max labels for continuous scale`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors(
      [1, 5, 10],
      [`rgb(0, 0, 255)`, `rgb(128, 0, 128)`, `rgb(255, 0, 0)`],
    )

    mount(AtomColorLegend, {
      target: document.body,
      props: { atom_color_config: config, property_colors },
    })

    const labels = document.querySelector(`.gradient-labels`)
    expect(labels).not.toBeNull()
    expect(labels?.textContent).toContain(`1`)
    expect(labels?.textContent).toContain(`10`)
  })

  test(`uses custom title when provided`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `custom`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors([1, 2], [`blue`, `red`])

    mount(AtomColorLegend, {
      target: document.body,
      props: {
        atom_color_config: config,
        property_colors,
        title: `My Custom Title`,
      },
    })

    const title = document.querySelector(`.atom-color-legend h4`)
    expect(title?.textContent).toBe(`My Custom Title`)
  })

  test(`uses default title based on mode`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors([1, 2], [`blue`, `red`])

    mount(AtomColorLegend, {
      target: document.body,
      props: { atom_color_config: config, property_colors },
    })

    const title = document.querySelector(`.atom-color-legend h4`)
    expect(title?.textContent).toBe(`Coordination Number`)
  })

  test(`applies custom HTML attributes via rest props`, () => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = create_property_colors([1, 2], [`blue`, `red`])

    mount(AtomColorLegend, {
      target: document.body,
      props: {
        atom_color_config: config,
        property_colors,
        'data-testid': `test-legend`,
        style: `z-index: 100;`,
      },
    })

    const legend = document.body.querySelector(`.atom-color-legend`)
    expect(legend).not.toBeNull()
    expect(legend?.getAttribute(`data-testid`)).toBe(`test-legend`)
    expect(legend?.getAttribute(`style`)).toContain(`z-index`)
  })

  test.each([
    [`empty unique_values`, [], []],
    [`single value`, [42], [`rgb(255, 128, 0)`]],
    [`two values`, [1, 2], [`red`, `blue`]],
    [`multiple values`, [1, 2, 3, 4], [`red`, `yellow`, `green`, `blue`]],
  ])(`handles %s without errors or NaN`, (_desc, unique_values, colors) => {
    const config: Partial<AtomColorConfig> = {
      mode: `coordination`,
      scale_type: `continuous`,
    }
    const property_colors = unique_values.length
      ? create_property_colors(unique_values, colors)
      : null

    expect(() => {
      mount(AtomColorLegend, {
        target: document.body,
        props: { atom_color_config: config, property_colors },
      })
    }).not.toThrow()

    if (unique_values.length > 0) {
      const legend = document.body.querySelector(`.atom-color-legend`)
      if (legend) {
        expect(legend.innerHTML).not.toContain(`NaN`)
      }
    }
  })
})
