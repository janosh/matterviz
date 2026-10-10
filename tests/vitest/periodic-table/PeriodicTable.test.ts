import type { ChemicalElement, ElementCategory } from '#lib'
import element_data from '#lib/element/data.js'
import PeriodicTable from '#lib/periodic-table/PeriodicTable.svelte'
import { DEFAULT_CATEGORY_COLORS } from '#lib/colors/index.js'
import { ELEM_HEATMAP_LABELS } from '#lib/labels.js'
import * as math from '#lib/math.js'
import { colors, selected } from '#lib/state.svelte.js'
import PeriodicTableControls from '#site/PeriodicTableControls.svelte'
import PeriodicTableDemo from '#site/PeriodicTableDemo.svelte'
import type { ComponentProps } from 'svelte'
import { createRawSnippet, flushSync, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, keydown, mouse, query, set_input } from '../setup'
import { CATEGORY_COUNTS } from '../test-fixtures'

const { page, replace_url } = vi.hoisted(() => ({
  page: { url: new URL(`http://localhost/periodic-table`) },
  replace_url: vi.fn(async () => {}),
}))
vi.mock(`$app/state`, () => ({ page }))
vi.mock(`#site/state.svelte.js`, () => ({ replace_url }))

const mouseenter = new MouseEvent(`mouseenter`)
const mouseleave = new MouseEvent(`mouseleave`)

// mounts PeriodicTable with active_element bound to a plain object the test reads back
const mount_bound = (props: ComponentProps<typeof PeriodicTable> = {}) => {
  const state: { active_element: ChemicalElement | null } = { active_element: null }
  mount(PeriodicTable, { target: document.body, props: bind_props(props, state) })
  return state
}
const number_input = (key: string) =>
  doc_query<HTMLInputElement>(`[data-key="${key}"] input[type="number"]`)
const tile_bg_reds = (count: number): number[] =>
  [...document.querySelectorAll<HTMLElement>(`.element-tile`)]
    .slice(0, count)
    .map((tile) => Number(/\d+/.exec(tile.style.backgroundColor)?.[0]))
// color_scale whose red channel reads back the normalized position on the ramp
const red_scale = (frac: number) => `rgb(${Math.round(frac * 255)}, 0, 0)`

describe(`PeriodicTable`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    replace_url.mockClear()
    page.url.search = ``
    page.url.hash = ``
    selected.category = null
    Object.assign(colors.category, DEFAULT_CATEGORY_COLORS)
  })
  // hiding tile symbols also drops the default La-Lu/Ac-Lr inset tiles
  const hidden_content = { show_symbol: false, show_name: false, show_number: false }
  test.each([
    [`default`, {}, 120, true],
    [`no lanth_act_tiles`, { lanth_act_tiles: [] }, 118, true],
    [`hidden tile content`, { tile_props: hidden_content }, 118, false],
  ])(`%s renders %i tiles (has text: %s)`, (_desc, props, expected_tiles, has_text) => {
    mount(PeriodicTable, { target: document.body, props })
    expect(document.querySelectorAll(`.element-tile`)).toHaveLength(expected_tiles)
    expect(Boolean(doc_query(`.periodic-table`).textContent?.trim())).toBe(has_text)
  })

  // regression: a tile_props style was spread after the {style} that sets each tile's grid
  // placement, overwriting grid-column/grid-row and collapsing the table
  test(`tile_props style and text color merge into main and inset tiles`, () => {
    mount(PeriodicTable, {
      target: document.body,
      props: { tile_props: { text_color: `red`, style: `cursor: pointer` } },
    })
    const tiles = [...document.querySelectorAll<HTMLElement>(`.element-tile`)]
    expect([tiles[0].style.gridColumn, tiles[0].style.gridRow]).toEqual([`1`, `1`])
    // H plus the lanthanide and actinide inset tiles
    for (const tile of [tiles[0], ...tiles.slice(-2)]) {
      expect([tile.style.color, tile.style.cursor]).toEqual([`red`, `pointer`])
    }
  })

  test(`hovering a tile toggles its active class and element photo`, async () => {
    mount(PeriodicTable, { target: document.body, props: { show_photo: true } })
    const element_tile = doc_query(`.element-tile`)
    element_tile.dispatchEvent(mouseenter)
    await tick()
    expect(element_tile.classList.contains(`active`)).toBe(true)
    expect(doc_query(`img[alt="Hydrogen"]`).style.gridArea).toBe(`9/1/span 2/span 2`)

    element_tile.dispatchEvent(mouseleave)
    await tick()
    expect(element_tile.classList.contains(`active`)).toBe(false)
    expect(document.querySelector(`img`)).toBeNull()
  })

  test.each([
    [true, undefined],
    [false, `H`],
  ])(`disabled=%s -> hover binds active_element %s`, (disabled, expected) => {
    const state = mount_bound({ disabled })
    doc_query(`.element-tile`).dispatchEvent(mouseenter)
    expect(state.active_element?.symbol).toBe(expected)
  })

  test(`row and section resets restore shipped periodic-table defaults`, async () => {
    const category = `noble gas`
    colors.category[category] = `#123456`
    mount(PeriodicTableControls, { target: document.body })
    expect(document.querySelector(`[aria-label="Reset font sizes to defaults"]`)).toBeNull()
    const click_reset = async (selector: string): Promise<void> => {
      doc_query<HTMLButtonElement>(selector).click()
      await tick()
    }
    const category_input = doc_query<HTMLInputElement>(
      `[data-key="${category}"] input[type="color"]`,
    )
    const auto_font_input = doc_query<HTMLInputElement>(
      `[data-key="tile_font_color"] input[type="checkbox"]`,
    )
    const font_color_input = doc_query<HTMLInputElement>(`input[aria-label="Tile font color"]`)
    category_input.focus()
    expect(selected.category).toBe(category)
    category_input.blur()
    expect(selected.category).toBeNull()
    expect([auto_font_input.checked, font_color_input.disabled]).toEqual([true, true])
    auto_font_input.click()
    set_input(number_input(`tile_border_radius`), 5)
    set_input(number_input(`hover_border_width`), 3)
    set_input(category_input, `#654321`)
    await tick()
    expect([auto_font_input.checked, font_color_input.disabled]).toEqual([false, false])

    await click_reset(`[data-key="tile_border_radius"] .setting-reset-button`)
    expect(number_input(`tile_border_radius`).valueAsNumber).toBe(1)
    expect(number_input(`hover_border_width`).valueAsNumber).toBe(3)

    await click_reset(`button[aria-label="Reset element tiles to defaults"]`)
    expect(number_input(`hover_border_width`).valueAsNumber).toBe(1)
    expect([auto_font_input.checked, font_color_input.disabled]).toEqual([true, true])

    await click_reset(`button[aria-label="Reset element category colors to defaults"]`)
    expect(category_input.value).toBe(DEFAULT_CATEGORY_COLORS[category])
  })

  test(`rejects an unknown runtime reset key`, async () => {
    mount(PeriodicTableControls, { target: document.body })
    const row = doc_query(`[data-key="tile_border_radius"]`)
    const input = number_input(`tile_border_radius`)
    set_input(input, 5)
    await tick()

    const reset_button = doc_query<HTMLButtonElement>(
      `[data-key="tile_border_radius"] .setting-reset-button`,
    )
    row.dataset.key = `unknown-control`
    reset_button.click()
    await tick()
    expect(row.querySelector(`.setting-reset-button`)).toBeNull()
    expect(input.valueAsNumber).toBe(5)
  })

  test(`on_activate tiles activate by click/Enter/Space and arrows move the tab stop`, async () => {
    const on_activate = vi.fn<(element: ChemicalElement) => void>()
    const state = mount_bound({ on_activate })
    const hydrogen = doc_query(`[data-element-symbol="H"]`)
    const lithium = doc_query(`[data-element-symbol="Li"]`)
    expect(hydrogen.getAttribute(`role`)).toBe(`button`)
    expect([hydrogen.tabIndex, lithium.tabIndex]).toEqual([0, -1])
    hydrogen.click()
    hydrogen.dispatchEvent(keydown(` `))
    hydrogen.focus()
    hydrogen.dispatchEvent(keydown(`ArrowDown`))
    await tick()

    expect(state.active_element).toMatchObject({ symbol: `Li` })
    expect(document.activeElement).toBe(lithium)
    expect([hydrogen.tabIndex, lithium.tabIndex]).toEqual([-1, 0])

    lithium.dispatchEvent(keydown(`Enter`))
    expect(on_activate.mock.calls.map(([element]) => element.symbol)).toEqual([`H`, `H`, `Li`])

    const outside_input = document.createElement(`input`)
    document.body.append(outside_input)
    outside_input.focus()
    await tick()
    expect(state.active_element).toBeNull()
    expect(hydrogen.tabIndex).toBe(0)
    expect(lithium.tabIndex).toBe(-1)

    // arrow keys outside the table leave its active element alone
    outside_input.dispatchEvent(keydown(`ArrowDown`))
    expect(state.active_element).toBeNull()
    expect(document.activeElement).toBe(outside_input)
  })

  test.each([
    [`H`, `ArrowRight`, `He`],
    [`He`, `ArrowLeft`, `H`],
    [`Be`, `ArrowRight`, `B`],
    [`B`, `ArrowLeft`, `Be`],
    [`H`, `ArrowDown`, `Na`],
    [`Na`, `ArrowUp`, `H`],
    [`Y`, `ArrowDown`, `La`],
    [`La`, `ArrowUp`, `Y`],
    // vertical moves stay in their column instead of jumping between main table and f-block
    [`Hf`, `ArrowDown`, `Rf`],
    [`Ce`, `ArrowUp`, `Rf`],
  ])(`arrow navigation skips gaps and unlinked tiles: %s %s → %s`, async (from, key, to) => {
    mount(PeriodicTable, {
      target: document.body,
      props: { links: { [from]: `#${from}`, [to]: `#${to}` } },
    })
    const source = doc_query(`[data-element-symbol="${from}"]`)
    const target = doc_query(`[data-element-symbol="${to}"]`)
    source.focus()
    source.dispatchEvent(keydown(key))
    await tick()
    expect(document.activeElement).toBe(target)
    expect(source.tabIndex).toBe(-1)
    expect(target.tabIndex).toBe(0)
  })

  // a tap is a pointerdown then the click; the compat mouseenter a browser adds is left out so
  // the tile has to be selected by the pointerdown itself. Returns whether the click's default
  // (link navigation) was prevented
  const tap = (tile: HTMLElement, pointerType: string): boolean => {
    tile.dispatchEvent(Object.assign(mouse(`pointerdown`), { pointerType }))
    const click = mouse(`click`, { cancelable: true })
    tile.dispatchEvent(click)
    flushSync()
    return click.defaultPrevented
  }

  test(`a touch tap previews a tile first and only a second tap on it activates`, () => {
    const on_activate = vi.fn<(element: ChemicalElement) => void>()
    mount(PeriodicTable, { target: document.body, props: { on_activate, tooltip: true } })
    const [hydrogen, helium] = document.querySelectorAll<HTMLElement>(`.element-tile`)
    tap(hydrogen, `touch`) // first tap: select only
    expect(hydrogen.classList.contains(`active`)).toBe(true)
    expect(doc_query(`.tooltip`).textContent).toContain(`Hydrogen`)
    expect(on_activate).not.toHaveBeenCalled()
    tap(hydrogen, `touch`) // same tile again: activate
    expect(on_activate.mock.calls.map(([element]) => element.symbol)).toEqual([`H`])
    tap(helium, `touch`) // another tile: back to preview
    expect(helium.classList.contains(`active`)).toBe(true)
    expect(on_activate).toHaveBeenCalledTimes(1)
    tap(helium, `mouse`) // a mouse click never previews
    expect(on_activate.mock.calls.map(([element]) => element.symbol)).toEqual([`H`, `He`])
  })

  test(`a touch tap on a linked tile holds the link until the second tap`, () => {
    // a hash link keeps happy-dom from navigating away on the unprevented clicks
    mount(PeriodicTable, { target: document.body, props: { links: { H: `#h` } } })
    const tile = doc_query<HTMLAnchorElement>(`[data-element-symbol="H"]`)
    expect([tap(tile, `touch`), tap(tile, `touch`), tap(tile, `mouse`)]).toEqual([
      true,
      false,
      false,
    ])
  })

  test(`links keep native semantics when an activation callback is also supplied`, async () => {
    const on_activate = vi.fn<(element: ChemicalElement) => void>()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    mount(PeriodicTable, {
      target: document.body,
      props: { links: `symbol`, on_activate },
    })
    await tick()
    const tile = doc_query<HTMLAnchorElement>(`[data-element-symbol="H"]`)
    tile.addEventListener(`click`, (event) => event.preventDefault())
    tile.click()
    for (const key of [`Enter`, ` `]) {
      tile.dispatchEvent(keydown(key))
    }

    expect(tile.tagName).toBe(`A`)
    expect(tile.getAttribute(`role`)).toBe(`link`)
    expect(tile.getAttribute(`href`)).toBe(`/h`)
    expect(on_activate).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`native link activation`),
    )
  })

  test(`tile_props interactions remain intact without on_activate`, () => {
    const onclick = vi.fn()
    const onkeydown = vi.fn()
    mount(PeriodicTable, {
      target: document.body,
      props: { tile_props: { onclick, onkeydown, role: `checkbox`, tabindex: 2 } },
    })
    const tile = doc_query(`.element-tile`)
    tile.click()
    tile.dispatchEvent(keydown(`Enter`))
    expect(onclick).toHaveBeenCalledOnce()
    expect(onkeydown).toHaveBeenCalledOnce()
    expect(tile.getAttribute(`role`)).toBe(`checkbox`)
    expect(tile.getAttribute(`tabindex`)).toBe(`2`)
  })

  test.each([`toString`, `phase`])(
    `demo rejects unsupported heatmap key %s and uses automatic tile contrast`,
    async (heatmap) => {
      page.url.search = `?heatmap=${heatmap}`
      page.url.hash = `#test-anchor` // URL rewrites must not drop the fragment
      mount(PeriodicTableDemo, { target: document.body })
      await vi.waitFor(() =>
        expect(replace_url).toHaveBeenCalledWith(`/periodic-table#test-anchor`),
      )
      expect(document.querySelector(`.periodic-table .value`)).toBeNull()

      doc_query(`ul.options > li`).click()
      await tick()

      const selected_text =
        doc_query(`div.multiselect > ul.selected`).textContent?.trim() ?? ``
      // the picked label maps to a real element property, whose key lands in the URL
      const heatmap_key = ELEM_HEATMAP_LABELS[selected_text]
      if (!heatmap_key) throw new Error(`no heatmap key for label "${selected_text}"`)
      await vi.waitFor(() =>
        expect(document.querySelector(`.periodic-table .value`)).toBeInstanceOf(HTMLElement),
      )
      const tiles = document.querySelectorAll<HTMLElement>(`.periodic-table .element-tile`)
      expect(new Set([...tiles].map((tile) => tile.style.color))).toEqual(
        new Set([`white`, `black`]),
      )
      expect(replace_url).toHaveBeenLastCalledWith(
        `/periodic-table?heatmap=${heatmap_key}#test-anchor`,
      )
    },
  )

  test(`demo preserves missing element properties instead of coloring them as zero`, async () => {
    page.url.search = `?heatmap=electronegativity`
    mount(PeriodicTableDemo, { target: document.body })
    await tick()
    expect(doc_query(`form .multiselect ul.selected`).textContent?.trim()).toBe(
      `Electronegativity`,
    )
    const helium = doc_query(`[data-element-symbol="He"]`)
    expect(helium.querySelector(`.value`)).toBeNull()
    expect(helium.style.backgroundColor).toBe(`#666`)
    helium.dispatchEvent(mouseenter)
    await tick()
    expect(doc_query(`.periodic-table > .tooltip`).textContent).toContain(`N/A`)
    doc_query(`form .multiselect ul.selected button.remove`).click()
    await tick()
    expect(doc_query(`form .multiselect ul.selected`).textContent?.trim()).toBe(``)
    expect(replace_url).toHaveBeenLastCalledWith(`/periodic-table`)
  })

  test(`gap prop overrides --ptable-gap and the f-block spacer sits in grid row 8`, () => {
    mount(PeriodicTable, { target: document.body, props: { gap: `10px` } })
    expect(getComputedStyle(doc_query(`.periodic-table`)).gap).toBe(`10px`)
    expect(getComputedStyle(doc_query(`div.spacer`)).gridRow).toBe(`8`)
    document.body.innerHTML = ``
    // without the prop the inline style stays empty so the CSS variable can take effect
    mount(PeriodicTable, { target: document.body })
    expect(doc_query(`.periodic-table`).style.gap).toBe(``)
  })

  test.each([`lanthanide`, `transition metal`] satisfies ElementCategory[])(
    `active_category=%s highlights every tile of that category`,
    (active_category) => {
      mount(PeriodicTable, { target: document.body, props: { active_category } })
      expect(document.querySelectorAll(`.element-tile.active`)).toHaveLength(
        CATEGORY_COUNTS[active_category],
      )
    },
  )

  // tiles render in atomic-number order, so no sort is needed
  test.each<[string, ComponentProps<typeof PeriodicTable>, string[]]>([
    [
      `symbols and element objects`,
      { active_elements: [`H`, element_data[1], `Li`] },
      [`H`, `He`, `Li`],
    ],
    [`empty active_elements`, { active_elements: [] }, []],
    // Li is both in active_elements and an alkali metal; its tile is highlighted once
    [
      `active_elements with active_element and active_category`,
      {
        active_elements: [`H`, `Li`],
        active_element: element_data[5],
        active_category: `alkali metal`,
      },
      [`H`, `Li`, `C`, `Na`, `K`, `Rb`, `Cs`, `Fr`],
    ],
  ])(`%s highlight %j`, (_desc, props, expected_symbols) => {
    mount(PeriodicTable, { target: document.body, props })
    const active_symbols = [...document.querySelectorAll(`.element-tile.active`)].map((tile) =>
      tile.getAttribute(`data-element-symbol`),
    )
    expect(active_symbols).toEqual(expected_symbols)
  })

  test(`error handling for heatmap_values arrays longer than 118`, () => {
    const error = vi.spyOn(console, `error`).mockImplementation(() => {})
    mount(PeriodicTable, {
      target: document.body,
      props: { heatmap_values: [...Array(119).keys()] },
    })
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`length should be 118 or less`),
    )
  })

  // missing-color resolution for the first tile (H), which is missing whenever a heatmap
  // is shown without an H value. `color` is a CSS color or `element-category`; the default
  // is `#666` under a heatmap and element category colors for a plain table ([] heatmap).
  test.each([
    [{ He: 5 }, { color: `element-category` }, `#ff8c00`], // category color
    [{ He: 5 }, { color: `#ff0000` }, `#ff0000`], // explicit color
    [{ He: 5 }, {}, `#666`], // default gray (heatmap shown, H absent)
    [[], {}, `#ff8c00`], // no heatmap -> element category color
  ] as const)(
    `missing resolution heatmap=%j missing=%j -> %s`,
    (heatmap, missing, expected) => {
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: heatmap as never, missing },
      })
      expect(doc_query(`.element-tile`).style.backgroundColor).toBe(expected)
    },
  )

  test.each([`color_overrides`, `labels`, `links`] as const)(
    `warns on non-symbol %s keys`,
    (prop) => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      mount(PeriodicTable, { target: document.body, props: { [prop]: { Fe: `x`, fe: `y` } } })
      flushSync()
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `PeriodicTable ${prop}: keys must be element symbols, got fe`,
      )
    },
  )

  // 0 is a real, colorable value (not missing); only absent/null/<=0-in-log are missing
  test(`zero maps through the color scale, absent elements use the missing fallback`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    // a non-symbol key is ignored with a warning, not a reason to drop the whole heatmap
    const heatmap_values = { H: 0, He: 10, nope: 5 }
    mount(PeriodicTable, {
      target: document.body,
      props: { heatmap_values, missing: { color: `#666` } },
    })
    flushSync()
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `PeriodicTable heatmap_values: keys must be element symbols, got nope`,
    )
    const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
    expect(tiles[0].style.backgroundColor).not.toBe(`#666`) // H=0 -> scale color, not missing
    expect(tiles[0].style.backgroundColor).not.toBe(``) // a real color is applied
    expect(tiles[1].style.backgroundColor).not.toBe(`#666`) // He=10 -> scale color
    expect(tiles[2].style.backgroundColor).toBe(`#666`) // Li absent -> missing
  })

  test.each([
    { values: [undefined, null, false, 10.5], color: `#123456`, log: false },
    { values: [0, -5, 1, 10], color: `#abcdef`, log: true }, // 0 and negatives missing in log mode
  ] as const)(`missing color edge cases (log=$log)`, ({ values, color, log }) => {
    mount(PeriodicTable, {
      target: document.body,
      props: { heatmap_values: values as never, missing: { color }, log },
    })
    const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
    expect([tiles[0].style.backgroundColor, tiles[1].style.backgroundColor]).toEqual([
      color,
      color,
    ])
    // the remaining valid values map through the color scale
    for (const tile of [...tiles].slice(log ? 2 : 3, 4)) {
      expect(tile.style.backgroundColor).not.toBe(color)
    }
  })

  // missing decorations (label/style) apply only to tiles whose value is genuinely
  // missing: absent keys and non-finite values (NaN) are missing, while present
  // numbers and explicit colors are real data that never gets decorated.
  test.each([
    [`absent object key`, { He: 5 }, [true, false]], // H absent -> missing, He present
    [`NaN is missing`, [NaN, 5], [true, false]], // NaN -> missing, value 5 present
    [`blank strings are missing`, [``, `  `], [true, true]],
    [`explicit colors are real data`, [`#ff0000`, `#00ff00`], [false, false]],
  ] as const)(
    `missing decorations apply only to missing tiles: %s`,
    (_desc, heatmap, [t0_missing, t1_missing]) => {
      const missing = { label: `N/A`, style: `opacity: 0.3; outline: 1px solid red;` }
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: heatmap as never, missing },
      })
      const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
      ;[t0_missing, t1_missing].forEach((is_missing, idx) => {
        expect(tiles[idx].textContent?.includes(`N/A`)).toBe(is_missing)
        expect(tiles[idx].style.opacity).toBe(is_missing ? `0.3` : ``)
        expect(tiles[idx].style.outline.includes(`red`)).toBe(is_missing)
      })
    },
  )

  // NaN/Infinity are missing AND must not poison the color-scale domain for valid tiles
  test(`non-finite values don't poison the color-scale domain`, () => {
    const color_scale = (frac: number) =>
      frac >= 0 && frac <= 1 ? `rgb(0, 0, 0)` : `rgb(255, 255, 255)`
    mount(PeriodicTable, {
      target: document.body,
      props: {
        heatmap_values: [NaN, 1, 2] as never,
        color_scale,
        missing: { color: `#666` },
      },
    })
    const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
    expect(tiles[0].style.backgroundColor).toBe(`#666`) // NaN -> missing
    // domain is [1, 2] (NaN excluded); valid tiles normalize into [0,1] -> in-range color
    expect(tiles[1].style.backgroundColor).toBe(`rgb(0, 0, 0)`)
    expect(tiles[2].style.backgroundColor).toBe(`rgb(0, 0, 0)`)
  })

  // a multi-value tile is missing only when ALL segments are missing (order-independent)
  test.each([
    [[5, null], false, ``, [`5`]],
    [[null, 5], false, ``, [`5`]], // regression: only segment[0] was checked
    [[NaN, 5], false, ``, [`5`]],
    [[Infinity, 5], false, ``, [`5`]],
    [[`pending`, 5], false, ``, [`5`]],
    [[0, 5], true, ``, [`5`]],
    [[-1, 5], true, ``, [`5`]],
    [[null, null], false, `0.3`, []],
  ] as const)(
    `multi-value tile %j (log=%s) hides missing labels`,
    (value, log, expected_opacity, expected_labels) => {
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: [value] as never, log, missing: { style: `opacity: 0.3` } },
      })
      const tile = doc_query(`.element-tile`)
      expect(tile.style.opacity).toBe(expected_opacity)
      expect([...tile.querySelectorAll(`.value`)].map((label) => label.textContent)).toEqual(
        expected_labels,
      )
    },
  )

  // an override paints a solid tile: multi-value segment colors are suppressed, labels kept
  test.each([
    [`numeric`, [1, 2, 3], [`1`]],
    [`color`, [`#ff0000`, `#00ff00`], []],
    [
      `multi-value`,
      [
        [1, 2],
        [3, 4],
      ],
      [`1`, `2`],
    ],
  ])(
    `color_overrides take precedence over %s heatmap values`,
    (_kind, heatmap_values, labels) => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: heatmap_values as never,
          color_overrides: { H: `purple`, He: `orange` },
        },
      })
      const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
      expect([tiles[0].style.backgroundColor, tiles[1].style.backgroundColor]).toEqual([
        `purple`,
        `orange`,
      ])
      expect(tiles[0].querySelectorAll(`.segment`)).toHaveLength(0)
      expect(
        [...tiles[0].querySelectorAll(`.value`)].map((label) => label.textContent),
      ).toEqual(labels)
    },
  )

  // log-mode tooltip scale_context.min must be the smallest positive bound, not cs_min
  test(`log-mode tooltip scale_context.min uses the smallest positive value`, async () => {
    let captured_min: number | undefined
    const tooltip = createRawSnippet<[{ scale_context: { min: number } }]>((props) => ({
      render: () => {
        captured_min = props().scale_context.min
        return `<span>tt</span>`
      },
    }))
    mount(PeriodicTable, {
      target: document.body,
      props: { heatmap_values: [0, 2, 8], log: true, tooltip },
    })
    const tiles = document.querySelectorAll<HTMLElement>(`.element-tile`)
    tiles[1].dispatchEvent(mouseenter) // He = 2 (a positive value)
    await tick()
    expect(captured_min).toBe(2) // smallest positive (cs_min_pos), not 0 (cs_min)
  })

  // the tooltip's `active` ignored active_elements while the tile honoured it. The parent
  // pins active_element to null (its setter drops hover writes) to isolate active_elements.
  test.each([
    [[`H`], true],
    [[], false],
  ] as const)(
    `tooltip active with active_elements=%j is %s`,
    async (active_elements, expected) => {
      let captured_active: boolean | undefined
      const tooltip = createRawSnippet<[{ active: boolean }]>((props) => ({
        render: () => {
          captured_active = props().active
          return `<span>tt</span>`
        },
      }))
      const props = Object.defineProperty(
        { tooltip, active_elements: [...active_elements] },
        `active_element`,
        { get: () => null, set: () => {}, enumerable: true },
      )
      mount(PeriodicTable, { target: document.body, props })
      const hydrogen_tile = doc_query(`.element-tile`)
      hydrogen_tile.dispatchEvent(mouseenter)
      await tick()
      expect(hydrogen_tile.classList.contains(`active`)).toBe(expected)
      expect(captured_active).toBe(expected)
    },
  )

  // links=`symbol` is covered by the native-semantics test above
  test.each([
    [{ H: `/hydrogen`, He: `/helium` }, `A`, `/hydrogen`],
    [null, `DIV`, null],
  ] as const)(`links=%o -> %s tag, %s href`, (links, expected_tag, expected_href) => {
    mount(PeriodicTable, { target: document.body, props: { links: links as never } })
    const hydrogen_tile = doc_query(`.element-tile`)
    expect(hydrogen_tile.tagName).toBe(expected_tag)
    expect(hydrogen_tile.getAttribute(`href`)).toBe(expected_href)
  })

  test.each([true, false])(`tooltip=%s shows a hover tooltip`, async (tooltip) => {
    mount(PeriodicTable, {
      target: document.body,
      props: { tooltip, style: `--tooltip-bg: #4fc3f7` },
    })
    const hydrogen_tile = doc_query(`.element-tile`)
    hydrogen_tile.dispatchEvent(mouseenter)
    await tick()

    const tooltip_el = document.querySelector<HTMLElement>(`.tooltip`)
    expect(Boolean(tooltip_el)).toBe(tooltip)

    if (tooltip_el) {
      expect(tooltip_el.textContent).toContain(`Hydrogen`)
      expect(tooltip_el.style.getPropertyValue(`--tooltip-auto-color`)).toBe(`black`)
      expect(getComputedStyle(tooltip_el).pointerEvents).toBe(`none`)
      hydrogen_tile.dispatchEvent(mouseleave)
      await tick()
      expect(document.querySelector(`.tooltip`)).toBeNull()
    }
  })

  // happy-dom has no layout: stub a 200px tooltip whose text spans 80.2px, both scaled
  test.each([1, 0.5])(`tooltip shrinks to its text at scale %s`, async (scale) => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, `getBoundingClientRect`).mockReturnValue(
      new DOMRect(0, 0, 200 * scale),
    )
    vi.spyOn(Range.prototype, `getBoundingClientRect`).mockReturnValue(
      new DOMRect(0, 0, 80.2 * scale),
    )
    mount(PeriodicTable, { target: document.body, props: { tooltip: true } })
    doc_query(`.element-tile`).dispatchEvent(mouseenter)
    await tick()
    expect(doc_query(`.tooltip`).style.width).toBe(`81px`)
  })

  describe(`multi-value heatmaps`, () => {
    const layouts = [
      [`diagonal-top`, `diagonal-bottom`],
      [`horizontal-top`, `horizontal-middle`, `horizontal-bottom`],
      [`quadrant-tl`, `quadrant-tr`, `quadrant-bl`, `quadrant-br`],
    ]
    const hex_colors = [`#ff0000`, `#00ff00`, `#0000ff`, `#ffff00`]
    // numeric arrays map through the color scale, color arrays paint their segments verbatim
    test.each(
      layouts.flatMap((segments) => {
        const nums = segments.map((_cls, idx) => idx + 1)
        const hexes = hex_colors.slice(0, segments.length)
        return [
          { kind: `numeric`, segments, values: [nums, nums.map((num) => num * 10)] },
          { kind: `color`, segments, values: [hexes, hexes.toReversed()] },
        ]
      }),
    )(`$kind arrays render $segments`, ({ kind, segments, values }) => {
      mount(PeriodicTable, { target: document.body, props: { heatmap_values: values } })
      const tile = doc_query(`.element-tile`)
      expect(tile.style.backgroundColor).toBe(`transparent`)
      const segment_colors = segments.map(
        (cls) => query(tile, `.segment.${cls}`).style.backgroundColor,
      )
      if (kind === `color`) expect(segment_colors).toEqual(values[0])
      else for (const color of segment_colors) expect([``, `transparent`]).not.toContain(color)
    })

    test(`tile_props text_color colors segment labels but cannot replace segments`, () => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [[1, 2]],
          tile_props: { text_color: `red`, segments: [{ color: `red` }] } as never,
        },
      })
      const tile = doc_query(`.element-tile`)
      expect(tile.querySelectorAll(`.segment`)).toHaveLength(2)
      expect(
        [...tile.querySelectorAll<HTMLElement>(`.multi-value`)].map(
          (label) => label.style.color,
        ),
      ).toEqual([`red`, `red`])
    })

    test(`mixed single values, numeric and color arrays render side by side`, async () => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [
            `#ff0000`,
            [10, 20],
            [`#00ff00`, `#0000ff`],
            42,
            [4, 5, 6],
          ] as never,
          tooltip: true,
        },
      })
      const tiles = [...document.querySelectorAll<HTMLElement>(`.element-tile`)]
      expect(tiles.slice(0, 3).map((tile) => tile.style.backgroundColor)).toEqual([
        `#ff0000`, // single color
        `transparent`, // numeric array
        `transparent`, // color array
      ])
      expect([``, `transparent`]).not.toContain(tiles[3].style.backgroundColor) // single number
      expect(tiles[4].querySelector(`.segment.horizontal-top`)).toBeInstanceOf(HTMLElement)
      // array tiles list their values in the tooltip
      for (const [idx, name] of [
        [0, `Hydrogen`],
        [1, `Helium`],
        [2, `Lithium`],
      ] as const) {
        tiles[idx].dispatchEvent(mouseenter)
        await tick()
        const tooltip_text = doc_query(`.tooltip`).textContent
        expect(tooltip_text).toContain(name)
        if (idx > 0) expect(tooltip_text).toContain(`Values:`)
        tiles[idx].dispatchEvent(mouseleave)
        await tick()
        expect(document.querySelector(`.tooltip`)).toBeNull()
      }
    })
  })

  // hex arrays are covered by the mixed multi-value test
  test.each([
    [`object`, { H: `#ff0000`, He: `#00ff00` }, [`#ff0000`, `#00ff00`]],
    [`detected formats`, [`rgb(255, 0, 0)`, `var(--blue)`], [`rgb(255, 0, 0)`, `var(--blue)`]],
  ])(
    `single color heatmap values (%s) paint tiles verbatim`,
    (_desc, heatmap_values, expected) => {
      mount(PeriodicTable, { target: document.body, props: { heatmap_values } })
      const tiles = [...document.querySelectorAll<HTMLElement>(`.element-tile`)]
      expect(tiles.slice(0, 2).map((tile) => tile.style.backgroundColor)).toEqual(expected)
    },
  )

  describe(`automatic ColorBar integration`, () => {
    const tick_extent = (): number[] => {
      const ticks = [...document.querySelectorAll(`.colorbar .tick-label`)]
        .map((tick_label) => Number(tick_label.textContent?.trim() || ``))
        .filter((val) => !isNaN(val))
      return [Math.min(...ticks), Math.max(...ticks)]
    }

    test(`shows ColorBar with correct structure and defaults`, () => {
      mount(PeriodicTable, {
        target: document.body,
        // Use range [0, 100] which produces exactly 3 nice ticks: 0, 50, 100
        props: { heatmap_values: [0, 50, 100] },
      })

      const table_inset = document.querySelector(`.table-inset`)
      const colorbar = table_inset?.querySelector(`.colorbar`)
      const bar = colorbar?.querySelector(`.bar`)

      // Structure: TableInset > ColorBar > bar with gradient
      expect(document.querySelector(`.periodic-table`)?.firstElementChild).toBe(table_inset)
      expect(colorbar).toBeInstanceOf(HTMLElement)
      expect((bar as HTMLElement)?.style.background).toContain(`linear-gradient`)

      // Defaults: 3 ticks on primary side (d3's snap_ticks produces nice values)
      expect(colorbar?.querySelectorAll(`.tick-label.tick-primary`).length).toBe(3)
    })

    test.each([
      [{ show_color_bar: false }, `show_color_bar=false`],
      [{ heatmap_values: [] }, `empty heatmap`],
      [{ heatmap_values: [``, `  `] }, `blank values`],
      [{ heatmap_values: [`#f00`, `#0f0`] as never }, `color-only values`],
    ])(`does not show ColorBar for %s`, (props, _desc) => {
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: [1, 2, 3], ...props },
      })
      expect(document.querySelector(`.colorbar`)).toBeNull()
    })

    test(`custom inset takes precedence over automatic ColorBar`, () => {
      let rendered = false
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [1, 2, 3],
          inset: createRawSnippet(() => {
            rendered = true
            return { render: () => `<div></div>` }
          }),
        },
      })

      expect(document.querySelector(`.colorbar`)).toBeNull()
      expect(rendered).toBe(true)
    })

    test(`color_bar_props customize title, wrapper style and ticks`, () => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [1, 2, 3],
          color_bar_props: {
            title: `Test Property`,
            wrapper_style: `width: 70%`,
            tick_labels: 3,
            tick_side: `secondary`,
            snap_ticks: false,
          },
        },
      })
      const inset = doc_query(`.table-inset`)
      const colorbar = query(inset, `.colorbar`)
      // auto-colorbar-inset class provides styling via CSS (place-items, padding)
      expect(inset.classList.contains(`auto-colorbar-inset`)).toBe(true)
      expect(colorbar.style.width).toBe(`70%`)
      expect(colorbar.querySelector(`.label`)?.textContent).toBe(`Test Property`)
      expect(colorbar.querySelectorAll(`.tick-label.tick-secondary`)).toHaveLength(3)
    })

    test(`log tile colors use true log mapping matching the powers-of-10 ColorBar`, () => {
      mount(PeriodicTable, {
        target: document.body,
        props: { heatmap_values: [1, 10, 100, 1000], log: true, color_scale: red_scale },
      })
      const tick_text = [...document.querySelectorAll(`.tick-label`)].map((label) =>
        label.textContent?.trim(),
      )
      expect(tick_text).toEqual([`1`, `10`, `100`, `1k`])
      // decades sit at thirds of the ramp (a log1p mapping would put 10 at ~0.27)
      expect(tile_bg_reds(4)).toEqual([0, 85, 170, 255])
    })

    // tiles and the auto ColorBar share one ramp: an explicit color_scale_range clamps
    // out-of-range values to the end colors instead of extrapolating
    test(`color_scale_range clamps tile colors without scanning the data extent`, () => {
      const extent_spy = vi.spyOn(math, `array_extent`)
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [-5, 0, 5, 10, 20],
          color_scale: red_scale,
          color_scale_range: [0, 10],
        },
      })
      expect(tile_bg_reds(5)).toEqual([0, 0, 128, 255, 255])
      expect(extent_spy).not.toHaveBeenCalled()
      expect(tick_extent()).toEqual([0, 10])
    })

    // a non-positive explicit min has no log image: tiles and bar start at the smallest
    // positive value instead of flooring at LOG_EPS and squashing every tile to the top
    test(`log mode lifts a non-positive color_scale_range min to the smallest positive value`, () => {
      mount(PeriodicTable, {
        target: document.body,
        props: {
          heatmap_values: [1, 10, 100],
          log: true,
          color_scale: red_scale,
          color_scale_range: [0, 100],
        },
      })
      expect(tile_bg_reds(3)).toEqual([0, 128, 255])
      expect(tick_extent()).toEqual([1, 100])
    })

    // ticks span at least the numeric data extent; colors and array entries are unpacked
    test.each<[string, ComponentProps<typeof PeriodicTable>[`heatmap_values`]]>([
      [`numbers`, [10, 20, 30, 40, 50]],
      [`mixed numeric and color`, [10, 20, `#ff0000`, 40, 50] as never],
      [`array values`, [[10, 20], [30, 40], 50] as never],
    ])(`ColorBar ticks span the data range of %s`, (_desc, heatmap_values) => {
      mount(PeriodicTable, { target: document.body, props: { heatmap_values } })
      const [tick_min, tick_max] = tick_extent()
      expect(tick_min).toBeLessThanOrEqual(10)
      expect(tick_max).toBeGreaterThanOrEqual(50)
    })
  })
})
