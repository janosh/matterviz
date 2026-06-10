import { FullscreenButton } from '$lib/layout'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`FullscreenButton`, () => {
  test.each([
    [false, `Enter fullscreen`],
    [true, `Exit fullscreen`],
  ])(
    `fullscreen=%s renders title/aria-pressed and forwards rest props`,
    (fullscreen, title) => {
      document.body.innerHTML = ``
      mount(FullscreenButton, {
        target: document.body,
        props: { fullscreen, class: `my-fs-btn`, [`aria-label`]: title },
      })
      const button = doc_query<HTMLButtonElement>(`button.my-fs-btn`)
      // built-in stable styling hook, merged with the consumer-passed class
      expect(button.classList.contains(`fullscreen-btn`)).toBe(true)
      expect(button.title).toBe(title)
      expect(button.getAttribute(`aria-pressed`)).toBe(String(fullscreen))
      expect(button.getAttribute(`aria-label`)).toBe(title)
      expect(button.querySelector(`svg`)).not.toBeNull() // default Icon content
    },
  )
})
