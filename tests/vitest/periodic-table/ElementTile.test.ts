import { element_data, ElementTile } from '$lib'
import type { SplitLayout, TileSegment } from '$lib/element'
import { DEFAULT_CATEGORY_COLORS } from '$lib/colors'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const rand_element = element_data[0]
const TEST_COLORS = [`red`, `green`, `blue`, `yellow`] as const

describe(`ElementTile`, () => {
  describe(`basic rendering`, () => {
    test(`renders element name, symbol and atomic number by default`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const name = doc_query(`.name`)
      expect(name.textContent).toBe(rand_element.name)

      const symbol = doc_query(`.symbol`)
      expect(symbol.textContent).toBe(rand_element.symbol)

      const number = doc_query(`.number`)
      expect(number.textContent).toBe(rand_element.number.toString())
    })

    test(`renders as anchor when href is provided`, () => {
      const href = `/element/${rand_element.symbol}`
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, href },
      })

      const node = doc_query(`.element-tile`)
      expect(node.tagName).toBe(`A`)
      expect(node.getAttribute(`href`)).toBe(href)
    })
  })

  describe(`show_* props`, () => {
    test.each([
      [true, true, true, `${rand_element.number} ${rand_element.symbol} ${rand_element.name}`],
      [false, false, false, ``],
      [true, false, true, `${rand_element.number} ${rand_element.symbol}`],
      [false, true, false, rand_element.name],
      [true, true, false, `${rand_element.number} ${rand_element.name}`],
      [false, false, true, rand_element.symbol],
      [true, false, false, String(rand_element.number)],
      [false, true, true, `${rand_element.symbol} ${rand_element.name}`],
    ])(
      `show_number=%s, show_name=%s, show_symbol=%s renders expected content`,
      (show_number, show_name, show_symbol, expected) => {
        mount(ElementTile, {
          target: document.body,
          props: { element: rand_element, show_number, show_name, show_symbol },
        })

        const tile = doc_query(`.element-tile`)
        // Clean up extra whitespace from text content
        const actual_text = tile.textContent?.replaceAll(/\s+/g, ` `).trim() || ``
        expect(actual_text).toBe(expected.trim())
      },
    )
  })

  describe(`segment values`, () => {
    test(`shows value instead of name when value is provided`, () => {
      const value = 42.5
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, segments: [{ value }] },
      })

      const value_element = doc_query(`.value`)
      expect(value_element.textContent).toBe(`42.5`)
      expect(document.querySelector(`.name`)).toBeNull()
    })

    test(`shows name without a segment value`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const name_element = doc_query(`.name`)
      expect(name_element.textContent).toBe(rand_element.name)
      expect(document.querySelector(`.value`)).toBeNull()
    })

    test(`formats value with float_fmt`, () => {
      const value = 42.123456
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, segments: [{ value }], float_fmt: `.2f` },
      })

      const value_element = doc_query(`.value`)
      expect(value_element.textContent).toBe(`42.12`)
    })
  })

  describe(`styling props`, () => {
    test(`applies a segment color as background`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, segments: [{ color: `red` }] },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.backgroundColor).toBe(`red`)
    })

    test(`applies text_color when provided`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, text_color: `blue` },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.color).toBe(`blue`)
    })

    test(`applies custom style`, () => {
      const custom_style = `border: 2px solid green; padding: 10px;`
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, style: custom_style },
      })

      const node = doc_query(`.element-tile`)
      expect(node.getAttribute(`style`)).toContain(`border: 2px solid green`)
      expect(node.getAttribute(`style`)).toContain(`padding: 10px`)
    })

    test(`applies symbol_style to symbol span`, () => {
      const symbol_style = `font-weight: bold; color: purple;`
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, symbol_style },
      })

      const symbol = doc_query(`.symbol`)
      expect(symbol.getAttribute(`style`)).toBe(symbol_style)
    })

    test.each([true, false])(`applies active class when active=%s`, (active) => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, active },
      })

      const node = doc_query(`.element-tile`)
      expect(node.classList.contains(`active`)).toBe(active)
    })

    test(`applies category as data attribute`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.getAttribute(`data-category`)).toBe(rand_element.category)
    })
  })

  describe(`label prop`, () => {
    test(`shows label instead of element name when provided`, () => {
      const custom_label = `Custom Label`
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, label: custom_label },
      })

      const name_element = doc_query(`.name`)
      expect(name_element.textContent).toBe(custom_label)
    })
  })

  describe(`event handling`, () => {
    test.each([
      [`onmouseenter`, `mouseenter`],
      [`onmouseleave`, `mouseleave`],
    ])(`forwards %s events`, (event_prop, event_type) => {
      const spy = vi.fn()

      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, [event_prop]: spy },
      })

      const node = doc_query(`.element-tile`)
      const event = new Event(event_type)
      node.dispatchEvent(event)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(event)
    })

    test(`has no role/tabindex without href`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.getAttribute(`tabindex`)).toBeNull()
      expect(node.getAttribute(`role`)).toBeNull()
    })
  })

  describe(`rest props`, () => {
    test(`forwards additional props to element`, () => {
      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          'data-testid': `custom-test-id`,
          'aria-label': `Custom aria label`,
        },
      })

      const node = doc_query(`.element-tile`)
      expect(node.getAttribute(`data-testid`)).toBe(`custom-test-id`)
      expect(node.getAttribute(`aria-label`)).toBe(`Custom aria label`)
    })
  })

  describe(`text_color binding`, () => {
    test(`explicit text_color overrides automatic contrast calculation`, () => {
      const explicit_color = `#ff0000`

      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          segments: [{ color: `#000000` }], // Dark background (would normally get white text)
          text_color: explicit_color, // But we override with red
        },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.color).toBe(explicit_color)
    })
  })

  describe(`edge cases`, () => {
    test(`handles zero value correctly`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, segments: [{ value: 0 }] },
      })

      const value_element = doc_query(`.value`)
      expect(value_element.textContent).toBe(`0`)
      expect(document.querySelector(`.name`)).toBeNull()
    })

    test(`handles empty string float_fmt`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, segments: [{ value: 42.123 }], float_fmt: `` },
      })

      const value_element = doc_query(`.value`)
      // Empty float_fmt defaults to format_num default behavior
      expect(value_element.textContent).toBe(`42.1`)
    })
  })

  describe(`multi-value support`, () => {
    const test_cases = [
      {
        value: [10, 20],
        segments: [`diagonal-top`, `diagonal-bottom`],
        positions: [`top-left`, `bottom-right`],
        layout: `diagonal`,
      },
      {
        value: [1, 2, 3],
        segments: [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
        positions: [`bar-top-left`, `bar-middle-right`, `bar-bottom-left`],
        layout: `horizontal`,
      },
      {
        value: [1, 2, 3, 4],
        segments: [`quadrant-tl`, `quadrant-tr`, `quadrant-bl`, `quadrant-br`],
        positions: [
          `value-quadrant-tl`,
          `value-quadrant-tr`,
          `value-quadrant-bl`,
          `value-quadrant-br`,
        ],
        layout: `quadrant`,
      },
    ]

    test.each(test_cases)(
      `renders $value.length values with $layout layout (auto)`,
      ({ value, segments, positions }) => {
        mount(ElementTile, {
          target: document.body,
          props: {
            element: rand_element,
            segments: value.map((segment_value, idx) => ({
              color: TEST_COLORS[idx],
              value: segment_value,
            })),
          },
        })

        segments.forEach((cls) =>
          expect(document.querySelector(`.segment.${cls}`)).toBeInstanceOf(HTMLElement),
        )
        positions.forEach((cls) =>
          expect(document.querySelector(`.multi-value.${cls}`)).toBeInstanceOf(HTMLElement),
        )
        expect(doc_query(`.element-tile`).style.backgroundColor).toBe(`transparent`)
        expect(document.querySelector(`.number`)).toBeNull() // Auto-hide atomic number
      },
    )

    test.each([
      {
        value: [1, 2, 3],
        layout: `vertical`,
        segments: [`vertical-left`, `vertical-middle`, `vertical-right`],
        positions: [`bar-left-top`, `bar-middle-bottom`, `bar-right-top`],
      },
      {
        value: [1, 2, 3, 4],
        layout: `triangular`,
        segments: [`triangle-top`, `triangle-right`, `triangle-bottom`, `triangle-left`],
        positions: [
          `triangle-top-pos`,
          `triangle-right-pos`,
          `triangle-bottom-pos`,
          `triangle-left-pos`,
        ],
      },
    ])(
      `renders $value.length values with explicit $layout layout`,
      ({ value, layout, segments, positions }) => {
        mount(ElementTile, {
          target: document.body,
          props: {
            element: rand_element,
            segments: value.map((segment_value, idx) => ({
              color: TEST_COLORS[idx],
              value: segment_value,
            })),
            split_layout: layout as SplitLayout,
          },
        })

        segments.forEach((cls) =>
          expect(document.querySelector(`.segment.${cls}`)).toBeInstanceOf(HTMLElement),
        )
        positions.forEach((cls) =>
          expect(document.querySelector(`.multi-value.${cls}`)).toBeInstanceOf(HTMLElement),
        )
        expect(doc_query(`.element-tile`).style.backgroundColor).toBe(`transparent`)
        expect(document.querySelector(`.number`)).toBeNull()
      },
    )

    test(`atomic number behavior with multi-value splits`, () => {
      const test_show_number = (props: Record<string, unknown>, should_show: boolean) => {
        document.body.innerHTML = ``
        mount(ElementTile, {
          target: document.body,
          props: { element: rand_element, ...props },
        })
        expect(Boolean(document.querySelector(`.number`))).toBe(should_show)
      }

      test_show_number({ segments: [{ value: 42 }] }, true)
      test_show_number({ segments: [{ color: `#ff0000` }, { color: `#00ff00` }] }, false)
      test_show_number(
        {
          segments: [{ color: `#ff0000` }, { color: `#00ff00` }],
          show_number: true,
        },
        true,
      )
      test_show_number({ segments: [{ value: 42 }], show_number: false }, false)
    })

    test(`renders zero-valued segments`, () => {
      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          segments: [
            { color: `#ff0000`, value: 0 },
            { color: `#00ff00`, value: 0 },
          ],
        },
      })

      expect(
        [...document.querySelectorAll(`.multi-value`)].map((node) => node.textContent),
      ).toEqual([`0`, `0`])
    })
  })

  describe(`background color fallback`, () => {
    test(`uses default category color without segments`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      const expected_color = DEFAULT_CATEGORY_COLORS[rand_element.category]
      expect(node.style.backgroundColor).toBe(expected_color)
    })

    test(`a solid segment overrides the category color`, () => {
      const custom_color = `#123456`
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, segments: [{ color: custom_color }] },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.backgroundColor).toBe(custom_color)
    })

    test(`segment values and omitted colors are explicit`, () => {
      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          segments: [{ value: `#ff0000` }, { color: `white`, value: 2 }],
        },
      })

      const [first_segment] = document.querySelectorAll<HTMLElement>(`.segment`)
      const [first_value] = document.querySelectorAll<HTMLElement>(`.multi-value`)
      expect(first_segment.style.backgroundColor).toBe(
        DEFAULT_CATEGORY_COLORS[rand_element.category],
      )
      expect([first_value.textContent, first_value.style.color]).toEqual([`#ff0000`, `black`])
    })

    test(`reacts to colors.category changes`, async () => {
      const { colors } = await import(`$lib/state.svelte`)
      const original_color = colors.category[rand_element.category]

      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.backgroundColor).toBe(original_color)

      // Change the category color
      const new_color = `#abcdef`
      colors.category[rand_element.category] = new_color
      await tick()

      expect(node.style.backgroundColor).toBe(new_color)

      // Restore original color
      colors.category[rand_element.category] = original_color
    })
  })

  describe(`split_layout validation`, () => {
    test.each([
      [
        Array.from({ length: 3 }, () => ({ color: `red` })),
        `triangular`,
        `not valid for 3 segments`,
      ],
      [Array.from({ length: 5 }, () => ({ color: `red` })), undefined, `at most 4 segments`],
    ] as const)(
      `rejects unsupported segment/layout combinations`,
      (segments, split_layout, error) => {
        expect(() =>
          mount(ElementTile, {
            target: document.body,
            props: {
              element: rand_element,
              segments: segments as TileSegment[],
              split_layout,
            },
          }),
        ).toThrow(error)
      },
    )
  })
})
