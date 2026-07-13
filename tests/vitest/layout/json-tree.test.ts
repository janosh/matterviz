// Component tests for JsonTree, JsonNode, and JsonValue
import { JsonTree } from '$lib/layout'
import { serialize_for_copy } from '$lib/layout/json-tree/utils'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { doc_query } from '../setup'
import JsonTreeReplacementHarness from './JsonTreeReplacementHarness.svelte'

const mount_tree = (props: ComponentProps<typeof JsonTree>): unknown =>
  mount(JsonTree, { target: document.body, props })

describe(`JsonTree`, () => {
  const get_tree = (): HTMLDivElement => doc_query(`.json-tree`)
  const get_header = (): HTMLElement | null => document.querySelector(`.json-tree-header`)
  const get_content = (): HTMLDivElement => doc_query(`.json-tree-content`)
  const get_search_input = (): HTMLInputElement | null =>
    document.querySelector(`.search-input`)
  const get_nodes = (): NodeListOf<HTMLDivElement> => document.querySelectorAll(`.json-node`)
  const get_values = (): NodeListOf<HTMLSpanElement> =>
    document.querySelectorAll(`.json-value`)
  const get_collapse_toggles = (): NodeListOf<HTMLButtonElement> =>
    document.querySelectorAll(`.collapse-toggle`)

  describe(`rendering`, () => {
    it(`renders tree with header and ARIA attributes by default`, () => {
      mount_tree({ value: { a: 1 } })
      const tree = get_tree()
      expect(get_content()).toBeInstanceOf(HTMLDivElement)
      expect(get_header()).toBeInstanceOf(HTMLElement)
      expect(get_search_input()).toBeInstanceOf(HTMLElement)
      expect(tree.getAttribute(`role`)).toBe(`tree`)
      expect(tree.getAttribute(`aria-label`)).toBe(`JSON tree viewer`)
    })

    it(`hides header when show_header=false`, () => {
      mount_tree({ value: { a: 1 }, show_header: false })
      expect(get_header()).toBeNull()
    })

    it(`renders root label when provided`, () => {
      mount_tree({ value: [1, 2, 3], root_label: `items`, show_header: false })
      expect(document.body.textContent).toContain(`"items"`)
    })

    it(`spreads additional attributes`, () => {
      mount_tree({ value: {}, style: `max-height: 300px`, 'data-testid': `json-tree` })
      const tree = doc_query(`[data-testid="json-tree"]`)
      expect(tree.style.maxHeight).toBe(`300px`)
      expect(tree.classList.contains(`json-tree`)).toBe(true)
    })
  })

  describe(`value types`, () => {
    it.each([
      { value: `hello`, expected_class: `string`, expected_text: `"hello"` },
      { value: 42, expected_class: `number`, expected_text: `42` },
      { value: 3.125, expected_class: `number`, expected_text: `3.125` },
      { value: true, expected_class: `boolean`, expected_text: `true` },
      { value: false, expected_class: `boolean`, expected_text: `false` },
      { value: null, expected_class: `null`, expected_text: `null` },
      { value: undefined, expected_class: `undefined`, expected_text: `undefined` },
    ])(
      `renders primitive $expected_class correctly`,
      ({ value, expected_class, expected_text }) => {
        mount_tree({ value: { test: value }, show_header: false })
        const value_el = get_values()[0]
        expect(value_el.classList.contains(expected_class)).toBe(true)
        expect(value_el.textContent?.trim()).toBe(expected_text)
      },
    )

    it.each([
      { value: BigInt(9007199254740991), css: `bigint`, expected: `n` },
      {
        value: new Date(`2024-01-15T10:30:00.000Z`),
        css: `date`,
        expected: `2024-01-15T10:30:00.000Z`,
      },
      { value: /test/gi, css: `regexp`, expected: `/test/gi` },
      {
        value: new Error(`Something failed`),
        css: `error`,
        expected: `Error: Something failed`,
      },
      { value: Symbol(`description`), css: `symbol`, expected: `Symbol(description)` },
    ])(`renders $css type containing "$expected"`, ({ value, css, expected }) => {
      mount_tree({ value: { test: value }, show_header: false })
      expect(get_values()[0].classList.contains(css)).toBe(true)
      expect(document.body.textContent).toContain(expected)
    })

    it(`renders function with ƒ prefix`, () => {
      function example_fn() {
        return 42
      }
      mount_tree({ value: { fn: example_fn }, show_header: false })
      expect(document.body.textContent).toContain(`ƒ example_fn()`)
    })

    it.each([`Infinity`, `-Infinity`, `NaN`])(`renders special number %s`, (expected) => {
      const value = expected === `NaN` ? NaN : expected === `Infinity` ? Infinity : -Infinity
      mount_tree({ value: { num: value }, show_header: false })
      expect(document.body.textContent).toContain(expected)
    })
  })

  describe(`arrays and objects`, () => {
    it(`uses square brackets for arrays and braces for objects`, () => {
      mount_tree({
        value: { arr: [1], obj: { a: 1 } },
        show_header: false,
        default_fold_level: 5,
      })
      const brackets = document.querySelectorAll(`.bracket`)
      const bracket_text = Array.from(brackets).map((el) => el.textContent)
      // Arrays use [ ], objects use { }
      expect(bracket_text).toContain(`[`)
      expect(bracket_text).toContain(`]`)
      expect(bracket_text).toContain(`{`)
      expect(bracket_text).toContain(`}`)
      // Count: outer object { }, inner array [ ], inner object { } = 3 pairs each
      expect(bracket_text.filter((text) => text === `[`)).toHaveLength(1) // Only arr uses [
      expect(bracket_text.filter((text) => text === `{`)).toHaveLength(2) // outer obj + inner obj
    })

    it.each([
      { show_array_indices: true, expected_count: 2 },
      { show_array_indices: false, expected_count: 0 },
    ])(`show_array_indices=$show_array_indices`, ({ show_array_indices, expected_count }) => {
      mount_tree({
        value: [`a`, `b`],
        show_header: false,
        show_array_indices,
        default_fold_level: 5,
      })
      const indices = document.querySelectorAll(`.array-index .index`)
      expect(indices).toHaveLength(expected_count)
    })

    it(`sorts object keys when sort_keys=true`, () => {
      mount_tree({
        value: { zebra: 1, apple: 2, mango: 3 },
        show_header: false,
        sort_keys: true,
        default_fold_level: 5,
      })
      const keys = Array.from(document.querySelectorAll(`.node-key`)).map((el) =>
        el.textContent?.replaceAll('"', ``).trim(),
      )
      expect(keys).toEqual([`apple`, `mango`, `zebra`])
    })

    it.each([
      { value: { arr: [1, 2, 3, 4, 5] }, expected: `Array(5)` },
      { value: { obj: { a: 1, b: 2 } }, expected: `{2 keys}` },
      { value: { empty: [] }, expected: `Array(0)` },
      { value: { empty: {} }, expected: `{0 keys}` },
    ])(`shows collapsed preview: $expected`, ({ value, expected }) => {
      mount_tree({ value, show_header: false, default_fold_level: 1 })
      expect(document.body.textContent).toContain(expected)
    })
  })

  describe(`folding/collapsing`, () => {
    it(`respects default_fold_level`, () => {
      mount_tree({
        value: { level1: { level2: { level3: `deep` } } },
        show_header: false,
        default_fold_level: 1,
      })
      // At level 1, level2 should be collapsed
      expect(document.body.textContent).toContain(`{1 key}`)
    })

    it(`clicking toggle changes aria-expanded`, async () => {
      mount_tree({
        value: { nested: { a: 1 } },
        show_header: false,
        default_fold_level: 1,
      })
      const toggle = get_collapse_toggles()[0]
      const node = toggle.closest(`.json-node`)

      // Get initial state
      const initial_expanded = node?.getAttribute(`aria-expanded`)

      toggle.click()
      flushSync()
      await tick()

      // State should have changed
      const final_expanded = node?.getAttribute(`aria-expanded`)
      expect(final_expanded).not.toBe(initial_expanded)
    })

    it.each([
      {
        desc: `arrays`,
        value: Array.from({ length: 15 }, (_, idx) => idx),
        props: { auto_fold_arrays: 10 },
        expected: `Array(15)`,
      },
      {
        desc: `objects`,
        value: Object.fromEntries(Array.from({ length: 25 }, (_, idx) => [`key${idx}`, idx])),
        props: { auto_fold_objects: 20 },
        expected: `{25 keys}`,
      },
    ])(`auto-folds large $desc`, ({ value, props, expected }) => {
      mount_tree({ value, show_header: false, default_fold_level: 5, ...props })
      expect(document.body.textContent).toContain(expected)
    })

    it(`clicking auto-folded node expands it`, async () => {
      mount_tree({
        value: Array.from({ length: 15 }, (_, idx) => idx),
        show_header: false,
        auto_fold_arrays: 10,
        default_fold_level: 5,
      })
      // Initially auto-collapsed
      expect(document.body.textContent).toContain(`Array(15)`)
      expect(document.body.textContent).not.toContain(`14`)

      // Click toggle to expand
      get_collapse_toggles()[0].click()
      flushSync()
      await tick()

      // Should now show contents
      expect(document.body.textContent).toContain(`14`)
      expect(document.body.textContent).not.toContain(`Array(15)`)
    })

    it(`collapse all / expand all buttons toggle nested visibility`, async () => {
      mount_tree({
        value: { a: { b: 1 } },
        default_fold_level: 5, // High level so nothing auto-collapses
      })

      // Initially expanded - nested value visible
      expect(document.body.textContent).toContain(`"b"`)

      // Second controls group has expand/collapse buttons
      const control_groups = document.querySelectorAll(`.controls`)
      const [expand_btn, collapse_btn] = control_groups[1].querySelectorAll(`button`)

      collapse_btn.click()
      flushSync()
      await tick()

      // Collapsed - shows preview, b is hidden
      expect(document.body.textContent).toContain(`{1 key}`)
      expect(document.body.textContent).not.toContain(`"b"`)

      expand_btn.click()
      flushSync()
      await tick()

      // After expand - nested value visible again
      expect(document.body.textContent).toContain(`"b"`)
    })

    it(`collapse to level buttons work`, async () => {
      mount_tree({
        value: { a: { b: { c: 1 } } },
        default_fold_level: 5,
      })

      // Second controls group has expand/collapse buttons
      const control_groups = document.querySelectorAll(`.controls`)
      const expand_collapse_group = control_groups[1]
      const level_1_btn = expand_collapse_group.querySelectorAll(`button`)[2]
      level_1_btn.click()
      flushSync()
      await tick()

      expect(document.body.textContent).toContain(`{1 key}`)
    })
  })

  describe(`header controls`, () => {
    it(`has all control button groups with dividers`, () => {
      mount_tree({ value: { name: `test` } })
      const btns = document.querySelectorAll(`.controls button`)
      // 2 toggles (T, #) + 5 expand/collapse (expand, collapse, 1, 2, 3) + 2 copy/download
      expect(btns).toHaveLength(9)
      const dividers = document.querySelectorAll(`.divider`)
      expect(dividers).toHaveLength(2) // separators between 3 button groups
    })

    it(`has copy and download buttons with icons`, () => {
      mount_tree({ value: { a: 1 } })
      const control_groups = document.querySelectorAll(`.controls`)
      const last_group = control_groups[control_groups.length - 1]
      const btns = last_group.querySelectorAll(`button`)
      expect(btns).toHaveLength(2)
      // Both should have SVG icons
      expect(btns[0].querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
      expect(btns[1].querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
      expect(btns[0].getAttribute(`title`)).toBe(`Copy JSON to clipboard`)
      expect(btns[1].getAttribute(`title`)).toBe(`Download as JSON file`)
    })
  })

  describe(`copy functionality`, () => {
    it(`keys are clickable buttons without title tooltip that copy value to clipboard`, () => {
      const write_text = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, `clipboard`, {
        value: { writeText: write_text },
        writable: true,
      })
      mount_tree({ value: { my_key: 42 }, show_header: false })
      const key_el = document.querySelector(`.node-key`) as HTMLButtonElement
      expect(key_el.tagName).toBe(`BUTTON`)
      expect(key_el.getAttribute(`title`)).toBeNull()
      key_el.click()
      flushSync()
      // Clicking an expanded key copies the value, not the path
      expect(write_text).toHaveBeenCalledWith(`42`)
    })
  })

  describe(`copy all button`, () => {
    const get_copy_btn = (): HTMLButtonElement => {
      const groups = document.querySelectorAll(`.controls`)
      return groups[groups.length - 1].querySelectorAll(`button`)[0]
    }

    const write_text_mock = vi.fn()

    beforeEach(() => {
      write_text_mock.mockReset().mockResolvedValue(undefined)
      vi.stubGlobal(`navigator`, { clipboard: { writeText: write_text_mock } })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const mock_clipboard_error = () => {
      write_text_mock.mockRejectedValue(new Error(`Clipboard error`))
    }

    it(`copies entire JSON to clipboard`, async () => {
      const test_value = { name: `test`, count: 42, nested: { a: 1 } }
      mount_tree({ value: test_value })

      get_copy_btn().click()
      flushSync()
      await tick()

      expect(write_text_mock).toHaveBeenCalledTimes(1)
      expect(JSON.parse(write_text_mock.mock.calls[0][0])).toEqual(test_value)
    })

    it(`shows copy feedback after copying`, async () => {
      mount_tree({ value: { a: 1 } })

      get_copy_btn().click()
      await vi.waitFor(() => expect(write_text_mock).toHaveBeenCalled())
      flushSync()
      await tick()

      const feedback = document.querySelector(`.copy-feedback`)
      expect(feedback).toBeInstanceOf(HTMLElement)
      expect(feedback?.textContent).toBe(`Copied!`)
    })

    it(`shows error feedback when clipboard fails`, async () => {
      mock_clipboard_error()
      mount_tree({ value: { a: 1 } })

      get_copy_btn().click()
      await vi.waitFor(() => expect(write_text_mock).toHaveBeenCalled())
      flushSync()
      await tick()

      const feedback = document.querySelector(`.copy-feedback.error`)
      expect(feedback).toBeInstanceOf(HTMLElement)
      expect(feedback?.textContent).toBe(`Copy failed`)
    })

    it(`calls oncopy callback when copying all`, async () => {
      const oncopy = vi.fn()
      mount_tree({ value: { test: 123 }, oncopy })

      get_copy_btn().click()
      flushSync()
      await tick()

      expect(oncopy).toHaveBeenCalledWith(`[root]`, expect.any(String))
    })
  })

  describe(`download button`, () => {
    // Use global download override from $lib/io/fetch to avoid mocking document.createElement
    let mock_download: ReturnType<typeof vi.fn>

    const get_download_btn = (): HTMLButtonElement => {
      const groups = document.querySelectorAll(`.controls`)
      return groups[groups.length - 1].querySelectorAll(`button`)[1]
    }

    beforeEach(() => {
      mock_download = vi.fn()
      ;(globalThis as Record<string, unknown>).download = mock_download
    })

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).download
    })

    it(`downloads JSON content with default date filename and mime type`, async () => {
      const test_value = { name: `test`, count: 42 }
      mount_tree({ value: test_value })

      get_download_btn().click()
      flushSync()
      await tick()

      expect(mock_download).toHaveBeenCalledTimes(1)
      const [data, filename, mime_type] = mock_download.mock.calls[0]
      expect(JSON.parse(data)).toEqual(test_value)
      expect(filename).toMatch(/^data-\d{4}-\d{2}-\d{2}\.json$/)
      expect(mime_type).toBe(`application/json`)
    })

    it(`downloads primitive root via serialize_for_copy`, async () => {
      mount_tree({ value: `string value` })

      get_download_btn().click()
      flushSync()
      await tick()

      expect(mock_download.mock.calls[0][0]).toBe(serialize_for_copy(`string value`))
    })

    it(`uses custom download_filename when provided`, async () => {
      mount_tree({ value: { a: 1 }, download_filename: `my-custom-data.json` })

      get_download_btn().click()
      flushSync()
      await tick()

      const [, filename] = mock_download.mock.calls[0]
      expect(filename).toBe(`my-custom-data.json`)
    })
  })

  describe(`type annotations`, () => {
    it.each([
      { show_data_types: true, expected_min: 1 },
      { show_data_types: false, expected_min: 0 },
    ])(`show_data_types=$show_data_types`, ({ show_data_types, expected_min }) => {
      mount_tree({ value: { str: `hello` }, show_header: false, show_data_types })
      const count = document.querySelectorAll(`.type-annotation`).length
      if (expected_min > 0) expect(count).toBeGreaterThan(0)
      else expect(count).toBe(0)
    })
  })

  describe(`toggle buttons`, () => {
    const get_toggle_btns = (): NodeListOf<HTMLButtonElement> => {
      const first_controls = document.querySelector(`.controls`)
      return first_controls?.querySelectorAll(`button`) as NodeListOf<HTMLButtonElement>
    }

    it(`data types toggle button toggles show_data_types`, async () => {
      mount_tree({ value: { str: `hello` }, show_data_types: false })

      // Initially no type annotations
      expect(document.querySelectorAll(`.type-annotation`)).toHaveLength(0)

      const type_toggle = get_toggle_btns()[0]
      expect(type_toggle.textContent).toBe(`T`)
      expect(type_toggle.classList.contains(`active`)).toBe(false)

      type_toggle.click()
      flushSync()
      await tick()

      // Now type annotations should appear
      expect(document.querySelectorAll(`.type-annotation`).length).toBeGreaterThan(0)
      expect(type_toggle.classList.contains(`active`)).toBe(true)

      // Toggle off again
      type_toggle.click()
      flushSync()
      await tick()

      expect(document.querySelectorAll(`.type-annotation`)).toHaveLength(0)
      expect(type_toggle.classList.contains(`active`)).toBe(false)
    })

    it(`array indices toggle button toggles show_array_indices`, async () => {
      mount_tree({
        value: [`a`, `b`, `c`],
        show_array_indices: true,
        default_fold_level: 5,
      })

      // Initially indices are shown
      expect(document.querySelectorAll(`.array-index .index`)).toHaveLength(3)

      const index_toggle = get_toggle_btns()[1]
      expect(index_toggle.textContent).toBe(`#`)
      expect(index_toggle.classList.contains(`active`)).toBe(true)

      index_toggle.click()
      flushSync()
      await tick()

      // Now indices should be hidden
      expect(document.querySelectorAll(`.array-index .index`)).toHaveLength(0)
      expect(index_toggle.classList.contains(`active`)).toBe(false)

      // Toggle on again
      index_toggle.click()
      flushSync()
      await tick()

      expect(document.querySelectorAll(`.array-index .index`)).toHaveLength(3)
      expect(index_toggle.classList.contains(`active`)).toBe(true)
    })

    it(`toggle buttons have correct titles`, () => {
      mount_tree({ value: { a: 1 }, show_data_types: false, show_array_indices: true })

      const toggle_btns = get_toggle_btns()
      const type_toggle = toggle_btns[0]
      const index_toggle = toggle_btns[1]

      // When off, title should say "Show..."
      expect(type_toggle.getAttribute(`title`)).toBe(`Show data types`)
      // When on, title should say "Hide..."
      expect(index_toggle.getAttribute(`title`)).toBe(`Hide array indices`)
    })

    it(`respects initial prop values`, () => {
      mount_tree({ value: { a: 1 }, show_data_types: true, show_array_indices: false })

      const toggle_btns = get_toggle_btns()
      expect(toggle_btns[0].classList.contains(`active`)).toBe(true)
      expect(toggle_btns[1].classList.contains(`active`)).toBe(false)
    })
  })

  describe(`string truncation`, () => {
    it(`truncates long strings and shows expand button`, () => {
      mount_tree({
        value: { long: `a`.repeat(300) },
        show_header: false,
        max_string_length: 50,
      })
      const value_el = get_values()[0]
      expect(value_el.textContent?.length).toBeLessThan(100)
      expect(value_el.textContent).toContain(`...`)
      expect(document.querySelector(`.expand-btn`)).toBeInstanceOf(HTMLElement)
    })
  })

  describe(`Map and Set`, () => {
    it.each([
      { collection: new Map([[`key1`, `value1`]]), expected: [`key1`, `value1`] },
      { collection: new Set([1, 2, 3]), expected: [`1`, `2`, `3`] },
    ])(`renders collection entries`, ({ collection, expected }) => {
      mount_tree({ value: { collection }, show_header: false, default_fold_level: 5 })
      expected.forEach((text) => expect(document.body.textContent).toContain(text))
    })

    it.each([
      {
        collection: new Map([
          [`a`, 1],
          [`b`, 2],
        ]),
        expected: `Map(2)`,
      },
      { collection: new Set([1, 2, 3, 4]), expected: `Set(4)` },
    ])(`shows $expected in preview`, ({ collection, expected }) => {
      mount_tree({ value: { collection }, show_header: false, default_fold_level: 1 })
      expect(document.body.textContent).toContain(expected)
    })

    it(`renders nested Map containing Set`, () => {
      const nested = new Map([[`inner`, new Set([{ deep: true }])]])
      mount_tree({ value: { nested }, show_header: false, default_fold_level: 10 })
      const text = document.body.textContent
      expect(text).toContain(`inner`)
      expect(text).toContain(`deep`)
      expect(text).toContain(`true`)
    })
  })

  describe(`callbacks`, () => {
    it(`calls onselect when node is clicked`, async () => {
      const onselect = vi.fn()
      mount_tree({
        value: { name: `test` },
        show_header: false,
        default_fold_level: 5,
        onselect,
      })

      // Click the child node (index 1), not root (index 0 has empty path)
      const nodes = get_nodes()
      nodes[1].click()
      flushSync()
      await tick()

      expect(onselect).toHaveBeenCalledWith(`name`, `test`)
    })

    it(`calls oncopy when value is copied`, async () => {
      const oncopy = vi.fn()
      const write_text = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, `clipboard`, {
        value: { writeText: write_text },
        writable: true,
      })

      mount_tree({ value: { name: `test` }, show_header: false, oncopy })

      const value_el = get_values()[0]
      value_el.click()
      flushSync()
      await tick()

      expect(oncopy).toHaveBeenCalledWith(`name`, `test`)
    })
  })

  describe(`bindable collapsed_paths`, () => {
    it(`accepts external collapsed_paths`, () => {
      const collapsed = new Set([`nested`])
      mount_tree({
        value: { nested: { a: 1 }, other: 2 },
        show_header: false,
        collapsed_paths: collapsed,
        default_fold_level: 5,
      })

      // nested should be collapsed, other should be visible
      expect(document.body.textContent).toContain(`{1 key}`)
      expect(document.body.textContent).toContain(`2`)
    })
  })

  it(`preserves search state and prunes invalid collapsed paths on value replacement`, async () => {
    mount(JsonTreeReplacementHarness, { target: document.body })

    const search_input = get_search_input()
    if (!(search_input instanceof HTMLInputElement)) throw new Error(`Search input not found`)
    search_input.value = `findme`
    search_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 175))
    await tick()
    expect(search_input.value).toBe(`findme`)

    doc_query(`[data-testid="replace-json"]`).click()
    flushSync()
    await tick()
    expect(search_input.value).toBe(`findme`)
    expect(document.querySelector(`.json-value.changed`)).toBeNull()

    const nested_toggle = (): HTMLButtonElement =>
      document.querySelector(`[data-path="nested"] .collapse-toggle`) as HTMLButtonElement
    nested_toggle().click()
    await tick()
    expect(document.querySelector(`[data-testid="collapsed-count"]`)?.textContent).toBe(`1`)

    doc_query(`[data-testid="replace-flat-json"]`).click()
    flushSync()
    await tick()
    expect(document.querySelector(`[data-testid="collapsed-count"]`)?.textContent).toBe(`0`)
  })
})

describe(`accessibility`, () => {
  it(`has correct ARIA roles and attributes`, () => {
    mount_tree({ value: { nested: { a: 1 } }, show_header: false, default_fold_level: 5 })
    // Tree structure
    expect(document.querySelectorAll(`[role="treeitem"]`).length).toBeGreaterThan(0)
    expect(document.querySelector(`[aria-expanded]`)).toBeInstanceOf(HTMLElement)
    // Clickable values
    const value_el = document.querySelector(`.json-value`)
    expect(value_el?.getAttribute(`role`)).toBe(`button`)
    expect(value_el?.getAttribute(`title`)).toBeNull()
  })
})

describe(`search navigation`, () => {
  const get_search_input = (): HTMLInputElement =>
    document.querySelector(`.search-input`) as HTMLInputElement
  const get_match_nav = (): HTMLElement | null => document.querySelector(`.match-nav`)
  const get_nav_btns = (): NodeListOf<HTMLButtonElement> =>
    document.querySelectorAll(`.nav-btn`)
  const get_match_count = (): HTMLElement | null => document.querySelector(`.match-count`)
  const get_current_match = (): HTMLElement | null => document.querySelector(`.current-match`)

  async function type_search(query: string): Promise<void> {
    const input = get_search_input()
    input.value = query
    input.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    // Wait for debounce (150ms) + microtask
    await new Promise((resolve) => setTimeout(resolve, 200))
    flushSync()
    await tick()
  }

  it(`shows prev/next buttons and "X of Y" count when search has matches`, async () => {
    mount_tree({ value: { foo: 1, bar: 2, baz: 3 }, default_fold_level: 5 })
    expect(get_match_nav()).toBeNull()

    await type_search(`ba`)

    expect(get_match_nav()).toBeInstanceOf(HTMLElement)
    expect(get_nav_btns()).toHaveLength(2) // prev and next
    expect(get_match_count()?.textContent).toMatch(/1 of 2/)
  })

  it(`next/prev buttons navigate matches with wrap-around`, async () => {
    mount_tree({ value: { bar: 1, baz: 2 }, default_fold_level: 5 })

    await type_search(`ba`)

    const count = get_match_count()
    expect(count?.textContent).toContain(`1 of 2`)

    const [prev_btn, next_btn] = get_nav_btns()

    // Go to 2nd match
    next_btn.click()
    flushSync()
    await tick()
    expect(count?.textContent).toContain(`2 of 2`)

    // Wrap around to 1st match
    next_btn.click()
    flushSync()
    await tick()
    expect(count?.textContent).toContain(`1 of 2`)

    // Prev wraps back to last match
    prev_btn.click()
    flushSync()
    await tick()
    expect(count?.textContent).toContain(`2 of 2`)
  })

  it(`clamps match index when search results shrink`, async () => {
    mount_tree({ value: { bar: 1, baz: 2, bat: 3 }, default_fold_level: 5 })

    await type_search(`ba`)
    expect(get_match_count()?.textContent).toContain(`1 of 3`)

    // Navigate to third match
    get_nav_btns()[1].click()
    get_nav_btns()[1].click()
    flushSync()
    await tick()
    expect(get_match_count()?.textContent).toContain(`3 of 3`)

    // Change search to only match one item - index should clamp to 0
    await type_search(`bat`)
    expect(get_match_count()?.textContent).toContain(`1 of 1`)
  })

  it(`highlights current match and moves highlight on navigation`, async () => {
    mount_tree({ value: { bar: 1, baz: 2 }, default_fold_level: 5 })

    await type_search(`ba`)

    const first_match = get_current_match()
    expect(first_match).toBeInstanceOf(HTMLElement)
    const first_path = first_match?.getAttribute(`data-path`)

    get_nav_btns()[1].click()
    flushSync()
    await tick()

    expect(get_current_match()?.getAttribute(`data-path`)).not.toBe(first_path)
  })

  it.each([
    { key: `F3`, shift: false, target: `tree`, from: `1 of 3`, to: `2 of 3` },
    { key: `F3`, shift: true, target: `tree`, from: `1 of 3`, to: `3 of 3` },
    { key: `Enter`, shift: false, target: `input`, from: `1 of 3`, to: `2 of 3` },
    { key: `Enter`, shift: true, target: `input`, from: `1 of 3`, to: `3 of 3` },
  ])(
    `$key (shift=$shift) on $target navigates matches`,
    async ({ key, shift, target, from, to }) => {
      mount_tree({ value: { bar: 1, baz: 2, bat: 3 }, default_fold_level: 5 })

      await type_search(`ba`)

      const count = get_match_count()
      expect(count?.textContent).toContain(from)

      const el = target === `tree` ? document.querySelector(`.json-tree`) : get_search_input()
      el?.dispatchEvent(new KeyboardEvent(`keydown`, { key, shiftKey: shift, bubbles: true }))
      flushSync()
      await tick()

      expect(count?.textContent).toContain(to)
    },
  )

  it(`Escape clears search`, async () => {
    mount_tree({ value: { foo: 1 }, default_fold_level: 5 })

    await type_search(`foo`)

    const input = get_search_input()
    expect(input.value).toBe(`foo`)
    expect(get_match_nav()).toBeInstanceOf(HTMLElement)

    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    flushSync()
    await tick()

    expect(input.value).toBe(``)
    expect(get_match_nav()).toBeNull()
  })

  it(`auto-expands collapsed nodes to show matches`, async () => {
    mount_tree({
      value: { outer: { inner: { target: `findme` } } },
      default_fold_level: 1, // Only root expanded
    })

    // Initially collapsed
    expect(document.body.textContent).not.toContain(`findme`)
    expect(document.body.textContent).toContain(`{1 key}`)

    await type_search(`findme`)

    // Should auto-expand to reveal match
    expect(document.body.textContent).toContain(`findme`)
  })
})

describe(`path breadcrumb`, () => {
  // Tests verify path/focus functionality via onselect callback since
  // vitest DOM updates may not reflect state changes immediately.

  it.each([
    { path: `nested.key`, value: { nested: { key: 1 } }, expected_val: 1 },
    { path: `a.b.c.d`, value: { a: { b: { c: { d: 1 } } } }, expected_val: 1 },
  ])(`onselect receives correct path: $path`, async ({ path, value, expected_val }) => {
    const onselect = vi.fn()
    mount_tree({ value, default_fold_level: 10, onselect })

    const target_node = document.querySelector(`[data-path="${path}"]`) as HTMLElement
    expect(target_node).toBeInstanceOf(HTMLElement)
    target_node.click()
    flushSync()
    await tick()

    expect(onselect).toHaveBeenCalledWith(path, expected_val)
  })
})

describe(`double-click recursive expand/collapse`, () => {
  it.each([
    {
      desc: `expands collapsed`,
      fold_level: 1,
      before: { contains: [], notContains: [`"d"`] },
      after: { contains: [`"d"`, `1`], notContains: [] },
    },
    {
      desc: `collapses expanded`,
      fold_level: 10,
      before: { contains: [`"b"`, `"c"`], notContains: [] },
      after: { contains: [`{2 keys}`], notContains: [`"b"`, `"c"`] },
    },
  ])(`double-click $desc all descendants`, async ({ fold_level, before, after }) => {
    mount_tree({
      value: { a: { b: { c: 1 }, d: 2 } },
      show_header: false,
      default_fold_level: fold_level,
    })

    before.contains.forEach((text) => expect(document.body.textContent).toContain(text))
    before.notContains.forEach((text) => expect(document.body.textContent).not.toContain(text))

    document
      .querySelectorAll(`.json-node`)[1]
      .dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    flushSync()
    await tick()

    after.contains.forEach((text) => expect(document.body.textContent).toContain(text))
    after.notContains.forEach((text) => expect(document.body.textContent).not.toContain(text))
  })

  it(`double-click root (empty path when no root_label) collapses then re-expands all`, async () => {
    mount_tree({
      value: { a: { b: { c: 1 }, d: 2 } },
      show_header: false,
      default_fold_level: 10, // Everything expanded initially
    })

    expect(document.body.textContent).toContain(`"c"`)

    // Double-click root to collapse all descendants
    const root_node = document.querySelectorAll(`.json-node`)[0]
    expect(root_node.getAttribute(`data-path`)).toBe(``)
    root_node.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    flushSync()
    await tick()

    expect(document.body.textContent).not.toContain(`"c"`)

    // Double-click root again to expand all descendants
    root_node.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    flushSync()
    await tick()

    expect(document.body.textContent).toContain(`"c"`)
    expect(document.body.textContent).toContain(`"d"`)
  })
})

describe(`edge cases`, () => {
  it.each([
    {
      desc: `deeply nested`,
      value: { a: { b: { c: { d: { e: { f: `deep` } } } } } },
      expected: [`"deep"`],
    },
    {
      desc: `mixed array`,
      value: [1, `two`, true, null],
      expected: [`1`, `"two"`, `true`, `null`],
    },
    {
      desc: `special key names`,
      value: { 'key-with-dash': 1, 'key with spaces': 2 },
      expected: [`key-with-dash`, `key with spaces`],
    },
  ])(`handles $desc`, ({ value, expected }) => {
    mount_tree({ value, show_header: false, default_fold_level: 10 })
    expected.forEach((text) => expect(document.body.textContent).toContain(text))
  })

  test.each([
    { value: `just a string`, expected: `"just a string"` },
    { value: null, expected: `null` },
  ])(`handles primitive root: $expected`, ({ value, expected }) => {
    mount_tree({ value, show_header: false })
    expect(document.body.textContent).toContain(expected)
  })

  test.each([
    { value: 0, expected: `0` },
    { value: ``, expected: `""` },
    { value: false, expected: `false` },
  ])(`handles falsy value: $expected`, ({ value, expected }) => {
    mount_tree({ value: { test: value }, show_header: false })
    expect(document.body.textContent).toContain(expected)
  })

  test.each([
    [`日本語`, `日本語`],
    [`🚀 🎨`, `🚀 🎨`],
    [`∑∏∫`, `∑∏∫`],
    [`line1\nline2`, `line1`],
    [`   `, `"   "`],
    [`<div>html</div>`, `<div>html</div>`],
  ])(`renders unicode/special content: %p`, (content, expected) => {
    mount_tree({ value: { text: content }, show_header: false })
    expect(document.body.textContent).toContain(expected)
  })

  it.each([
    {
      desc: `numeric-looking string keys`,
      value: { '123': `a`, '0': `b` },
      expected: [`"123"`, `"0"`],
    },
    {
      desc: `scientific notation numbers`,
      value: { sci: 6.022e23, tiny: 1e-10 },
      expected: [`6.022e+23`, `1e-10`],
    },
  ])(`renders $desc correctly`, ({ value, expected }) => {
    mount_tree({ value, show_header: false })
    expected.forEach((text) => expect(document.body.textContent).toContain(text))
  })
})

describe(`context menu`, () => {
  it(`opens on right-click and shows menu items`, async () => {
    mount_tree({ value: { key: `val` }, show_header: false, default_fold_level: 5 })
    const node = document.querySelector(`.json-node`) as HTMLDivElement
    node.dispatchEvent(
      new MouseEvent(`contextmenu`, { bubbles: true, clientX: 100, clientY: 200 }),
    )
    flushSync()
    await tick()

    const menu = document.querySelector(`.context-menu`)
    expect(menu).toBeInstanceOf(HTMLElement)
    expect(menu?.textContent).toContain(`Copy value`)
    expect(menu?.textContent).toContain(`Copy path`)
    expect(menu?.textContent).toContain(`Pin`)
  })

  it(`closes on backdrop click and on Escape key`, async () => {
    mount_tree({ value: { a: 1 }, show_header: false })
    const node = document.querySelector(`.json-node`) as HTMLDivElement
    const open_menu = async () => {
      node.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true }))
      flushSync()
      await tick()
      expect(document.querySelector(`.context-menu`)).toBeInstanceOf(HTMLElement)
    }

    await open_menu()
    const backdrop = document.querySelector(`.context-menu-backdrop`) as HTMLDivElement
    backdrop.click()
    flushSync()
    await tick()
    expect(document.querySelector(`.context-menu`)).toBeNull()

    await open_menu()
    const tree = document.querySelector(`.json-tree`) as HTMLDivElement
    tree.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    flushSync()
    await tick()
    expect(document.querySelector(`.context-menu`)).toBeNull()
  })

  it(`shows expand/collapse options for expandable nodes`, async () => {
    mount_tree({ value: { nested: { a: 1 } }, show_header: false, default_fold_level: 5 })
    // Right-click on the root node (expandable, expanded)
    const root_node = document.querySelector(`.json-node`) as HTMLDivElement
    root_node.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true }))
    flushSync()
    await tick()

    expect(document.querySelector(`.context-menu`)?.textContent).toContain(
      `Collapse all children`,
    )
  })
})

describe(`pinned paths panel`, () => {
  it(`shows pinned panel after pinning via context menu, Clear button removes it`, async () => {
    mount_tree({ value: { a: 1, b: 2 }, show_header: false, default_fold_level: 5 })
    // Right-click to open context menu
    const node = document.querySelector(`.json-node`) as HTMLDivElement
    node.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true }))
    flushSync()
    await tick()

    // Click "Pin this path"
    const pin_btn = Array.from(document.querySelectorAll(`.context-menu button`)).find((btn) =>
      btn.textContent?.includes(`Pin`),
    ) as HTMLButtonElement
    expect(pin_btn).toBeDefined()
    pin_btn.click()
    flushSync()
    await tick()

    const panel = document.querySelector(`.pinned-panel`)
    expect(panel).toBeInstanceOf(HTMLElement)
    expect(panel?.textContent).toContain(`Pinned (1)`)

    // Click Clear
    const clear_btn = document.querySelector(`.pinned-clear-btn`) as HTMLButtonElement
    clear_btn.click()
    flushSync()
    await tick()
    expect(document.querySelector(`.pinned-panel`)).toBeNull()
  })
})

describe(`selection`, () => {
  it(`Ctrl+click selects a node, Ctrl+click again deselects`, async () => {
    mount_tree({ value: { a: 1, b: 2 }, show_header: false, default_fold_level: 5 })
    // Ctrl+click on the "a" node (index 1, since index 0 is root)
    const node = document.querySelectorAll(`.json-node`)[1]
    node.dispatchEvent(new MouseEvent(`click`, { bubbles: true, ctrlKey: true }))
    flushSync()
    await tick()
    expect(node.classList.contains(`selected`)).toBe(true)

    node.dispatchEvent(new MouseEvent(`click`, { bubbles: true, ctrlKey: true }))
    flushSync()
    await tick()
    expect(node.classList.contains(`selected`)).toBe(false)
  })

  it(`Escape clears all selections`, async () => {
    mount_tree({ value: { a: 1, b: 2 }, show_header: false, default_fold_level: 5 })
    const tree = document.querySelector(`.json-tree`) as HTMLDivElement
    const nodes = document.querySelectorAll(`.json-node`)
    // Select node
    nodes[1].dispatchEvent(new MouseEvent(`click`, { bubbles: true, ctrlKey: true }))
    flushSync()
    expect(nodes[1].classList.contains(`selected`)).toBe(true)

    // Press Escape on tree
    tree.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    flushSync()
    await tick()
    expect(nodes[1].classList.contains(`selected`)).toBe(false)
  })
})

describe(`key click behavior`, () => {
  it(`clicking collapsed key expands node`, async () => {
    mount_tree({
      value: { nested: { deep: 42 } },
      show_header: false,
      default_fold_level: 1,
    })
    // "nested" is collapsed at fold level 1
    expect(document.body.textContent).not.toContain(`"deep"`)

    const key_btn = document.querySelector(`.node-key`) as HTMLButtonElement
    key_btn.click()
    flushSync()
    await tick()

    // Should now be expanded
    expect(document.body.textContent).toContain(`"deep"`)
  })

  it(`Shift+click on key copies path`, async () => {
    const write_text = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: write_text },
      writable: true,
    })
    mount_tree({ value: { my_key: 42 }, show_header: false, default_fold_level: 5 })
    const key_btn = document.querySelector(`.node-key`) as HTMLButtonElement
    key_btn.dispatchEvent(new MouseEvent(`click`, { bubbles: true, shiftKey: true }))
    flushSync()
    await tick()
    expect(write_text).toHaveBeenCalledWith(`my_key`)
  })
})

describe(`node visual hints`, () => {
  it(`shows byte size next to collapsed preview`, () => {
    mount_tree({
      value: { data: { a: 1, b: 2 } },
      show_header: false,
      default_fold_level: 1,
    })
    const size_hint = document.querySelector(`.size-hint`)
    expect(size_hint).toBeInstanceOf(HTMLElement)
    expect(size_hint?.textContent?.trim()).toMatch(/\d+ B/)
  })

  it(`shows ▸ hint for collapsed keys`, () => {
    mount_tree({ value: { nested: { a: 1 } }, show_header: false, default_fold_level: 1 })
    // Collapsed expandable key shows expand hint (leaf keys show a copy icon instead)
    const hint = document.querySelector(`.action-hint`)
    expect(hint?.textContent?.trim()).toBe(`▸`)
  })
})

describe(`collapse-to-level button`, () => {
  it(`shows ⊟ button on expanded nodes`, () => {
    mount_tree({
      value: { nested: { a: 1 } },
      show_header: false,
      default_fold_level: 5,
    })
    const btn = document.querySelector(`.collapse-level-btn`)
    expect(btn).toBeInstanceOf(HTMLElement)
    expect(btn?.textContent?.trim()).toBe(`⊟`)
  })

  it(`collapses children when clicked`, async () => {
    mount_tree({
      value: { outer: { inner: { deep: 1 } } },
      show_header: false,
      default_fold_level: 5,
    })
    expect(document.body.textContent).toContain(`"deep"`)

    // Click the collapse-level button on root
    const btn = document.querySelector(`.collapse-level-btn`) as HTMLButtonElement
    btn.click()
    flushSync()
    await tick()

    // Children should be collapsed but root should still be expanded
    expect(document.body.textContent).not.toContain(`"deep"`)
    expect(document.body.textContent).toContain(`"outer"`)
  })
})

describe(`URL auto-linking`, () => {
  it(`renders URL strings as clickable links`, () => {
    mount_tree({
      value: { link: `https://example.com` },
      show_header: false,
      default_fold_level: 5,
    })
    const link = document.querySelector(`.url-link`) as HTMLAnchorElement
    expect(link).toBeInstanceOf(HTMLElement)
    expect(link.href).toBe(`https://example.com/`)
    expect(link.target).toBe(`_blank`)
    expect(link.rel).toBe(`noopener noreferrer`)
  })

  it(`does not render non-URL strings as links`, () => {
    mount_tree({
      value: { text: `not a url` },
      show_header: false,
      default_fold_level: 5,
    })
    expect(document.querySelector(`.url-link`)).toBeNull()
  })
})

describe(`color swatch`, () => {
  it.each([`#ff0000`, `#fff`, `rgb(255, 0, 0)`, `hsl(120, 100%, 50%)`])(
    `renders swatch for CSS color %p`,
    (color) => {
      mount_tree({
        value: { color },
        show_header: false,
        default_fold_level: 5,
      })
      const swatch = document.querySelector(`.color-swatch`) as HTMLSpanElement
      expect(swatch).toBeInstanceOf(HTMLElement)
      expect(swatch.style.background).not.toBe(``)
    },
  )

  it(`does not render swatch for non-color strings`, () => {
    mount_tree({
      value: { text: `hello` },
      show_header: false,
      default_fold_level: 5,
    })
    expect(document.querySelector(`.color-swatch`)).toBeNull()
  })
})

describe(`diff mode`, () => {
  it(`highlights added keys with diff-added class`, () => {
    mount_tree({
      value: { a: 1, b: 2 },
      compare_value: { a: 1 },
      show_header: false,
      default_fold_level: 5,
    })
    const added_nodes = document.querySelectorAll(`.diff-added`)
    expect(added_nodes.length).toBeGreaterThan(0)
  })

  it(`highlights changed values with diff-changed class`, () => {
    mount_tree({
      value: { a: 99 },
      compare_value: { a: 1 },
      show_header: false,
      default_fold_level: 5,
    })
    const changed_nodes = document.querySelectorAll(`.diff-changed`)
    expect(changed_nodes.length).toBeGreaterThan(0)
  })

  it(`shows ghost nodes for removed keys`, async () => {
    mount_tree({
      value: { a: 1 },
      compare_value: { a: 1, removed_key: `gone` },
      show_header: false,
      default_fold_level: 5,
    })
    await tick()
    const ghost = document.querySelector(`.ghost`)
    expect(ghost).toBeInstanceOf(HTMLElement)
    expect(ghost?.textContent).toContain(`removed_key`)
  })

  it(`does not show diff classes when compare_value is undefined`, () => {
    mount_tree({
      value: { a: 1, b: 2 },
      show_header: false,
      default_fold_level: 5,
    })
    expect(document.querySelectorAll(`.diff-added`)).toHaveLength(0)
    expect(document.querySelectorAll(`.diff-changed`)).toHaveLength(0)
    expect(document.querySelectorAll(`.diff-removed`)).toHaveLength(0)
    expect(document.querySelectorAll(`.ghost`)).toHaveLength(0)
  })
})

describe(`sticky headers`, () => {
  it(`adds sticky-header class to expanded nodes at depth <= 2`, () => {
    mount_tree({
      value: { a: { b: { c: 1 } } },
      show_header: false,
      default_fold_level: 5,
    })
    const sticky_nodes = document.querySelectorAll(`.sticky-header`)
    // root (depth 0), a (depth 1), b (depth 2) should all be sticky
    expect(sticky_nodes).toHaveLength(3)
  })

  it(`does not add sticky-header to collapsed or leaf nodes`, () => {
    mount_tree({
      value: { a: { b: 1 } },
      show_header: false,
      default_fold_level: 1, // only root expanded
    })
    // Only the root node should be sticky (depth 0, expanded)
    const sticky = document.querySelectorAll(`.sticky-header`)
    expect(sticky).toHaveLength(1)
  })
})

describe(`clipboard interactions`, () => {
  it(`right-click on leaf value opens context menu`, async () => {
    mount_tree({ value: { key: 42 }, show_header: false, default_fold_level: 5 })
    const json_value = document.querySelector(`.json-value`) as HTMLSpanElement
    json_value.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true }))
    flushSync()
    await tick()

    const menu = document.querySelector(`.context-menu`)
    expect(menu).toBeInstanceOf(HTMLElement)
    expect(menu?.textContent).toContain(`Copy value`)
    expect(menu?.textContent).toContain(`Copy path`)
  })

  it(`shows inline copy feedback after click-to-copy`, async () => {
    const write_text = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: write_text },
      writable: true,
    })
    mount_tree({ value: { key: 42 }, show_header: false, default_fold_level: 5 })
    const value_el = document.querySelector(`.json-value`) as HTMLSpanElement
    value_el.click()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 10))
    flushSync()

    const feedback = document.querySelector(`.copy-feedback`)
    expect(feedback).toBeInstanceOf(HTMLElement)
    expect(feedback?.textContent?.trim()).toBe(`Copied!`)
  })

  it(`Enter on focused leaf node copies value`, async () => {
    const write_text = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: write_text },
      writable: true,
    })
    mount_tree({ value: { key: 42 }, show_header: false, default_fold_level: 5 })
    const tree = document.querySelector(`.json-tree`) as HTMLDivElement
    // ArrowDown twice: first focuses root, second focuses leaf "key: 42"
    tree.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }))
    flushSync()
    tree.dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }))
    flushSync()
    await tick()

    const leaf_node = document.querySelectorAll(`.json-node`)[1] as HTMLDivElement
    expect(leaf_node.classList.contains(`focused`)).toBe(true)
    leaf_node.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(write_text).toHaveBeenCalledWith(`42`)
  })
})
