import { SettingsSection } from '$lib'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

describe(`SettingsSection`, () => {
  const base_props = {
    title: `Test Section`,
    current_values: { setting1: `default1`, setting2: 42, setting3: true },
  }

  test(`renders title correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, children: () => `Test content` },
    })
    expect(doc_query(`h4`).textContent?.trim()).toBe(`Test Section`)
  })

  test(`title is required and h4 is always present`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, children: () => `Test content` },
    })
    // h4 should always be present since title is required
    expect(doc_query(`h4`).textContent?.trim()).toBe(`Test Section`)
    expect(doc_query(`section`).textContent?.trim()).toBe(``)
  })

  test(`does not show reset button initially when values match reference`, () => {
    // Test that reset button is not shown initially since reference_values = current_values
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: `value` },
        on_reset: vi.fn(),
        children: () => `Settings content`,
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeFalsy()
  })

  test(`handles array comparison correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: [`a`, `b`, `c`] },
        on_reset: vi.fn(),
        children: () => `Settings content`,
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeFalsy() // No changes initially
  })

  test(`handles nested object arrays correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: [{ key: `value1` }, { key: `value2` }] },
        on_reset: vi.fn(),
        children: () => `Settings content`,
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeFalsy() // No changes initially
  })

  test(`handles undefined/null comparisons correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: undefined, setting2: null },
        on_reset: vi.fn(),
        children: () => `Settings content`,
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeFalsy() // No changes detected
  })

  test(`handles empty arrays correctly`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        title: `Test Settings`,
        current_values: { setting1: [] },
        on_reset: vi.fn(),
        children: () => `Settings content`,
      },
    })

    const reset_button = document.querySelector(`.reset-button`)
    expect(reset_button).toBeFalsy() // No changes initially
  })
})
