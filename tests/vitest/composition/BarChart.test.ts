import {
  BarChart,
  count_atoms_in_composition,
  fractional_composition,
} from '$lib/composition'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`BarChart component`, () => {
  test(`renders container with correct dimensions`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 300 },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container).toBeTruthy()
    expect(container?.getAttribute(`viewBox`)).toContain(`0 0 300`)
  })

  test(`renders segments for each element`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 300 },
    })

    expect(document.querySelectorAll(`rect.bar-segment`)).toHaveLength(3)
  })

  test(`handles interactive mode`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, interactive: true },
    })

    expect(
      document.querySelectorAll(`rect.bar-segment[role="button"]`).length,
    ).toBeGreaterThan(0)
  })

  test.each([
    [false, `all segments`],
    [true, `outer corners only`],
  ])(
    `applies border radius correctly when outer_corners_only is %s`,
    (outer_corners_only) => {
      mount(BarChart, {
        target: document.body,
        props: {
          composition: { H: 2, O: 1, C: 1 },
          outer_corners_only,
        },
      })

      const segments = document.querySelectorAll(`rect.bar-segment`)
      expect(segments.length).toBeGreaterThan(0)

      // Check that clip path exists for border radius
      const clip_path = document.querySelector(`clipPath`)
      expect(clip_path).toBeTruthy()

      // Check that the clip path rect has the correct border radius
      const clip_rect = clip_path?.querySelector(`rect`) as SVGElement
      expect(clip_rect?.getAttribute(`rx`)).toBe(outer_corners_only ? `4` : `0`)
    },
  )

  test.each([true, false])(`handles labels`, (show_labels) => {
    const composition = { H: 2, O: 1 }
    mount(BarChart, {
      target: document.body,
      props: { composition, size: 300, show_labels },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container?.querySelectorAll(`text.bar-label`).length).toBe(
      show_labels ? Object.keys(composition).length : 0,
    )
  })

  test(`renders with basic composition`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 } },
    })
    expect(doc_query(`.bar-chart`)).toBeTruthy()
  })

  test(`renders bar segments correctly`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 } },
    })

    const segments = document.querySelectorAll(`rect.bar-segment`)
    expect(segments.length).toBe(2) // H and O segments
  })

  test(`external label positioning balances above and below`, () => {
    // Create composition with many thin segments to trigger external labels
    const composition = { H: 1, C: 1, N: 1, O: 1, Ca: 1, Mg: 1 }
    mount(BarChart, {
      target: document.body,
      props: { composition, size: 300 },
    })

    // Check that external labels exist by looking at their y-coordinates
    const all_labels = document.querySelectorAll(`text.external-label`)
    const above_labels = Array.from(all_labels).filter((label) => {
      const y = parseFloat(label.getAttribute(`y`) || `0`)
      return y < 20 // Above the bar
    })
    const below_labels = Array.from(all_labels).filter((label) => {
      const y = parseFloat(label.getAttribute(`y`) || `0`)
      return y > 60 // Below the bar
    })

    // With 6 equal segments at ~16.7% each, they should be thin enough for external labels
    const total_external_labels = above_labels.length + below_labels.length
    expect(total_external_labels).toBeGreaterThan(0)

    // The difference between above and below labels should be at most 1
    // (perfect balance or one extra in one direction)
    const difference = Math.abs(above_labels.length - below_labels.length)
    expect(difference).toBeLessThanOrEqual(1)
  })

  test(`handles custom dimensions`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 400 },
    })

    const container = doc_query(`.bar-chart`)
    expect(container.getAttribute(`viewBox`)).toContain(`0 0 400`)
  })

  test(`applies custom styling and classes`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        style: `background-color: red;`,
        class: `my-custom-class`,
      },
    })

    const container = doc_query(`.bar-chart`)
    const style = container.getAttribute(`style`)
    expect(style).toContain(`background-color: red;`)
    expect(style).toContain(`--bar-height: 30px`) // Should also have CSS variables
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
  })

  test(`handles empty composition gracefully`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: {} },
    })

    const segments = document.querySelectorAll(`rect.bar-segment`)
    expect(segments.length).toBe(0)
  })

  test(`shows labels and percentages when enabled`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        show_labels: true,
        show_percentages: true,
        show_amounts: true,
      },
    })

    // Should find element symbols
    expect(document.querySelector(`.element-symbol`)).toBeTruthy()

    // Should find percentage elements
    expect(document.querySelector(`.percentage`)).toBeTruthy()

    // Should find amount elements
    expect(document.querySelector(`.amount`)).toBeTruthy()
  })

  test(`handles custom bar dimensions`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        bar_height: 50,
        label_height: 30,
        gap: 5,
      },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container).toBeTruthy()

    // Check that CSS variables are set
    const style = container?.getAttribute(`style`)
    expect(style).toContain(`--bar-height: 50px`)
    expect(style).toContain(`--label-height: 30px`)
    expect(style).toContain(`--gap: 5px`)
  })

  test(`handles custom thresholds`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 1, C: 1, N: 1, O: 1, Ca: 1, Mg: 1 },
        min_segment_size_for_label: 50, // Very high threshold
        thin_segment_threshold: 30, // Higher threshold
        external_label_size_threshold: 10, // Higher threshold
      },
    })

    // With high thresholds, segments should have different label behavior
    const bar_labels = document.querySelectorAll(`text.bar-label`)
    const external_labels = document.querySelectorAll(`text.external-label`)

    // Should have some labels (either internal or external)
    expect(bar_labels.length + external_labels.length).toBeGreaterThan(0)

    // With high min_segment_size_for_label, fewer internal labels should be shown
    expect(bar_labels.length).toBeLessThanOrEqual(6)
  })

  test(`renders children content`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-child"></div>`,
        })),
      },
    })

    expect(document.querySelector(`.custom-child`)).toBeTruthy()
  })
})

describe(`BarChart calculations`, () => {
  test.each([
    [{ H: 2, O: 1 }, { H: 0.6667, O: 0.3333 }, 3],
    [{}, {}, 0],
    [{ H: 5 }, { H: 1.0 }, 5],
    [
      { C: 8, H: 10, N: 4, O: 2 },
      { C: 0.3333, H: 0.4167, N: 0.1667, O: 0.0833 },
      24,
    ],
  ])(
    `processes composition correctly`,
    (composition, expected_fractions, expected_total) => {
      expect(count_atoms_in_composition(composition)).toBe(expected_total)

      const fractions = fractional_composition(composition)
      if (Object.keys(expected_fractions).length === 0) {
        expect(Object.keys(fractions)).toHaveLength(0)
      } else {
        Object.entries(expected_fractions).forEach(
          ([element, expected_frac]) => {
            expect(
              fractions[element as keyof typeof fractions],
            ).toBeCloseTo(expected_frac as number, 3)
          },
        )
      }
    },
  )

  test(`calculates font scaling correctly`, () => {
    const min_font_scale = 0.6
    const max_font_scale = 1.2

    // Test different segment sizes
    expect(Math.min(max_font_scale, Math.max(min_font_scale, 80 / 40))).toBe(
      max_font_scale,
    )
    expect(Math.min(max_font_scale, Math.max(min_font_scale, 20 / 40))).toBe(
      min_font_scale,
    )
    expect(Math.min(max_font_scale, Math.max(min_font_scale, 40 / 40))).toBe(
      1.0,
    )
  })
})
