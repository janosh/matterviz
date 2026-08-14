import * as lib from '$lib'
import * as labels from '$lib/labels'
import { describe, expect, test } from 'vitest'

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
})
