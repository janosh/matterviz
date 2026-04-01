import { InfoCard } from '$lib/layout'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`InfoCard`, () => {
  test(`renders numeric values through format_num`, () => {
    mount(InfoCard, {
      target: document.body,
      props: { data: [{ title: `Energy`, value: 3.14159, fmt: `.2f` }] },
    })
    expect(doc_query(`strong`).textContent?.trim()).toBe(`3.14`)
  })

  test(`sanitizes HTML in string values`, () => {
    mount(InfoCard, {
      target: document.body,
      props: { data: [{ title: `Label`, value: `Fe<sub>2</sub>O<sub>3</sub>` }] },
    })
    const strong = doc_query(`strong`)
    expect(strong.querySelectorAll(`sub`)).toHaveLength(2)
    expect(strong.textContent?.trim()).toBe(`Fe2O3`)
  })

  test(`strips dangerous HTML from values`, () => {
    mount(InfoCard, {
      target: document.body,
      props: { data: [{ title: `XSS`, value: `<script>alert(1)</script>safe` }] },
    })
    expect(document.querySelector(`script`)).toBeNull()
    expect(doc_query(`strong`).textContent?.trim()).toBe(`safe`)
  })

  test(`filters out null and undefined values`, () => {
    mount(InfoCard, {
      target: document.body,
      props: {
        data: [
          { title: `Present`, value: `yes` },
          { title: `Null`, value: null },
          { title: `Undef`, value: undefined },
        ],
        fallback: `No data`,
      },
    })
    const divs = document.querySelectorAll(`.info-card div`)
    expect(divs).toHaveLength(1)
    expect(doc_query(`strong`).textContent?.trim()).toBe(`yes`)
  })

  test(`shows fallback when all data is filtered out`, () => {
    mount(InfoCard, {
      target: document.body,
      props: {
        data: [{ title: `Gone`, value: null }],
        fallback: `No data available`,
      },
    })
    expect(document.querySelectorAll(`.info-card div`)).toHaveLength(0)
    expect(doc_query(`.info-card`).textContent).toContain(`No data available`)
  })

  test(`renders unit suffix`, () => {
    mount(InfoCard, {
      target: document.body,
      props: { data: [{ title: `Band gap`, value: 1.5, unit: `eV` }] },
    })
    const small = doc_query(`strong small`)
    expect(small.textContent).toBe(`eV`)
  })

  test(`sanitizes HTML in title`, () => {
    mount(InfoCard, {
      target: document.body,
      props: { title: `E<sub>hull</sub>`, data: [] },
    })
    expect(doc_query(`h2 sub`).textContent).toBe(`hull`)
  })
})
