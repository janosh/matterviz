import { EmptyState } from '$lib'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`EmptyState`, () => {
  test(`renders message in a span (valid inside <p>) and forwards class, attributes and style`, () => {
    mount(EmptyState, {
      target: document.body,
      props: {
        message: `No data available`,
        class: `custom-class`,
        id: `my-empty-state`,
        style: `min-height: 200px; background: red`,
      },
    })
    const container = doc_query<HTMLDivElement>(`.empty-state.custom-class`)
    expect(container.querySelector(`span.message`)?.textContent).toBe(`No data available`)
    expect(container.id).toBe(`my-empty-state`)
    expect(container.style.minHeight).toBe(`200px`)
    expect(container.style.background).toBe(`red`)
  })

  test.each([{}, { message: `` }, { message: undefined }])(
    `renders empty container when props are %j`,
    (props) => {
      mount(EmptyState, { target: document.body, props })
      const container = doc_query(`.empty-state`)
      expect(container.textContent?.trim()).toBe(``)
      expect(container.querySelector(`span.message`)).toBeNull()
    },
  )

  test(`children snippet takes precedence over message prop`, () => {
    mount(EmptyState, {
      target: document.body,
      props: {
        message: `This should not render`,
        children: createRawSnippet(() => ({
          render: () => `<p class="custom-content">Custom snippet content</p>`,
        })),
      },
    })
    const container = doc_query(`.empty-state`)
    expect(container.querySelector(`.custom-content`)?.textContent).toBe(
      `Custom snippet content`,
    )
    expect(container.querySelector(`span.message`)).toBeNull()
  })
})
