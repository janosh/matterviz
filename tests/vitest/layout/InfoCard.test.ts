import { InfoCard } from '$lib/layout'
import { type ComponentProps, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

type Item = NonNullable<ComponentProps<typeof InfoCard>[`data`]>[number]

describe(`InfoCard`, () => {
  const value_text = () => doc_query(`strong`).textContent?.replaceAll(/\s+/g, ` `).trim()

  test.each<[Item, string]>([
    [{ title: `Energy`, value: Math.PI, fmt: `.2f` }, `3.14`],
    [{ title: `Energy`, value: Math.PI }, `3.142`], // card-level fmt
    [{ title: `Magmom`, value: [1.2, -1.2, 0], unit: `μB` }, `1.200, −1.200, 0.000 μB`],
    [{ title: `Label`, value: `Fe<sub>2</sub>O<sub>3</sub>` }, `Fe2O3`],
    [{ title: `XSS`, value: `<script>alert(1)</script>safe` }, `safe`],
    [{ title: `Band gap`, value: 1.5, unit: `eV` }, `1.500 eV`],
  ])(`renders %j as %p`, (item, expected) => {
    mount(InfoCard, { target: document.body, props: { data: [item], fmt: `.3f` } })
    expect(value_text()).toBe(expected)
    expect(document.querySelector(`script`)).toBeNull()
    if (item.unit) expect(doc_query(`strong small`).textContent).toBe(item.unit)
  })

  test(`hides null/undefined values and falsy conditions, falls back when nothing remains`, () => {
    mount(InfoCard, {
      target: document.body,
      props: {
        title: `E<sub>hull</sub>`,
        data: [
          { title: `Present`, value: `yes`, condition: 1 },
          { title: `Null`, value: null },
          { title: `Undef`, value: undefined },
          { title: `Off`, value: `no`, condition: false },
          { title: `Zero`, value: `no`, condition: 0 },
        ],
        fallback: `No data`,
      },
    })
    expect(doc_query(`h2 sub`).textContent).toBe(`hull`)
    expect(document.querySelectorAll(`.info-card div`)).toHaveLength(1)
    expect(value_text()).toBe(`yes`)
    expect(document.body.textContent).not.toContain(`No data`)

    document.body.innerHTML = ``
    mount(InfoCard, {
      target: document.body,
      props: { data: [{ title: `Gone`, value: null }], fallback: `No data available` },
    })
    expect(document.querySelectorAll(`.info-card div`)).toHaveLength(0)
    expect(document.querySelector(`h2`)).toBeNull()
    expect(doc_query(`.info-card`).textContent?.trim()).toBe(`No data available`)
  })
})
