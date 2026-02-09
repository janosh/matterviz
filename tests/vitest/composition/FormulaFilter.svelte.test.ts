import { FormulaFilter } from '$lib/composition'
import { flushSync, mount, tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`FormulaFilter`, () => {
  const get_input = (): HTMLInputElement => doc_query(`input`)
  const get_filter = (): HTMLElement => doc_query(`.formula-filter`)

  test(`renders with default props and initial value`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `` } })
    expect(get_input()).toBeTruthy()
    expect(get_input().getAttribute(`aria-label`)).toBe(`Formula filter`)

    document.body.innerHTML = ``
    mount(FormulaFilter, { target: document.body, props: { value: `Fe,O` } })
    expect(get_input().value).toBe(`Fe,O`)
  })

  test.each([
    [`Li,Fe`, `has elements`],
    [`Li-Fe-O`, `chemical system`],
    [`LiFePO4`, `exact formula`],
  ])(`mode hint for "%s" shows "%s"`, async (input, expected_hint) => {
    let val = $state(input)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
      },
    })
    await tick()
    // Use includes() since clickable mode hints have an icon child
    expect(document.querySelector(`.mode-hint`)?.textContent).toContain(expected_hint)
  })

  test(`clicking mode hint cycles through modes and reformats input`, async () => {
    // Mode hint is always clickable and clicking it reformats the input
    const onchange = vi.fn()
    let val = $state(`LiFePO4`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
        onchange,
      },
    })
    await tick()

    const get_mode_btn = () =>
      document.querySelector<HTMLButtonElement>(`.mode-hint.clickable`)
    expect(get_mode_btn()).toBeTruthy()
    expect(get_mode_btn()?.textContent).toContain(`exact formula`)

    // Click to cycle: exact → elements (reformats to comma-separated)
    get_mode_btn()?.click()
    flushSync()
    expect(onchange).toHaveBeenLastCalledWith(`Fe,Li,O,P`, `elements`)
    expect(get_mode_btn()?.textContent).toContain(`has elements`)

    // Click again: elements → chemsys (reformats to dash-separated)
    get_mode_btn()?.click()
    flushSync()
    expect(onchange).toHaveBeenLastCalledWith(`Fe-Li-O-P`, `chemsys`)
    expect(get_mode_btn()?.textContent).toContain(`chemical system`)

    // Click again: chemsys → exact (reformats to concatenated)
    get_mode_btn()?.click()
    flushSync()
    expect(onchange).toHaveBeenLastCalledWith(`FeLiOP`, `exact`)
    expect(get_mode_btn()?.textContent).toContain(`exact formula`)
  })

  test.each([
    { from: `Li-Fe-O`, to_mode: `elements`, expected: `Fe,Li,O` },
    { from: `Li,Fe,O`, to_mode: `chemsys`, expected: `Fe-Li-O` },
    { from: `LiFePO4`, to_mode: `elements`, expected: `Fe,Li,O,P` },
    { from: `LiFePO4`, to_mode: `chemsys`, expected: `Fe-Li-O-P` },
    { from: `Fe,Li,O`, to_mode: `exact`, expected: `FeLiO` },
  ])(
    `reformats "$from" to "$expected" when cycling to $to_mode mode`,
    async ({ from, to_mode, expected }) => {
      const onchange = vi.fn()
      let val = $state(from)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()

      // Click until we reach the target mode
      const get_mode_btn = () =>
        document.querySelector<HTMLButtonElement>(`.mode-hint.clickable`)
      let attempts = 0
      while (attempts < 3) {
        get_mode_btn()?.click()
        flushSync()
        const last_call = onchange.mock.calls[onchange.mock.calls.length - 1]
        if (last_call[1] === to_mode) break
        attempts++
      }

      expect(onchange).toHaveBeenLastCalledWith(expected, to_mode)
    },
  )

  test.each([
    [`Li,Fe`, `elements`],
    [`Li-Fe-O`, `chemsys`],
    [`LiFePO4`, `exact`],
  ])(`infers mode "%s" from input "%s"`, async (input, expected_mode) => {
    const onchange = vi.fn()
    let val = $state(input)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
        onchange,
      },
    })
    await tick()
    get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
    flushSync()
    expect(onchange).toHaveBeenCalledWith(expect.any(String), expected_mode)
  })

  test(`disabled state applies`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: ``, disabled: true } })
    expect(get_filter().classList.contains(`disabled`)).toBe(true)
    expect(get_input().disabled).toBe(true)
  })

  test.each([
    { value: `Fe`, show_clear_button: true, disabled: false, expected: true },
    { value: ``, show_clear_button: true, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: false, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: true, disabled: true, expected: false },
  ])(`clear button visible=$expected`, (params) => {
    mount(FormulaFilter, { target: document.body, props: params })
    expect(!!document.querySelector(`.clear-btn`)).toBe(params.expected)
  })

  test(`clears value on click or Escape`, () => {
    const onchange = vi.fn()
    const onclear = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onchange, onclear },
    })

    // Click clear button
    doc_query<HTMLButtonElement>(`.clear-btn`).click()
    flushSync()
    expect(onclear).toHaveBeenCalled()
    expect(onchange).toHaveBeenCalledWith(``, `elements`)

    // Reset for Escape test
    document.body.innerHTML = ``
    const onclear2 = vi.fn()
    mount(FormulaFilter, {
      target: document.body,
      props: { value: `Fe`, onclear: onclear2 },
    })
    get_input().dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
    )
    flushSync()
    expect(get_input().value).toBe(``)
    expect(onclear2).toHaveBeenCalled()
  })

  test(`clear button accessibility and input_element binding`, () => {
    mount(FormulaFilter, { target: document.body, props: { value: `Fe` } })
    expect(doc_query(`.clear-btn`).getAttribute(`aria-label`)).toBe(`Clear filter`)
    expect(doc_query(`.clear-btn`).getAttribute(`title`)).toBe(`Clear (Escape)`)

    document.body.innerHTML = ``
    let bound: HTMLInputElement | null = null
    mount(FormulaFilter, {
      target: document.body,
      props: {
        value: ``,
        get input_element() {
          return bound
        },
        set input_element(val) {
          bound = val
        },
      },
    })
    flushSync()
    expect(bound).toBe(get_input())
  })

  test(`syncs external value changes`, async () => {
    let value = $state(``)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return value
        },
        set value(val: string) {
          value = val
        },
      },
    })
    await tick()
    expect(get_input().value).toBe(``)

    value = `Fe,O`
    await tick()
    expect(get_input().value).toBe(`Fe,O`)
  })

  test.each([
    { initial_value: `Li-Fe-O`, expected_mode: `chemsys` },
    { initial_value: `LiFePO4`, expected_mode: `exact` },
    { initial_value: `Li,Fe`, expected_mode: `elements` },
  ])(
    `infers mode=$expected_mode on first render from value="$initial_value" (e.g. URL params)`,
    async ({ initial_value, expected_mode }) => {
      // Regression test: when value is set from URL params without search_mode,
      // the component should infer the correct mode from the value format
      let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          value: initial_value,
          get search_mode() {
            return mode
          },
          set search_mode(val) {
            mode = val
          },
        },
      })
      await tick()
      expect(mode).toBe(expected_mode)
    },
  )

  test(`re-infers mode when value prop changes externally`, async () => {
    // When parent updates value prop without search_mode, mode should be re-inferred
    let value = $state(`LiFePO4`)
    let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return value
        },
        set value(val: string) {
          value = val
        },
        get search_mode() {
          return mode
        },
        set search_mode(val) {
          mode = val
        },
      },
    })
    await tick()
    expect(mode).toBe(`exact`) // Initial inference

    // Simulate parent updating value prop (e.g. from URL change)
    value = `Fe,Li,O`
    await tick()
    expect(mode).toBe(`elements`) // Should re-infer from new value format
  })

  test.each([
    [`Li-Fe-O`, `chemsys`],
    [`LiFePO4`, `exact`],
    [`Li,Fe`, `elements`],
  ])(`search_mode binding updates to %s for input "%s"`, (input, expected_mode) => {
    // Verifies that the search_mode bindable prop is synchronized when user enters input
    let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        value: ``,
        get search_mode() {
          return mode
        },
        set search_mode(val) {
          mode = val
        },
      },
    })
    get_input().value = input
    get_input().dispatchEvent(new Event(`input`, { bubbles: true }))
    get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
    flushSync()
    expect(mode).toBe(expected_mode)
  })

  test.each([
    // Alphabetical order: Fe before O, Fe before Li
    { input: `Fe,O`, expected: `Fe,O`, mode: `elements` },
    { input: `Fe-Li`, expected: `Fe-Li`, mode: `chemsys` },
    { input: `NaCl`, expected: `NaCl`, mode: `exact` },
  ])(
    `normalizes "$input" to "$expected" (mode=$mode)`,
    async ({ input, expected, mode }) => {
      const onchange = vi.fn()
      let val = $state(input)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()
      get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
      flushSync()
      expect(onchange).toHaveBeenCalledWith(expected, mode)
    },
  )

  test(`Enter key triggers normalization`, async () => {
    const onchange = vi.fn()
    let val = $state(`Fe-Li`)
    mount(FormulaFilter, {
      target: document.body,
      props: {
        get value() {
          return val
        },
        set value(v: string) {
          val = v
        },
        onchange,
      },
    })
    await tick()
    get_input().dispatchEvent(
      new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
    )
    flushSync()
    // Alphabetical order: Fe before Li
    expect(onchange).toHaveBeenCalledWith(`Fe-Li`, `chemsys`)
  })

  test(`spreads additional attributes to wrapper`, () => {
    mount(FormulaFilter, {
      target: document.body,
      props: { value: ``, 'data-testid': `test` },
    })
    expect(doc_query(`[data-testid="test"]`).classList.contains(`formula-filter`)).toBe(
      true,
    )
  })

  describe(`examples dropdown`, () => {
    test.each([
      { show_examples: true, disabled: false, expected: true },
      { show_examples: false, disabled: false, expected: false },
      { show_examples: true, disabled: true, expected: false },
    ])(`help button visible=$expected`, (params) => {
      mount(FormulaFilter, { target: document.body, props: { value: ``, ...params } })
      expect(!!document.querySelector(`.help-btn`)).toBe(params.expected)
    })

    test(`toggles, displays content, and applies example on click`, () => {
      const onchange = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: ``, onchange } })
      const help_btn = doc_query<HTMLButtonElement>(`.help-btn`)

      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`false`)

      help_btn.click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`true`)
      expect(document.querySelectorAll(`.example-category`).length).toBe(3)
      expect(document.querySelectorAll(`.example-tag`).length).toBe(9)

      // Apply example
      Array.from(document.querySelectorAll<HTMLButtonElement>(`.example-tag`))
        .find((tag) => tag.textContent === `Li-Fe-O`)
        ?.click()
      flushSync()
      expect(onchange).toHaveBeenCalledWith(`Li-Fe-O`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe-O`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`Escape closes dropdown first, then clears value`, () => {
      const onclear = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: `Fe`, onclear } })
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()

      // First Escape closes dropdown
      get_input().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
      )
      flushSync()
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(get_input().value).toBe(`Fe`)
      expect(onclear).not.toHaveBeenCalled()

      // Second Escape clears value
      get_input().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
      )
      flushSync()
      expect(get_input().value).toBe(``)
      expect(onclear).toHaveBeenCalled()
    })

    test(`examples include wildcard patterns and apply correctly`, () => {
      const onchange = vi.fn()
      mount(FormulaFilter, { target: document.body, props: { value: ``, onchange } })
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()

      const examples_text = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`.example-tag`),
      ).map((tag) => tag.textContent)

      // Verify wildcard examples are present
      for (const example of [`Li,*,*`, `Li-Fe-*-*`, `*-*-O`, `LiFe*2*`, `*2O3`]) {
        expect(examples_text).toContain(example)
      }

      // Apply a wildcard example
      Array.from(document.querySelectorAll<HTMLButtonElement>(`.example-tag`))
        .find((tag) => tag.textContent === `Li-Fe-*-*`)
        ?.click()
      flushSync()

      expect(onchange).toHaveBeenCalledWith(`Li-Fe-*-*`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe-*-*`)
    })
  })

  describe(`wildcard handling`, () => {
    test.each([
      [`Li,*,*`, `has elements`],
      [`Li-Fe-*-*`, `chemical system`],
      [`LiFe*2*`, `exact formula`],
      [`*-*-O`, `chemical system`],
      [`*2O3`, `exact formula`],
    ])(`mode hint for wildcard input "%s" shows "%s"`, async (input, expected_hint) => {
      let val = $state(input)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
        },
      })
      await tick()
      expect(document.querySelector(`.mode-hint`)?.textContent).toContain(expected_hint)
    })

    test.each([
      { input: `Li,*,*`, expected: `Li,*,*`, mode: `elements` },
      { input: `Li-Fe-*`, expected: `Fe-Li-*`, mode: `chemsys` },
      // Alphabetical order: Fe before O, Li before O
      { input: `*,O,Fe`, expected: `Fe,O,*`, mode: `elements` },
      { input: `*-*-Li-O`, expected: `Li-O-*-*`, mode: `chemsys` },
    ])(
      `normalizes wildcard input "$input" to "$expected" (mode=$mode)`,
      async ({ input, expected, mode }) => {
        const onchange = vi.fn()
        let val = $state(input)
        mount(FormulaFilter, {
          target: document.body,
          props: {
            get value() {
              return val
            },
            set value(v: string) {
              val = v
            },
            onchange,
          },
        })
        await tick()
        get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
        flushSync()
        expect(onchange).toHaveBeenCalledWith(expected, mode)
      },
    )

    test(`preserves wildcards when cycling through modes`, async () => {
      const onchange = vi.fn()
      let val = $state(`Li-Fe-*-*`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()

      const get_mode_btn = () =>
        document.querySelector<HTMLButtonElement>(`.mode-hint.clickable`)

      // Initial mode is chemsys
      expect(get_mode_btn()?.textContent).toContain(`chemical system`)

      // Cycle to exact - wildcards should be preserved
      get_mode_btn()?.click()
      flushSync()
      expect(onchange).toHaveBeenLastCalledWith(`FeLi**`, `exact`)

      // Cycle to elements - wildcards should be preserved
      get_mode_btn()?.click()
      flushSync()
      expect(onchange).toHaveBeenLastCalledWith(`Fe,Li,*,*`, `elements`)

      // Cycle back to chemsys - wildcards should be preserved
      get_mode_btn()?.click()
      flushSync()
      expect(onchange).toHaveBeenLastCalledWith(`Fe-Li-*-*`, `chemsys`)
    })

    test.each([
      { from: `Li,Fe,*,*`, to_mode: `chemsys`, expected: `Fe-Li-*-*` },
      { from: `Li,Fe,*,*`, to_mode: `exact`, expected: `FeLi**` },
      { from: `Li-Fe-*-*`, to_mode: `elements`, expected: `Fe,Li,*,*` },
      { from: `Li-Fe-*-*`, to_mode: `exact`, expected: `FeLi**` },
      { from: `LiFe*2*`, to_mode: `elements`, expected: `Fe,Li,*,*` },
      { from: `LiFe*2*`, to_mode: `chemsys`, expected: `Fe-Li-*-*` },
    ])(
      `reformats wildcard "$from" to "$expected" when cycling to $to_mode mode`,
      async ({ from, to_mode, expected }) => {
        const onchange = vi.fn()
        let val = $state(from)
        mount(FormulaFilter, {
          target: document.body,
          props: {
            get value() {
              return val
            },
            set value(v: string) {
              val = v
            },
            onchange,
          },
        })
        await tick()

        // Click until we reach the target mode
        const get_mode_btn = () =>
          document.querySelector<HTMLButtonElement>(`.mode-hint.clickable`)
        let attempts = 0
        while (attempts < 3) {
          get_mode_btn()?.click()
          flushSync()
          const last_call = onchange.mock.calls[onchange.mock.calls.length - 1]
          if (last_call[1] === to_mode) break
          attempts++
        }

        expect(onchange).toHaveBeenLastCalledWith(expected, to_mode)
      },
    )

    test(`placeholders show wildcard examples`, async () => {
      let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          value: ``,
          get search_mode() {
            return mode
          },
          set search_mode(val) {
            mode = val
          },
        },
      })
      await tick()

      expect(get_input().placeholder).toBe(`Li,Fe,O or Li,*,*`)

      mode = `chemsys`
      await tick()
      expect(get_input().placeholder).toBe(`Li-Fe-O or Li-*-*`)

      mode = `exact`
      await tick()
      expect(get_input().placeholder).toBe(`LiFePO4 or LiFe*2*`)
    })

    test.each([
      [`Li-*-*`, `chemsys`],
      [`Li,*,*`, `elements`],
      [`*2O3`, `exact`],
    ])(`infers mode=%s from wildcard URL param "%s"`, async (value, expected_mode) => {
      let mode = $state<`elements` | `chemsys` | `exact`>(`elements`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          value,
          get search_mode() {
            return mode
          },
          set search_mode(val) {
            mode = val
          },
        },
      })
      await tick()
      expect(mode).toBe(expected_mode)
    })

    test(`handles multiple wildcards with varied positions`, async () => {
      const onchange = vi.fn()
      let val = $state(`*-Li-*-O-*`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()
      get_input().dispatchEvent(new Event(`blur`, { bubbles: true }))
      flushSync()

      // Elements should be sorted, wildcards appended
      expect(onchange).toHaveBeenCalledWith(`Li-O-*-*-*`, `chemsys`)
    })

    test(`Enter key normalizes wildcard input`, async () => {
      const onchange = vi.fn()
      let val = $state(`*,Fe,Li,*`)
      mount(FormulaFilter, {
        target: document.body,
        props: {
          get value() {
            return val
          },
          set value(v: string) {
            val = v
          },
          onchange,
        },
      })
      await tick()
      get_input().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
      )
      flushSync()
      // Elements are sorted alphabetically, wildcards appended
      expect(onchange).toHaveBeenCalledWith(`Fe,Li,*,*`, `elements`)
    })
  })

  describe(`history dropdown`, () => {
    const HISTORY_KEY = `formula-filter-test-history`
    const keydown = (key: string) =>
      get_input().dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
    const focus_input = () =>
      get_input().dispatchEvent(new Event(`focus`, { bubbles: true }))
    const history_dropdown = () => document.querySelector(`.history-dropdown`)
    const history_items = () => document.querySelectorAll(`.history-item`)
    const history_values = () => document.querySelectorAll(`.history-value`)
    const remove_btns = () =>
      document.querySelectorAll<HTMLButtonElement>(`.history-remove`)
    const get_stored = () =>
      JSON.parse(localStorage.getItem(HISTORY_KEY) ?? `[]`) as string[]

    beforeEach(() => localStorage.removeItem(HISTORY_KEY))
    afterEach(() => localStorage.removeItem(HISTORY_KEY))

    function seed(entries: string[]): void {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
    }

    // Mount with history enabled and unique localStorage key
    function mount_with_history(props: Record<string, unknown> = {}) {
      return mount(FormulaFilter, {
        target: document.body,
        props: { value: ``, history_key: HISTORY_KEY, max_history: 5, ...props },
      })
    }

    // Seed localStorage, mount, focus input, flushSync — the most common setup
    function seed_mount_focus(entries: string[], props: Record<string, unknown> = {}) {
      seed(entries)
      mount_with_history(props)
      focus_input()
      flushSync()
    }

    function submit(value: string): void {
      get_input().value = value
      get_input().dispatchEvent(new Event(`input`, { bubbles: true }))
      keydown(`Enter`)
      flushSync()
    }

    test(`loads prepopulated history, shows header and ARIA attributes`, () => {
      seed_mount_focus([`Fe,O`, `Li-Fe-O`, `LiFePO4`])
      // Dropdown structure
      expect(doc_query(`.history-header`).textContent?.trim()).toBe(`Recent`)
      expect(history_dropdown()?.getAttribute(`role`)).toBe(`listbox`)
      expect(history_dropdown()?.getAttribute(`aria-label`)).toBe(`Recent searches`)
      // Items rendered in order with correct roles
      const items = history_values()
      expect(items.length).toBe(3)
      expect(items[0].textContent?.trim()).toBe(`Fe,O`)
      expect(items[1].textContent?.trim()).toBe(`Li-Fe-O`)
      expect(items[2].textContent?.trim()).toBe(`LiFePO4`)
      expect(items[0].getAttribute(`role`)).toBe(`option`)
    })

    test(`adds entries on submit and persists to localStorage`, () => {
      mount_with_history()
      submit(`Fe,O`)
      expect(get_stored()).toEqual([`Fe,O`])
    })

    test(`deduplicates: re-submitting moves value to top`, () => {
      // Pre-normalized values since sync_value normalizes on submit
      seed([`Fe,O`, `Li,Na`, `O,Si`])
      mount_with_history()
      submit(`Si,O`) // normalized to O,Si
      expect(get_stored()).toEqual([`O,Si`, `Fe,O`, `Li,Na`])
    })

    test(`caps history at max_history entries`, () => {
      seed([`a`, `b`, `c`])
      mount_with_history({ max_history: 3 })
      submit(`Fe,O`)
      expect(get_stored()).toEqual([`Fe,O`, `a`, `b`])
    })

    test(`max_history=0 disables history entirely`, () => {
      seed([`Fe,O`])
      mount_with_history({ max_history: 0 })
      focus_input()
      flushSync()
      expect(history_dropdown()).toBeNull()
      submit(`Li,Na`)
      // Original value unchanged — load_history returned [] so nothing was overwritten
      expect(localStorage.getItem(HISTORY_KEY)).toBe(JSON.stringify([`Fe,O`]))
    })

    test(`excludes current value from visible history`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`], { value: `Fe,O` })
      expect(history_values().length).toBe(1)
      expect(history_values()[0].textContent?.trim()).toBe(`Li,Na`)
    })

    test(`does not show dropdown on focus when history is empty`, () => {
      mount_with_history()
      focus_input()
      flushSync()
      expect(history_dropdown()).toBeNull()
    })

    test(`clicking a history item sets value and closes dropdown`, () => {
      const onchange = vi.fn()
      seed_mount_focus([`Fe,O`, `Li,Na`], { onchange })
      doc_query<HTMLButtonElement>(`.history-value`).dispatchEvent(
        new MouseEvent(`mousedown`, { bubbles: true }),
      )
      flushSync()
      expect(onchange).toHaveBeenCalledWith(`Fe,O`, `elements`)
      expect(history_dropdown()).toBeNull()
    })

    test(`remove button removes entry and updates localStorage`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      expect(history_items().length).toBe(3)
      remove_btns()[1].dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true }))
      flushSync()
      expect(history_values().length).toBe(2)
      expect(history_values()[0].textContent?.trim()).toBe(`Fe,O`)
      expect(history_values()[1].textContent?.trim()).toBe(`Si,O`)
      expect(get_stored()).toEqual([`Fe,O`, `Si,O`])
    })

    test(`removing item clamps focused index to prevent out-of-bounds Enter`, () => {
      const onchange = vi.fn()
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`], { onchange })
      // Navigate to last item (index 2)
      for (let step = 0; step < 3; step++) keydown(`ArrowDown`)
      flushSync()
      expect(history_items()[2].classList.contains(`focused`)).toBe(true)
      // Remove middle item — list shrinks from 3→2, focused_history_idx should clamp
      remove_btns()[1].dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true }))
      flushSync()
      // Enter should select the clamped item, not crash
      keydown(`Enter`)
      flushSync()
      expect(onchange).toHaveBeenCalled()
      expect([`Fe,O`, `Si,O`]).toContain(
        onchange.mock.calls[onchange.mock.calls.length - 1][0],
      )
    })

    test(`removing last entry closes dropdown`, () => {
      seed_mount_focus([`Fe,O`])
      expect(history_dropdown()).toBeTruthy()
      remove_btns()[0].dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true }))
      flushSync()
      expect(history_dropdown()).toBeNull()
    })

    test(`ArrowDown cycles through items, ArrowUp from no selection goes to last`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      // ArrowDown: -1 → 0 → 1
      keydown(`ArrowDown`)
      flushSync()
      expect(history_items()[0].classList.contains(`focused`)).toBe(true)
      keydown(`ArrowDown`)
      flushSync()
      expect(history_items()[1].classList.contains(`focused`)).toBe(true)
      // ArrowDown wraps: 1 → 2 → 0
      keydown(`ArrowDown`)
      keydown(`ArrowDown`)
      flushSync()
      expect(history_items()[0].classList.contains(`focused`)).toBe(true)

      // Reset: re-mount to test ArrowUp from no selection
      document.body.innerHTML = ``
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      keydown(`ArrowUp`)
      flushSync()
      expect(history_items()[2].classList.contains(`focused`)).toBe(true)
      expect(history_items()[0].classList.contains(`focused`)).toBe(false)
    })

    test(`Enter selects focused history item`, () => {
      const onchange = vi.fn()
      seed_mount_focus([`Fe,O`, `Li,Na`], { onchange })
      keydown(`ArrowDown`)
      keydown(`ArrowDown`)
      keydown(`Enter`)
      flushSync()
      expect(onchange).toHaveBeenCalledWith(`Li,Na`, `elements`)
    })

    test(`Escape closes history dropdown before clearing value`, () => {
      const onclear = vi.fn()
      seed_mount_focus([`Fe,O`], { value: `Li`, onclear })
      expect(history_dropdown()).toBeTruthy()
      // First Escape closes history
      keydown(`Escape`)
      flushSync()
      expect(history_dropdown()).toBeNull()
      expect(get_input().value).toBe(`Li`)
      expect(onclear).not.toHaveBeenCalled()
      // Second Escape clears value
      keydown(`Escape`)
      flushSync()
      expect(onclear).toHaveBeenCalled()
    })

    test(`examples and history are mutually exclusive`, () => {
      seed_mount_focus([`Fe,O`], { show_examples: true })
      expect(history_dropdown()).toBeTruthy()
      // Opening examples closes history
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()
      expect(history_dropdown()).toBeNull()
      expect(document.querySelector(`.examples-dropdown`)).toBeTruthy()
      // Focusing input while examples open does NOT open history
      focus_input()
      flushSync()
      expect(history_dropdown()).toBeNull()
    })

    test(`separate history_key props maintain independent histories`, () => {
      const key_a = `${HISTORY_KEY}-a`
      const key_b = `${HISTORY_KEY}-b`
      localStorage.setItem(key_a, JSON.stringify([`Fe,O`]))
      localStorage.setItem(key_b, JSON.stringify([`Li,Na`, `Si,O`]))
      mount(FormulaFilter, {
        target: document.body,
        props: { value: ``, history_key: key_a },
      })
      focus_input()
      flushSync()
      expect(history_values().length).toBe(1)
      expect(history_values()[0].textContent?.trim()).toBe(`Fe,O`)
      localStorage.removeItem(key_a)
      localStorage.removeItem(key_b)
    })

    test.each([
      { stored: `not valid json{{{`, desc: `invalid JSON` },
      { stored: `"just a string"`, desc: `string instead of array` },
      { stored: `42`, desc: `number instead of array` },
      { stored: `{"a":1}`, desc: `object instead of array` },
      { stored: `[1, 2, true, null]`, desc: `array of non-strings` },
    ])(`handles malformed localStorage ($desc)`, ({ stored }) => {
      localStorage.setItem(HISTORY_KEY, stored)
      mount_with_history()
      focus_input()
      flushSync()
      expect(history_dropdown()).toBeNull()
    })

    test(`empty string submissions are not added to history`, () => {
      mount_with_history()
      submit(`   `)
      expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    })
  })
})
