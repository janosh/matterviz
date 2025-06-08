import type { Category } from '$lib'
import { element_data, PeriodicTable, PropertySelect } from '$lib'
import { category_counts, heatmap_labels } from '$lib/labels'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '..'

const mouseenter = new MouseEvent(`mouseenter`)
const mouseleave = new MouseEvent(`mouseleave`)

describe(`PeriodicTable`, () => {
  afterEach(() => {
    // Clean up DOM after each test to prevent state accumulation
    document.body.innerHTML = ``
    // Restore console.error if it was mocked
    vi.restoreAllMocks()
  })
  test.each([
    [true, 120],
    [false, 118],
    [null, 118],
    [[], 118],
  ] as const)(
    `renders %s lanth_act_tiles -> %s tiles`,
    async (lanth_act_tiles, expected_tiles) => {
      const props =
        lanth_act_tiles === true
          ? {}
          : lanth_act_tiles === false
            ? { lanth_act_tiles: [] }
            : { lanth_act_tiles }
      mount(PeriodicTable, { target: document.body, props })
      expect(document.querySelectorAll(`.element-tile`).length).toBe(
        expected_tiles,
      )
    },
  )

  test(`empty tiles are rendered`, async () => {
    mount(PeriodicTable, { target: document.body })
    expect(document.querySelectorAll(`.element-tile`).length).toBe(118)
  })

  test(`hovering element tile toggles CSS class 'active'`, async () => {
    mount(PeriodicTable, { target: document.body })

    const element_tile = doc_query(`.element-tile`)
    element_tile?.dispatchEvent(mouseenter)
    await tick()
    expect([...element_tile.classList]).toContain(`active`)

    element_tile?.dispatchEvent(mouseleave)
    await tick()
    expect([...element_tile.classList]).not.toContain(`active`)
  })

  test(`shows element photo when hovering element tile`, async () => {
    mount(PeriodicTable, { target: document.body, props: { show_photo: true } })

    const element_tile = doc_query(`.element-tile`)
    element_tile?.dispatchEvent(mouseenter)
    await tick()

    expect(doc_query(`img[alt="Hydrogen"]`)?.style.gridArea).toBe(
      `9/1/span 2/span 2`,
    )

    element_tile?.dispatchEvent(mouseleave)
    await tick()
    expect(document.querySelector(`img`)).toBeNull()
  })

  test(`keyboard navigation works`, async () => {
    let active_element: (typeof element_data)[0] | null = $state(null)

    mount(PeriodicTable, {
      target: document.body,
      props: {
        get active_element() {
          return active_element
        },
        set active_element(val) {
          active_element = val
        },
      },
    })

    active_element = element_data[0]
    await tick()
    window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowDown` }))
    await tick()
    expect(active_element?.symbol).toBe(`Li`)
  })

  test(`tile content can be hidden`, async () => {
    mount(PeriodicTable, {
      target: document.body,
      props: {
        tile_props: {
          show_symbol: false,
          show_name: false,
          show_number: false,
        },
      },
    })
    // Empty text when symbols/names/numbers disabled
    expect(doc_query(`.periodic-table`)?.textContent?.trim()).toBe(``)
  })

  test(`PropertySelect integration`, async () => {
    const props: { heatmap_values?: number[] } = $state({})
    mount(PeriodicTable, { target: document.body, props })
    mount(PropertySelect, { target: document.body })

    const li = doc_query(`ul.options > li`)
    li.dispatchEvent(new MouseEvent(`mouseup`))
    await tick()

    const selected_text = doc_query(
      `div.multiselect > ul.selected`,
    ).textContent?.trim()
    if (selected_text && heatmap_labels[selected_text]) {
      const heatmap_key = heatmap_labels[selected_text]

      props.heatmap_values = element_data.map(
        (elem) => elem[heatmap_key] as number,
      )
      await tick()
      expect(doc_query(`div.element-tile`).style.backgroundColor).toBe(
        `#3c4f8a`,
      )
    }
  })

  test.each([
    [[0], [0.5], [1], [2]], // inner_transition_metal_offset values
    [[`0`], [`10px`], [`1cqw`]], // gap values
  ] as const)(`styling props work correctly`, (...args) => {
    const values = args[0]
    values.forEach((value) => {
      const props =
        typeof value === `string`
          ? { gap: value }
          : { inner_transition_metal_offset: value }
      mount(PeriodicTable, { target: document.body, props })

      if (typeof value === `string`) {
        expect(
          (
            getComputedStyle(
              doc_query(`.periodic-table`) as Element,
            ) as CSSStyleDeclaration
          ).gap,
        ).toBe(value)
      } else if (value > 0) {
        expect(
          (
            getComputedStyle(
              doc_query(`div.spacer`) as Element,
            ) as CSSStyleDeclaration
          ).gridRow,
        ).toBe(`8`)
      } else {
        expect(document.querySelector(`div.spacer`)).toBeNull()
      }
    })
  })

  test.each(Object.entries(category_counts))(
    `active_category=%s highlights %s tiles`,
    (active_category, expected_active) => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          active_category: active_category.replaceAll(` `, `-`) as Category,
        },
      })
      expect(document.querySelectorAll(`.element-tile.active`).length).toBe(
        expected_active,
      )
    },
  )

  test.each([
    [[...Array(200).keys()], `length should be 118 or less`],
    [[...Array(119).keys()], `length should be 118 or less`],
    [{ he: 0 }, `keys should be element symbols`],
    [{ foo: 42 }, `keys should be element symbols`],
  ] as const)(
    `error handling for invalid heatmap_values`,
    (heatmap_values, error_message) => {
      const original_error = console.error
      console.error = vi.fn()

      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: heatmap_values as never },
      })

      expect(console.error).toHaveBeenCalledOnce()
      expect(console.error).toBeCalledWith(
        expect.stringContaining(error_message),
      )

      console.error = original_error
    },
  )

  test.each([
    [`element-category`, `var(--diatomic-nonmetal-bg-color)`],
    [`#ff0000`, `#ff0000`],
    [`#666666`, `#666666`],
  ] as const)(`missing_color=%s -> %s`, async (missing_color, expected_bg) => {
    mount(PeriodicTable, {
      target: document.body,
      props: { heatmap_values: [0, 0, 0, 0], missing_color },
    })
    expect(document.querySelector(`.element-tile`).style.backgroundColor).toBe(
      expected_bg,
    )
  })

  test.each([
    [
      {
        values: [undefined, null, false, 10.5],
        missing_color: `#123456`,
        log: false,
      },
    ],
    [{ values: [0, -5, 1, 10], missing_color: `#abcdef`, log: true }],
  ] as const)(
    `missing_color edge cases`,
    async ({ values, missing_color, log }) => {
      // @ts-expect-error testing edge case handling for invalid types
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: values, missing_color, log },
      })
      const tiles = document.querySelectorAll(
        `.element-tile`,
      ) as NodeListOf<HTMLElement>

      // First two tiles should use missing color
      expect(tiles[0].style.backgroundColor).toBe(missing_color)
      expect(tiles[1].style.backgroundColor).toBe(missing_color)

      // Later tiles with valid values should use color scale
      const valid_tile_idx = log ? 2 : 3
      expect(tiles[valid_tile_idx].style.backgroundColor).not.toBe(
        missing_color,
      )
    },
  )

  test.each([
    [true, null, null, `disabled prevents hover`],
    [false, null, `H`, `enabled allows hover`],
  ] as const)(
    `disabled=%s (%s)`,
    async (disabled, initial, expected, _description) => {
      let active_element = $state(initial)
      mount(PeriodicTable, {
        target: document.body,
        props: {
          disabled,
          get active_element() {
            return active_element
          },
          set active_element(val) {
            active_element = val
          },
        },
      })
      ;(document.querySelector(`.element-tile`) as HTMLElement).dispatchEvent(
        mouseenter,
      )
      await tick()
      expect(active_element?.symbol || null).toBe(expected)
    },
  )

  test.each([
    [`symbol`, `A`, `h`],
    [{ H: `/hydrogen`, He: `/helium` }, `A`, `/hydrogen`],
    [null, `DIV`, null],
  ] as const)(
    `links=%o -> %s tag, %s href`,
    async (links, expected_tag, expected_href) => {
      // @ts-expect-error testing various link types including invalid ones
      mount(PeriodicTable, { target: document.body, props: { links } })
      const hydrogen_tile = document.querySelector(
        `.element-tile`,
      ) as HTMLElement
      expect(hydrogen_tile.tagName).toBe(expected_tag)
      expect(hydrogen_tile.getAttribute(`href`)).toBe(expected_href)
    },
  )

  test(`comprehensive prop functionality`, async () => {
    // Test multiple props affecting appearance and behavior in one test
    const props = {
      heatmap_values: [1, 2, 3, 4],
      color_scale_range: [0, 10] as [number, number],
      color_overrides: { H: `#ff0000`, He: `#00ff00` },
      tile_props: { show_name: false }, // Use show_name: false to test labels prop
      lanth_act_style: `background-color: red;`,
    }

    mount(PeriodicTable, { target: document.body, props })

    const hydrogen_tile = document.querySelector(`.element-tile`) as HTMLElement
    const helium_tile = document.querySelectorAll(
      `.element-tile`,
    )[1] as HTMLElement

    // Color overrides work
    expect(hydrogen_tile.style.backgroundColor).toBe(`#ff0000`)
    expect(helium_tile.style.backgroundColor).toBe(`#00ff00`)

    // Should have lanthanide/actinide tiles
    expect(document.querySelectorAll(`.element-tile`).length).toBeGreaterThan(
      118,
    )
  })

  test.each([
    [true, true],
    [false, false],
  ] as const)(`tooltip=%s -> %s`, async (tooltip, should_show) => {
    mount(PeriodicTable, { target: document.body, props: { tooltip } })

    const hydrogen_tile = document.querySelector(`.element-tile`) as HTMLElement
    hydrogen_tile.dispatchEvent(mouseenter)
    await tick()

    const tooltip_el = document.querySelector(`.tooltip`)
    expect(!!tooltip_el).toBe(should_show)

    if (should_show) {
      expect(tooltip_el?.textContent).toContain(`Hydrogen`)
      hydrogen_tile.dispatchEvent(mouseleave)
      await tick()
      expect(document.querySelector(`.tooltip`)).toBeFalsy()
    }
  })
})
