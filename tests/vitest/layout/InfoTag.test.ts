import InfoTag from '#lib/layout/InfoTag.svelte'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, mock_clipboard_write } from '../setup'

describe(`InfoTag`, () => {
  const get_tag = (): HTMLSpanElement => doc_query(`.info-tag`)

  test(`renders HTML labels and sanitized hover details while retaining click actions`, async () => {
    const onclick = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: {
        label: `E<sub>hull</sub>:`,
        value: 42,
        title: `<b>Energy</b><script>bad()</script>`,
        onclick,
      },
    })
    const tag = get_tag()
    expect(tag.getAttribute(`role`)).toBe(`button`)
    expect(tag.querySelector(`sub`)?.textContent).toBe(`hull`)
    expect(doc_query(`em`).textContent).toBe(`42`)
    tag.dispatchEvent(new MouseEvent(`mouseenter`))
    await vi.waitFor(() =>
      expect(document.querySelector(`.popover b`)?.textContent).toBe(`Energy`),
    )
    expect(document.querySelector(`.popover script`)).toBeNull()
    tag.click()
    expect(onclick).toHaveBeenCalledOnce()
    expect(tag.getAttribute(`role`)).toBe(`button`)
  })

  // variant, size and extra attributes pass straight through; disabled leaves the tab order
  // and blocks click plus Enter/Space activation
  test.each([
    [`defaults`, {}, [`default`, `md`]],
    [
      `variant, size and spread attrs`,
      { variant: `error`, size: `lg`, style: `color: red` },
      [`error`, `lg`],
    ],
    [`disabled`, { disabled: true }, [`default`, `md`]],
  ] as const)(`%s`, (_name, props, classes) => {
    const onclick = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: 1, onclick, ...props },
    })
    const tag = get_tag()
    const disabled = `disabled` in props
    for (const cls of classes) expect(tag.classList.contains(cls)).toBe(true)
    expect(tag.classList.contains(`disabled`)).toBe(disabled)
    expect(tag.getAttribute(`tabindex`)).toBe(disabled ? `-1` : `0`)
    expect(tag.getAttribute(`aria-disabled`)).toBe(String(disabled))
    expect(tag.style.color).toBe(`style` in props ? `red` : ``)
    tag.click()
    for (const key of [`Enter`, ` `])
      tag.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
    flushSync()
    expect(onclick).toHaveBeenCalledTimes(disabled ? 0 : 3)
  })

  // a tag is a copy button only when it has something to copy
  test.each([
    { value: undefined, copy_value: undefined, copied: undefined },
    { value: `mp-1234`, copy_value: undefined, copied: `mp-1234` },
    { value: 123.456, copy_value: undefined, copied: `123.456` },
    { value: `abc123`, copy_value: `full-id-abc123`, copied: `full-id-abc123` },
    { value: undefined, copy_value: `full-id-abc123`, copied: `full-id-abc123` },
  ])(
    `value=$value, copy_value=$copy_value copies $copied`,
    ({ value, copy_value, copied }) => {
      const write_text_spy = mock_clipboard_write()
      mount(InfoTag, { target: document.body, props: { label: `ID:`, value, copy_value } })
      const tag = get_tag()
      expect(doc_query(`em`).textContent).toBe(value === undefined ? `` : String(value))
      expect(tag.getAttribute(`role`)).toBe(copied ? `button` : null)
      expect(tag.getAttribute(`tabindex`)).toBe(copied ? `0` : null)
      tag.click()
      flushSync()
      expect(write_text_spy.mock.calls).toEqual(copied ? [[copied]] : [])
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

  test(`custom onclick overrides copy`, () => {
    const write_text_spy = mock_clipboard_write()
    const onclick = vi.fn()
    mount(InfoTag, {
      target: document.body,
      props: { label: `Test`, value: undefined, copy_value: `id`, onclick },
    })
    expect(get_tag().getAttribute(`role`)).toBe(`button`)
    get_tag().click()
    flushSync()
    expect(onclick).toHaveBeenCalledOnce()
    expect(write_text_spy).not.toHaveBeenCalled()
  })

  test.each([
    { removable: true, disabled: false, callback: true, expected: true },
    { removable: false, disabled: false, callback: true, expected: false },
    { removable: true, disabled: true, callback: true, expected: false },
    { removable: true, disabled: false, callback: false, expected: false },
  ])(
    `remove button visible=$expected when removable=$removable, disabled=$disabled, callback=$callback`,
    ({ removable, disabled, callback, expected }) => {
      const onclick = vi.fn()
      const on_remove = vi.fn()
      mount(InfoTag, {
        target: document.body,
        props: {
          label: `Test`,
          value: 1,
          removable,
          disabled,
          onclick,
          on_remove: callback ? on_remove : undefined,
        },
      })
      const remove = document.querySelector<HTMLButtonElement>(`[aria-label="Remove"]`)
      expect(Boolean(remove)).toBe(expected)
      if (!remove) return
      for (const key of [`Enter`, ` `])
        remove.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
      expect(onclick).not.toHaveBeenCalled()
      remove.click()
      flushSync()
      expect(on_remove).toHaveBeenCalledExactlyOnceWith()
      expect(onclick).not.toHaveBeenCalled()
    },
  )
})
