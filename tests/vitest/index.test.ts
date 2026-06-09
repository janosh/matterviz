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

  // Verify some key components are exported correctly (spot check)
  expect(lib.PeriodicTable).toBeDefined()
  expect(lib.Structure).toBeDefined()
  expect(lib.ElementTile).toBeDefined()
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

test(`is_binary function detects binary content`, () => {
  // Text content should not be binary
  expect(lib.is_binary(`Hello, world!`)).toBe(false)
  expect(lib.is_binary(`1234567890`)).toBe(false)
  expect(lib.is_binary(`{"json": "data"}`)).toBe(false)
  expect(lib.is_binary(``)).toBe(false)

  // Content with null bytes should be binary
  expect(lib.is_binary(`Hello\0world`)).toBe(true)
  expect(lib.is_binary(`\0\0\0\0`)).toBe(true)

  // Content with many control characters should be binary
  const control_chars = `\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000E\u000F\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F`
  expect(lib.is_binary(`${control_chars}some text`)).toBe(true)

  // Content with mostly non-printable characters should be binary
  const mostly_non_printable = `\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087\u0088\u0089${`a`.repeat(5)}`
  expect(lib.is_binary(mostly_non_printable)).toBe(true)

  // Content with mostly printable characters should not be binary
  const mostly_printable = `abcdefghijklmnopqrstuvwxyz\u0080\u0081\u0082${`abcdefghijklmnopqrstuvwxyz`.repeat(10)}`
  expect(lib.is_binary(mostly_printable)).toBe(false)
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

  test.each([
    [`Hello\0World`, true],
    [
      `Hello\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000A\u000B\u000C\u000D\u000E\u000FWorld`,
      true,
    ],
    [`Hello World`, false],
    [``, false],
  ])(`is_binary: %s → %s`, (input, expected) => {
    expect(lib.is_binary(input)).toBe(expected)
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
