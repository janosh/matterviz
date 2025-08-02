import { SettingsSection } from '$lib'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
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
    expect(document.querySelector(`h4`)).toBeTruthy()
    expect(doc_query(`h4`).textContent?.trim()).toBe(`Test Section`)
    expect(doc_query(`section`).textContent?.trim()).toBe(``)
  })

  test(`does not show reset button when values are unchanged from initial state`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: { ...base_props, children: () => `Test content` },
    })
    expect(document.querySelector(`button`)).toBeNull()
  })

  test(`passes through additional props to section element`, () => {
    mount(SettingsSection, {
      target: document.body,
      props: {
        ...base_props,
        children: () => `Test content`,
        class: `custom-class`,
        'data-testid': `test-section`,
      },
    })

    const section = document.querySelector(`section`)
    expect(section?.className).toContain(`custom-class`)
    expect(section?.getAttribute(`data-testid`)).toBe(`test-section`)
  })
})
