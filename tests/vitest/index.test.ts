import * as lib from '$lib'
import * as labels from '$lib/labels'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

test(`library exports all Svelte components from $lib/*.svelte`, () => {
  const svelte_files = Object.keys(import.meta.glob(`$lib/*.svelte`))
    .map((path) => path.split(`/`).pop()?.split(`.`).shift())
    .filter((name): name is string => name !== undefined)
  const lib_exports = Object.keys(lib)

  // Verify each Svelte file has a corresponding export
  for (const component of svelte_files) {
    expect(lib_exports).toContain(component)
  }
})

test(`element labels and categories are consistent with element_data`, () => {
  // Verify all 10 element categories exist
  expect(labels.ELEMENT_CATEGORIES).toHaveLength(10)
  expect(labels.ELEMENT_CATEGORIES).toContain(`alkali metal`)
  expect(labels.ELEMENT_CATEGORIES).toContain(`noble gas`)
  expect(labels.ELEMENT_CATEGORIES).toContain(`transition metal`)

  // Verify symbol count matches element data
  expect(labels.ELEM_SYMBOLS).toHaveLength(lib.element_data.length)
  expect(labels.ELEM_SYMBOLS).toContain(`H`)
  expect(labels.ELEM_SYMBOLS).toContain(`He`)
  expect(labels.ELEM_SYMBOLS).toContain(`U`)
})

test(`root exports is_binary without misclassifying sparse high bytes`, () => {
  expect(lib.is_binary).toBeTypeOf(`function`)
  expect(lib.is_binary(`\u00FF${`a`.repeat(20)}`)).toBe(false)
})

describe(`Utility Functions`, () => {
  test.each([
    [`<script>alert('xss')</script>`, `&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;`],
    [`&<>"'`, `&amp;&lt;&gt;&quot;&#39;`],
    [`Hello World`, `Hello World`],
    [``, ``],
  ])(`escape_html: %s → %s`, (input, expected) => {
    expect(lib.escape_html(input)).toBe(expected)
  })

  describe(`toggle_fullscreen`, () => {
    let mock_wrapper: HTMLDivElement
    let orig_fullscreen_element: Element | null

    beforeEach(() => {
      mock_wrapper = document.createElement(`div`)
      document.body.append(mock_wrapper) // Must be connected to DOM
      orig_fullscreen_element = document.fullscreenElement
      mock_wrapper.requestFullscreen = vi.fn().mockResolvedValue(undefined)
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    })

    afterEach(() => {
      mock_wrapper.remove()
      vi.restoreAllMocks()
      Object.defineProperty(document, `fullscreenElement`, {
        value: orig_fullscreen_element,
        writable: false,
        configurable: true,
      })
    })

    const set_fullscreen_element = (element: Element | null | string) => {
      const actual_element = element === `same` ? mock_wrapper : element
      Object.defineProperty(document, `fullscreenElement`, {
        value: actual_element,
        writable: false,
        configurable: true,
      })
    }

    test.each([
      [`no element`, null, true, false],
      [`same wrapper`, `same`, false, true],
    ])(`%s: enters=%s, exits=%s`, async (_, element, should_enter, should_exit) => {
      set_fullscreen_element(element)

      await lib.toggle_fullscreen(mock_wrapper)

      expect(mock_wrapper.requestFullscreen).toHaveBeenCalledTimes(should_enter ? 1 : 0)
      expect(document.exitFullscreen).toHaveBeenCalledTimes(should_exit ? 1 : 0)
    })

    test(`switches when different element is fullscreen`, async () => {
      const other_wrapper = document.createElement(`div`)
      set_fullscreen_element(other_wrapper)

      await lib.toggle_fullscreen(mock_wrapper)

      expect(document.exitFullscreen).toHaveBeenCalledOnce()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mock_wrapper.requestFullscreen).toHaveBeenCalledOnce()
    })

    test.each([
      [`requestFullscreen`, null, `requestFullscreen`],
      [`exitFullscreen`, `same`, `exitFullscreen`],
    ])(`handles %s rejection gracefully`, async (_, element, method) => {
      set_fullscreen_element(element)
      const error = new Error(`Test error`)

      if (method === `requestFullscreen`) {
        mock_wrapper.requestFullscreen = vi.fn().mockRejectedValue(error)
      } else {
        document.exitFullscreen = vi.fn().mockRejectedValue(error)
      }

      await expect(lib.toggle_fullscreen(mock_wrapper)).resolves.toBeUndefined()
    })

    test(`returns early when no wrapper provided`, async () => {
      await lib.toggle_fullscreen(undefined)
      expect(mock_wrapper.requestFullscreen).not.toHaveBeenCalled()
      expect(document.exitFullscreen).not.toHaveBeenCalled()
    })

    test(`returns early when wrapper not connected to DOM`, async () => {
      const disconnected = document.createElement(`div`)
      const disconnected_request_fullscreen = vi.fn()
      disconnected.requestFullscreen = disconnected_request_fullscreen
      await lib.toggle_fullscreen(disconnected)
      expect(disconnected_request_fullscreen).not.toHaveBeenCalled()
    })
  })
})
