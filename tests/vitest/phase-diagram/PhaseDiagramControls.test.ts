import type { PhaseDiagramData } from '$lib/phase-diagram'
import { PhaseDiagramControls } from '$lib/phase-diagram'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

// Sample phase diagram data for testing
const sample_data: PhaseDiagramData = {
  components: [`Cu`, `Ni`],
  temperature_range: [300, 1800],
  temperature_unit: `K`,
  composition_unit: `at%`,
  regions: [
    {
      id: `liquid`,
      name: `Liquid`,
      vertices: [
        [0, 1800],
        [1, 1800],
        [1, 1400],
        [0, 1350],
      ],
      color: `#6baed6`,
    },
  ],
  boundaries: [
    {
      id: `liquidus`,
      type: `liquidus`,
      points: [
        [0, 1350],
        [0.5, 1400],
        [1, 1400],
      ],
    },
  ],
  special_points: [
    {
      id: `test-point`,
      type: `eutectic`,
      position: [0.5, 1350],
      label: `E`,
    },
  ],
}

describe(`PhaseDiagramControls`, () => {
  test.each([
    { section: `Visibility`, labels: [`Boundaries`, `Labels`, `Grid`, `Comp. Labels`] },
    { section: `Appearance`, labels: [`Font size`] },
    { section: `Colors`, labels: [`Background`, `Boundaries`] },
    {
      section: `Tie-line Display`,
      labels: [`Line width`, `Endpoint radius`, `Cursor radius`],
    },
    { section: `Axes`, labels: [`X-axis ticks`, `Y-axis ticks`] },
    { section: `Export`, labels: [`PNG DPI`] },
  ])(`renders $section section with its controls when open`, ({ section, labels }) => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true, enable_export: true },
    })

    for (const text of [section, ...labels]) expect(target.innerHTML).toContain(text)
  })

  test(`hides export section when enable_export is false`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true, enable_export: false },
    })

    // Export section header should not be present
    const export_regex = /<h4[^>]*>Export<\/h4>/i
    expect(target.innerHTML).not.toMatch(export_regex)
  })

  test.each([
    { data: sample_data, expected: true, desc: `with special_points` },
    { data: { ...sample_data, special_points: [] }, expected: false, desc: `without` },
  ])(`Special Pts toggle shown=$expected $desc`, ({ data, expected }) => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true, data },
    })

    const visibility_grid = target.querySelector(`.visibility-grid`)
    expect(visibility_grid).toBeInstanceOf(HTMLElement)
    expect(visibility_grid?.innerHTML.includes(`Special Pts`)).toBe(expected)
  })

  test.each([
    [`Boundaries`, true],
    [`Labels`, true],
    [`Grid`, true],
    [`Comp. Labels`, true],
  ])(`checkbox "%s" defaults to %s`, (label_text, expected_value) => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    // Find the checkbox by its label text
    const checkboxes = target.querySelectorAll(`input[type="checkbox"]`)
    expect(checkboxes.length).toBeGreaterThan(0)

    const checkbox = Array.from(checkboxes).find((cb) => {
      const label = cb.closest(`label`)
      return label?.textContent?.includes(label_text)
    }) as HTMLInputElement | undefined

    expect(checkbox, `checkbox "${label_text}" not found`).toBeDefined()
    expect(checkbox?.checked).toBe(expected_value)
  })

  test(`renders with custom config values`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: {
        controls_open: true,
        config: {
          font_size: 16,
          special_point_radius: 8,
        },
      },
    })

    // The font size input should have the custom value
    const font_size_input = target.querySelector<HTMLInputElement>(
      `input[type="number"][min="8"][max="20"]`,
    )
    expect(font_size_input?.value).toBe(`16`)
  })

  test(`uses component names from data in title`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: {
        controls_open: true,
        data: sample_data,
      },
    })

    expect(target.innerHTML).toContain(`Cu-Ni`)
  })

  test(`shows generic title when no data provided`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    expect(target.innerHTML).toContain(`Phase Diagram Controls`)
  })

  test(`hides pane content when controls_open is false`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: false },
    })

    // The pane should be hidden (display: none)
    const pane = target.querySelector(`.draggable-pane`) as HTMLElement
    expect(pane).toBeInstanceOf(HTMLElement)
    expect(pane?.style.display).toBe(`none`)
  })
})
