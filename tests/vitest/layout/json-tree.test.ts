// Component tests for JsonTree, JsonNode, and JsonValue
import { JsonTree } from '$lib/layout'
import { flushSync, mount, tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`JsonTree`, () => {
  const get_tree = (): HTMLDivElement => doc_query(`.json-tree`)
  const get_header = (): HTMLElement | null => document.querySelector(`.json-tree-header`)
  const get_content = (): HTMLDivElement => doc_query(`.json-tree-content`)
  const get_search_input = (): HTMLInputElement | null =>
    document.querySelector(`.search-input`)
  const get_nodes = (): NodeListOf<HTMLDivElement> =>
    document.querySelectorAll(`.json-node`)
  const get_values = (): NodeListOf<HTMLSpanElement> =>
    document.querySelectorAll(`.json-value`)
  const get_collapse_toggles = (): NodeListOf<HTMLButtonElement> =>
    document.querySelectorAll(`.collapse-toggle`)

  describe(`rendering`, () => {
    it(`renders with required value prop`, () => {
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })
      expect(get_tree()).toBeTruthy()
      expect(get_content()).toBeTruthy()
    })

    it(`renders header by default`, () => {
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })
      expect(get_header()).toBeTruthy()
      expect(get_search_input()).toBeTruthy()
    })

    it(`hides header when show_header=false`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { a: 1 }, show_header: false },
      })
      expect(get_header()).toBeNull()
    })

    it(`renders root label when provided`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: [1, 2, 3], root_label: `items`, show_header: false },
      })
      expect(document.body.textContent).toContain(`"items"`)
    })

    it(`renders without root label when not provided`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { a: 1 }, show_header: false },
      })
      // Should not have a key for the root
      const first_node = get_nodes()[0]
      expect(first_node.querySelector(`.node-key`)).toBeTruthy()
    })

    it(`has correct ARIA attributes`, () => {
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })
      const tree = get_tree()
      expect(tree.getAttribute(`role`)).toBe(`tree`)
      expect(tree.getAttribute(`aria-label`)).toBe(`JSON tree viewer`)
    })

    it(`spreads additional attributes`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: {}, style: `max-height: 300px`, 'data-testid': `json-tree` },
      })
      const tree = doc_query(`[data-testid="json-tree"]`)
      expect(tree.style.maxHeight).toBe(`300px`)
      expect(tree.classList.contains(`json-tree`)).toBe(true)
    })
  })

  describe(`value types`, () => {
    it.each([
      { value: `hello`, expected_class: `string`, expected_text: `"hello"` },
      { value: 42, expected_class: `number`, expected_text: `42` },
      { value: 3.14159, expected_class: `number`, expected_text: `3.14159` },
      { value: true, expected_class: `boolean`, expected_text: `true` },
      { value: false, expected_class: `boolean`, expected_text: `false` },
      { value: null, expected_class: `null`, expected_text: `null` },
      { value: undefined, expected_class: `undefined`, expected_text: `undefined` },
    ])(
      `renders primitive $expected_class correctly`,
      ({ value, expected_class, expected_text }) => {
        mount(JsonTree, {
          target: document.body,
          props: { value: { test: value }, show_header: false },
        })
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
      mount(JsonTree, {
        target: document.body,
        props: { value: { test: value }, show_header: false },
      })
      expect(get_values()[0].classList.contains(css)).toBe(true)
      expect(document.body.textContent).toContain(expected)
    })

    it(`renders function with ƒ prefix`, () => {
      function example_fn() {
        return 42
      }
      mount(JsonTree, {
        target: document.body,
        props: { value: { fn: example_fn }, show_header: false },
      })
      expect(document.body.textContent).toContain(`ƒ example_fn()`)
    })

    it.each([`Infinity`, `-Infinity`, `NaN`])(`renders special number %s`, (expected) => {
      const value = expected === `NaN`
        ? NaN
        : expected === `Infinity`
        ? Infinity
        : -Infinity
      mount(JsonTree, {
        target: document.body,
        props: { value: { num: value }, show_header: false },
      })
      expect(document.body.textContent).toContain(expected)
    })
  })

  describe(`arrays and objects`, () => {
    it(`uses square brackets for arrays and braces for objects`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { arr: [1], obj: { a: 1 } },
          show_header: false,
          default_fold_level: 5,
        },
      })
      const brackets = document.querySelectorAll(`.bracket`)
      const bracket_text = Array.from(brackets).map((el) => el.textContent)
      // Arrays use [ ], objects use { }
      expect(bracket_text).toContain(`[`)
      expect(bracket_text).toContain(`]`)
      expect(bracket_text).toContain(`{`)
      expect(bracket_text).toContain(`}`)
      // Count: outer object { }, inner array [ ], inner object { } = 3 pairs each
      expect(bracket_text.filter((text) => text === `[`).length).toBe(1) // Only arr uses [
      expect(bracket_text.filter((text) => text === `{`).length).toBe(2) // outer obj + inner obj
    })

    it.each([
      { show_array_indices: true, expected_count: 2 },
      { show_array_indices: false, expected_count: 0 },
    ])(
      `show_array_indices=$show_array_indices`,
      ({ show_array_indices, expected_count }) => {
        mount(JsonTree, {
          target: document.body,
          props: {
            value: [`a`, `b`],
            show_header: false,
            show_array_indices,
            default_fold_level: 5,
          },
        })
        const indices = document.querySelectorAll(`.array-index .index`)
        expect(indices.length).toBe(expected_count)
      },
    )

    it(`sorts object keys when sort_keys=true`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { zebra: 1, apple: 2, mango: 3 },
          show_header: false,
          sort_keys: true,
          default_fold_level: 5,
        },
      })
      const keys = Array.from(document.querySelectorAll(`.node-key`))
        .map((el) => el.textContent?.replace(/"/g, ``))
      expect(keys).toEqual([`apple`, `mango`, `zebra`])
    })

    it.each([
      { value: { arr: [1, 2, 3, 4, 5] }, expected: `Array(5)` },
      { value: { obj: { a: 1, b: 2 } }, expected: `{2 keys}` },
      { value: { empty: [] }, expected: `Array(0)` },
      { value: { empty: {} }, expected: `{0 keys}` },
    ])(`shows collapsed preview: $expected`, ({ value, expected }) => {
      mount(JsonTree, {
        target: document.body,
        props: { value, show_header: false, default_fold_level: 1 },
      })
      expect(document.body.textContent).toContain(expected)
    })
  })

  describe(`folding/collapsing`, () => {
    it(`respects default_fold_level`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { level1: { level2: { level3: `deep` } } },
          show_header: false,
          default_fold_level: 1,
        },
      })
      // At level 1, level2 should be collapsed
      expect(document.body.textContent).toContain(`{1 key}`)
    })

    it(`clicking toggle changes aria-expanded`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { nested: { a: 1 } },
          show_header: false,
          default_fold_level: 1,
        },
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
        value: Object.fromEntries(
          Array.from({ length: 25 }, (_, idx) => [`key${idx}`, idx]),
        ),
        props: { auto_fold_objects: 20 },
        expected: `{25 keys}`,
      },
    ])(`auto-folds large $desc`, ({ value, props, expected }) => {
      mount(JsonTree, {
        target: document.body,
        props: { value, show_header: false, default_fold_level: 5, ...props },
      })
      expect(document.body.textContent).toContain(expected)
    })

    it(`clicking auto-folded node expands it`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: Array.from({ length: 15 }, (_, idx) => idx),
          show_header: false,
          auto_fold_arrays: 10,
          default_fold_level: 5,
        },
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

    it(`expand all button expands collapsed nodes`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: 1 } },
          default_fold_level: 5, // High level so nothing auto-collapses
        },
      })

      // Second controls group has expand/collapse buttons
      const control_groups = document.querySelectorAll(`.controls`)
      const expand_collapse_group = control_groups[1]
      const btns = expand_collapse_group.querySelectorAll(`button`)
      const expand_btn = btns[0] as HTMLButtonElement
      const collapse_btn = btns[1] as HTMLButtonElement

      // Manually collapse via collapse all first
      collapse_btn.click()
      flushSync()
      await tick()

      // Now collapsed - shows preview
      expect(document.body.textContent).toContain(`{1 key}`)
      expect(document.body.textContent).not.toContain(`"b"`)

      // Click expand all
      expand_btn.click()
      flushSync()
      await tick()

      // After expand - nested value visible again
      expect(document.body.textContent).toContain(`"b"`)
    })

    it(`collapse all button collapses expanded nodes`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: 1 }, c: 2 },
          default_fold_level: 5,
        },
      })

      // Initially expanded - nested value visible
      expect(document.body.textContent).toContain(`"b"`)

      // Second controls group has expand/collapse buttons
      const control_groups = document.querySelectorAll(`.controls`)
      const expand_collapse_group = control_groups[1]
      const collapse_btn = expand_collapse_group.querySelectorAll(
        `button`,
      )[1] as HTMLButtonElement
      collapse_btn.click()
      flushSync()
      await tick()

      // After collapse - nested node shows preview, b is hidden
      expect(document.body.textContent).toContain(`{1 key}`)
      expect(document.body.textContent).not.toContain(`"b"`)
    })

    it(`collapse to level buttons work`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: { c: 1 } } },
          default_fold_level: 5,
        },
      })

      // Second controls group has expand/collapse buttons
      const control_groups = document.querySelectorAll(`.controls`)
      const expand_collapse_group = control_groups[1]
      const level_1_btn = expand_collapse_group.querySelectorAll(
        `button`,
      )[2] as HTMLButtonElement
      level_1_btn.click()
      flushSync()
      await tick()

      expect(document.body.textContent).toContain(`{1 key}`)
    })
  })

  describe(`header controls`, () => {
    it(`has all control button groups with dividers`, () => {
      mount(JsonTree, { target: document.body, props: { value: { name: `test` } } })
      const btns = document.querySelectorAll(`.controls button`)
      // 2 toggles (T, #) + 5 expand/collapse (expand, collapse, 1, 2, 3) + 2 copy/download
      expect(btns.length).toBe(9)
      const dividers = document.querySelectorAll(`.divider`)
      expect(dividers.length).toBe(2) // separators between 3 button groups
    })

    it(`has toggle buttons for data types and array indices`, () => {
      mount(JsonTree, { target: document.body, props: { value: { arr: [1, 2] } } })
      const toggle_btns = document.querySelectorAll(`.controls button`)
      const type_toggle = toggle_btns[0] as HTMLButtonElement
      const index_toggle = toggle_btns[1] as HTMLButtonElement
      expect(type_toggle.textContent).toBe(`T`)
      expect(index_toggle.textContent).toBe(`#`)
    })

    it(`has copy and download buttons with icons`, () => {
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })
      const control_groups = document.querySelectorAll(`.controls`)
      const last_group = control_groups[control_groups.length - 1]
      const btns = last_group.querySelectorAll(`button`)
      expect(btns.length).toBe(2)
      // Both should have SVG icons
      expect(btns[0].querySelector(`svg`)).toBeTruthy()
      expect(btns[1].querySelector(`svg`)).toBeTruthy()
      expect(btns[0].getAttribute(`title`)).toBe(`Copy JSON to clipboard`)
      expect(btns[1].getAttribute(`title`)).toBe(`Download as JSON file`)
    })
  })

  describe(`copy functionality`, () => {
    it(`keys are clickable and call clipboard API`, () => {
      const write_text = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, `clipboard`, {
        value: { writeText: write_text },
        writable: true,
      })
      mount(JsonTree, {
        target: document.body,
        props: { value: { my_key: 42 }, show_header: false },
      })
      const key_el = document.querySelector(`.node-key`) as HTMLButtonElement
      expect(key_el.tagName).toBe(`BUTTON`)
      key_el.click()
      flushSync()
      expect(write_text).toHaveBeenCalledWith(`my_key`)
    })
  })

  describe(`copy all button`, () => {
    const get_copy_btn = (): HTMLButtonElement => {
      const groups = document.querySelectorAll(`.controls`)
      return groups[groups.length - 1].querySelectorAll(`button`)[0] as HTMLButtonElement
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
      mount(JsonTree, { target: document.body, props: { value: test_value } })

      get_copy_btn().click()
      flushSync()
      await tick()

      expect(write_text_mock).toHaveBeenCalledTimes(1)
      expect(JSON.parse(write_text_mock.mock.calls[0][0])).toEqual(test_value)
    })

    it(`shows copy feedback after copying`, async () => {
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })

      get_copy_btn().click()
      await vi.waitFor(() => expect(write_text_mock).toHaveBeenCalled())
      flushSync()
      await tick()

      const feedback = document.querySelector(`.copy-feedback`)
      expect(feedback).toBeTruthy()
      expect(feedback?.textContent).toBe(`Copied!`)
    })

    it(`shows error feedback when clipboard fails`, async () => {
      mock_clipboard_error()
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })

      get_copy_btn().click()
      await vi.waitFor(() => expect(write_text_mock).toHaveBeenCalled())
      flushSync()
      await tick()

      const feedback = document.querySelector(`.copy-feedback.error`)
      expect(feedback).toBeTruthy()
      expect(feedback?.textContent).toBe(`Copy failed`)
    })

    it(`calls oncopy callback when copying all`, async () => {
      const oncopy = vi.fn()
      mount(JsonTree, { target: document.body, props: { value: { test: 123 }, oncopy } })

      get_copy_btn().click()
      flushSync()
      await tick()

      expect(oncopy).toHaveBeenCalledWith(`[root]`, expect.any(String))
    })

    it.each([
      { value: [1, 2, 3], desc: `array` },
      { value: { nested: { deep: { value: true } } }, desc: `nested object` },
      { value: `just a string`, desc: `primitive string` },
      { value: 42, desc: `primitive number` },
      { value: null, desc: `null` },
    ])(`copies $desc correctly`, async ({ value }) => {
      mount(JsonTree, { target: document.body, props: { value } })

      get_copy_btn().click()
      flushSync()
      await tick()

      expect(write_text_mock).toHaveBeenCalledTimes(1)
    })
  })

  describe(`download button`, () => {
    // Use global download override from $lib/io/fetch to avoid mocking document.createElement
    let mock_download: ReturnType<typeof vi.fn>

    const get_download_btn = (): HTMLButtonElement => {
      const groups = document.querySelectorAll(`.controls`)
      return groups[groups.length - 1].querySelectorAll(`button`)[1] as HTMLButtonElement
    }

    beforeEach(() => {
      mock_download = vi.fn()
      ;(globalThis as Record<string, unknown>).download = mock_download
    })

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).download
    })

    it(`creates download with correct filename format`, async () => {
      mount(JsonTree, { target: document.body, props: { value: { a: 1 } } })

      get_download_btn().click()
      flushSync()
      await tick()

      expect(mock_download).toHaveBeenCalledTimes(1)
      const [, filename] = mock_download.mock.calls[0]
      expect(filename).toMatch(/^data-\d{4}-\d{2}-\d{2}\.json$/)
    })

    it(`creates download with JSON content and correct mime type`, async () => {
      const test_value = { name: `test`, count: 42 }
      mount(JsonTree, { target: document.body, props: { value: test_value } })

      get_download_btn().click()
      flushSync()
      await tick()

      const [data, , mime_type] = mock_download.mock.calls[0]
      expect(mime_type).toBe(`application/json`)
      expect(JSON.parse(data)).toEqual(test_value)
    })

    it.each([
      {
        value: { deep: { nested: { obj: true } } },
        desc: `nested object`,
        is_json: true,
      },
      { value: [1, 2, 3, 4, 5], desc: `array`, is_json: true },
      { value: `string value`, desc: `string`, is_json: false },
      { value: 42, desc: `number`, is_json: false },
    ])(`downloads $desc correctly`, async ({ value, is_json }) => {
      mount(JsonTree, { target: document.body, props: { value } })

      get_download_btn().click()
      flushSync()
      await tick()

      const [data] = mock_download.mock.calls[0]
      if (is_json) expect(JSON.parse(data)).toEqual(value)
      else expect(data).toBe(String(value))
    })

    it(`uses custom download_filename when provided`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { a: 1 }, download_filename: `my-custom-data.json` },
      })

      get_download_btn().click()
      flushSync()
      await tick()

      const [, filename] = mock_download.mock.calls[0]
      expect(filename).toBe(`my-custom-data.json`)
    })
  })

  describe(`keyboard navigation`, () => {
    it(`collapse toggles have aria-label`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { nested: { a: 1 } }, show_header: false, default_fold_level: 5 },
      })
      const toggles = get_collapse_toggles()
      expect(toggles.length).toBeGreaterThan(0)
      expect(toggles[0].getAttribute(`aria-label`)).toBeTruthy()
    })
  })

  describe(`type annotations`, () => {
    it.each([
      { show_data_types: true, expected_min: 1 },
      { show_data_types: false, expected_min: 0 },
    ])(`show_data_types=$show_data_types`, ({ show_data_types, expected_min }) => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { str: `hello` }, show_header: false, show_data_types },
      })
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
      mount(JsonTree, {
        target: document.body,
        props: { value: { str: `hello` }, show_data_types: false },
      })

      // Initially no type annotations
      expect(document.querySelectorAll(`.type-annotation`).length).toBe(0)

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

      expect(document.querySelectorAll(`.type-annotation`).length).toBe(0)
      expect(type_toggle.classList.contains(`active`)).toBe(false)
    })

    it(`array indices toggle button toggles show_array_indices`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: [`a`, `b`, `c`],
          show_array_indices: true,
          default_fold_level: 5,
        },
      })

      // Initially indices are shown
      expect(document.querySelectorAll(`.array-index .index`).length).toBe(3)

      const index_toggle = get_toggle_btns()[1]
      expect(index_toggle.textContent).toBe(`#`)
      expect(index_toggle.classList.contains(`active`)).toBe(true)

      index_toggle.click()
      flushSync()
      await tick()

      // Now indices should be hidden
      expect(document.querySelectorAll(`.array-index .index`).length).toBe(0)
      expect(index_toggle.classList.contains(`active`)).toBe(false)

      // Toggle on again
      index_toggle.click()
      flushSync()
      await tick()

      expect(document.querySelectorAll(`.array-index .index`).length).toBe(3)
      expect(index_toggle.classList.contains(`active`)).toBe(true)
    })

    it(`toggle buttons have correct titles`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { a: 1 }, show_data_types: false, show_array_indices: true },
      })

      const toggle_btns = get_toggle_btns()
      const type_toggle = toggle_btns[0]
      const index_toggle = toggle_btns[1]

      // When off, title should say "Show..."
      expect(type_toggle.getAttribute(`title`)).toBe(`Show data types`)
      // When on, title should say "Hide..."
      expect(index_toggle.getAttribute(`title`)).toBe(`Hide array indices`)
    })

    it(`toggle button active state updates when toggled`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { a: 1 }, show_data_types: false },
      })

      let type_toggle = get_toggle_btns()[0]
      expect(type_toggle.classList.contains(`active`)).toBe(false)

      type_toggle.click()
      flushSync()
      await tick()

      // Re-query the button after state change
      type_toggle = get_toggle_btns()[0]
      expect(type_toggle.classList.contains(`active`)).toBe(true)

      // Toggle off
      type_toggle.click()
      flushSync()
      await tick()

      type_toggle = get_toggle_btns()[0]
      expect(type_toggle.classList.contains(`active`)).toBe(false)
    })

    it(`toggle states are independent`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: [`item`],
          show_data_types: false,
          show_array_indices: true,
          default_fold_level: 5,
        },
      })

      const toggle_btns = get_toggle_btns()
      const type_toggle = toggle_btns[0]
      const index_toggle = toggle_btns[1]

      // Toggle data types on
      type_toggle.click()
      flushSync()
      await tick()

      expect(type_toggle.classList.contains(`active`)).toBe(true)
      expect(index_toggle.classList.contains(`active`)).toBe(true) // unchanged

      // Toggle array indices off
      index_toggle.click()
      flushSync()
      await tick()

      expect(type_toggle.classList.contains(`active`)).toBe(true) // unchanged
      expect(index_toggle.classList.contains(`active`)).toBe(false)
    })

    it(`respects initial prop values`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { a: 1 }, show_data_types: true, show_array_indices: false },
      })

      const toggle_btns = get_toggle_btns()
      expect(toggle_btns[0].classList.contains(`active`)).toBe(true)
      expect(toggle_btns[1].classList.contains(`active`)).toBe(false)
    })
  })

  describe(`string truncation`, () => {
    it(`truncates long strings and shows expand button`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { long: `a`.repeat(300) },
          show_header: false,
          max_string_length: 50,
        },
      })
      const value_el = get_values()[0]
      expect(value_el.textContent?.length).toBeLessThan(100)
      expect(value_el.textContent).toContain(`...`)
      expect(document.querySelector(`.expand-btn`)).toBeTruthy()
    })
  })

  describe(`Map and Set`, () => {
    it.each([
      { collection: new Map([[`key1`, `value1`]]), expected: [`key1`, `value1`] },
      { collection: new Set([1, 2, 3]), expected: [`1`, `2`, `3`] },
    ])(`renders collection entries`, ({ collection, expected }) => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { collection }, show_header: false, default_fold_level: 5 },
      })
      expected.forEach((text) => expect(document.body.textContent).toContain(text))
    })

    it.each([
      { collection: new Map([[`a`, 1], [`b`, 2]]), expected: `Map(2)` },
      { collection: new Set([1, 2, 3, 4]), expected: `Set(4)` },
    ])(`shows $expected in preview`, ({ collection, expected }) => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { collection }, show_header: false, default_fold_level: 1 },
      })
      expect(document.body.textContent).toContain(expected)
    })

    it(`renders nested Map containing Set`, () => {
      const nested = new Map([[`inner`, new Set([{ deep: true }])]])
      mount(JsonTree, {
        target: document.body,
        props: { value: { nested }, show_header: false, default_fold_level: 10 },
      })
      const text = document.body.textContent
      expect(text).toContain(`inner`)
      expect(text).toContain(`deep`)
      expect(text).toContain(`true`)
    })
  })

  describe(`callbacks`, () => {
    it(`calls onselect when node is clicked`, async () => {
      const onselect = vi.fn()
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { name: `test` },
          show_header: false,
          default_fold_level: 5,
          onselect,
        },
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

      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `test` }, show_header: false, oncopy },
      })

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
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { nested: { a: 1 }, other: 2 },
          show_header: false,
          collapsed_paths: collapsed,
          default_fold_level: 5,
        },
      })

      // nested should be collapsed, other should be visible
      expect(document.body.textContent).toContain(`{1 key}`)
      expect(document.body.textContent).toContain(`2`)
    })
  })
})

describe(`accessibility`, () => {
  it(`has correct ARIA roles and attributes`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { nested: { a: 1 } }, show_header: false, default_fold_level: 5 },
    })
    // Tree structure
    expect(document.querySelectorAll(`[role="treeitem"]`).length).toBeGreaterThan(0)
    expect(document.querySelector(`[aria-expanded]`)).toBeTruthy()
    // Clickable values
    const value_el = document.querySelector(`.json-value`)
    expect(value_el?.getAttribute(`role`)).toBe(`button`)
    expect(value_el?.getAttribute(`title`)).toBe(`Click to copy`)
  })
})

describe(`search navigation`, () => {
  const get_search_input = (): HTMLInputElement =>
    document.querySelector(`.search-input`) as HTMLInputElement
  const get_match_nav = (): HTMLElement | null => document.querySelector(`.match-nav`)
  const get_nav_btns = (): NodeListOf<HTMLButtonElement> =>
    document.querySelectorAll(`.nav-btn`)
  const get_match_count = (): HTMLElement | null => document.querySelector(`.match-count`)
  const get_current_match = (): HTMLElement | null =>
    document.querySelector(`.current-match`)

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

  it(`shows prev/next buttons when search has matches`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { foo: 1, bar: 2, baz: 3 }, default_fold_level: 5 },
    })
    expect(get_match_nav()).toBeNull()

    await type_search(`ba`)

    expect(get_match_nav()).toBeTruthy()
    expect(get_nav_btns().length).toBe(2) // prev and next
  })

  it(`shows "X of Y" match count format`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { foo: 1, bar: 2, baz: 3 }, default_fold_level: 5 },
    })

    await type_search(`ba`)

    const count = get_match_count()
    expect(count).toBeTruthy()
    expect(count?.textContent).toMatch(/1 of 2/)
  })

  it(`next button increments match index and wraps around`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { bar: 1, baz: 2 }, default_fold_level: 5 },
    })

    await type_search(`ba`)

    const count = get_match_count()
    expect(count?.textContent).toContain(`1 of 2`)

    const next_btn = get_nav_btns()[1]

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
  })

  it(`prev button decrements match index with wrap-around`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { bar: 1, baz: 2 }, default_fold_level: 5 },
    })

    await type_search(`ba`)

    const count = get_match_count()
    expect(count?.textContent).toContain(`1 of 2`)

    const prev_btn = get_nav_btns()[0]
    prev_btn.click()
    flushSync()
    await tick()

    // Should wrap to last match
    expect(count?.textContent).toContain(`2 of 2`)
  })

  it(`clamps match index when search results shrink`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { bar: 1, baz: 2, bat: 3 }, default_fold_level: 5 },
    })

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

  it(`highlights current match with distinct class`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { bar: 1, baz: 2 }, default_fold_level: 5 },
    })

    await type_search(`ba`)

    const current = get_current_match()
    expect(current).toBeTruthy()
    expect(current?.classList.contains(`current-match`)).toBe(true)
  })

  it(`navigating to next match updates current-match class`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { bar: 1, baz: 2 }, default_fold_level: 5 },
    })

    await type_search(`ba`)

    const first_match = get_current_match()
    const first_path = first_match?.getAttribute(`data-path`)

    const next_btn = get_nav_btns()[1]
    next_btn.click()
    flushSync()
    await tick()

    const second_match = get_current_match()
    const second_path = second_match?.getAttribute(`data-path`)

    expect(first_path).not.toBe(second_path)
  })

  it.each([
    { key: `F3`, shift: false, target: `tree`, from: `1 of 3`, to: `2 of 3` },
    { key: `F3`, shift: true, target: `tree`, from: `1 of 3`, to: `3 of 3` },
    { key: `Enter`, shift: false, target: `input`, from: `1 of 3`, to: `2 of 3` },
    { key: `Enter`, shift: true, target: `input`, from: `1 of 3`, to: `3 of 3` },
  ])(
    `$key (shift=$shift) on $target navigates matches`,
    async ({ key, shift, target, from, to }) => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { bar: 1, baz: 2, bat: 3 }, default_fold_level: 5 },
      })

      await type_search(`ba`)

      const count = get_match_count()
      expect(count?.textContent).toContain(from)

      const el = target === `tree`
        ? document.querySelector(`.json-tree`)
        : get_search_input()
      el?.dispatchEvent(
        new KeyboardEvent(`keydown`, { key, shiftKey: shift, bubbles: true }),
      )
      flushSync()
      await tick()

      expect(count?.textContent).toContain(to)
    },
  )

  it(`Escape clears search`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { foo: 1 }, default_fold_level: 5 },
    })

    await type_search(`foo`)

    const input = get_search_input()
    expect(input.value).toBe(`foo`)
    expect(get_match_nav()).toBeTruthy()

    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }))
    flushSync()
    await tick()

    expect(input.value).toBe(``)
    expect(get_match_nav()).toBeNull()
  })

  it(`auto-expands collapsed nodes to show matches`, async () => {
    mount(JsonTree, {
      target: document.body,
      props: {
        value: { outer: { inner: { target: `findme` } } },
        default_fold_level: 1, // Only root expanded
      },
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
    mount(JsonTree, {
      target: document.body,
      props: { value, default_fold_level: 10, onselect },
    })

    const target_node = document.querySelector(`[data-path="${path}"]`) as HTMLElement
    expect(target_node).toBeTruthy()
    target_node.click()
    flushSync()
    await tick()

    expect(onselect).toHaveBeenCalledWith(path, expected_val)
  })
})

describe(`copy path functionality`, () => {
  it(`clicking key copies full path instead of just key`, async () => {
    const write_text = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: write_text },
      writable: true,
    })

    mount(JsonTree, {
      target: document.body,
      props: {
        value: { outer: { inner: 42 } },
        show_header: false,
        default_fold_level: 5,
      },
    })

    // Find the "inner" key button
    const keys = document.querySelectorAll(`.node-key`)
    const inner_key = Array.from(keys).find((el) => el.textContent?.includes(`inner`))
    expect(inner_key).toBeTruthy()
    ;(inner_key as HTMLButtonElement).click()
    flushSync()
    await tick()

    expect(write_text).toHaveBeenCalledWith(`outer.inner`)
  })

  it(`key title shows full path hint`, () => {
    mount(JsonTree, {
      target: document.body,
      props: {
        value: { parent: { child: 1 } },
        show_header: false,
        default_fold_level: 5,
      },
    })

    const keys = document.querySelectorAll(`.node-key`)
    const child_key = Array.from(keys).find((el) => el.textContent?.includes(`child`))

    expect(child_key?.getAttribute(`title`)).toContain(`parent.child`)
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
    mount(JsonTree, {
      target: document.body,
      props: {
        value: { a: { b: { c: 1 }, d: 2 } },
        show_header: false,
        default_fold_level: fold_level,
      },
    })

    before.contains.forEach((text) => expect(document.body.textContent).toContain(text))
    before.notContains.forEach((text) =>
      expect(document.body.textContent).not.toContain(text)
    )

    document.querySelectorAll(`.json-node`)[1].dispatchEvent(
      new MouseEvent(`dblclick`, { bubbles: true }),
    )
    flushSync()
    await tick()

    after.contains.forEach((text) => expect(document.body.textContent).toContain(text))
    after.notContains.forEach((text) =>
      expect(document.body.textContent).not.toContain(text)
    )
  })

  // Test for root node double-click when root_label is undefined (empty path)
  // Verifies that toggle_collapse_recursive handles empty path correctly
  it.each([
    {
      desc: `collapses all from root without label`,
      fold_level: 10,
      before: { contains: [`"b"`, `"c"`], notContains: [] },
      after: { contains: [], notContains: [`"b"`, `"c"`] },
    },
  ])(
    `double-click root (empty path) $desc`,
    async ({ fold_level, before, after }) => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: { c: 1 }, d: 2 } },
          show_header: false,
          default_fold_level: fold_level,
          // No root_label means root path is empty string
        },
      })

      before.contains.forEach((text) => expect(document.body.textContent).toContain(text))
      before.notContains.forEach((text) =>
        expect(document.body.textContent).not.toContain(text)
      )

      // Double-click on root node (index 0) - has empty path when no root_label
      const root_node = document.querySelectorAll(`.json-node`)[0]
      expect(root_node.getAttribute(`data-path`)).toBe(``)
      root_node.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
      flushSync()
      await tick()

      after.contains.forEach((text) => expect(document.body.textContent).toContain(text))
      after.notContains.forEach((text) =>
        expect(document.body.textContent).not.toContain(text)
      )
    },
  )

  it(`double-click root (empty path) expands after collapse all`, async () => {
    // Start with everything expanded, collapse all, then double-click root to expand
    mount(JsonTree, {
      target: document.body,
      props: {
        value: { a: { b: { c: 1 }, d: 2 } },
        show_header: false,
        default_fold_level: 10, // Everything expanded initially
      },
    })

    // Initially everything is visible
    expect(document.body.textContent).toContain(`"c"`)

    // Double-click root to collapse all descendants
    const root_node = document.querySelectorAll(`.json-node`)[0]
    expect(root_node.getAttribute(`data-path`)).toBe(``)
    root_node.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    flushSync()
    await tick()

    // Now everything should be collapsed - c is hidden
    expect(document.body.textContent).not.toContain(`"c"`)

    // Double-click root again to expand all descendants
    root_node.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    flushSync()
    await tick()

    // Now everything should be visible again
    expect(document.body.textContent).toContain(`"c"`)
    expect(document.body.textContent).toContain(`"d"`)
  })

  it(`nodes have data-path attribute`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { foo: { bar: 1 } }, show_header: false, default_fold_level: 5 },
    })
    const paths = Array.from(document.querySelectorAll(`.json-node[data-path]`))
      .map((n) => n.getAttribute(`data-path`))
    expect(paths).toContain(`foo`)
    expect(paths).toContain(`foo.bar`)
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
    mount(JsonTree, {
      target: document.body,
      props: { value, show_header: false, default_fold_level: 10 },
    })
    expected.forEach((text) => expect(document.body.textContent).toContain(text))
  })

  test.each([
    { value: `just a string`, expected: `"just a string"` },
    { value: null, expected: `null` },
  ])(`handles primitive root: $expected`, ({ value, expected }) => {
    mount(JsonTree, { target: document.body, props: { value, show_header: false } })
    expect(document.body.textContent).toContain(expected)
  })

  test.each([
    { value: 0, expected: `0` },
    { value: ``, expected: `""` },
    { value: false, expected: `false` },
  ])(`handles falsy value: $expected`, ({ value, expected }) => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { test: value }, show_header: false },
    })
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
    mount(JsonTree, {
      target: document.body,
      props: { value: { text: content }, show_header: false },
    })
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
    mount(JsonTree, { target: document.body, props: { value, show_header: false } })
    expected.forEach((text) => expect(document.body.textContent).toContain(text))
  })
})
