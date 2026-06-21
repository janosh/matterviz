import { FullscreenButton } from '$lib/layout'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`FullscreenButton`, () => {
  test.each([
    [false, `Enter fullscreen`],
    [true, `Exit fullscreen`],
  ])(
    `fullscreen=%s: title, aria-pressed, default+override aria-label, class merge`,
    (fullscreen, label) => {
      // no aria-label passed -> defaults to the title text
      document.body.innerHTML = ``
      mount(FullscreenButton, { target: document.body, props: { fullscreen } })
      const btn = doc_query<HTMLButtonElement>(`button.fullscreen-btn`)
      expect(btn.title).toBe(label)
      expect(btn.getAttribute(`aria-pressed`)).toBe(String(fullscreen))
      expect(btn.getAttribute(`aria-label`)).toBe(label) // default
      expect(btn.querySelector(`svg`)).not.toBeNull() // default Icon content

      // caller class merges with the built-in styling hook; caller aria-label wins (spread order)
      document.body.innerHTML = ``
      mount(FullscreenButton, {
        target: document.body,
        props: { fullscreen, class: `my-fs-btn`, [`aria-label`]: `Custom label` },
      })
      const custom = doc_query<HTMLButtonElement>(`button.my-fs-btn`)
      expect(custom.classList.contains(`fullscreen-btn`)).toBe(true)
      expect(custom.getAttribute(`aria-label`)).toBe(`Custom label`)
    },
  )
})
