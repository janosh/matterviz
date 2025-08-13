import * as lib from '$lib'
import { ElementScatter, PeriodicTable } from '$lib'
import * as labels from '$lib/labels'
import DirectImportPeriodicTable from '$lib/periodic-table/PeriodicTable.svelte'
import DirectImportElementScatter from '$lib/plot/ElementScatter.svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

test(`PeriodicTable is named and default export`, () => {
  expect(DirectImportPeriodicTable).toBe(PeriodicTable)
})

test(`ElementScatter is named export`, () => {
  expect(DirectImportElementScatter).toBe(ElementScatter)
})

test(`src/lib/icons/index.ts re-exports all components`, () => {
  const components = Object.keys(import.meta.glob(`$lib/*.svelte`)).map(
    (path) => path.split(`/`).pop()?.split(`.`).shift(),
  )
  expect(Object.keys(lib)).toEqual(expect.arrayContaining(components))
})

test(`categories and element_symbols are exported`, () => {
  expect(labels.element_categories).toHaveLength(10)
  expect(labels.elem_symbols).toHaveLength(lib.element_data.length)
})

test(`escape_html function escapes HTML special characters`, () => {
  expect(lib.escape_html(`<script>alert('xss')</script>`)).toBe(
    `&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;`,
  )
  expect(lib.escape_html(`& < > " '`)).toBe(`&amp; &lt; &gt; &quot; &#39;`)
  expect(lib.escape_html(`normal text`)).toBe(`normal text`)
  expect(lib.escape_html(``)).toBe(``)
  expect(lib.escape_html(`<div class="test">content</div>`)).toBe(
    `&lt;div class=&quot;test&quot;&gt;content&lt;/div&gt;`,
  )
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
  const control_chars =
    `\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F`
  expect(lib.is_binary(control_chars + `some text`)).toBe(true)

  // Content with mostly non-printable characters should be binary
  const mostly_non_printable = `\x80\x81\x82\x83\x84\x85\x86\x87\x88\x89` + `a`.repeat(5)
  expect(lib.is_binary(mostly_non_printable)).toBe(true)

  // Content with mostly printable characters should not be binary
  const mostly_printable = `abcdefghijklmnopqrstuvwxyz` + `\x80\x81\x82` +
    `abcdefghijklmnopqrstuvwxyz`.repeat(10)
  expect(lib.is_binary(mostly_printable)).toBe(false)
})

describe(`Utility Functions`, () => {
  test.each([
    [
      `<script>alert('xss')</script>`,
      `&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;`,
    ],
    [`&<>"'`, `&amp;&lt;&gt;&quot;&#39;`],
    [`Hello World`, `Hello World`],
    [``, ``],
  ])(`escape_html: %s → %s`, (input, expected) => {
    expect(lib.escape_html(input)).toBe(expected)
  })

  test.each([
    [`Hello\0World`, true],
    [`Hello\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0FWorld`, true],
    [`Hello World`, false],
    [``, false],
  ])(`is_binary: %s → %s`, (input, expected) => {
    expect(lib.is_binary(input)).toBe(expected)
  })

  describe(`toggle_fullscreen`, () => {
    let mock_wrapper: HTMLDivElement
    let original_fullscreen_element: Element | null

    beforeEach(() => {
      mock_wrapper = document.createElement(`div`)
      original_fullscreen_element = document.fullscreenElement
      mock_wrapper.requestFullscreen = vi.fn().mockResolvedValue(undefined)
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
    })

    afterEach(() => {
      vi.restoreAllMocks()
      Object.defineProperty(document, `fullscreenElement`, {
        value: original_fullscreen_element,
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

      if (should_enter) expect(mock_wrapper.requestFullscreen).toHaveBeenCalledOnce()
      if (should_exit) expect(document.exitFullscreen).toHaveBeenCalledOnce()
    })

    test(`switches when different element is fullscreen`, async () => {
      const other_wrapper = document.createElement(`div`)
      set_fullscreen_element(other_wrapper)

      await lib.toggle_fullscreen(mock_wrapper)

      expect(document.exitFullscreen).toHaveBeenCalledOnce()
      await new Promise((resolve) => setTimeout(resolve, 150))
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
  })
})
