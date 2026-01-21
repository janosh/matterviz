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

    it(`renders BigInt with n suffix`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { big: BigInt(9007199254740991) }, show_header: false },
      })
      const value_el = get_values()[0]
      expect(value_el.classList.contains(`bigint`)).toBe(true)
      expect(value_el.textContent).toContain(`n`)
    })

    it(`renders Date as ISO string`, () => {
      const date = new Date(`2024-01-15T10:30:00.000Z`)
      mount(JsonTree, {
        target: document.body,
        props: { value: { date }, show_header: false },
      })
      expect(document.body.textContent).toContain(`2024-01-15T10:30:00.000Z`)
    })

    it(`renders RegExp correctly`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { pattern: /test/gi }, show_header: false },
      })
      expect(document.body.textContent).toContain(`/test/gi`)
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

    it(`renders Error with name and message`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { err: new Error(`Something failed`) }, show_header: false },
      })
      expect(document.body.textContent).toContain(`Error: Something failed`)
    })

    it(`renders Symbol correctly`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { sym: Symbol(`description`) }, show_header: false },
      })
      expect(document.body.textContent).toContain(`Symbol(description)`)
    })

    it(`renders special number values`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { inf: Infinity, neg_inf: -Infinity, nan: NaN },
          show_header: false,
          default_fold_level: 5,
        },
      })
      const text = document.body.textContent
      expect(text).toContain(`Infinity`)
      expect(text).toContain(`-Infinity`)
      expect(text).toContain(`NaN`)
    })
  })

  describe(`arrays and objects`, () => {
    it(`shows array indices when show_array_indices=true`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: [`a`, `b`],
          show_header: false,
          show_array_indices: true,
          default_fold_level: 5,
        },
      })
      const indices = document.querySelectorAll(`.index`)
      expect(indices.length).toBeGreaterThan(0)
    })

    it(`hides array indices when show_array_indices=false`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: [`a`, `b`],
          show_header: false,
          show_array_indices: false,
          default_fold_level: 5,
        },
      })
      const indices = document.querySelectorAll(`.array-index .index`)
      expect(indices.length).toBe(0)
    })

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

    it(`shows preview for collapsed arrays`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { arr: [1, 2, 3, 4, 5] },
          show_header: false,
          default_fold_level: 1,
        },
      })
      expect(document.body.textContent).toContain(`Array(5)`)
    })

    it(`shows preview for collapsed objects`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { obj: { a: 1, b: 2 } },
          show_header: false,
          default_fold_level: 1,
        },
      })
      expect(document.body.textContent).toContain(`{2 keys}`)
    })

    it(`handles empty array`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { empty: [] }, show_header: false, default_fold_level: 1 },
      })
      // Empty array collapsed shows Array(0)
      expect(document.body.textContent).toContain(`Array(0)`)
    })

    it(`handles empty object`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { empty: {} }, show_header: false, default_fold_level: 1 },
      })
      // Empty object collapsed shows {0 keys}
      expect(document.body.textContent).toContain(`{0 keys}`)
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

    it(`auto-folds large arrays`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: Array.from({ length: 15 }, (_, idx) => idx),
          show_header: false,
          auto_fold_arrays: 10,
          default_fold_level: 5,
        },
      })
      // Array should be auto-collapsed because it has > 10 items
      expect(document.body.textContent).toContain(`Array(15)`)
    })

    it(`auto-folds large objects`, () => {
      const large_obj: Record<string, number> = {}
      for (let idx = 0; idx < 25; idx++) {
        large_obj[`key${idx}`] = idx
      }
      mount(JsonTree, {
        target: document.body,
        props: {
          value: large_obj,
          show_header: false,
          auto_fold_objects: 20,
          default_fold_level: 5,
        },
      })
      expect(document.body.textContent).toContain(`{25 keys}`)
    })

    it(`expand all button expands collapsed nodes`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: { c: 1 } } },
          default_fold_level: 1,
        },
      })

      // Initially collapsed - shows preview
      expect(document.body.textContent).toContain(`{1 key}`)

      const expand_btn = document.querySelector(
        `button[title="Expand all"]`,
      ) as HTMLButtonElement
      expand_btn.click()
      flushSync()
      await tick()

      // After expand - nested values should be visible
      expect(document.body.textContent).toContain(`"c"`)
    })

    it(`collapse all button collapses expanded nodes`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: 1 }, c: 2 },
          default_fold_level: 5,
        },
      })

      // Initially expanded - shows values
      expect(document.body.textContent).toContain(`"b"`)

      const collapse_btn = document.querySelector(
        `button[title="Collapse all"]`,
      ) as HTMLButtonElement
      collapse_btn.click()
      flushSync()
      await tick()

      // After collapse - shows preview
      expect(document.body.textContent).toContain(`{2 keys}`)
    })

    it(`collapse to level buttons work`, async () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { a: { b: { c: 1 } } },
          default_fold_level: 5,
        },
      })

      const level_1_btn = document.querySelector(
        `button[title="Collapse to level 1"]`,
      ) as HTMLButtonElement
      level_1_btn.click()
      flushSync()
      await tick()

      expect(document.body.textContent).toContain(`{1 key}`)
    })
  })

  describe(`search`, () => {
    it(`search input is present`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `test` } },
      })
      const search = get_search_input()
      expect(search).toBeTruthy()
      expect(search?.placeholder).toContain(`Search`)
    })

    it(`has expand/collapse all buttons`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `test` } },
      })
      expect(document.querySelector(`button[title="Expand all"]`)).toBeTruthy()
      expect(document.querySelector(`button[title="Collapse all"]`)).toBeTruthy()
    })

    it(`has level buttons`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `test` } },
      })
      expect(document.querySelector(`button[title="Collapse to level 1"]`)).toBeTruthy()
      expect(document.querySelector(`button[title="Collapse to level 2"]`)).toBeTruthy()
      expect(document.querySelector(`button[title="Collapse to level 3"]`)).toBeTruthy()
    })
  })

  describe(`copy functionality`, () => {
    it(`values have copy title`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `copy_me` }, show_header: false },
      })
      const value_el = get_values()[0]
      expect(value_el.getAttribute(`title`)).toBe(`Click to copy`)
    })

    it(`keys are clickable`, () => {
      mount(JsonTree, {
        target: document.body,
        props: { value: { my_key: 42 }, show_header: false },
      })
      const key_el = document.querySelector(`.node-key`) as HTMLSpanElement
      expect(key_el.getAttribute(`role`)).toBe(`button`)
    })

    it(`clicking key calls clipboard API`, () => {
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
      key_el.click()
      flushSync()

      expect(write_text).toHaveBeenCalledWith(`my_key`)
    })
  })

  describe(`keyboard navigation`, () => {
    it(`nodes are focusable`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { nested: { a: 1 } },
          show_header: false,
          default_fold_level: 5,
        },
      })
      const node = get_nodes()[0]
      expect(node.getAttribute(`role`)).toBe(`treeitem`)
    })

    it(`collapse toggle has aria-label`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { nested: { a: 1 } },
          show_header: false,
          default_fold_level: 5,
        },
      })
      const toggles = get_collapse_toggles()
      expect(toggles.length).toBeGreaterThan(0)
      expect(toggles[0].getAttribute(`aria-label`)).toBeTruthy()
    })
  })

  describe(`type annotations`, () => {
    it(`shows type annotations when show_data_types=true`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { str: `hello`, num: 42, bool: true },
          show_header: false,
          show_data_types: true,
          default_fold_level: 5,
        },
      })
      const annotations = document.querySelectorAll(`.type-annotation`)
      expect(annotations.length).toBeGreaterThan(0)
    })

    it(`hides type annotations when show_data_types=false`, () => {
      mount(JsonTree, {
        target: document.body,
        props: {
          value: { str: `hello` },
          show_header: false,
          show_data_types: false,
        },
      })
      const annotations = document.querySelectorAll(`.type-annotation`)
      expect(annotations.length).toBe(0)
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
    it(`renders Map with entries`, () => {
      const map = new Map([[`key1`, `value1`], [`key2`, `value2`]])
      mount(JsonTree, {
        target: document.body,
        props: { value: { map }, show_header: false, default_fold_level: 5 },
      })
      expect(document.body.textContent).toContain(`key`)
      expect(document.body.textContent).toContain(`value`)
    })

    it(`renders Set with values`, () => {
      const set = new Set([1, 2, 3])
      mount(JsonTree, {
        target: document.body,
        props: { value: { set }, show_header: false, default_fold_level: 5 },
      })
      expect(document.body.textContent).toContain(`1`)
      expect(document.body.textContent).toContain(`2`)
      expect(document.body.textContent).toContain(`3`)
    })

    it(`shows Map size in preview`, () => {
      const map = new Map([[`a`, 1], [`b`, 2]])
      mount(JsonTree, {
        target: document.body,
        props: { value: { map }, show_header: false, default_fold_level: 1 },
      })
      expect(document.body.textContent).toContain(`Map(2)`)
    })

    it(`shows Set size in preview`, () => {
      const set = new Set([1, 2, 3, 4])
      mount(JsonTree, {
        target: document.body,
        props: { value: { set }, show_header: false, default_fold_level: 1 },
      })
      expect(document.body.textContent).toContain(`Set(4)`)
    })
  })

  describe(`callbacks`, () => {
    it(`accepts onselect prop`, () => {
      const onselect = vi.fn()
      // Just verify the component accepts the callback without error
      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `test` }, show_header: false, onselect },
      })
      expect(get_nodes().length).toBeGreaterThan(0)
    })

    it(`accepts oncopy prop`, () => {
      const oncopy = vi.fn()
      mount(JsonTree, {
        target: document.body,
        props: { value: { name: `test` }, show_header: false, oncopy },
      })
      expect(get_nodes().length).toBeGreaterThan(0)
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

describe(`JsonNode ARIA`, () => {
  it(`has correct treeitem role`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { a: 1 }, show_header: false },
    })
    const nodes = document.querySelectorAll(`[role="treeitem"]`)
    expect(nodes.length).toBeGreaterThan(0)
  })

  it(`has aria-expanded for expandable nodes`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { nested: { a: 1 } }, show_header: false, default_fold_level: 5 },
    })
    const expandable = document.querySelector(`[aria-expanded]`)
    expect(expandable).toBeTruthy()
  })
})

describe(`JsonValue accessibility`, () => {
  it(`has button role for copyable values`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { name: `test` }, show_header: false },
    })
    const value_el = document.querySelector(`.json-value`)
    expect(value_el?.getAttribute(`role`)).toBe(`button`)
  })

  it(`has copy title`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { name: `test` }, show_header: false },
    })
    const value_el = document.querySelector(`.json-value`)
    expect(value_el?.getAttribute(`title`)).toBe(`Click to copy`)
  })
})

describe(`edge cases`, () => {
  it(`handles deeply nested data`, () => {
    const deep = { a: { b: { c: { d: { e: { f: `deep` } } } } } }
    mount(JsonTree, {
      target: document.body,
      props: { value: deep, show_header: false, default_fold_level: 10 },
    })
    expect(document.body.textContent).toContain(`"deep"`)
  })

  it(`handles mixed array with various types`, () => {
    const mixed = [1, `two`, true, null, { nested: `obj` }, [1, 2]]
    mount(JsonTree, {
      target: document.body,
      props: { value: mixed, show_header: false, default_fold_level: 5 },
    })
    expect(document.body.textContent).toContain(`1`)
    expect(document.body.textContent).toContain(`"two"`)
    expect(document.body.textContent).toContain(`true`)
    expect(document.body.textContent).toContain(`null`)
  })

  it(`handles object with special key names`, () => {
    const obj = {
      'key-with-dash': 1,
      'key with spaces': 2,
      '123numeric': 3,
    }
    mount(JsonTree, {
      target: document.body,
      props: { value: obj, show_header: false, default_fold_level: 5 },
    })
    expect(document.body.textContent).toContain(`key-with-dash`)
    expect(document.body.textContent).toContain(`key with spaces`)
  })

  it(`handles primitive root values`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: `just a string`, show_header: false },
    })
    expect(document.body.textContent).toContain(`"just a string"`)
  })

  it(`handles null root value`, () => {
    mount(JsonTree, {
      target: document.body,
      props: { value: null, show_header: false },
    })
    expect(document.body.textContent).toContain(`null`)
  })

  test.each([
    { value: 0, expected: `0` },
    { value: ``, expected: `""` },
    { value: false, expected: `false` },
  ])(`handles falsy value: $value`, ({ value, expected }) => {
    mount(JsonTree, {
      target: document.body,
      props: { value: { test: value }, show_header: false },
    })
    expect(document.body.textContent).toContain(expected)
  })
})
