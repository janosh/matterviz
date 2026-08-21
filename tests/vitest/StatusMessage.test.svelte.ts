import { StatusMessage } from '$lib'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`StatusMessage`, () => {
  test.each([``, undefined])(`renders nothing when message is %j`, (message) => {
    mount(StatusMessage, { target: document.body, props: { message } })
    expect(document.querySelector(`.status-message`)).toBeNull()
  })

  test.each([
    { type: `info`, role: `status`, aria_live: `polite` },
    { type: `error`, role: `alert`, aria_live: `assertive` },
    { type: `warning`, role: `status`, aria_live: `polite` },
  ] as const)(
    `renders $type message with role=$role aria-live=$aria_live and forwarded attributes`,
    ({ type, role, aria_live }) => {
      mount(StatusMessage, {
        target: document.body,
        props: { message: `Test message`, type, id: `custom-id`, style: `margin-top: 20px` },
      })
      const message_div = doc_query(`.status-message.${type}`)
      expect(message_div.textContent?.trim()).toBe(`Test message`)
      expect(message_div.getAttribute(`role`)).toBe(role)
      expect(message_div.getAttribute(`aria-live`)).toBe(aria_live)
      expect(message_div.id).toBe(`custom-id`)
      expect(message_div.style.marginTop).toBe(`20px`)
      expect(message_div.querySelector(`button`)).toBeNull()
    },
  )

  test(`dismissible button clears the bound message`, () => {
    let message = $state<string | undefined>(`Test message`)
    mount(StatusMessage, {
      target: document.body,
      props: {
        get message() {
          return message
        },
        set message(new_message) {
          message = new_message
        },
        dismissible: true,
      },
    })
    const button = doc_query(`.status-message button[aria-label="Dismiss message"]`)
    expect(button.textContent?.trim()).toBe(`✕`)
    const current_message = () => message
    button.click()
    flushSync()
    expect(current_message()).toBeUndefined()
    expect(document.querySelector(`.status-message`)).toBeNull()
  })
})
