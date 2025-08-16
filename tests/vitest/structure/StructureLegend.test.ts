import type { CompositionType } from '$lib'
import { default_element_colors } from '$lib/colors'
import { colors } from '$lib/state.svelte'
import { StructureLegend } from '$lib/structure'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`StructureLegend Component`, () => {
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
    mount(StructureLegend, { target: document.body, props })

    const labels = document.querySelectorAll(`label`)
    expect(labels).toHaveLength(expected_count)

    const label_texts = Array.from(labels).map((l) => l.textContent?.trim())
    expect(label_texts).toEqual(expected_labels)

    if (check_styling) {
      // Check styling and inputs
      const fe_label = labels[0] as HTMLLabelElement
      expect(fe_label.style.backgroundColor).toBe(colors.element.Fe)

      const color_inputs = document.querySelectorAll(`input[type="color"]`)
      expect(color_inputs).toHaveLength(expected_count)
      expect((color_inputs[0] as HTMLInputElement).value).toBe(colors.element.Fe)

      // Check custom style
      expect(doc_query(`div`).getAttribute(`style`)).toBe(props.style)
    }
  })

  test(`color picker functionality`, () => {
    mount(StructureLegend, {
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
    [{ Xx: 1 } as CompositionType, 1, `Xx 1`], // Non-existent element
  ])(
    `handles edge cases correctly`,
    (elements, expected_count, expected_text) => {
      mount(StructureLegend, { target: document.body, props: { elements } })

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
      mount(StructureLegend, {
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
})
