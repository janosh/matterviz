import { InfoTag } from '$lib/layout'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`InfoTag`, () => {
  const get_tag = (): HTMLSpanElement => doc_query(`.info-tag`)

  test(`renders with required props and displays value`, () => {
    mount(InfoTag, { target: document.body, props: { label: `Count:`, value: 42 } })
    const tag = get_tag()
    expect(tag).toBeTruthy()
    expect(tag.textContent).toContain(`Count:`)
    expect(doc_query(`em`).textContent).toBe(`42`)
    expect(tag.getAttribute(`role`)).toBe(`button`)
  })

  test(`renders HTML in label`, () => {
    mount(InfoTag, {
      target: document.body,
      props: { label: `E<sub>hull</sub>:`, value: `0.1 eV` },
    })
    expect(get_tag().querySelector(`sub`)?.textContent).toBe(`hull`)
  })

  test.each([`default`, `success`, `warning`, `error`, `info`] as const)(
    `applies %s variant class`,
    (variant) => {
      mount(InfoTag, {
        target: document.body,
        props: { label: `Test`, value: 1, variant },
      })
      expect(get_tag().classList.contains(variant)).toBe(true)
    },
  )

  test.each([`sm`, `md`, `lg`] as const)(`applies %s size class`, (size) => {
    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1, size } })
    expect(get_tag().classList.contains(size)).toBe(true)
  })

  test(`default variant and size when not specified`, () => {
    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1 } })
    const tag = get_tag()
    expect(tag.classList.contains(`default`)).toBe(true)
    expect(tag.classList.contains(`md`)).toBe(true)
  })

  test(`applies disabled state correctly`, () => {
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, disabled: true },
    })
    const tag = get_tag()
    expect(tag.classList.contains(`disabled`)).toBe(true)
    expect(tag.getAttribute(`aria-disabled`)).toBe(`true`)
    expect(tag.getAttribute(`tabindex`)).toBe(`-1`)
  })

  test(`has tabindex 0 when not disabled`, () => {
    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1 } })
    expect(get_tag().getAttribute(`tabindex`)).toBe(`0`)
  })

  test(`sets title attribute`, () => {
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, title: `Click to copy` },
    })
    expect(get_tag().getAttribute(`title`)).toBe(`Click to copy`)
  })

  test.each([
    { value: `abc123`, copy_value: undefined, expected: `abc123` },
    { value: `abc123`, copy_value: `full-id-abc123`, expected: `full-id-abc123` },
  ])(
    `copies $expected to clipboard (copy_value=$copy_value)`,
    ({ value, copy_value, expected }) => {
      const write_text_spy = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, `clipboard`, {
        value: { writeText: write_text_spy },
        writable: true,
      })

      mount(InfoTag, {
        target: document.body,
        props: { label: `ID:`, value, copy_value },
      })
      get_tag().click()
      flushSync()

      expect(write_text_spy).toHaveBeenCalledWith(expected)
    },
  )

  test(`shows checkmark after copying and removes it after 1s`, async () => {
    vi.useFakeTimers()
    mount(InfoTag, { target: document.body, props: { label: `ID:`, value: `abc123` } })

    get_tag().click()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()

    expect(document.querySelector(`.copy-checkmark`)).toBeTruthy()

    vi.advanceTimersByTime(1000)
    flushSync()

    expect(document.querySelector(`.copy-checkmark`)).toBeNull()
    vi.useRealTimers()
  })

  test(`calls custom onclick handler instead of copying`, () => {
    const onclick = vi.fn()
    const write_text_spy = vi.fn()
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: write_text_spy },
      writable: true,
    })

    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1, onclick } })
    get_tag().click()
    flushSync()

    expect(onclick).toHaveBeenCalled()
    expect(write_text_spy).not.toHaveBeenCalled()
  })

  test.each([`Enter`, ` `])(`triggers click on %s key`, (key) => {
    const onclick = vi.fn()
    mount(InfoTag, { target: document.body, props: { label: `Test`, value: 1, onclick } })
    get_tag().dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
    flushSync()
    expect(onclick).toHaveBeenCalled()
  })

  test.each([
    { action: `click`, disabled: true },
    { action: `Enter key`, disabled: true },
  ])(`does not trigger handler on $action when disabled`, ({ action }) => {
    const onclick = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, onclick, disabled: true },
    })

    if (action === `click`) {
      get_tag().click()
    } else {
      get_tag().dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
      )
    }
    flushSync()

    expect(onclick).not.toHaveBeenCalled()
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
      expect(!!document.querySelector(`[aria-label="Remove"]`)).toBe(params.expected)
    },
  )

  test(`calls onremove when remove button is clicked without triggering tag click`, () => {
    const onclick = vi.fn()
    const onremove = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, removable: true, onclick, onremove },
    })

    doc_query<HTMLButtonElement>(`[aria-label="Remove"]`).click()
    flushSync()

    expect(onremove).toHaveBeenCalled()
    expect(onclick).not.toHaveBeenCalled()
  })

  test(`remove button has accessible label`, () => {
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, removable: true },
    })
    // Button is selected by aria-label, so this verifies it exists with correct label
    expect(doc_query(`[aria-label="Remove"]`)).toBeTruthy()
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
