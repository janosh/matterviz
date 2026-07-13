import { SettingsSection } from '$lib'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

const snippet = (content: string) => createRawSnippet(() => ({ render: () => content }))

describe(`SettingsSection`, () => {
  const base_props = {
    title: `Test Section`,
    current_values: { setting1: `default1`, setting2: 42, setting3: true },
  }

  test(`renders title in h4 and children in section`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, children: snippet(`Test content`) },
    })
    expect(doc_query(`h4`).textContent?.trim()).toBe(`Test Section`)
    expect(doc_query(`section`).textContent?.trim()).toBe(`Test content`)
  })

  test(`generates a unique title id so aria-labelledby stays valid across instances`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, title: `Section A`, children: snippet(`A`) },
    })
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, title: `Section B`, children: snippet(`B`) },
    })
    const [h4_a, h4_b] = [...document.querySelectorAll(`h4`)]
    const [sec_a, sec_b] = [...document.querySelectorAll(`section`)]
    // ids are non-empty, unique, and each section points at its own heading
    // (boolean assertion is oxlint-stable; --fix rewrites toBeTruthy() -> toBe(true))
    expect(h4_a.id.startsWith(`settings-section-title-`)).toBe(true)
    expect(h4_a.id).not.toBe(h4_b.id)
    expect(sec_a.getAttribute(`aria-labelledby`)).toBe(h4_a.id)
    expect(sec_b.getAttribute(`aria-labelledby`)).toBe(h4_b.id)
  })

  test.each([
    [`primitives`, { setting1: `value` }],
    [`arrays`, { setting1: [`a`, `b`, `c`] }],
    [`nested object arrays`, { setting1: [{ key: `value1` }, { key: `value2` }] }],
    [`undefined/null values`, { setting1: undefined, setting2: null }],
    [`empty arrays`, { setting1: [] }],
  ])(
    `hides reset button when %s match reference values`,
    (_desc: string, current_values: Record<string, unknown>) => {
      mount(SettingsSection, {
        target: document.body,
        props: { title: `Test Settings`, current_values, children: snippet(`content`) },
      })
      expect(document.querySelector(`.reset-button`)).toBeNull()
    },
  )
})
