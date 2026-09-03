import { FormulaFilter, type FormulaSearchMode } from '$lib/composition'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, doc_query, keydown, mouse } from '../setup'

describe(`FormulaFilter`, () => {
  const get_input = (): HTMLInputElement => doc_query(`input`)
  const get_filter = (): HTMLElement => doc_query(`.formula-filter`)
  const get_mode_btn = (): HTMLButtonElement => doc_query(`.mode-hint.clickable`)
  const MODE_HINTS: Record<FormulaSearchMode, string> = {
    elements: `has elements`,
    chemsys: `chemical system`,
    exact: `exact formula`,
  }

  const mount_filter = (props: Partial<ComponentProps<typeof FormulaFilter>>): void => {
    mount(FormulaFilter, {
      target: document.body,
      props: props as ComponentProps<typeof FormulaFilter>,
    })
  }
  // Mount with value and search_mode bound (as a page wiring URL params would) and settle
  const mount_bound = async (value: string, props: Record<string, unknown> = {}) => {
    const state: { value: string; search_mode: FormulaSearchMode } = $state({
      value,
      search_mode: `elements`,
    })
    mount(FormulaFilter, { target: document.body, props: bind_props(props, state) })
    await tick()
    return state
  }
  const fire_input = (event: Event): void => {
    get_input().dispatchEvent(event)
    flushSync()
  }
  const blur = () => fire_input(new Event(`blur`, { bubbles: true }))
  const press = (key: string) => fire_input(keydown(key))
  // No flush between typing and the commit: the value prop would sync back over the input
  const type_value = (value: string): void => {
    get_input().value = value
    get_input().dispatchEvent(new Event(`input`, { bubbles: true }))
  }
  // Type a raw value and commit it by blurring
  const submit_input = (raw_value: string): void => {
    type_value(raw_value)
    blur()
  }
  // Click the mode hint until on_change reports `mode` (at most one full cycle)
  const cycle_to = (on_change: Mock, mode: FormulaSearchMode): void => {
    for (let attempt = 0; attempt < 3; attempt++) {
      get_mode_btn().click()
      flushSync()
      if (on_change.mock.lastCall?.[1] === mode) return
    }
  }

  test(`renders with default props and initial value`, () => {
    mount_filter({ value: `` })
    expect(get_input()).toBeInstanceOf(HTMLElement)
    expect(get_input().getAttribute(`aria-label`)).toBe(`Formula filter`)

    document.body.innerHTML = ``
    mount_filter({ value: `Fe,O` })
    expect(get_input().value).toBe(`Fe,O`)
  })

  // Mode is inferred from the value on first render (e.g. URL params without search_mode),
  // written to the search_mode binding and shown as the hint; blur normalizes the value in
  // that mode (elements sorted alphabetically, wildcards appended). A '-' inside a range
  // constraint does not make the input a chemsys.
  test.each([
    [`Li,Fe`, `elements`, `Fe,Li`],
    [`Li,Fe:1-2`, `elements`, `Fe:1-2,Li`],
    [`Fe:1-2`, `elements`, `Fe:1-2`],
    [`Li,*,*`, `elements`, `Li,*,*`],
    [`*,O,Fe`, `elements`, `Fe,O,*`],
    [`Li-Fe-O`, `chemsys`, `Fe-Li-O`],
    [`Fe:1-2-Li`, `chemsys`, `Fe:1-2-Li`],
    [`Li-*-*`, `chemsys`, `Li-*-*`],
    [`Li-Fe-*`, `chemsys`, `Fe-Li-*`],
    [`Li-Fe-*-*`, `chemsys`, `Fe-Li-*-*`],
    [`*-*-O`, `chemsys`, `O-*-*`],
    [`*-*-Li-O`, `chemsys`, `Li-O-*-*`],
    [`*-Li-*-O-*`, `chemsys`, `Li-O-*-*-*`],
    [`LiFePO4`, `exact`, `FeLiO4P`],
    [`NaCl`, `exact`, `ClNa`],
    [`LiFe*2*`, `exact`, `FeLi*2*`],
    [`*2O3`, `exact`, `O3*2`],
    [`H0`, `exact`, `H0`], // zero amount formats to nothing; the text survives
    // invalid wildcard formula: kept verbatim, and the mode-hint preview must not throw
    [`Li*2x`, `exact`, `Li*2x`],
  ] as const)(
    `"%s" infers mode %s, shows its hint and normalizes to "%s" on blur`,
    async (input, mode, normalized) => {
      const on_change = vi.fn()
      const state = await mount_bound(input, { on_change })
      expect(state.search_mode).toBe(mode)
      // includes() since clickable mode hints have an icon child
      expect(doc_query(`.mode-hint`).textContent).toContain(MODE_HINTS[mode])
      blur()
      expect(on_change).toHaveBeenCalledWith(normalized, mode)
    },
  )

  test.each([
    [`Fe-Li`, `chemsys`, `Fe-Li`],
    [`*,Fe,Li,*`, `elements`, `Fe,Li,*,*`],
  ] as const)(`Enter normalizes "%s" like blur`, async (input, mode, normalized) => {
    const on_change = vi.fn()
    await mount_bound(input, { on_change })
    press(`Enter`)
    expect(on_change).toHaveBeenCalledWith(normalized, mode)
  })

  // Clicking the mode hint cycles exact -> elements -> chemsys -> exact, reformatting the
  // value (wildcards included) and updating the hint at every step
  test.each([
    [
      `LiFePO4`,
      [
        [`Fe,Li,O,P`, `elements`],
        [`Fe-Li-O-P`, `chemsys`],
        [`FeLiOP`, `exact`],
      ],
    ],
    [
      `Li-Fe-*-*`,
      [
        [`FeLi**`, `exact`],
        [`Fe,Li,*,*`, `elements`],
        [`Fe-Li-*-*`, `chemsys`],
      ],
    ],
  ] as const)(`mode hint clicks cycle "%s" through every mode`, async (start, steps) => {
    const on_change = vi.fn()
    await mount_bound(start, { on_change })
    for (const [value, mode] of steps) {
      get_mode_btn().click()
      flushSync()
      expect(on_change).toHaveBeenLastCalledWith(value, mode)
      expect(get_mode_btn().textContent).toContain(MODE_HINTS[mode])
    }
  })

  test.each([
    // LiFePO4 / Li-Fe-*-* -> every mode is covered by the cycling test above
    [`Li-Fe-O`, `elements`, `Fe,Li,O`],
    [`Li,Fe,O`, `chemsys`, `Fe-Li-O`],
    [`Fe,Li,O`, `exact`, `FeLiO`],
    [`Li,Fe,*,*`, `chemsys`, `Fe-Li-*-*`],
    [`Li,Fe,*,*`, `exact`, `FeLi**`],
    [`LiFe*2*`, `elements`, `Fe,Li,*,*`],
    [`LiFe*2*`, `chemsys`, `Fe-Li-*-*`],
  ] as const)(`reformats "%s" to %s mode as "%s"`, async (from, to_mode, expected) => {
    const on_change = vi.fn()
    await mount_bound(from, { on_change })
    cycle_to(on_change, to_mode)
    expect(on_change).toHaveBeenLastCalledWith(expected, to_mode)
  })

  test(`disabled state applies`, () => {
    mount_filter({ value: ``, disabled: true })
    expect(get_filter().classList.contains(`disabled`)).toBe(true)
    expect(get_input().disabled).toBe(true)
  })

  test.each([
    { value: `Fe`, show_clear_button: true, disabled: false, expected: true },
    { value: ``, show_clear_button: true, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: false, disabled: false, expected: false },
    { value: `Fe`, show_clear_button: true, disabled: true, expected: false },
  ])(`clear button visible=$expected`, (params) => {
    mount_filter(params)
    expect(Boolean(document.querySelector(`.clear-btn`))).toBe(params.expected)
  })

  test(`clears value on click or Escape`, () => {
    const on_change = vi.fn()
    const on_clear = vi.fn()
    mount_filter({ value: `Fe`, on_change, on_clear })

    // Click clear button
    doc_query<HTMLButtonElement>(`.clear-btn`).click()
    flushSync()
    expect(on_clear).toHaveBeenCalled()
    expect(on_change).toHaveBeenCalledWith(``, `elements`)

    // Reset for Escape test
    document.body.innerHTML = ``
    const onclear2 = vi.fn()
    mount_filter({ value: `Fe`, on_clear: onclear2 })
    press(`Escape`)
    expect(get_input().value).toBe(``)
    expect(onclear2).toHaveBeenCalled()
  })

  test(`clear button accessibility and input_element binding`, () => {
    mount_filter({ value: `Fe` })
    expect(doc_query(`.clear-btn`).getAttribute(`aria-label`)).toBe(`Clear filter`)
    expect(doc_query(`.clear-btn`).getAttribute(`title`)).toBe(`Clear (Escape)`)

    document.body.innerHTML = ``
    const state = $state({ input_element: null as HTMLInputElement | null })
    mount_filter(bind_props({ value: `` }, state))
    flushSync()
    expect(state.input_element).toBe(get_input())
  })

  test(`syncs external value changes and re-infers the mode`, async () => {
    const state = await mount_bound(`LiFePO4`)
    expect(get_input().value).toBe(`LiFePO4`)
    expect(state.search_mode).toBe(`exact`) // Initial inference

    // Parent updates the value prop (e.g. from a URL change) without search_mode
    state.value = `Fe,Li,O`
    await tick()
    expect(get_input().value).toBe(`Fe,Li,O`)
    expect(state.search_mode).toBe(`elements`) // re-inferred from the new value format
  })

  test.each([
    [`Li-Fe-O`, `chemsys`],
    [`LiFePO4`, `exact`],
    [`Li,Fe`, `elements`],
  ])(`search_mode binding updates to %s for typed input "%s"`, (input, expected_mode) => {
    const state: { search_mode: FormulaSearchMode } = $state({ search_mode: `elements` })
    mount_filter(bind_props({ value: `` }, state))
    submit_input(input)
    expect(state.search_mode).toBe(expected_mode)
  })

  test(`spreads additional attributes to wrapper`, () => {
    mount_filter({ value: ``, 'data-testid': `test` })
    expect(doc_query(`[data-testid="test"]`).classList.contains(`formula-filter`)).toBe(true)
  })

  test(`placeholders show wildcard examples`, async () => {
    const state = await mount_bound(``)
    expect(get_input().placeholder).toBe(`Li,Fe,O or Li,*,*`)

    state.search_mode = `chemsys`
    await tick()
    expect(get_input().placeholder).toBe(`Li-Fe-O or Li-*-*`)

    state.search_mode = `exact`
    await tick()
    expect(get_input().placeholder).toBe(`LiFePO4 or LiFe*2*`)
  })

  describe(`examples dropdown`, () => {
    const example_tags = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(`.example-tag`))
    const open_examples = () => {
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()
    }

    test.each([
      { show_examples: true, disabled: false, expected: true },
      { show_examples: false, disabled: false, expected: false },
      { show_examples: true, disabled: true, expected: false },
    ])(`help button visible=$expected`, (params) => {
      mount_filter({ value: ``, ...params })
      expect(Boolean(document.querySelector(`.help-btn`))).toBe(params.expected)
    })

    test(`toggles, lists wildcard examples and applies one on click`, () => {
      const on_change = vi.fn()
      mount_filter({ value: ``, on_change })
      const help_btn = doc_query<HTMLButtonElement>(`.help-btn`)

      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`false`)

      open_examples()
      expect(document.querySelector(`.examples-dropdown`)).toBeInstanceOf(HTMLElement)
      expect(help_btn.getAttribute(`aria-expanded`)).toBe(`true`)
      expect(document.querySelectorAll(`.example-category`)).toHaveLength(3)
      const examples_text = example_tags().map((tag) => tag.textContent)
      expect(examples_text).toHaveLength(9)
      for (const example of [`Li,*,*`, `Li-Fe-*-*`, `*-*-O`, `LiFe*2*`, `*2O3`]) {
        expect(examples_text).toContain(example)
      }

      example_tags()
        .find((tag) => tag.textContent === `Li-Fe-*-*`)
        ?.click()
      flushSync()
      expect(on_change).toHaveBeenCalledWith(`Li-Fe-*-*`, `chemsys`)
      expect(get_input().value).toBe(`Li-Fe-*-*`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
    })

    test(`Escape closes dropdown first, then clears value`, () => {
      const on_clear = vi.fn()
      mount_filter({ value: `Fe`, on_clear })
      open_examples()
      expect(document.querySelector(`.examples-dropdown`)).toBeInstanceOf(HTMLElement)

      // First Escape closes dropdown
      press(`Escape`)
      expect(document.querySelector(`.examples-dropdown`)).toBeNull()
      expect(get_input().value).toBe(`Fe`)
      expect(on_clear).not.toHaveBeenCalled()

      // Second Escape clears value
      press(`Escape`)
      expect(get_input().value).toBe(``)
      expect(on_clear).toHaveBeenCalled()
    })

    test(`supports custom examples prop and applies custom example`, () => {
      const on_change = vi.fn()
      mount_filter({
        value: ``,
        on_change,
        examples: [
          {
            label: `Custom`,
            description: `Custom example set`,
            examples: [`Co,Ni`, `Mn-Fe-O`],
          },
        ],
      })
      open_examples()
      const example_btn = example_tags().find((btn) => btn.textContent === `Co,Ni`)
      expect(example_btn).toBeDefined()
      example_btn?.click()
      flushSync()
      expect(on_change).toHaveBeenLastCalledWith(`Co,Ni`, `elements`)
    })
  })

  describe(`history dropdown`, () => {
    const HISTORY_KEY = `formula-filter-test-history`
    const focus_input = () => fire_input(new Event(`focus`, { bubbles: true }))
    const history_dropdown = () => document.querySelector(`.history-dropdown`)
    const history_items = () => document.querySelectorAll(`.history-item`)
    const history_values = () => document.querySelectorAll(`.history-value`)
    const remove_btns = () => document.querySelectorAll<HTMLButtonElement>(`.history-remove`)
    const get_stored = () => JSON.parse(localStorage.getItem(HISTORY_KEY) ?? `[]`) as string[]

    beforeEach(() => localStorage.removeItem(HISTORY_KEY))
    afterEach(() => localStorage.removeItem(HISTORY_KEY))

    function seed(entries: string[]): void {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
    }

    // Mount with history enabled and unique localStorage key
    const mount_with_history = (props: Record<string, unknown> = {}) =>
      mount_filter({ value: ``, history_key: HISTORY_KEY, max_history: 5, ...props })

    // Seed localStorage, mount, focus input — the most common setup
    function seed_mount_focus(entries: string[], props: Record<string, unknown> = {}) {
      seed(entries)
      mount_with_history(props)
      focus_input()
    }

    // Type a value and commit it with Enter
    const submit = (value: string): void => {
      type_value(value)
      press(`Enter`)
    }

    test(`loads prepopulated history, shows header and ARIA attributes`, () => {
      seed_mount_focus([`Fe,O`, `Li-Fe-O`, `LiFePO4`])
      // Dropdown structure
      expect(doc_query(`.history-header`).textContent?.trim()).toBe(`Recent`)
      expect(history_dropdown()?.getAttribute(`role`)).toBe(`listbox`)
      expect(history_dropdown()?.getAttribute(`aria-label`)).toBe(`Recent searches`)
      // Items rendered in order with correct roles
      const items = history_values()
      expect(items).toHaveLength(3)
      expect(items[0].textContent?.trim()).toBe(`Fe,O`)
      expect(items[1].textContent?.trim()).toBe(`Li-Fe-O`)
      expect(items[2].textContent?.trim()).toBe(`LiFePO4`)
      expect(items[0].getAttribute(`role`)).toBe(`option`)
    })

    // Without a reload the old key's entries get written back under the new one, and lowering
    // max_history never truncates the list already in memory
    test(`reloads history when history_key or max_history changes`, () => {
      const other_key = `${HISTORY_KEY}-other`
      onTestFinished(() => localStorage.removeItem(other_key))
      localStorage.setItem(other_key, JSON.stringify([`Na,Cl`]))
      seed([`Fe,O`, `Li,Na`, `O,Si`])
      const state = $state({ history_key: HISTORY_KEY, max_history: 5 })
      mount_filter(bind_props({ value: `` }, state))
      focus_input()
      const texts = () => [...history_values()].map((item) => item.textContent?.trim())
      expect(texts()).toHaveLength(3)
      state.max_history = 2
      flushSync()
      expect(texts()).toEqual([`Fe,O`, `Li,Na`])
      state.history_key = other_key
      flushSync()
      expect(texts()).toEqual([`Na,Cl`])
      // the old key is untouched: its entries were never rewritten under the new one
      expect(get_stored()).toEqual([`Fe,O`, `Li,Na`, `O,Si`])
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
      expect(history_values()).toHaveLength(1)
      expect(history_values()[0].textContent?.trim()).toBe(`Li,Na`)
    })

    test(`does not show dropdown on focus when history is empty`, () => {
      mount_with_history()
      focus_input()
      flushSync()
      expect(history_dropdown()).toBeNull()
    })

    test(`clicking a history item sets value and closes dropdown`, () => {
      const on_change = vi.fn()
      seed_mount_focus([`Fe,O`, `Li,Na`], { on_change })
      doc_query<HTMLButtonElement>(`.history-value`).dispatchEvent(mouse(`mousedown`))
      flushSync()
      expect(on_change).toHaveBeenCalledWith(`Fe,O`, `elements`)
      expect(history_dropdown()).toBeNull()
    })

    test(`remove button removes entry and updates localStorage`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      expect(history_items()).toHaveLength(3)
      remove_btns()[1].dispatchEvent(mouse(`mousedown`))
      flushSync()
      expect(history_values()).toHaveLength(2)
      expect(history_values()[0].textContent?.trim()).toBe(`Fe,O`)
      expect(history_values()[1].textContent?.trim()).toBe(`Si,O`)
      expect(get_stored()).toEqual([`Fe,O`, `Si,O`])
    })

    test(`removing item clamps focused index to prevent out-of-bounds Enter`, () => {
      const on_change = vi.fn()
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`], { on_change })
      // Navigate to last item (index 2)
      for (let step = 0; step < 3; step++) press(`ArrowDown`)
      flushSync()
      expect(history_items()[2].classList.contains(`focused`)).toBe(true)
      // Remove middle item — list shrinks from 3→2, focused_history_idx should clamp
      remove_btns()[1].dispatchEvent(mouse(`mousedown`))
      flushSync()
      // Enter selects the item the focus clamped onto (the new last one), not crash
      press(`Enter`)
      flushSync()
      expect(on_change).toHaveBeenLastCalledWith(`Si,O`, `elements`)
    })

    test(`removing last entry closes dropdown`, () => {
      seed_mount_focus([`Fe,O`])
      expect(history_dropdown()).toBeInstanceOf(HTMLElement)
      remove_btns()[0].dispatchEvent(mouse(`mousedown`))
      flushSync()
      expect(history_dropdown()).toBeNull()
    })

    test(`ArrowDown cycles through items, ArrowUp from no selection goes to last`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      // ArrowDown: -1 → 0 → 1
      press(`ArrowDown`)
      flushSync()
      expect(history_items()[0].classList.contains(`focused`)).toBe(true)
      press(`ArrowDown`)
      flushSync()
      expect(history_items()[1].classList.contains(`focused`)).toBe(true)
      // ArrowDown wraps: 1 → 2 → 0
      press(`ArrowDown`)
      press(`ArrowDown`)
      flushSync()
      expect(history_items()[0].classList.contains(`focused`)).toBe(true)

      // Reset: re-mount to test ArrowUp from no selection
      document.body.innerHTML = ``
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      press(`ArrowUp`)
      flushSync()
      expect(history_items()[2].classList.contains(`focused`)).toBe(true)
      expect(history_items()[0].classList.contains(`focused`)).toBe(false)
    })

    test(`Enter selects focused history item`, () => {
      const on_change = vi.fn()
      seed_mount_focus([`Fe,O`, `Li,Na`], { on_change })
      press(`ArrowDown`)
      press(`ArrowDown`)
      press(`Enter`)
      flushSync()
      expect(on_change).toHaveBeenCalledWith(`Li,Na`, `elements`)
    })

    test(`Escape closes history dropdown before clearing value`, () => {
      const on_clear = vi.fn()
      seed_mount_focus([`Fe,O`], { value: `Li`, on_clear })
      expect(history_dropdown()).toBeInstanceOf(HTMLElement)
      // First Escape closes history
      press(`Escape`)
      flushSync()
      expect(history_dropdown()).toBeNull()
      expect(get_input().value).toBe(`Li`)
      expect(on_clear).not.toHaveBeenCalled()
      // Second Escape clears value
      press(`Escape`)
      flushSync()
      expect(on_clear).toHaveBeenCalled()
    })

    test(`examples and history are mutually exclusive`, () => {
      seed_mount_focus([`Fe,O`], { show_examples: true })
      expect(history_dropdown()).toBeInstanceOf(HTMLElement)
      // Opening examples closes history
      doc_query<HTMLButtonElement>(`.help-btn`).click()
      flushSync()
      expect(history_dropdown()).toBeNull()
      expect(document.querySelector(`.examples-dropdown`)).toBeInstanceOf(HTMLElement)
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
      expect(history_values()).toHaveLength(1)
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

    test(`pins history entries and keeps pinned entries first`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      // Pin second entry
      document
        .querySelectorAll<HTMLButtonElement>(`.history-pin`)[1]
        .dispatchEvent(mouse(`mousedown`))
      flushSync()

      const values = Array.from(history_values()).map((item) => item.textContent?.trim())
      expect(values[0]).toBe(`Li,Na`)
    })

    test(`clear-all button clears dropdown and persisted history`, () => {
      seed_mount_focus([`Fe,O`, `Li,Na`, `Si,O`])
      doc_query<HTMLButtonElement>(`.history-clear-all`).dispatchEvent(mouse(`mousedown`))
      flushSync()
      expect(history_dropdown()).toBeNull()
      expect(localStorage.getItem(HISTORY_KEY)).toBe(JSON.stringify([]))
      expect(localStorage.getItem(`${HISTORY_KEY}-pins`)).toBe(JSON.stringify([]))
    })
  })

  describe(`extended features`, () => {
    test(`mode lock prevents automatic mode inference`, async () => {
      const state: { search_mode: FormulaSearchMode; mode_locked: boolean } = $state({
        search_mode: `elements`,
        mode_locked: true,
      })
      mount_filter(bind_props({ value: `Li-Fe-O` }, state))
      await tick()
      expect(state.search_mode).toBe(`elements`)
    })

    test(`on_parse emits structured token data`, () => {
      const on_parse = vi.fn()
      mount_filter({ value: ``, on_parse })
      submit_input(`+Li,-O`)

      // the committed value is the normalized one (explicit + dropped), tokenized per element
      const token = { constraint: null, is_wildcard: false, is_valid: true }
      expect(on_parse).toHaveBeenLastCalledWith({
        value: `Li,-O`,
        search_mode: `elements`,
        has_wildcards: false,
        is_valid: true,
        error_message: null,
        tokens: [
          { raw: `Li`, element: `Li`, operator: `include`, ...token },
          { raw: `-O`, element: `O`, operator: `exclude`, ...token },
        ],
      })
    })

    test(`custom validate hook controls validation message`, () => {
      const validate = vi.fn(() => ({
        state: `warning`,
        message: `custom warning`,
      }))
      mount_filter({
        value: `Li,Fe`,
        validate: validate as ComponentProps<typeof FormulaFilter>[`validate`],
      })
      flushSync()
      expect(document.querySelector(`.validation-message`)?.textContent).toContain(
        `custom warning`,
      )
    })

    test.each([
      [`Xx2`, `Invalid element symbol`],
      // unbalanced parentheses must neither hang nor escape input handling
      [`Ca(OH2`, `parentheses`],
      [`Fe(`, `parentheses`],
      [`Mg()O2`, `parentheses`],
    ])(`invalid exact formula %s emits invalid validation state`, (raw_input, msg_part) => {
      const on_validation = vi.fn()
      mount_filter({ value: ``, on_validation })
      submit_input(raw_input)
      expect(on_validation.mock.lastCall?.[0].state).toBe(`invalid`)
      expect(on_validation.mock.lastCall?.[0].message).toContain(msg_part)
      expect(doc_query(`.formula-filter`).classList.contains(`invalid`)).toBe(true)
    })

    test(`invalid non-exact tokens are not silently dropped on submit`, () => {
      const on_change = vi.fn()
      const on_validation = vi.fn()
      mount_filter({ value: ``, on_change, on_validation })
      submit_input(`Li,Xx`)
      expect(on_change).not.toHaveBeenCalled()
      const invalid_validation = on_validation.mock.calls
        .map(
          (call) =>
            call[0] as {
              state: string
              message: string | null
            },
        )
        .find((validation) => validation.state === `invalid`)
      expect(invalid_validation).toBeDefined()
      expect(invalid_validation?.message).toContain(`Invalid token`)
      const last_validation = on_validation.mock.calls[
        on_validation.mock.calls.length - 1
      ][0] as {
        state: string
        message: string | null
      }
      expect(last_validation.state).toBe(`valid`)
    })

    test.each([
      [`normalize_exact=false preserves order`, { normalize_exact: false }, `NaCl`, `NaCl`],
      [`unicode subscripts normalize`, {}, `Fe₂O₃`, `Fe2O3`],
      // deleting the hydrate dot in normalization would glue digits: CuSO45H2O
      [`hydrate dot survives normalization`, {}, `CuSO4·5H2O`, `CuH10O9S`],
      // an SI amount format would canonicalize to C1kH2k, which no longer parses
      [`large counts stay plain digits`, {}, `H2000C1000`, `C1000H2000`],
      [`wildcard amounts are merged and formatted`, {}, `*2Li0.1Li0.2*`, `Li0.3*2*`],
    ])(`exact mode: %s`, (_name, props, input, expected) => {
      const on_change = vi.fn()
      mount_filter({ value: ``, on_change, ...props })
      submit_input(input)
      expect(on_change).toHaveBeenLastCalledWith(expected, `exact`)
    })

    test(`mode hint click is ignored while mode is locked`, () => {
      const on_change = vi.fn()
      mount_filter({
        value: `Li,Fe`,
        mode_locked: true,
        on_change,
      })
      doc_query<HTMLButtonElement>(`.mode-hint.clickable`).click()
      flushSync()
      expect(on_change).not.toHaveBeenCalled()
      expect(doc_query(`.mode-hint.clickable`).classList.contains(`locked`)).toBe(true)
    })

    test(`lock button toggles mode_locked binding`, () => {
      const state = $state({ mode_locked: false })
      mount_filter(bind_props({ value: `Li,Fe` }, state))
      const lock_btn = doc_query<HTMLButtonElement>(`.lock-btn`)
      lock_btn.click()
      flushSync()
      expect(state.mode_locked).toBe(true)
      lock_btn.click()
      flushSync()
      expect(state.mode_locked).toBe(false)
    })

    test(`renders removable token chips for tokenized input`, () => {
      mount_filter({ value: `+Li,-O` })
      flushSync()
      const chips = document.querySelectorAll(`.token-chip`)
      expect(chips).toHaveLength(2)
      ;(chips[0] as HTMLButtonElement).click()
      flushSync()
      expect(document.querySelectorAll(`.token-chip`)).toHaveLength(1)
    })

    test(`removing one duplicate token chip only removes one instance`, () => {
      mount_filter({ value: `Li,Li` })
      flushSync()
      let chips = document.querySelectorAll(`.token-chip`)
      expect(chips).toHaveLength(2)
      ;(chips[0] as HTMLButtonElement).click()
      flushSync()
      chips = document.querySelectorAll(`.token-chip`)
      expect(chips).toHaveLength(1)
      expect(chips[0].textContent).toContain(`+Li`)
    })

    test(`normalizes and sorts constrained include/exclude token input`, () => {
      const on_change = vi.fn()
      mount_filter({ value: ``, on_change })
      submit_input(`-O,+Li,Fe:1-2,*`)
      expect(on_change).toHaveBeenLastCalledWith(`Fe:1-2,Li,*,-O`, `elements`)
    })

    test(`keeps chemsys ranges intact while tokenizing`, () => {
      const on_change = vi.fn()
      mount_filter({ value: ``, on_change, search_mode: `chemsys`, mode_locked: true })
      submit_input(`Fe:1-2-Li`)
      expect(on_change).toHaveBeenLastCalledWith(`Fe:1-2-Li`, `chemsys`)
    })
  })
})
