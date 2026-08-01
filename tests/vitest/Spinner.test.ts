import { Spinner } from '$lib'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`Spinner`, () => {
  test(`renders with correct structure and ARIA attributes`, () => {
    mount(Spinner, { target: document.body })

    const container = doc_query(`.spinner[role="status"]`)
    expect(container.classList.contains(`spinner`)).toBe(true)
    expect(container.getAttribute(`role`)).toBe(`status`)
    expect(container.getAttribute(`aria-live`)).toBe(`polite`)
    expect(container.getAttribute(`aria-busy`)).toBe(`true`)
    // circle is a ::before pseudo — no inner spinner node
    expect(container.querySelector(`div`)).toBeNull()
  })

  test(`renders text conditionally`, () => {
    mount(Spinner, { target: document.body })
    expect(document.querySelector(`.spinner > span`)).toBeNull()

    document.body.innerHTML = ``
    mount(Spinner, { target: document.body, props: { text: `Processing...` } })
    const text_element = doc_query(`.spinner > span`)
    expect(text_element.textContent).toBe(`Processing...`)
  })

  test(`passes through props and accepts custom styles`, () => {
    mount(Spinner, {
      target: document.body,
      props: {
        id: `custom-id`,
        'data-testid': `test-spinner`,
        style: `--spinner-size: 60px; --spinner-color: red`,
      },
    })

    const container = doc_query(`.spinner[role="status"]`)
    expect(container.id).toBe(`custom-id`)
    expect(container.getAttribute(`data-testid`)).toBe(`test-spinner`)
    expect(container.getAttribute(`style`)).toContain(`--spinner-size: 60px`)
    expect(container.getAttribute(`style`)).toContain(`--spinner-color: red`)
  })
})
