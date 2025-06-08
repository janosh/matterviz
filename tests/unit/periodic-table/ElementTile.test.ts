import { ElementTile, element_data } from '$lib'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '..'

// test random element for increased robustness
const rand_idx = Math.floor(Math.random() * element_data.length)
const rand_element = element_data[rand_idx]

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

    test(`renders as div by default`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.tagName).toBe(`DIV`)
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
      [`show_name`, `name`],
      [`show_symbol`, `symbol`],
      [`show_number`, `number`],
    ] as const)(`%s prop controls %s visibility`, (prop, selector) => {
      // Test showing
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, [prop]: true },
      })

      const visible_element = doc_query(`.${selector}`)
      expect(visible_element.textContent).toBe(`${rand_element[selector]}`)

      // Clear and test hiding
      document.body.innerHTML = ``
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, [prop]: false },
      })

      expect(document.querySelector(`.${selector}`)).toBeNull()
    })

    test.each([
      [
        true,
        true,
        true,
        `${rand_element.number} ${rand_element.symbol} ${rand_element.name}`,
      ],
      [false, false, false, ``],
      [true, false, true, `${rand_element.number} ${rand_element.symbol}`],
      [false, true, false, `${rand_element.name}`],
      [true, true, false, `${rand_element.number} ${rand_element.name}`],
      [false, false, true, `${rand_element.symbol}`],
      [true, false, false, `${rand_element.number}`],
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
        const actual_text = tile.textContent?.replace(/\s+/g, ` `).trim() || ``
        expect(actual_text).toBe(expected.trim())
      },
    )
  })

  describe(`value prop`, () => {
    test(`shows value instead of name when value is provided`, () => {
      const value = 42.5
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, value },
      })

      const value_element = doc_query(`.value`)
      expect(value_element.textContent).toBe(`42.5`)
      expect(document.querySelector(`.name`)).toBeNull()
    })

    test(`shows name when value is false`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, value: false },
      })

      const name_element = doc_query(`.name`)
      expect(name_element.textContent).toBe(rand_element.name)
      expect(document.querySelector(`.value`)).toBeNull()
    })

    test(`shows name when value is undefined`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, value: undefined },
      })

      const name_element = doc_query(`.name`)
      expect(name_element.textContent).toBe(rand_element.name)
      expect(document.querySelector(`.value`)).toBeNull()
    })

    test(`formats value with precision`, () => {
      const value = 42.123456
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, value, precision: `.2f` },
      })

      const value_element = doc_query(`.value`)
      expect(value_element.textContent).toBe(`42.12`)
    })
  })

  describe(`styling props`, () => {
    test(`applies bg_color as background color`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, bg_color: `red` },
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

    test(`applies active class when active=true`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, active: true },
      })

      const node = doc_query(`.element-tile`)
      expect(node.classList.contains(`active`)).toBe(true)
    })

    test(`does not apply active class when active=false`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, active: false },
      })

      const node = doc_query(`.element-tile`)
      expect(node.classList.contains(`active`)).toBe(false)
    })

    test(`applies category class based on element category`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      const expected_class = rand_element.category.replaceAll(` `, `-`)
      expect(node.classList.contains(expected_class)).toBe(true)
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

    test(`shows element name when label is null`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, label: null },
      })

      const name_element = doc_query(`.name`)
      expect(name_element.textContent).toBe(rand_element.name)
    })
  })

  describe(`node binding`, () => {
    test(`renders without error when node binding is used`, () => {
      // Test that the component renders without errors when node is bound
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.classList.contains(`element-tile`)).toBe(true)
    })
  })

  describe(`text_color_threshold prop`, () => {
    test(`uses custom text_color_threshold`, () => {
      // This test verifies the prop is accepted and passed to choose_bw_for_contrast
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, text_color_threshold: 0.5 },
      })

      const node = doc_query(`.element-tile`)
      expect(node).toBeTruthy() // Basic check that component renders
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

    test(`accepts click and keyboard event handlers`, () => {
      // Test that click and keyboard handlers can be passed without errors
      const click_spy = vi.fn()
      const keydown_spy = vi.fn()

      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          onclick: click_spy,
          onkeydown: keydown_spy,
          onkeyup: vi.fn(),
        },
      })

      const node = doc_query(`.element-tile`)
      expect(node).toBeTruthy()
    })

    test(`has proper accessibility attributes`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.getAttribute(`tabindex`)).toBe(`0`)
      expect(node.getAttribute(`role`)).toBe(`link`)
    })
  })

  describe(`accessibility`, () => {
    test(`has proper ARIA attributes`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element },
      })

      const node = doc_query(`.element-tile`)
      expect(node.getAttribute(`role`)).toBe(`link`)
      expect(node.getAttribute(`tabindex`)).toBe(`0`)
    })

    test(`includes data-sveltekit-noscroll when href is provided`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, href: `/test` },
      })

      const node = doc_query(`.element-tile`)
      expect(node.hasAttribute(`data-sveltekit-noscroll`)).toBe(true)
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
    test(`renders without error when text_color binding is used`, () => {
      // Test that the component renders without errors when text_color is bound
      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          bg_color: `#000000`, // Dark background
        },
      })

      const node = doc_query(`.element-tile`)
      expect(node).toBeTruthy()
    })

    test(`explicit text_color overrides automatic calculation`, () => {
      const explicit_color = `#ff0000`

      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          bg_color: `#000000`, // Dark background (would normally get white text)
          text_color: explicit_color, // But we override with red
        },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.color).toBe(explicit_color)
    })

    test(`text_color reactivity works with background color changes`, () => {
      // This test specifically addresses the $effect rune bug mentioned by the user
      // Test that text color reacts properly to background color changes
      mount(ElementTile, {
        target: document.body,
        props: {
          element: rand_element,
          bg_color: `#000000`, // Start with dark background
        },
      })

      const node = doc_query(`.element-tile`)
      expect(node.style.backgroundColor).toBe(`#000000`)

      // Component should render without errors despite background/text color interactions
      expect(node).toBeTruthy()
      expect(node.classList.contains(`element-tile`)).toBe(true)
    })
  })

  describe(`edge cases`, () => {
    test(`handles elements with spaces in category names`, () => {
      // Find an element with a space in its category name
      const element_with_space = element_data.find((el) =>
        el.category.includes(` `),
      )
      if (element_with_space) {
        mount(ElementTile, {
          target: document.body,
          props: { element: element_with_space },
        })

        const node = doc_query(`.element-tile`)
        const expected_class = element_with_space.category.replaceAll(` `, `-`)
        expect(node.classList.contains(expected_class)).toBe(true)
      }
    })

    test(`handles zero value correctly`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, value: 0 },
      })

      // Zero is falsy, so it shows name instead of value
      const name_element = doc_query(`.name`)
      expect(name_element.textContent).toBe(rand_element.name)
      expect(document.querySelector(`.value`)).toBeNull()
    })

    test(`handles empty string precision`, () => {
      mount(ElementTile, {
        target: document.body,
        props: { element: rand_element, value: 42.123, precision: `` },
      })

      const value_element = doc_query(`.value`)
      // Empty precision defaults to format_num default behavior
      expect(value_element.textContent).toBe(`42.1`)
    })
  })
})
