import type { Category, ChemicalElement } from '$lib'
import { element_data, PeriodicTable, PropertySelect } from '$lib'
import { category_counts, heatmap_labels } from '$lib/labels'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const mouseenter = new MouseEvent(`mouseenter`)
const mouseleave = new MouseEvent(`mouseleave`)

describe(`PeriodicTable`, () => {
  afterEach(() => {
    // Restore console.error if it was mocked
    vi.restoreAllMocks()
  })
  test.each([[true, 120], [false, 118]] as const)(
    `renders lanth_act_tiles=%s -> %s tiles`,
    (show_lanth_act, expected_tiles) => {
      const props = show_lanth_act ? {} : { lanth_act_tiles: [] }
      mount(PeriodicTable, { target: document.body, props })
      expect(document.querySelectorAll(`.element-tile`).length).toBe(
        expected_tiles,
      )
    },
  )

  test(`empty tiles are rendered`, () => {
    mount(PeriodicTable, { target: document.body })
    expect(document.querySelectorAll(`.element-tile`).length).toBe(120)
  })

  test(`hovering element tile toggles CSS class 'active'`, async () => {
    mount(PeriodicTable, { target: document.body })

    const element_tile = doc_query(`.element-tile`)
    element_tile?.dispatchEvent(mouseenter)
    await tick()
    expect(Array.from(element_tile.classList)).toContain(`active`)

    element_tile?.dispatchEvent(mouseleave)
    await tick()
    expect(Array.from(element_tile.classList)).not.toContain(`active`)
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

  test(`keyboard navigation works`, () => {
    let active_element: (typeof element_data)[0] | null = null

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

    // Set initial active element
    active_element = element_data[0]
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowDown` }))
    expect(active_element?.symbol).toBe(`Li`)
  })

  test(`tile content can be hidden`, () => {
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

  test(`PropertySelect integration`, () => {
    const props: { heatmap_values?: number[] } = {}
    mount(PeriodicTable, { target: document.body, props })
    mount(PropertySelect, { target: document.body })

    const li = doc_query(`ul.options > li`)
    li.dispatchEvent(new MouseEvent(`mouseup`))

    const selected_text = doc_query(
      `div.multiselect > ul.selected`,
    ).textContent?.trim()
    if (selected_text && heatmap_labels[selected_text]) {
      const heatmap_key = heatmap_labels[selected_text]

      props.heatmap_values = element_data.map(
        (elem) => elem[heatmap_key] as number,
      )
      // Check that a background color has been applied (exact color may vary based on color scale)
      const bg_color = doc_query(`div.element-tile`).style.backgroundColor
      expect(bg_color).not.toBe(`transparent`)
      // expect(bg_color).not.toBe(``) // can't test for non-empty string since CSS custom properties don't resolve in happy-dom
    }
  })

  test.each(
    [
      [[0], [0.5], [1], [2]], // inner_transition_metal_offset values
      [[`0`], [`10px`], [`1cqw`]], // gap values
    ] as const,
  )(`styling props work correctly`, (...args) => {
    const values = args[0]
    values.forEach((value) => {
      const props = typeof value === `string`
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

  test.each(
    [
      [[...Array(200).keys()], `length should be 118 or less`],
      [[...Array(119).keys()], `length should be 118 or less`],
      [{ he: 0 }, `keys should be element symbols`],
      [{ foo: 42 }, `keys should be element symbols`],
    ] as const,
  )(
    `error handling for invalid heatmap_values`,
    (heatmap_values, error_msg) => {
      const original_error = console.error
      console.error = vi.fn()

      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: heatmap_values as never },
      })

      expect(console.error).toHaveBeenCalledOnce()
      expect(console.error).toBeCalledWith(
        expect.stringContaining(error_msg),
      )

      console.error = original_error
    },
  )

  test.each(
    [
      [`element-category`, ``], // should be var(--diatomic-nonmetal-bg-color) but CSS custom properties don't resolve in happy-dom
      [`#ff0000`, `#ff0000`],
      [`#666666`, `#666666`],
    ] as const,
  )(`missing_color=%s -> %s`, (missing_color, expected_bg) => {
    mount(PeriodicTable, {
      target: document.body,
      props: { heatmap_values: [0, 0, 0, 0], missing_color },
    })
    const tile = document.querySelector(`.element-tile`) as HTMLElement
    expect(tile?.style.backgroundColor).toBe(expected_bg)
  })

  test.each(
    [
      [{ values: [undefined, null, false, 10.5], missing_color: `#123456`, log: false }],
      [{ values: [0, -5, 1, 10], missing_color: `#abcdef`, log: true }],
    ] as const,
  )(
    `missing_color edge cases`,
    ({ values, missing_color, log }) => {
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: values as never, missing_color, log },
      })
      const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)

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

  test.each(
    [
      [true, null, null, `disabled prevents hover`],
      [false, null, `H`, `enabled allows hover`],
    ] as const,
  )(`disabled=%s (%s)`, (disabled, initial, expected, _description) => {
    let active_element: ChemicalElement | null = initial
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
    expect((active_element as ChemicalElement | null)?.symbol || null).toBe(expected)
  })

  test.each(
    [
      [`symbol`, `A`, `h`],
      [{ H: `/hydrogen`, He: `/helium` }, `A`, `/hydrogen`],
      [null, `DIV`, null],
    ] as const,
  )(`links=%o -> %s tag, %s href`, (links, expected_tag, expected_href) => {
    mount(PeriodicTable, { target: document.body, props: { links } })
    const hydrogen_tile = document.querySelector(
      `.element-tile`,
    ) as HTMLElement
    expect(hydrogen_tile.tagName).toBe(expected_tag)
    expect(hydrogen_tile.getAttribute(`href`)).toBe(expected_href)
  })

  test(`multiple props`, () => {
    // Test multiple props affecting appearance and behavior in one test
    const props = {
      heatmap_values: [1, 2, 3, 4],
      color_scale_range: [0, 10],
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

  test.each([[true, true], [false, false]] as const)(
    `tooltip=%s -> %s`,
    async (tooltip, should_show) => {
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
    },
  )

  describe(`multi-value heatmaps`, () => {
    test.each([
      {
        values: [
          [10, 20],
          [30, 40],
        ],
        segments: [`diagonal-top`, `diagonal-bottom`],
      },
      {
        values: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        segments: [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
      },
      {
        values: [
          [1, 2, 3, 4],
          [5, 6, 7, 8],
        ],
        segments: [`quadrant-tl`, `quadrant-tr`, `quadrant-bl`, `quadrant-br`],
      },
    ])(
      `renders $values.0.length-value arrays with proper segments`,
      ({ values, segments }) => {
        mount(PeriodicTable, {
          target: document.body,
          props: {
            heatmap_values: values as never,
            tile_props: { show_name: false },
          },
        })

        // Verify all expected segments are present
        segments.forEach((segment) => {
          expect(document.querySelector(`.segment.${segment}`)).toBeTruthy()
        })

        // Verify segments have valid colors
        const colored_segments = document.querySelectorAll(
          `.segment[style*="background-color"]`,
        )
        expect(colored_segments.length).toBeGreaterThan(0)
        colored_segments.forEach((segment) => {
          const bg_color = (segment as HTMLElement).style.backgroundColor
          expect(bg_color).toBeTruthy()
          expect(bg_color).not.toBe(`transparent`)
        })
      },
    )

    test(`handles mixed data types and tooltip integration`, async () => {
      const mixed_data = [10, [20, 30], [40, 50, 60]]
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: mixed_data,
          tile_props: { show_name: false },
          tooltip: true,
        },
      })

      // Should render different segment types for different value counts
      expect(document.querySelector(`.segment.diagonal-top`)).toBeTruthy()
      expect(document.querySelector(`.segment.horizontal-top`)).toBeTruthy()

      // Tooltip should display array values
      const multi_value_tile = document.querySelectorAll<HTMLElement>(`.element-tile`)[1]
      multi_value_tile.dispatchEvent(mouseenter)
      await tick()

      const tooltip = document.querySelector(`.tooltip`)
      expect(tooltip?.textContent).toContain(`Values:`)

      multi_value_tile.dispatchEvent(mouseleave)
      await tick()
      expect(document.querySelector(`.tooltip`)).toBeFalsy()
    })
  })

  describe(`color value heatmaps`, () => {
    test.each([
      [[`#ff0000`, `#00ff00`, `#0000ff`], [`#ff0000`, `#00ff00`, `#0000ff`], `array`],
      [
        { H: `#ff0000`, He: `#00ff00`, Li: `#0000ff` },
        [`#ff0000`, `#00ff00`, `#0000ff`],
        `object`,
      ],
      [
        [`rgb(255, 0, 0)`, `var(--blue)`],
        [`rgb(255, 0, 0)`, `var(--blue)`],
        `detected formats`,
      ],
    ])(`single colors (%s)`, (heatmap_values, expected_colors, _type) => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: heatmap_values as never,
          tile_props: { show_name: false },
        },
      })

      const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
      expected_colors.forEach((color, idx) => {
        expect(tiles[idx].style.backgroundColor).toBe(color)
      })
    })

    test.each([
      [
        [[`#ff0000`, `#00ff00`], [`#0000ff`, `#ffff00`]],
        [`diagonal-top`, `diagonal-bottom`],
        `two colors`,
      ],
      [
        [[`#ff0000`, `#00ff00`, `#0000ff`], [`#ffff00`, `#ff00ff`, `#00ffff`]],
        [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
        `three colors`,
      ],
      [
        [
          [`#ff0000`, `#00ff00`, `#0000ff`, `#ffff00`],
          [`#ff00ff`, `#00ffff`, `#888888`, `#ffffff`],
        ],
        [`quadrant-tl`, `quadrant-tr`, `quadrant-bl`, `quadrant-br`],
        `four colors`,
      ],
    ])(`multi-color arrays (%s)`, (heatmap_values, segments, _desc) => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: heatmap_values as never,
          tile_props: { show_name: false },
        },
      })

      segments.forEach((cls) =>
        expect(document.querySelector(`.segment.${cls}`)).toBeTruthy()
      )

      const multi_tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
      expect(multi_tiles[0].style.backgroundColor).toBe(`transparent`)
      expect(document.querySelectorAll(`.segment`).length).toBeGreaterThan(0)
    })

    test(`mixed types in heatmap`, () => {
      const mixed = [`#ff0000`, [10, 20], [`#00ff00`, `#0000ff`], 42]
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: mixed as never,
          tile_props: { show_name: false },
        },
      })

      const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
      expect(tiles[0].style.backgroundColor).toBe(`#ff0000`) // single color
      expect(tiles[1].style.backgroundColor).toBe(`transparent`) // numeric array
      expect(tiles[2].style.backgroundColor).toBe(`transparent`) // color array
      expect(tiles[3].style.backgroundColor).not.toBe(`transparent`) // single number
    })

    test.each([
      [
        `color_overrides take precedence`,
        { color_overrides: { H: `purple`, He: `orange` } },
      ],
      [
        `show_values displays colors as text`,
        { tile_props: { show_values: true } },
      ],
    ])(`%s`, (_desc, extra_props) => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [`#ff0000`, `#00ff00`] as never,
          color_overrides: {},
          tile_props: { show_name: false },
          ...extra_props,
        },
      })

      if (`color_overrides` in extra_props) {
        const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
        expect(tiles[0].style.backgroundColor).toBe(`purple`)
        expect(tiles[1].style.backgroundColor).toBe(`orange`)
      } else {
        const values = document.querySelectorAll(`.value`)
        expect(values.length).toBeGreaterThan(0)
        expect((values[0] as HTMLElement).textContent).toBe(`#ff0000`)
      }
    })

    test(`tooltip with color arrays`, async () => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [`#ff0000`, [`#00ff00`, `#0000ff`]] as never,
          tooltip: true,
        },
      })

      const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)

      // Single color tooltip
      tiles[0].dispatchEvent(mouseenter)
      await tick()
      expect(document.querySelector(`.tooltip`)?.textContent).toContain(`Hydrogen`)
      tiles[0].dispatchEvent(mouseleave)

      // Multi-color tooltip
      tiles[1].dispatchEvent(mouseenter)
      await tick()
      const tooltip = document.querySelector(`.tooltip`)
      expect(tooltip?.textContent).toContain(`Helium`)
      expect(tooltip?.textContent).toContain(`Values:`)
      tiles[1].dispatchEvent(mouseleave)
    })
  })
})
