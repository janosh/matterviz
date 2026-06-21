import { SettingsSection } from '$lib'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

const snippet = (content: string) => createRawSnippet(() => ({ render: () => content }))

describe(`SettingsSection`, () => {
  const base_props = {
    title: `Test Section`,
    current_values: { setting1: `default1`, setting2: 42, setting3: true },
  }

  test(`renders title correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, children: snippet(`Test content`) },
    })
    expect(doc_query(`h4`).textContent?.trim()).toBe(`Test Section`)
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

  test(`title is required and h4 is always present`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, children: snippet(`Test content`) },
    })
    // h4 should always be present since title is required
    expect(doc_query(`h4`).textContent?.trim()).toBe(`Test Section`)
    expect(doc_query(`section`).textContent?.trim()).toBe(`Test content`)
  })

  test(`does not show reset button initially when values match reference`, () => {
    // Test that reset button is not shown initially since reference_values = current_values
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: `value` },
        on_reset: vi.fn(),
        children: snippet(`Settings content`),
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeNull()
  })

  test(`handles array comparison correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: [`a`, `b`, `c`] },
        on_reset: vi.fn(),
        children: snippet(`Settings content`),
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeNull() // No changes initially
  })

  test(`handles nested object arrays correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: [{ key: `value1` }, { key: `value2` }] },
        on_reset: vi.fn(),
        children: snippet(`Settings content`),
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeNull() // No changes initially
  })

  test(`handles undefined/null comparisons correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: undefined, setting2: null },
        on_reset: vi.fn(),
        children: snippet(`Settings content`),
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeNull() // No changes detected
  })

  test(`handles empty arrays correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: [] },
        on_reset: vi.fn(),
        children: snippet(`Settings content`),
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeNull() // No changes initially
  })
})
