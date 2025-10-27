import { StatusMessage } from '$lib'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`StatusMessage`, () => {
  test.each([``, undefined, null])(
    `renders nothing when message is $message`,
    (message) => {
      mount(StatusMessage, { target: document.body, props: { message } })
      expect(document.querySelector(`.message`)).toBeFalsy()
    },
  )

  test.each(
    [
      { type: `info`, role: `status`, aria_live: `polite` },
      { type: `error`, role: `alert`, aria_live: `assertive` },
      { type: `warning`, role: `status`, aria_live: `polite` },
    ] as const,
  )(`renders $type message with correct ARIA attributes`, ({ type, role, aria_live }) => {
    mount(StatusMessage, {
      target: document.body,
      props: { message: `Test message`, type },
    })

    const message_div = doc_query(`.message`)
    expect(message_div.textContent?.trim()).toBe(`Test message`)
    expect(message_div.getAttribute(`role`)).toBe(role)
    expect(message_div.getAttribute(`aria-live`)).toBe(aria_live)
  })

  test(`dismissible button renders and clears message when clicked`, () => {
    mount(StatusMessage, {
      target: document.body,
      props: { message: `Test message`, dismissible: false },
    })
    expect(document.querySelector(`.message button`)).toBeFalsy()

    document.body.innerHTML = ``
    mount(StatusMessage, {
      target: document.body,
      props: { message: `Test message`, dismissible: true },
    })

    const button = doc_query(`.message button`)
    expect(button.textContent?.trim()).toBe(`Dismiss`)
    expect(button.getAttribute(`aria-label`)).toBe(`Dismiss message`)

    button.click()
    flushSync()
    expect(document.querySelector(`.message`)).toBeFalsy()
  })

  test(`passes through custom HTML attributes and styles`, () => {
    mount(StatusMessage, {
      target: document.body,
      props: {
        message: `Test message`,
        id: `custom-id`,
        'data-testid': `test-message`,
        style: `margin-top: 20px`,
      },
    })

    const message_div = doc_query(`.message`)
    expect(message_div.id).toBe(`custom-id`)
    expect(message_div.getAttribute(`data-testid`)).toBe(`test-message`)
    expect(message_div.style.marginTop).toBe(`20px`)
  })
})
