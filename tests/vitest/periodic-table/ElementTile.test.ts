import { element_data, ElementTile } from '$lib'
import type { SplitLayout, TileSegment } from '$lib/element'
import { DEFAULT_CATEGORY_COLORS } from '$lib/colors'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const rand_element = element_data[0]
const TEST_COLORS = [`red`, `green`, `blue`, `yellow`] as const
const mount_tile = (
  props: Omit<ComponentProps<typeof ElementTile>, `element`> = {},
): ReturnType<typeof mount> =>
  mount(ElementTile, { target: document.body, props: { element: rand_element, ...props } })

describe(`ElementTile`, () => {
  test(`renders name, symbol, number, category and forwards rest props`, () => {
    mount_tile({ 'data-testid': `custom-test-id`, 'aria-label': `Custom aria label` })
    expect(doc_query(`.name`).textContent).toBe(rand_element.name)
    expect(doc_query(`.symbol`).textContent).toBe(rand_element.symbol)
    expect(doc_query(`.number`).textContent).toBe(rand_element.number.toString())
    expect(document.querySelector(`.value`)).toBeNull()
    const node = doc_query(`.element-tile`)
    expect(node.getAttribute(`data-category`)).toBe(rand_element.category)
    expect(node.getAttribute(`data-testid`)).toBe(`custom-test-id`)
    expect(node.getAttribute(`aria-label`)).toBe(`Custom aria label`)
    // a plain tile is not interactive
    expect(node.getAttribute(`tabindex`)).toBeNull()
    expect(node.getAttribute(`role`)).toBeNull()
  })

  test(`renders as anchor when href is provided`, () => {
    const href = `/element/${rand_element.symbol}`
    mount_tile({ href })
    const node = doc_query(`.element-tile`)
    expect(node.tagName).toBe(`A`)
    expect(node.getAttribute(`href`)).toBe(href)
  })

  // each show_* flag independently toggles its span; label replaces the element name
  test.each([
    [{}, `${rand_element.number} ${rand_element.symbol} ${rand_element.name}`],
    [{ show_number: false, show_name: false, show_symbol: false }, ``],
    [{ show_name: false }, `${rand_element.number} ${rand_element.symbol}`],
    [{ show_number: false, show_symbol: false }, rand_element.name],
    [{ label: `Custom Label` }, `${rand_element.number} ${rand_element.symbol} Custom Label`],
  ])(`props %j render text %j`, (props, expected) => {
    mount_tile(props)
    const actual_text = doc_query(`.element-tile`).textContent?.replaceAll(/\s+/g, ` `).trim()
    expect(actual_text).toBe(expected)
  })

  // a segment value replaces the name; float_fmt formats it (empty string = format_num default)
  test.each([
    [42.5, undefined, `42.5`],
    [0, undefined, `0`],
    [42.123456, `.2f`, `42.12`],
    [42.123, ``, `42.1`],
  ])(`segment value %s with float_fmt %j shows %s`, (value, float_fmt, expected) => {
    mount_tile({ segments: [{ value }], float_fmt })
    expect(doc_query(`.value`).textContent).toBe(expected)
    expect(document.querySelector(`.name`)).toBeNull()
  })

  test(`applies segment color, explicit text_color, style and symbol_style`, () => {
    const symbol_style = `font-weight: bold; color: purple;`
    mount_tile({
      segments: [{ color: `#000000` }], // dark background would otherwise get white text
      text_color: `#ff0000`,
      style: `border: 2px solid green; padding: 10px;`,
      symbol_style,
    })
    const node = doc_query(`.element-tile`)
    expect(node.style.backgroundColor).toBe(`#000000`)
    expect(node.style.color).toBe(`#ff0000`)
    expect(node.getAttribute(`style`)).toContain(`border: 2px solid green`)
    expect(node.getAttribute(`style`)).toContain(`padding: 10px`)
    expect(doc_query(`.symbol`).getAttribute(`style`)).toBe(symbol_style)
  })

  test.each([true, false])(`applies active class when active=%s`, (active) => {
    mount_tile({ active, text_color: `white` })

    const node = doc_query(`.element-tile`)
    expect(node.classList.contains(`active`)).toBe(active)
    expect(getComputedStyle(node).color).toBe(`white`)
    if (active) {
      // Keep the reserved 1px border (unset --elem-tile-active-border must not wipe it, or cqw
      // text inflates). Longhands, since happy-dom mis-splits the nested-var() border shorthand.
      expect(getComputedStyle(node).borderTopWidth).toBe(`1px`)
      expect(getComputedStyle(node).borderTopStyle).toBe(`solid`)
    }
  })

  test.each([
    [`onmouseenter`, `mouseenter`],
    [`onmouseleave`, `mouseleave`],
  ])(`forwards %s events`, (event_prop, event_type) => {
    const spy = vi.fn()
    mount_tile({ [event_prop]: spy })
    const event = new Event(event_type)
    doc_query(`.element-tile`).dispatchEvent(event)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(event)
  })

  describe(`multi-value support`, () => {
    const test_cases: {
      name: string
      value: number[]
      segments: string[]
      positions: string[]
      split_layout?: SplitLayout
    }[] = [
      {
        name: `automatic diagonal`,
        value: [10, 20],
        segments: [`diagonal-top`, `diagonal-bottom`],
        positions: [`top-left`, `bottom-right`],
      },
      {
        name: `automatic horizontal`,
        value: [1, 2, 3],
        segments: [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
        positions: [`bar-top-left`, `bar-middle-right`, `bar-bottom-left`],
      },
      {
        name: `automatic quadrant`,
        value: [1, 2, 3, 4],
        segments: [`quadrant-tl`, `quadrant-tr`, `quadrant-bl`, `quadrant-br`],
        positions: [
          `value-quadrant-tl`,
          `value-quadrant-tr`,
          `value-quadrant-bl`,
          `value-quadrant-br`,
        ],
      },
      {
        name: `explicit vertical`,
        value: [1, 2, 3],
        split_layout: `vertical`,
        segments: [`vertical-left`, `vertical-middle`, `vertical-right`],
        positions: [`bar-left-top`, `bar-middle-bottom`, `bar-right-top`],
      },
      {
        name: `explicit triangular`,
        value: [1, 2, 3, 4],
        split_layout: `triangular`,
        segments: [`triangle-top`, `triangle-right`, `triangle-bottom`, `triangle-left`],
        positions: [
          `triangle-top-pos`,
          `triangle-right-pos`,
          `triangle-bottom-pos`,
          `triangle-left-pos`,
        ],
      },
    ]

    test.each(test_cases)(
      `renders $name layout`,
      ({ value, split_layout, segments, positions }) => {
        mount_tile({
          segments: value.map((segment_value, idx) => ({
            color: TEST_COLORS[idx],
            value: segment_value,
          })),
          split_layout,
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

    test.each([
      [`one value`, [{ value: 42 }], undefined, true],
      [
        `multiple colors without values`,
        [{ color: `red` }, { color: `green` }],
        undefined,
        true,
      ],
      [`multiple values`, [{ value: 1 }, { value: 2 }], undefined, false],
      [`explicitly shown`, [{ value: 1 }, { value: 2 }], true, true],
      [`explicitly hidden`, [{ value: 42 }], false, false],
    ])(`atomic number: %s`, (_desc, segments, show_number, expected) => {
      mount_tile({ segments, show_number })
      expect(Boolean(document.querySelector(`.number`))).toBe(expected)
    })

    test(`renders zero-valued segments`, () => {
      mount_tile({
        segments: [
          { color: `#ff0000`, value: 0 },
          { color: `#00ff00`, value: 0 },
        ],
      })

      expect(
        [...document.querySelectorAll(`.multi-value`)].map((node) => node.textContent),
      ).toEqual([`0`, `0`])
    })
  })

  describe(`background color fallback`, () => {
    test.each([
      [`no segments`, [], DEFAULT_CATEGORY_COLORS[rand_element.category]],
      [`a solid segment`, [{ color: `#123456` }], `#123456`],
    ])(`%s paints the tile %s`, (_desc, segments, expected_color) => {
      mount_tile({ segments })
      expect(doc_query(`.element-tile`).style.backgroundColor).toBe(expected_color)
    })

    test(`segment values and omitted colors are explicit`, () => {
      mount_tile({
        segments: [{ value: `#ff0000` }, { color: `white`, value: 2 }],
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

      mount_tile()

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
        3,
        `not valid for 3 segments`,
      ],
      [
        Array.from({ length: 5 }, () => ({ color: `red` })),
        undefined,
        4,
        `at most 4 segments`,
      ],
    ] as const)(
      `falls back for unsupported segment/layout combinations`,
      (segments, split_layout, expected_segments, warning) => {
        const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
        mount_tile({
          segments: segments.map((_segment, idx) => ({
            color: `rgb(${idx}, 0, 0)`,
          })) as TileSegment[],
          split_layout,
        })
        expect(document.querySelectorAll(`.segment`)).toHaveLength(expected_segments)
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(warning))
        warn.mockRestore()
      },
    )
  })
})
