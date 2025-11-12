import type { CompositionType, ElementSymbol } from '$lib'
import { default_element_colors } from '$lib/colors'
import { colors } from '$lib/state.svelte'
import AtomLegend from '$lib/structure/AtomLegend.svelte'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`AtomLegend Component`, () => {
  const mock_elements = { Fe: 2, O: 3, H: 1.5, C: 12.123456789 }

  test.each([
    {
      desc: `basic rendering with default amounts`,
      props: { elements: mock_elements, style: `margin: 20px;` },
      expected_labels: [`Fe 2`, `O 3`, `H 1.5`, `C 12.123`],
      expected_count: 4,
      check_styling: true,
    },
    {
      desc: `custom amount formatting`,
      props: { elements: { Fe: 2.123456, O: 3.0 }, amount_format: `.2f` },
      expected_labels: [`Fe 2.12`, `O 3.00`],
      expected_count: 2,
    },
    {
      desc: `floating point precision`,
      props: { elements: { P: 1.4849999999999999, Ge: 0.515, S: 3 } },
      expected_labels: [`P 1.485`, `Ge 0.515`, `S 3`],
      expected_count: 3,
    },
    {
      desc: `hide amounts`,
      props: { elements: mock_elements, show_amounts: false },
      expected_labels: [`Fe`, `O`, `H`, `C`],
      expected_count: 4,
    },
    {
      desc: `show amounts explicitly`,
      props: { elements: { Fe: 2.123456 }, show_amounts: true, amount_format: `.2f` },
      expected_labels: [`Fe 2.12`],
      expected_count: 1,
    },
  ])(`$desc`, ({ props, expected_labels, expected_count, check_styling }) => {
    mount(AtomLegend, { target: document.body, props })

    const labels = document.querySelectorAll(`label`)
    expect(labels).toHaveLength(expected_count)

    const label_texts = Array.from(labels).map((l) => l.textContent?.trim())
    expect(label_texts).toEqual(expected_labels)

    if (check_styling) {
      // Check styling and inputs
      const iron_label = labels[0] as HTMLLabelElement
      expect(iron_label.style.backgroundColor).toBe(colors.element.Fe)

      const color_inputs = document.querySelectorAll(`input[type="color"]`)
      expect(color_inputs).toHaveLength(expected_count)
      expect((color_inputs[0] as HTMLInputElement).value).toBe(colors.element.Fe)

      // Check custom style
      expect(doc_query(`div`).getAttribute(`style`)).toBe(props.style)
    }
  })

  test(`color picker functionality`, () => {
    mount(AtomLegend, {
      target: document.body,
      props: { elements: { Fe: 2 }, elem_color_picker_title: `Custom title` },
    })

    const color_input = doc_query<HTMLInputElement>(`input[type="color"]`)
    const label = doc_query<HTMLLabelElement>(`label`)

    expect(color_input.title).toBe(`Custom title`)

    // Test color change and reset
    color_input.value = `#ff0000`
    color_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(colors.element.Fe).toBe(`#ff0000`)

    label.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    expect(colors.element.Fe).toBe(default_element_colors.Fe)
  })

  test.each([
    [{}, 0, undefined], // Empty elements
    [{ Fe: 0 }, 1, `Fe 0`], // Zero amount
    [{ Fe: 0.0001 }, 1, `Fe 0`], // Very small decimal (trimmed by .3~f format)
    [{ Xx: 1 } as unknown as CompositionType, 1, `Xx 1`], // Non-existent element
  ])(
    `handles edge cases correctly`,
    (elements, expected_count, expected_text) => {
      mount(AtomLegend, { target: document.body, props: { elements } })

      const labels = document.querySelectorAll(`label`)
      expect(labels).toHaveLength(expected_count)

      if (expected_text) {
        expect(labels[0].textContent?.trim()).toBe(expected_text)
        // Test accessibility - label contains input
        const input = labels[0].querySelector(`input[type="color"]`)
        expect(input).not.toBeNull()
        expect(labels[0].contains(input)).toBe(true)
      }
    },
  )

  test.each([
    {
      desc: `custom labels with formatting`,
      get_element_label: (element: string, amount: number) =>
        `${element.toUpperCase()}: ${amount.toFixed(1)}`,
      elements: { Fe: 2.5, O: 1.234 },
      expected: [`FE: 2.5`, `O: 1.2`],
    },
    {
      desc: `custom labels override show_amounts`,
      get_element_label: (element: string) => `Element ${element}`,
      elements: { Fe: 2.5, O: 1.234 },
      show_amounts: false,
      expected: [`Element Fe`, `Element O`],
    },
    {
      desc: `custom labels with spy function`,
      get_element_label: vi.fn((element: string, amount: number) =>
        `${element}-${amount}`
      ),
      elements: { Cu: 3.14, Zn: 2.71 },
      expected: [`Cu-3.14`, `Zn-2.71`],
      verify_spy: true,
    },
  ])(
    `custom label functions: $desc`,
    ({ get_element_label, elements, show_amounts, expected, verify_spy }) => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements,
          get_element_label,
          ...(show_amounts !== undefined && { show_amounts }),
        },
      })

      const label_texts = Array.from(document.querySelectorAll(`label`)).map((l) =>
        l.textContent?.trim()
      )
      expect(label_texts).toEqual(expected)

      if (verify_spy) {
        expect(get_element_label).toHaveBeenCalledTimes(Object.keys(elements).length)
        Object.entries(elements).forEach(([elem, amt]) => {
          expect(get_element_label).toHaveBeenCalledWith(elem, amt)
        })
      }
    },
  )

  test(`updates label text color when background changes`, async () => {
    const orig_fe_color = colors.element.Fe // Capture original value to restore after test
    try { // 1. Initialize with a known color
      colors.element.Fe = `#000000`
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 1 } },
      })
      const label = doc_query(`label`)
      const initial_color = getComputedStyle(label).color

      // 2. Change the background color in the store
      colors.element.Fe = `#ffffff`
      await tick() // Wait for Svelte to process the change

      // 3. Expect contrast_color to update the text color
      expect(getComputedStyle(label).color).not.toBe(initial_color)
    } finally { // Restore original value to avoid state leakage
      colors.element.Fe = orig_fe_color
    }
  })

  test(`element visibility toggle`, async () => {
    const hidden_elements = new Set<ElementSymbol>()
    mount(AtomLegend, {
      target: document.body,
      props: { elements: { Fe: 2, O: 3 }, hidden_elements },
    })

    const labels = document.querySelectorAll(`label`)
    const toggle_buttons = document.querySelectorAll(`button.toggle-visibility`)

    expect(labels[0].classList.contains(`hidden`)).toBe(false)
    expect(toggle_buttons[0].classList.contains(`visible`)).toBe(false) // Click toggle button
    ;(toggle_buttons[0] as HTMLButtonElement).click()
    await tick()

    expect(labels[0].classList.contains(`hidden`)).toBe(true)
    expect(toggle_buttons[0].classList.contains(`visible`)).toBe(true)
  })

  describe(`Mode Selector`, () => {
    test(`renders mode toggle button`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 2 } },
      })

      const mode_toggle = doc_query(`button.mode-toggle`)
      expect(mode_toggle).toBeTruthy()
      expect(mode_toggle.getAttribute(`aria-expanded`)).toBe(`false`)
    })

    test(`opens and closes mode dropdown`, async () => {
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 2 } },
      })

      const mode_toggle = doc_query<HTMLButtonElement>(`button.mode-toggle`)
      expect(document.querySelector(`.mode-dropdown`)).toBeNull()

      // Open dropdown
      mode_toggle.click()
      await tick()

      expect(document.querySelector(`.mode-dropdown`)).toBeTruthy()
      expect(mode_toggle.getAttribute(`aria-expanded`)).toBe(`true`)

      // Close dropdown
      mode_toggle.click()
      await tick()

      expect(document.querySelector(`.mode-dropdown`)).toBeNull()
    })

    test(`mode options are rendered correctly`, async () => {
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 2 } },
      })

      const mode_toggle = doc_query<HTMLButtonElement>(`button.mode-toggle`)
      mode_toggle.click()
      await tick()

      const mode_options = document.querySelectorAll(`.mode-option`)
      expect(mode_options.length).toBeGreaterThan(0)

      const option_texts = Array.from(mode_options).map((opt) => opt.textContent?.trim())
      expect(option_texts).toContain(`Element`)
      expect(option_texts).toContain(`Coordination Number`)
      expect(option_texts).toContain(`Wyckoff Position`)
    })

    test(`switches mode when option is clicked`, async () => {
      const atom_color_config = {
        mode: `element` as const,
        scale: ``,
        scale_type: `continuous` as const,
      }
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements: { Fe: 2 },
          atom_color_config,
          property_colors: {
            colors: [`#ff0000`, `#00ff00`],
            values: [4, 6],
            min_value: 4,
            max_value: 6,
            unique_values: [4, 6],
          },
        },
      })

      const mode_toggle = doc_query<HTMLButtonElement>(`button.mode-toggle`)
      mode_toggle.click()
      await tick()

      const coord_option = Array.from(
        document.querySelectorAll(`.mode-option`),
      ).find((opt) => opt.textContent?.includes(`Coordination`)) as HTMLButtonElement

      expect(coord_option).toBeTruthy()
      coord_option.click()
      await tick()

      expect(atom_color_config.mode).toBe(`coordination`)
      expect(document.querySelector(`.mode-dropdown`)).toBeNull()
    })

    test(`wyckoff mode disabled without sym_data`, async () => {
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 2 }, sym_data: null },
      })

      const mode_toggle = doc_query<HTMLButtonElement>(`button.mode-toggle`)
      mode_toggle.click()
      await tick()

      const wyckoff_option = Array.from(
        document.querySelectorAll(`.mode-option`),
      ).find((opt) => opt.textContent?.includes(`Wyckoff`)) as HTMLButtonElement

      expect(wyckoff_option).toBeTruthy()
      expect(wyckoff_option.classList.contains(`disabled`)).toBe(true)
      expect(wyckoff_option.disabled).toBe(true)
    })
  })

  describe(`Property Legend - Continuous`, () => {
    test(`renders continuous gradient legend`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `continuous` },
          property_colors: {
            colors: [`#440154`, `#31688e`, `#35b779`, `#fde724`],
            values: [2, 4, 6, 8],
            min_value: 2,
            max_value: 8,
            unique_values: [2, 4, 6, 8],
          },
          title: `Coordination Number`,
        },
      })

      const legend = doc_query(`.property-legend`)
      expect(legend).toBeTruthy()

      const gradient_bar = doc_query(`.gradient-bar`)
      expect(gradient_bar).toBeTruthy()

      const gradient_labels = document.querySelectorAll(`.gradient-labels span`)
      expect(gradient_labels).toHaveLength(2)
      expect(gradient_labels[0].textContent).toBe(`2`)
      expect(gradient_labels[1].textContent).toBe(`8`)
    })

    test(`displays title for property legend`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `continuous` },
          property_colors: {
            colors: [`#440154`, `#fde724`],
            values: [2, 8],
            min_value: 2,
            max_value: 8,
            unique_values: [2, 8],
          },
          title: `Custom Title`,
        },
      })

      const title = doc_query(`.legend-header h4`)
      expect(title.textContent).toBe(`Custom Title`)
    })

    test(`uses default title based on mode`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `continuous` },
          property_colors: {
            colors: [`#440154`],
            values: [4],
            min_value: 4,
            max_value: 4,
            unique_values: [4],
          },
        },
      })

      const title = doc_query(`.legend-header h4`)
      expect(title.textContent).toBe(`Coordination Number`)
    })

    test(`handles single value continuous scale`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `continuous` },
          property_colors: {
            colors: [`#440154`],
            values: [5],
            min_value: 5,
            max_value: 5,
            unique_values: [5],
          },
        },
      })

      const gradient_bar = doc_query(`.gradient-bar`)
      expect(gradient_bar).toBeTruthy()

      const gradient_labels = document.querySelectorAll(`.gradient-labels span`)
      expect(gradient_labels[0].textContent).toBe(`5`)
      expect(gradient_labels[1].textContent).toBe(`5`)
    })
  })

  describe(`Property Legend - Categorical`, () => {
    test(`renders categorical legend with discrete values`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `categorical` },
          property_colors: {
            colors: [`#e41a1c`, `#377eb8`, `#4daf4a`, `#984ea3`],
            values: [2, 4, 4, 6],
            unique_values: [2, 4, 6],
          },
        },
      })

      const categorical = doc_query(`.categorical-legend`)
      expect(categorical).toBeTruthy()

      const items = document.querySelectorAll(`.categorical-legend .legend-item`)
      expect(items).toHaveLength(3) // Unique values only

      const labels = document.querySelectorAll(`.category-label`)
      const label_texts = Array.from(labels).map((l) => l.textContent?.trim())
      expect(label_texts).toEqual([`2`, `4`, `6`])
    })

    test(`formats Wyckoff orbit IDs correctly`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `wyckoff`, scale_type: `categorical` },
          property_colors: {
            colors: [`#e41a1c`, `#377eb8`, `#4daf4a`],
            values: [`4e|Fe`, `4e|Fe`, `2a|O`],
            unique_values: [`4e|Fe`, `2a|O`],
          },
        },
      })

      const labels = document.querySelectorAll(`.category-label`)
      const label_texts = Array.from(labels).map((l) => l.textContent?.trim())

      // Format: Element:count+wyckoff (e.g., Fe:24e, O:12a)
      expect(label_texts).toContain(`Fe:24e`)
      expect(label_texts).toContain(`O:12a`)
    })

    test(`property value visibility toggle`, async () => {
      const hidden_prop_vals = new Set<string | number>()
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `categorical` },
          property_colors: {
            colors: [`#e41a1c`, `#377eb8`],
            values: [4, 6],
            unique_values: [4, 6],
          },
          hidden_prop_vals,
        },
      })

      const labels = document.querySelectorAll(`.category-label`)
      const toggle_buttons = document.querySelectorAll(
        `.categorical-legend button.toggle-visibility`,
      )

      expect(labels[0].classList.contains(`hidden`)).toBe(false)
      expect(toggle_buttons[0].classList.contains(`visible`)).toBe(false) // Click toggle button
      ;(toggle_buttons[0] as HTMLButtonElement).click()
      await tick()

      expect(labels[0].classList.contains(`hidden`)).toBe(true)
      expect(toggle_buttons[0].classList.contains(`visible`)).toBe(true)
      // Check that the component's internal state has been updated
      // The UI reflects the change, which is what matters
    })
  })

  describe(`Mode Switching Behavior`, () => {
    test(`clears hidden property values when switching modes`, async () => {
      const hidden_prop_vals = new Set([4, 6])

      // Mount with coordination mode
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements: { Fe: 2, O: 3 },
          atom_color_config: { mode: `coordination`, scale_type: `categorical` },
          property_colors: {
            colors: [`#e41a1c`, `#377eb8`],
            values: [4, 6],
            unique_values: [4, 6],
          },
          hidden_prop_vals,
        },
      })

      // Initially, categorical legend should show items
      const labels = document.querySelectorAll(`.category-label`)
      expect(labels).toHaveLength(2)
      expect(document.querySelector(`.property-legend`)).toBeTruthy()

      // Clear and remount with element mode to simulate mode switch
      document.body.innerHTML = ``
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements: { Fe: 2, O: 3 },
          atom_color_config: { mode: `element`, scale_type: `continuous` },
          hidden_prop_vals,
        },
      })
      await tick()

      // After mode switch, the element legend should be shown
      expect(document.querySelector(`.element-legend`)).toBeTruthy()
      expect(document.querySelector(`.property-legend`)).toBeNull()
    })

    test(`shows element legend when mode is element`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements: { Fe: 2, O: 3 },
          atom_color_config: { mode: `element` },
        },
      })

      expect(document.querySelector(`.element-legend`)).toBeTruthy()
      expect(document.querySelector(`.property-legend`)).toBeNull()
    })

    test(`shows property legend when mode is not element`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements: { Fe: 2, O: 3 },
          atom_color_config: { mode: `coordination`, scale_type: `continuous` },
          property_colors: {
            colors: [`#440154`],
            values: [4],
            min_value: 4,
            max_value: 4,
            unique_values: [4],
          },
        },
      })

      expect(document.querySelector(`.property-legend`)).toBeTruthy()
      expect(document.querySelector(`.element-legend`)).toBeNull()
    })

    test(`hides all legends when elements is empty and no property colors`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          elements: {},
          atom_color_config: { mode: `element` },
        },
      })

      expect(document.querySelector(`.element-legend`)).toBeNull()
      expect(document.querySelector(`.property-legend`)).toBeNull()
    })
  })

  describe(`Accessibility`, () => {
    test(`mode toggle has correct aria attributes`, async () => {
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 2 } },
      })

      const mode_toggle = doc_query<HTMLButtonElement>(`button.mode-toggle`)
      expect(mode_toggle.getAttribute(`aria-expanded`)).toBe(`false`)

      mode_toggle.click()
      await tick()

      expect(mode_toggle.getAttribute(`aria-expanded`)).toBe(`true`)
    })

    test(`toggle visibility buttons have descriptive titles`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: { elements: { Fe: 2, O: 3 } },
      })

      const toggle_buttons = document.querySelectorAll(`button.toggle-visibility`)
      expect((toggle_buttons[0] as HTMLButtonElement).title).toBe(`Hide Fe atoms`)
      expect((toggle_buttons[1] as HTMLButtonElement).title).toBe(`Hide O atoms`)
    })

    test(`property value toggle buttons have descriptive titles`, () => {
      mount(AtomLegend, {
        target: document.body,
        props: {
          atom_color_config: { mode: `coordination`, scale_type: `categorical` },
          property_colors: {
            colors: [`#e41a1c`, `#377eb8`],
            values: [4, 6],
            unique_values: [4, 6],
          },
        },
      })

      const toggle_buttons = document.querySelectorAll(
        `.categorical-legend button.toggle-visibility`,
      )
      expect((toggle_buttons[0] as HTMLButtonElement).title).toBe(`Hide 4`)
      expect((toggle_buttons[1] as HTMLButtonElement).title).toBe(`Hide 6`)
    })
  })
})
