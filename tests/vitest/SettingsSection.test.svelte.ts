import { SettingsSection } from '$lib'
import { createRawSnippet, flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const snippet = (content: string) => createRawSnippet(() => ({ render: () => content }))
type SettingValues = Record<string, unknown>

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
    expect(Boolean(document.querySelector(`.reset-button`))).toBe(expect_reset)
  })
})
