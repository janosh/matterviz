import { EmptyState } from '$lib'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`EmptyState`, () => {
  test(`renders with message prop`, () => {
    mount(EmptyState, {
      target: document.body,
      props: { message: `No data available` },
    })

    const container = doc_query(`.empty-state`)
    // Uses <span> instead of <p> to avoid invalid HTML when nested inside <p> elements
    expect(container.querySelector(`span.message`)?.textContent).toBe(`No data available`)
  })

  test.each([{}, { message: `` }, { message: undefined }])(
    `renders empty container when props are %j`,
    (props) => {
      mount(EmptyState, { target: document.body, props })
      const container = doc_query(`.empty-state`)
      expect(container.textContent?.trim()).toBe(``)
      expect(container.querySelector(`span.message`)).toBeFalsy()
    },
  )

  test(`applies custom class alongside default class`, () => {
    mount(EmptyState, {
      target: document.body,
      props: { message: `Test`, class: `custom-class` },
    })

    const container = doc_query(`.empty-state`)
    expect(container.classList.contains(`empty-state`)).toBe(true)
    expect(container.classList.contains(`custom-class`)).toBe(true)
  })

  test(`passes through HTML attributes and styles via rest props`, () => {
    mount(EmptyState, {
      target: document.body,
      props: {
        message: `Test`,
        id: `my-empty-state`,
        'data-testid': `empty-state-test`,
        style: `min-height: 200px; background: red`,
      },
    })

    const container = doc_query<HTMLDivElement>(`.empty-state`)
    expect(container.id).toBe(`my-empty-state`)
    expect(container.getAttribute(`data-testid`)).toBe(`empty-state-test`)
    expect(container.style.minHeight).toBe(`200px`)
    expect(container.style.background).toBe(`red`)
  })

  test(`children snippet takes precedence over message prop`, () => {
    const custom_content = `<p class="custom-content">Custom snippet content</p>`
    mount(EmptyState, {
      target: document.body,
      props: {
        message: `This should not render`,
        children: createRawSnippet(() => ({ render: () => custom_content })),
      },
    })

    const container = doc_query(`.empty-state`)
    // Children snippet content should render
    expect(container.querySelector(`.custom-content`)?.textContent).toBe(
      `Custom snippet content`,
    )
    // Message span should NOT render when children is provided
    expect(container.querySelector(`span.message`)).toBeNull()
  })
})
