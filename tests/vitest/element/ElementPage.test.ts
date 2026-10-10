import ElementPage from '#root/src/routes/(element)/[slug]/+page.svelte'
import { selected } from '#lib/state.svelte.js'
import { mount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const { page } = vi.hoisted(() => ({
  page: { params: { slug: `hydrogen` }, url: new URL(`http://localhost/hydrogen`) },
}))
vi.mock(`$app/state`, () => ({ page }))

afterEach(() => {
  selected.element = null
  selected.heatmap_key = null
})

// C and Au list their year as `unknown`, which read "Discovered by Ancient Egypt in unknown"
test.each([
  [`hydrogen`, `Discovered by Henry Cavendish in 1766`],
  [`carbon`, `Discovered by Ancient Egypt`],
  [`gold`, `Discovered by Middle East`],
  [`iron`, `Discovered by 5000 BC in ~5000 BC`],
])(`%s page reads %j`, (slug, expected) => {
  page.params.slug = slug
  mount(ElementPage, { target: document.body })
  const discovered = [...document.querySelectorAll(`p`)].find((para) =>
    para.textContent.trim().startsWith(`Discovered`),
  )
  expect(discovered?.textContent.replaceAll(/\s+/g, ` `).trim()).toBe(expected)
})
