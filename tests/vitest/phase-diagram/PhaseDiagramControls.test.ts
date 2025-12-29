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
  test(`renders without errors`, () => {
    const target = document.createElement(`div`)
    expect(() => {
      mount(PhaseDiagramControls, { target, props: {} })
    }).not.toThrow()
  })

  test(`renders with data prop`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { data: sample_data },
    })
    // Should contain the component names in title
    expect(target.innerHTML).toContain(`Cu`)
    expect(target.innerHTML).toContain(`Ni`)
  })

  test(`controls_open state is bindable`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })
    // When open, the pane should contain visibility controls
    expect(target.innerHTML).toContain(`Visibility`)
  })

  test(`visibility toggles are rendered when open`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    expect(target.innerHTML).toContain(`Boundaries`)
    expect(target.innerHTML).toContain(`Labels`)
    expect(target.innerHTML).toContain(`Grid`)
    expect(target.innerHTML).toContain(`Comp. Labels`)
  })

  test(`shows Special Points visibility toggle when data has special_points`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true, data: sample_data },
    })

    // Find the visibility grid and check for Special Pts checkbox
    const visibility_grid = target.querySelector(`.visibility-grid`)
    expect(visibility_grid).toBeTruthy()
    expect(visibility_grid?.innerHTML).toContain(`Special Pts`)
  })

  test(`hides Special Points visibility toggle when no special_points in data`, () => {
    const target = document.createElement(`div`)
    const data_without_special = { ...sample_data, special_points: [] }
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true, data: data_without_special },
    })

    // The visibility grid should NOT contain Special Pts (but colors grid still will)
    const visibility_grid = target.querySelector(`.visibility-grid`)
    expect(visibility_grid).toBeTruthy()
    expect(visibility_grid?.innerHTML).not.toContain(`Special Pts`)
  })

  test(`renders appearance section`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    expect(target.innerHTML).toContain(`Appearance`)
    expect(target.innerHTML).toContain(`Font size`)
  })

  test(`renders colors section`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    expect(target.innerHTML).toContain(`Colors`)
    expect(target.innerHTML).toContain(`Background`)
    expect(target.innerHTML).toContain(`Boundaries`)
  })

  test(`renders tie-line section`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    expect(target.innerHTML).toContain(`Tie-line Display`)
    expect(target.innerHTML).toContain(`Line width`)
    expect(target.innerHTML).toContain(`Endpoint radius`)
    expect(target.innerHTML).toContain(`Cursor radius`)
  })

  test(`renders axes section`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true },
    })

    expect(target.innerHTML).toContain(`Axes`)
    expect(target.innerHTML).toContain(`X-axis ticks`)
    expect(target.innerHTML).toContain(`Y-axis ticks`)
  })

  test(`renders export section when enable_export is true`, () => {
    const target = document.createElement(`div`)
    mount(PhaseDiagramControls, {
      target,
      props: { controls_open: true, enable_export: true },
    })

    expect(target.innerHTML).toContain(`Export`)
    expect(target.innerHTML).toContain(`PNG DPI`)
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
    const font_size_input = target.querySelector(
      `input[type="number"][min="8"][max="20"]`,
    ) as HTMLInputElement

    if (font_size_input) {
      expect(font_size_input.value).toBe(`16`)
    }
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
    expect(pane).toBeTruthy()
    expect(pane?.style.display).toBe(`none`)
  })
})
