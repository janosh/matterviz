import type { Composition } from '$lib'
import { default_element_colors } from '$lib/colors'
import { colors } from '$lib/state.svelte'
import StructureLegend from '$lib/structure/StructureLegend.svelte'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { doc_query } from '..'

describe(`StructureLegend Component`, () => {
  const mock_elements: Composition = { Fe: 2, O: 3, H: 1.5, C: 12.123456789 }

  beforeEach(() => {
    colors.element = { ...default_element_colors }
    document.body.innerHTML = ``
  })

  test(`renders complete UI with correct content and styling`, () => {
    const custom_style = `margin: 20px;`
    mount(StructureLegend, {
      target: document.body,
      props: { elements: mock_elements, style: custom_style },
    })

    // Check basic rendering
    const labels = document.querySelectorAll(`label`)
    expect(labels).toHaveLength(4)

    const label_texts = Array.from(labels).map((l) => l.textContent?.trim())
    expect(label_texts).toEqual([`Fe2`, `O3`, `H1.5`, `C12.123`])

    // Check styling and inputs
    const fe_label = labels[0] as HTMLLabelElement
    expect(fe_label.style.backgroundColor).toBe(colors.element.Fe)

    const color_inputs = document.querySelectorAll(`input[type="color"]`)
    expect(color_inputs).toHaveLength(4)
    expect((color_inputs[0] as HTMLInputElement).value).toBe(colors.element.Fe)

    // Check custom style
    expect(doc_query(`div`).getAttribute(`style`)).toBe(custom_style)
  })

  test.each([
    [
      { P: 1.4849999999999999, Ge: 0.515, S: 3 },
      undefined,
      [`P1.485`, `Ge0.515`, `S3`],
    ],
    [{ Fe: 2.123456, O: 3.0 }, `.2f`, [`Fe2.12`, `O3.00`]],
  ])(`formats amounts correctly`, (elements, format, expected) => {
    mount(StructureLegend, {
      target: document.body,
      props: { elements, ...(format && { amount_format: format }) },
    })

    const labels = document.querySelectorAll(`label`)
    const label_texts = Array.from(labels).map((l) => l.textContent?.trim())
    expect(label_texts).toEqual(expected)
  })

  test(`color picker functionality works correctly`, async () => {
    const custom_title = `Click to change color`
    mount(StructureLegend, {
      target: document.body,
      props: { elements: { Fe: 2 }, elem_color_picker_title: custom_title },
    })

    const color_input = doc_query<HTMLInputElement>(`input[type="color"]`)
    const label = doc_query<HTMLLabelElement>(`label`)

    // Test title attribute
    expect(color_input.title).toBe(custom_title)

    // Test color change
    color_input.value = `#ff0000`
    color_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(colors.element.Fe).toBe(`#ff0000`)

    // Test double click reset
    label.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await tick()
    expect(colors.element.Fe).toBe(default_element_colors.Fe)
  })

  test(`tips modal renders with correct content and behavior`, () => {
    const dialog_style = `background: red;`
    mount(StructureLegend, {
      target: document.body,
      props: { elements: mock_elements, dialog_style },
    })

    const dialog = doc_query<HTMLDialogElement>(`dialog`)

    // Test rendering and content
    expect(dialog.textContent).toContain(
      `Drop a POSCAR, XYZ, CIF or pymatgen JSON`,
    )
    expect(dialog.textContent).toContain(`Click on an atom to make it active`)
    expect(dialog.textContent).toContain(
      `Hold shift or cmd or ctrl and drag to pan`,
    )

    // Test styling and modal behavior
    expect(dialog.getAttribute(`style`)).toBe(dialog_style)
    dialog.showModal()
    expect(dialog.open).toBe(true)
    dialog.close()
    expect(dialog.open).toBe(false)
  })

  test.each([
    [{}, 0, undefined], // Empty elements
    [{ Fe: 0 }, 1, `Fe0`], // Zero amount
    [{ Fe: 0.0001 }, 1, `Fe0`], // Very small decimal (trimmed by .3~f format)
    [{ Xx: 1 } as Composition, 1, `Xx1`], // Non-existent element
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
})
