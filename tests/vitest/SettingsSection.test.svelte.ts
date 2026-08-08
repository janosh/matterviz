import { SettingsSection } from '$lib'
import { createRawSnippet, flushSync, mount, tick } from 'svelte'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { describe, expect, test } from 'vitest'
import SettingsSectionRerenderHarness from './SettingsSectionRerenderHarness.svelte'

const snippet = (content: string) => createRawSnippet(() => ({ render: () => content }))
type SettingValues = Record<string, unknown>
const element = (selector: string, root: ParentNode = document): HTMLElement => {
  const match = root.querySelector<HTMLElement>(selector)
  if (!match) throw new Error(`Missing element: ${selector}`)
  return match
}
const click = async (selector: string, root: ParentNode = document): Promise<void> => {
  const button = element(selector, root)
  button.click()
  await tick()
}
const restore_key = (
  values: SettingValues,
  key: string,
  value: unknown,
  present: boolean,
): SettingValues =>
  present
    ? { ...values, [key]: value }
    : Object.fromEntries(Object.entries(values).filter(([entry_key]) => entry_key !== key))

describe(`SettingsSection`, () => {
  test(`renders content with unique aria-labelledby targets`, () => {
    for (const [title, content] of [
      [`Section A`, `Content A`],
      [`Section B`, `Content B`],
    ]) {
      mount(SettingsSection, {
        target: document.body,
        props: { title, current_values: {}, children: snippet(content) },
      })
    }
    const [heading_a, heading_b] = [...document.querySelectorAll(`h4`)]
    const [section_a, section_b] = [...document.querySelectorAll(`section`)]
    expect([heading_a.textContent?.trim(), heading_b.textContent?.trim()]).toEqual([
      `Section A`,
      `Section B`,
    ])
    expect([section_a.textContent?.trim(), section_b.textContent?.trim()]).toEqual([
      `Content A`,
      `Content B`,
    ])
    // ids are non-empty, unique, and each section points at its own heading
    // (boolean assertion is oxlint-stable; --fix rewrites toBeTruthy() -> toBe(true))
    expect(heading_a.id.startsWith(`settings-section-title-`)).toBe(true)
    expect(heading_a.id).not.toBe(heading_b.id)
    expect(section_a.getAttribute(`aria-labelledby`)).toBe(heading_a.id)
    expect(section_b.getAttribute(`aria-labelledby`)).toBe(heading_b.id)
  })

  const reset_cases: [string, SettingValues, SettingValues, boolean][] = [
    [`equal arrays`, { setting1: [`a`, `b`] }, { setting1: [`a`, `b`] }, false],
    [`equal nested arrays`, { setting1: [{ key: 1 }] }, { setting1: [{ key: 1 }] }, false],
    [`equal empty arrays`, { setting1: [] }, { setting1: [] }, false],
    [
      `equal nullish values`,
      { setting1: undefined, setting2: null },
      { setting1: undefined, setting2: null },
      false,
    ],
    [`primitive change`, { setting1: `default` }, { setting1: `changed` }, true],
    [
      `object key insertion order`,
      { setting1: { a: 1, b: 2 } },
      { setting1: { b: 2, a: 1 } },
      false,
    ],
    [`nested change`, { setting1: { a: 1 } }, { setting1: { a: 2 } }, true],
    [
      `equal dates`,
      { setting1: new Date(`2026-01-01`) },
      { setting1: new Date(`2026-01-01`) },
      false,
    ],
    [
      `date change`,
      { setting1: new Date(`2026-01-01`) },
      { setting1: new Date(`2026-01-02`) },
      true,
    ],
    [`equal regexps`, { setting1: /test/gi }, { setting1: /test/gi }, false],
    [`regexp change`, { setting1: /test/gi }, { setting1: /test/g }, true],
    [`negative zero`, { setting1: 0 }, { setting1: -0 }, false],
    [`key addition`, { setting1: `a` }, { setting1: `a`, setting2: undefined }, true],
    [`key removal`, { setting1: `a`, setting2: undefined }, { setting1: `a` }, true],
  ]

  test.each(reset_cases)(`reset button after %s`, (_name, initial, next, expect_reset) => {
    let current_values = $state<SettingValues>({ ...initial })
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        get current_values() {
          return current_values
        },
        children: snippet(`content`),
      },
    })
    expect(document.querySelector(`.reset-button`)).toBeNull()

    flushSync(() => {
      current_values = { ...next }
    })
    const reset_button = document.querySelector<HTMLButtonElement>(`.reset-button`)
    expect(Boolean(reset_button)).toBe(expect_reset)
    if (expect_reset) expect(reset_button?.type).toBe(`button`)
  })

  test.each([
    [`Set`, new SvelteSet([`a`]), `must not contain Set or Map`],
    [`Map`, new SvelteMap([[`key`, `value`]]), `must not contain Set or Map`],
    [`custom-prototype`, Object.create({ inherited: true }), `must be plain objects`],
  ])(`rejects %s-valued settings`, (_name, value, message) => {
    expect(() =>
      mount(SettingsSection, {
        target: document.body,
        props: {
          title: `Unsupported`,
          current_values: { value },
          children: snippet(`content`),
        },
      }),
    ).toThrow(message)
  })

  test.each([
    {
      name: `existing key`,
      initial: { radius: 1, palette: { colors: [`red`, `blue`] } },
      change: { radius: 2 },
      key: `radius`,
      reference_value: 1,
      reference_present: true,
    },
    {
      name: `new key`,
      initial: { radius: 1 },
      change: { temporary: undefined },
      key: `temporary`,
      reference_value: undefined,
      reference_present: false,
    },
  ])(`resets $name to its mounted state`, async (test_case) => {
    const { initial, change, key, reference_value, reference_present } = test_case
    let current_values = $state<SettingValues>({ ...initial })
    const read_current_values = (): SettingValues => current_values
    const reset_calls: [string, unknown, boolean][] = []
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Atoms`,
        get current_values() {
          return current_values
        },
        children: snippet(`
          <div>
            <label data-key="radius"><span>Radius</span><input></label>
            <label data-key="palette"><span>Palette</span><select></select></label>
            <label data-key="temporary"><span>Temporary</span><input></label>
          </div>
        `),
        on_reset_key: (reset_key: string, value: unknown, present: boolean) => {
          reset_calls.push([reset_key, value, present])
          current_values = restore_key(current_values, reset_key, value, present)
        },
      },
    })

    flushSync(() => {
      current_values = { ...current_values, ...change }
    })
    await tick()
    const reset_buttons = document.querySelectorAll(`.setting-reset-button`)
    expect(reset_buttons).toHaveLength(1)
    const reset_button = document.querySelector<HTMLButtonElement>(
      `[data-key="${key}"] .setting-reset-button`,
    )
    expect(reset_button?.getAttribute(`aria-label`)).toBe(`Reset ${key} to default`)
    await click(`[data-key="${key}"] .setting-reset-button`)

    expect(reset_calls).toEqual([[key, reference_value, reference_present]])
    expect(Object.hasOwn(read_current_values(), key)).toBe(reference_present)
    if (reference_present) expect(read_current_values()[key]).toEqual(reference_value)
    expect(document.querySelector(`.setting-reset-button`)).toBeNull()
    expect(document.querySelector(`.reset-button`)).toBeNull()
  })

  test(`section reset without on_reset replays on_reset_key until nothing is changed`, async () => {
    let current_values = $state<SettingValues>({ radius: 1, palette: `warm` })
    const read_current_values = (): SettingValues => current_values
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Atoms`,
        get current_values() {
          return current_values
        },
        children: snippet(`
          <div>
            <label data-key="radius"><span>Radius</span><input></label>
            <label data-key="palette"><span>Palette</span><select></select></label>
          </div>
        `),
        on_reset_key: (key: string, value: unknown, present: boolean) =>
          (current_values = restore_key(current_values, key, value, present)),
      },
    })

    flushSync(() => {
      current_values = { radius: 5, palette: `cool`, extra: true }
    })
    await tick()
    // `extra` has no row of its own, so only the two rendered rows get a per-row button
    expect(document.querySelectorAll(`.setting-reset-button`)).toHaveLength(2)

    await click(`.reset-button`)
    // has_changes drives both indicators, so the section button clearing itself is the invariant
    expect(document.querySelector(`.reset-button`)).toBeNull()
    expect(document.querySelector(`.setting-reset-button`)).toBeNull()
    expect(read_current_values()).toEqual({ radius: 1, palette: `warm` })
  })

  test(`names unlabelled row controls and leaves author-named ones alone`, async () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Atoms`,
        current_values: { radius: 1 },
        setting_metadata: { radius: `Radius of rendered atoms` },
        children: snippet(`
          <label data-key="radius">
            <span>Radius</span>
            <input type="number">
            <input type="range">
            <input type="text" aria-label="Author named">
            <select aria-labelledby="somewhere-else"></select>
          </label>
        `),
      },
    })
    await tick()

    expect(
      [...document.querySelectorAll(`input, select`)].map((control) => [
        control.getAttribute(`aria-label`),
        control.getAttribute(`data-auto-label`),
      ]),
    ).toEqual([
      [`Radius`, `Radius`],
      [`Radius`, `Radius`],
      [`Author named`, null],
      [null, null],
    ])
  })

  test(`reveals mapped row descriptions with an accessible section toggle`, async () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Pointer sensitivity`,
        current_values: { rotate_speed: 1, rotation_damping: 0.1 },
        setting_metadata: {
          rotate_speed: { description: `Pointer rotation speed` },
          rotation_damping: { description: `Motion inertia after releasing the pointer` },
        },
        children: snippet(`
          <div>
            <label data-key="rotate_speed"><span>Rotate speed</span><input></label>
            <label data-key="rotation_damping"><span>Damping</span><input></label>
          </div>
        `),
      },
    })
    await tick()

    const toggle = element(`.description-toggle`)
    expect(toggle.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(document.querySelectorAll(`.settings-row-description`)).toHaveLength(0)
    expect(
      document
        .querySelector(`[data-key="rotation_damping"]`)
        ?.getAttribute(`data-description`),
    ).toBe(`Motion inertia after releasing the pointer`)

    await click(`.description-toggle`)
    expect(toggle.getAttribute(`aria-expanded`)).toBe(`true`)
    expect(
      [...document.querySelectorAll(`.settings-row-description`)].map(
        (description) => description.textContent,
      ),
    ).toEqual([`Pointer rotation speed`, `Motion inertia after releasing the pointer`])

    await click(`.description-toggle`)
    expect(document.querySelectorAll(`.settings-row-description`)).toHaveLength(0)
  })

  test(`reveals caller-supplied row descriptions`, async () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Atoms`,
        setting_metadata: {},
        children: snippet(
          `<label data-key="radius" data-description="Radius of rendered atoms"><span>Radius</span><input></label>`,
        ),
      },
    })
    await tick()

    expect(document.querySelector(`.description-toggle`)).not.toBeNull()
  })

  test(`only offers descriptions mapped to rows in this section`, async () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Atoms`,
        current_values: { radius: 1 },
        setting_metadata: { unrelated: `Not rendered here` },
        children: snippet(`<label data-key="radius"><span>Radius</span><input></label>`),
      },
    })
    await tick()
    // Prove the connected row was enhanced before checking that unrelated metadata is ignored.
    expect(element(`input`).getAttribute(`data-auto-label`)).toBe(`Radius`)
    expect(document.querySelector(`.description-toggle`)).toBeNull()
  })

  const rerender_row = (): HTMLElement => element(`[data-generation]`)
  const expect_enhanced_row = (description: string): void => {
    const row = rerender_row()
    expect(row.querySelector(`input`)?.getAttribute(`data-auto-label`)).toBe(`Radius`)
    expect(row.querySelector(`.settings-row-description`)?.textContent).toBe(description)
    expect(row.querySelectorAll(`.setting-reset-button`)).toHaveLength(1)
  }

  test(`enhances a replacement control nested in an existing row`, async () => {
    mount(SettingsSectionRerenderHarness, { target: document.body })
    await click(`[data-testid="change-dimensions"]`)
    const reset_button = element(`.setting-reset-button`, rerender_row())
    reset_button.focus()
    const palette = element(`select`)
    if (!(palette instanceof HTMLSelectElement)) throw new Error(`Palette select is missing`)
    palette.value = `cool`
    palette.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(document.activeElement).toBe(reset_button)
    const previous_input = element(`input`, rerender_row())

    await click(`[data-testid="replace-input"]`)
    expect(element(`input`, rerender_row())).not.toBe(previous_input)
    expect_enhanced_row(`Radius of rendered atoms`)
  })

  test(`refreshes dynamic keys and cleans up a remounted row`, async () => {
    mount(SettingsSectionRerenderHarness, { target: document.body })
    await click(`[data-testid="change-dimensions"]`)
    await click(`[data-testid="change-key"]`)

    expect(rerender_row().dataset.key).toBe(`diameter`)
    expect(element(`.setting-reset-button`, rerender_row()).getAttribute(`aria-label`)).toBe(
      `Reset diameter to default`,
    )
    expect_enhanced_row(`Diameter of rendered atoms`)
    await click(`.setting-reset-button`, rerender_row())
    expect(rerender_row().querySelector(`.setting-reset-button`)).toBeNull()
    expect(document.querySelector(`.reset-button`)).not.toBeNull()

    await click(`[data-testid="change-key"]`)
    const previous_row = rerender_row()
    const previous_input = element(`input`, previous_row)
    await click(`[data-testid="replace-row"]`)

    expect(rerender_row()).not.toBe(previous_row)
    expect(previous_row.querySelector(`.settings-row-description`)).toBeNull()
    expect(previous_row.querySelector(`.setting-reset-button`)).toBeNull()
    expect([
      previous_input.getAttribute(`aria-label`),
      previous_input.getAttribute(`data-auto-label`),
    ]).toEqual([null, null])
    expect_enhanced_row(`Radius of rendered atoms`)
  })
})
