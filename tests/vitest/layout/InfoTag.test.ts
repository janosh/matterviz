import { InfoTag } from '$lib/layout'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, mock_clipboard_write } from '../setup'

describe(`InfoTag`, () => {
  const get_tag = (): HTMLSpanElement => doc_query(`.info-tag`)

  test(`renders with required props, HTML label, and displays value`, () => {
    mount(InfoTag, {
      target: document.body,
      props: { label: `E<sub>hull</sub>:`, value: 42 },
    })
    const tag = get_tag()
    expect(tag.getAttribute(`role`)).toBe(`button`)
    expect(tag.querySelector(`sub`)?.textContent).toBe(`hull`)
    expect(doc_query(`em`).textContent).toBe(`42`)
  })

  // variant and size are passed straight through as classes
  test.each([
    [{ variant: `error`, size: `lg` }, [`error`, `lg`]],
    [{}, [`default`, `md`]],
  ] as const)(`props %j apply classes %j`, (props, classes) => {
    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1, ...props } })
    for (const cls of classes) expect(get_tag().classList.contains(cls)).toBe(true)
  })

  test.each([
    { disabled: false, tabindex: `0`, has_class: false },
    { disabled: true, tabindex: `-1`, has_class: true },
  ])(
    `disabled=$disabled → tabindex=$tabindex, class=$has_class`,
    ({ disabled, tabindex, has_class }) => {
      mount(InfoTag, {
        target: document.body,
        props: { label: `Test`, value: 1, disabled },
      })
      const tag = get_tag()
      expect(tag.getAttribute(`tabindex`)).toBe(tabindex)
      expect(tag.classList.contains(`disabled`)).toBe(has_class)
      if (disabled) expect(tag.getAttribute(`aria-disabled`)).toBe(`true`)
    },
  )

  test.each([
    { value: `abc123`, copy_value: undefined, expected: `abc123` },
    { value: `abc123`, copy_value: `full-id-abc123`, expected: `full-id-abc123` },
  ])(
    `copies $expected to clipboard (copy_value=$copy_value)`,
    ({ value, copy_value, expected }) => {
      const write_text_spy = mock_clipboard_write()
      mount(InfoTag, {
        target: document.body,
        props: { label: `ID:`, value, copy_value },
      })
      get_tag().click()
      flushSync()
      expect(write_text_spy).toHaveBeenCalledWith(expected)
    },
  )

  test(`shows checkmark after copying and removes after 1s`, async () => {
    vi.useFakeTimers()
    mount(InfoTag, { target: document.body, props: { label: `ID:`, value: `abc123` } })
    get_tag().click()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    expect(document.querySelector(`.copy-checkmark`)).toBeInstanceOf(SVGSVGElement)
    vi.advanceTimersByTime(1000)
    flushSync()
    expect(document.querySelector(`.copy-checkmark`)).toBeNull()
    vi.useRealTimers()
  })

  test(`custom onclick overrides copy; Enter/Space triggers click; disabled blocks both`, () => {
    const write_text_spy = mock_clipboard_write()

    // Custom onclick overrides copy
    const onclick = vi.fn()
    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1, onclick } })
    get_tag().click()
    flushSync()
    expect(onclick).toHaveBeenCalled()
    expect(write_text_spy).not.toHaveBeenCalled()

    // Enter/Space triggers click
    onclick.mockClear()
    get_tag().dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    get_tag().dispatchEvent(new KeyboardEvent(`keydown`, { key: ` `, bubbles: true }))
    flushSync()
    expect(onclick).toHaveBeenCalledTimes(2)

    // Disabled blocks both click and keyboard
    document.body.innerHTML = ``
    const onclick2 = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, onclick: onclick2, disabled: true },
    })
    get_tag().click()
    get_tag().dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    flushSync()
    expect(onclick2).not.toHaveBeenCalled()
  })

  test.each([
    { removable: true, disabled: false, expected: true },
    { removable: false, disabled: false, expected: false },
    { removable: true, disabled: true, expected: false },
  ])(
    `remove button visible=$expected when removable=$removable, disabled=$disabled`,
    (params) => {
      mount(InfoTag, {
        target: document.body,
        props: { label: `Test`, value: 1, ...params },
      })
      expect(Boolean(document.querySelector(`[aria-label="Remove"]`))).toBe(params.expected)
    },
  )

  test(`on_remove fires without triggering tag onclick`, () => {
    const onclick = vi.fn()
    const on_remove = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, removable: true, onclick, on_remove },
    })
    doc_query<HTMLButtonElement>(`[aria-label="Remove"]`).click()
    flushSync()
    expect(on_remove).toHaveBeenCalled()
    expect(onclick).not.toHaveBeenCalled()
  })

  test.each([
    { value: undefined, expected: `` },
    { value: 123.456, expected: `123.456` },
    { value: `mp-1234`, expected: `mp-1234` },
  ])(`displays value $value as "$expected"`, ({ value, expected }) => {
    mount(InfoTag, { target: document.body, props: { label: `Test:`, value } })
    expect(doc_query(`em`).textContent).toBe(expected)
  })

  test(`spreads additional attributes`, () => {
    mount(InfoTag, {
      target: document.body,
      props: {
        label: `Test`,
        value: 1,
        style: `background: red`,
        'data-testid': `test-tag`,
      },
    })
    const tag = doc_query(`[data-testid="test-tag"]`)
    expect(tag.style.background).toBe(`red`)
    expect(tag.classList.contains(`info-tag`)).toBe(true)
  })
})
