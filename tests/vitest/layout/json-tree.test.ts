// Component tests for JsonTree, JsonNode, and JsonValue
import { JsonTree } from '$lib/layout'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, it, test, vi } from 'vitest'
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

      const btns = document.querySelectorAll(`.controls button`)
      const [expand_btn, collapse_btn] = btns as NodeListOf<HTMLButtonElement>

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

      const btns = document.querySelectorAll(`.controls button`)
      const collapse_btn = btns[1] as HTMLButtonElement
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

      const btns = document.querySelectorAll(`.controls button`)
      const level_1_btn = btns[2] as HTMLButtonElement // [expand, collapse, 1, 2, 3]
      level_1_btn.click()
      flushSync()
      await tick()

      expect(document.body.textContent).toContain(`{1 key}`)
    })
  })

  describe(`header controls`, () => {
    it(`has expand/collapse and level buttons`, () => {
      mount(JsonTree, { target: document.body, props: { value: { name: `test` } } })
      const btns = document.querySelectorAll(`.controls button`)
      expect(btns.length).toBe(5) // expand, collapse, 1, 2, 3
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
      const key_el = document.querySelector(`.node-key`) as HTMLSpanElement
      expect(key_el.getAttribute(`role`)).toBe(`button`)
      key_el.click()
      flushSync()
      expect(write_text).toHaveBeenCalledWith(`my_key`)
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

  describe(`string truncation`, () => {
    it(`truncates long strings`, () => {
      const long_str = `a`.repeat(300)
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { long: long_str },
          show_header: false,
          max_string_length: 50,
        },
      })
      const value_el = get_values()[0]
      expect(value_el.textContent?.length).toBeLessThan(100)
      expect(value_el.textContent).toContain(`...`)
    })

    it(`shows expand button for long strings`, () => {
      const long_str = `a`.repeat(300)
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { long: long_str },
          show_header: false,
          max_string_length: 50,
        },
      })
      const expand_btn = document.querySelector(`.expand-btn`) as HTMLButtonElement
      expect(expand_btn).toBeTruthy()
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
  it(`nodes have treeitem role and aria-expanded`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { nested: { a: 1 } }, show_header: false, default_fold_level: 5 },
    })
    expect(document.querySelectorAll(`[role="treeitem"]`).length).toBeGreaterThan(0)
    expect(document.querySelector(`[aria-expanded]`)).toBeTruthy()
  })

  it(`values have button role and copy title`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { name: `test` }, show_header: false },
    })
    const value_el = document.querySelector(`.json-value`)
    expect(value_el?.getAttribute(`role`)).toBe(`button`)
    expect(value_el?.getAttribute(`title`)).toBe(`Click to copy`)
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

  it(`renders numeric-looking string keys correctly`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { '123': `a`, '0': `b`, '-1': `c` }, show_header: false },
    })
    const text = document.body.textContent
    expect(text).toContain(`"123"`)
    expect(text).toContain(`"0"`)
    expect(text).toContain(`"-1"`)
  })

  it(`renders scientific notation numbers`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { sci: 6.022e23, tiny: 1e-10 }, show_header: false },
    })
    const text = document.body.textContent
    expect(text).toContain(`6.022e+23`)
    expect(text).toContain(`1e-10`)
  })
})
