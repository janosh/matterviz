import { Nav } from '$lib'
import type { Page } from '@sveltejs/kit'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

vi.mock(`$app/state`, () => ({ page: { url: { pathname: `/` } } }))

describe(`Nav`, () => {
  const default_routes = [`/`, `/about`, `/contact`]
  const click = async (el: Element) => {
    el.dispatchEvent(new MouseEvent(`click`, { bubbles: true, cancelable: true }))
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  test(`renders simple routes as links`, () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const links = document.querySelectorAll(`a`)
    expect(links).toHaveLength(3)
    expect(Array.from(links).map((link) => link.getAttribute(`href`))).toEqual([
      `/`,
      `/about`,
      `/contact`,
    ])
  })

  test(`renders tuple routes with custom labels`, () => {
    const routes: [string, string][] = [[`/`, `Home`], [`/about`, `About Us`], [
      `/contact`,
      `Get In Touch`,
    ]]
    mount(Nav, { target: document.body, props: { routes } })
    const links = document.querySelectorAll(`a`)
    expect(Array.from(links).map((link) => link.textContent?.trim())).toEqual([
      `Home`,
      `About Us`,
      `Get In Touch`,
    ])
  })

  test(`burger button structure and ARIA`, () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const burger_button = doc_query(`.burger-button`)
    expect(burger_button.tagName).toBe(`BUTTON`)
    expect(burger_button.getAttribute(`aria-label`)).toBe(`Toggle navigation menu`)
    expect(burger_button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(burger_button.getAttribute(`aria-controls`)).toBeTruthy()
    expect(document.querySelectorAll(`.burger-line`)).toHaveLength(3)
  })

  test(`toggles menu on burger button click`, async () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const button = doc_query(`.burger-button`)
    const menu = doc_query(`.menu-content`)

    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(menu.classList.contains(`open`)).toBe(false)

    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)
    expect(menu.classList.contains(`open`)).toBe(true)

    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(menu.classList.contains(`open`)).toBe(false)
  })

  test(`closes menu with Escape key`, async () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const button = doc_query(`.burger-button`)

    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)

    // Escape does nothing when already closed
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test(`menu ID matches aria-controls and closes on link click`, async () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const button = doc_query(`.burger-button`)
    const menu = doc_query(`.menu-content`)
    const panel_id = button.getAttribute(`aria-controls`)

    expect(panel_id).toBeTruthy()
    expect(menu.id).toBe(panel_id)
    expect(panel_id?.startsWith(`nav-menu-`)).toBe(true)
    expect(menu.getAttribute(`role`)).toBe(`menu`)
    expect(menu.getAttribute(`tabindex`)).toBe(`0`)

    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    const link = document.querySelector(`a`)
    if (link) await click(link)
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test(`applies custom props`, () => {
    mount(Nav, {
      target: document.body,
      props: {
        routes: default_routes,
        class: `custom-class`,
        menu_style: `background: red;`,
      },
    })
    const nav = doc_query(`nav`)
    const menu = doc_query(`.menu-content`)
    expect(nav.classList.contains(`custom-class`)).toBe(true)
    expect(nav.classList.contains(`bleed-1400`)).toBe(true)
    expect(menu.getAttribute(`style`)).toBe(`background: red;`)
  })

  test(`accepts snippet props`, () => {
    expect(() =>
      mount(Nav, {
        target: document.body,
        props: { routes: default_routes, link: () => {}, children: () => {} },
      })
    ).not.toThrow()
  })

  test.each([
    [
      `mixed routes`,
      [`/`, [`/about`, `About Page`], `/contact`] as (string | [string, string])[],
      [`/`, `About Page`, `/contact`],
    ],
    [`empty routes`, [], []],
    [`HTML labels`, [[`/home`, `<strong>Home</strong>`]] as [string, string][], [`Home`]],
    [`special chars`, [`/path?query=test`, `/path#anchor`], [
      `/path?query=test`,
      `/path#anchor`,
    ]],
  ])(`handles %s`, (_desc, routes, expected_content) => {
    mount(Nav, { target: document.body, props: { routes } })
    const links = document.querySelectorAll(`a`)
    expect(links).toHaveLength(expected_content.length)
    if (expected_content.length > 0) {
      expect(Array.from(links).map((link) => link.textContent?.trim())).toEqual(
        expected_content,
      )
    }
  })

  test.each([
    [`/about`, `/about`, `page`],
    [`/about/team`, `/about`, `page`],
    [`/contact`, `/about`, null],
    [`/`, `/`, `page`],
    [`/home`, `/`, null],
  ])(`aria-current: pathname=%s link=%s -> %s`, (pathname, link_href, expected) => {
    const mock_page = { url: { pathname } } as Page

    mount(Nav, {
      target: document.body,
      props: { routes: [link_href], page: mock_page },
    })
    const link = doc_query(`a[href="${link_href}"]`)
    expect(link.getAttribute(`aria-current`)).toBe(expected)
  })

  test(`generates unique panel IDs`, () => {
    mount(Nav, { target: document.body, props: { routes: [`/a`] } })
    mount(Nav, { target: document.body, props: { routes: [`/b`] } })
    const menus = document.querySelectorAll(`.menu-content`)
    const [id1, id2] = Array.from(menus).map((menu) => menu.id)
    expect(id1).not.toBe(id2)
    expect(id1.startsWith(`nav-menu-`)).toBe(true)
    expect(id2.startsWith(`nav-menu-`)).toBe(true)
  })

  test(`click_outside closes menu, clicking inside does not`, async () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const button = doc_query(`.burger-button`)
    const menu = doc_query(`.menu-content`)

    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    menu.click()
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    const outside_div = document.createElement(`div`)
    document.body.appendChild(outside_div)
    outside_div.click()
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test(`non-Escape keys do not close menu`, async () => {
    mount(Nav, { target: document.body, props: { routes: default_routes } })
    const button = doc_query(`.burger-button`)

    await click(button)
    const keys = [`Enter`, `Space`, `Tab`, `ArrowDown`, `a`, `1`]
    await Promise.all(
      keys.map((key) => {
        globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key }))
        return tick()
      }),
    )
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)
  })
})
