import type { InfoPaneCard, InfoPaneRow } from '$lib/overlays'
import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
import { createRawSnippet, flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

const card = (idx: number) => ({
  title: `Card ${idx}`,
  rows: [{ label: `Label`, value: `Value ${idx}` }],
})
const titles = () =>
  [...document.querySelectorAll(`.info-card h4`)].map((el) => el.textContent?.trim())

describe(`InfoPaneCards`, () => {
  test(`renders duplicate unkeyed rows with copy buttons`, () => {
    mount(InfoPaneCards, {
      target: document.body,
      props: {
        cards: [
          {
            title: `Card`,
            rows: [
              { label: `Same`, value: `Value` },
              { label: `Same`, value: `Value` },
            ],
          },
        ],
        filter_placeholder: `Filter info`,
        empty_label: `info`,
      },
    })
    expect(document.querySelectorAll(`.info-row`)).toHaveLength(2)
    expect(document.querySelectorAll(`.copy-button`)).toHaveLength(2)
  })

  test(`pages long lists, clamps after filtering and resets the page on a new filter`, () => {
    mount(InfoPaneCards, {
      target: document.body,
      props: {
        cards: Array.from({ length: 7 }, (_, idx) => card(idx)),
        filter_placeholder: `Filter cards`,
        empty_label: `cards`,
        page_size: 3,
      },
    })
    const [prev_btn, next_btn] = document.querySelectorAll<HTMLButtonElement>(`.pager button`)
    expect(titles()).toEqual([`Card 0`, `Card 1`, `Card 2`])
    expect(doc_query(`.pager span`).textContent).toBe(`1-3 of 7`)
    expect(prev_btn.disabled).toBe(true)

    next_btn.click()
    flushSync()
    next_btn.click()
    flushSync()
    expect(titles()).toEqual([`Card 4`, `Card 5`, `Card 6`]) // last page clamps to the end
    expect(doc_query(`.pager span`).textContent).toBe(`5-7 of 7`)
    expect(next_btn.disabled).toBe(true)

    // A filter narrows the list below a page and hides the pager
    const filter = doc_query<HTMLInputElement>(`input.info-filter`)
    filter.value = `Value 1`
    filter.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    expect(titles()).toEqual([`Card 1`]) // only `Value 1` matches; pager disappears
    expect(document.querySelector(`.pager`)).toBeNull()

    filter.value = ``
    filter.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    expect(titles()).toEqual([`Card 0`, `Card 1`, `Card 2`]) // new filter restarts at page 1
  })

  test(`card_attrs decorate cards and row_value replaces the value cell`, () => {
    mount(InfoPaneCards, {
      target: document.body,
      props: {
        cards: [{ ...card(0), subtitle: `sub`, key: `k0` }],
        empty_label: `cards`,
        show_copy: false,
        card_attrs: (item: InfoPaneCard) => ({ class: `custom`, 'data-key': item.key }),
        row_value: createRawSnippet<[InfoPaneRow, InfoPaneCard]>((row) => ({
          render: () => `<input value="${row().value}" />`,
        })),
      },
    })
    const section = doc_query(`.info-card`)
    expect(section.classList.contains(`custom`)).toBe(true)
    expect(section.getAttribute(`data-key`)).toBe(`k0`)
    expect(doc_query(`.info-card h4 .subtitle`).textContent).toBe(`sub`)
    expect(doc_query<HTMLInputElement>(`.info-row input`).value).toBe(`Value 0`)
    expect(document.querySelector(`.copy-button`)).toBeNull()
  })
})
