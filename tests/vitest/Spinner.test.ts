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

    const inner_spinner = doc_query(`.spinner > div`)
    expect(inner_spinner.getAttribute(`aria-hidden`)).toBe(`true`)
    expect(container.children.length).toBeGreaterThan(0)
  })

  test(`renders text conditionally`, () => {
    mount(Spinner, { target: document.body })
    expect(document.querySelector(`.spinner > span`)).toBeFalsy()

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
