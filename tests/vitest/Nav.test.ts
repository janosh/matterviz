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
      [``, `About Page`, `contact`],
    ],
    [`empty routes`, [], []],
    [`HTML labels`, [[`/home`, `<strong>Home</strong>`]] as [string, string][], [`Home`]],
    [`special chars`, [`/path?query=test`, `/path#anchor`], [
      `path?query=test`,
      `path#anchor`,
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

  test(`renders dropdown menus with parent and child routes`, () => {
    const routes_with_dropdown = [
      `/standalone`,
      [`/parent`, [`/parent`, `/parent/child1`, `/parent/child2`]],
    ]
    mount(Nav, { target: document.body, props: { routes: routes_with_dropdown } })

    // Check standalone route
    expect(document.querySelector(`a[href="/standalone"]`)).toBeTruthy()

    // Check dropdown structure
    const dropdown = document.querySelector(`.dropdown-wrapper`)
    expect(dropdown).toBeTruthy()
    expect(dropdown?.getAttribute(`data-href`)).toBe(`/parent`)
    expect(dropdown?.getAttribute(`aria-haspopup`)).toBe(`true`)

    // Check all dropdown items including parent
    const dropdown_links = document.querySelectorAll(`.dropdown-menu a`)
    expect(dropdown_links).toHaveLength(3)
    const hrefs = Array.from(dropdown_links).map((link) => link.getAttribute(`href`))
    expect(hrefs).toEqual([`/parent`, `/parent/child1`, `/parent/child2`])
  })

  test.each([
    [`keyboard Enter/Space`, async (wrapper: Element, menu: Element) => {
      wrapper.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
      await tick()
      expect(menu.classList.contains(`visible`)).toBe(true)
      wrapper.dispatchEvent(new KeyboardEvent(`keydown`, { key: ` `, bubbles: true }))
      await tick()
      expect(menu.classList.contains(`visible`)).toBe(false)
    }],
    [`mouse hover on wrapper`, async (wrapper: Element, menu: Element) => {
      wrapper.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
      await tick()
      expect(menu.classList.contains(`visible`)).toBe(true)
      wrapper.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
      await tick()
      expect(menu.classList.contains(`visible`)).toBe(false)
    }],
    [`mouse hover on menu`, async (_wrapper: Element, menu: Element) => {
      menu.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
      await tick()
      expect(menu.classList.contains(`visible`)).toBe(true)
      menu.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
      await tick()
      expect(menu.classList.contains(`visible`)).toBe(false)
    }],
    [`click toggle`, async (wrapper: Element, menu: Element) => {
      await click(wrapper)
      expect(menu.classList.contains(`visible`)).toBe(true)
      await click(wrapper)
      expect(menu.classList.contains(`visible`)).toBe(false)
    }],
  ])(`dropdown interaction via %s`, async (_desc, interaction) => {
    mount(Nav, {
      target: document.body,
      props: { routes: [[`/parent`, [`/parent`, `/parent/child`]]] },
    })
    const dropdown_wrapper = doc_query(`.dropdown-wrapper`)
    const dropdown_menu = doc_query(`.dropdown-menu`)

    expect(dropdown_menu.classList.contains(`visible`)).toBe(false)
    await interaction(dropdown_wrapper, dropdown_menu)
  })

  test(`clicking dropdown menu item closes mobile menu`, async () => {
    const routes_with_dropdown = [
      [`/parent`, [`/parent`, `/parent/child1`, `/parent/child2`]],
    ]
    mount(Nav, { target: document.body, props: { routes: routes_with_dropdown } })

    const burger_button = doc_query(`.burger-button`)
    const dropdown_wrapper = doc_query(`.dropdown-wrapper`)
    const dropdown_menu = doc_query(`.dropdown-menu`)

    // Open mobile menu
    await click(burger_button)
    expect(burger_button.getAttribute(`aria-expanded`)).toBe(`true`)

    // Open dropdown
    await click(dropdown_wrapper)
    expect(dropdown_menu.classList.contains(`visible`)).toBe(true)

    // Click a dropdown menu item
    const dropdown_link = dropdown_menu.querySelector(`a`)
    if (dropdown_link) {
      await click(dropdown_link)
    }

    // Mobile menu should be closed
    expect(burger_button.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test.each([
    [
      `links with default rendering`,
      [`/test`, `/about`],
      (links: NodeListOf<Element>) => {
        expect(links).toHaveLength(2)
        expect(links[0].getAttribute(`href`)).toBe(`/test`)
        expect(links[1].getAttribute(`href`)).toBe(`/about`)
      },
    ],
    [`dropdown child routes`, [[`/parent`, [`/parent`, `/parent/child`]]], () => {
      const dropdown_links = document.querySelectorAll(`.dropdown-menu a`)
      expect(dropdown_links).toHaveLength(2)
      const hrefs = Array.from(dropdown_links).map((l) => l.getAttribute(`href`))
      expect(hrefs).toEqual([`/parent`, `/parent/child`])
    }],
    [`menu without page prop`, [`/test`], () => {
      expect(doc_query(`a[href="/test"]`).getAttribute(`aria-current`)).toBe(null)
    }],
  ])(`renders %s correctly`, (_desc, routes, assertions) => {
    mount(Nav, { target: document.body, props: { routes } })
    const links = document.querySelectorAll(`a`)
    assertions(links)
  })

  test.each([
    [`/plot-color-bar`, `plot color bar`, false, undefined],
    [`/nested/sub-route`, `nested/sub route`, false, undefined],
    [`/`, ``, false, undefined],
    [`/parent`, `parent`, false, undefined],
    [`/parent/long-child-name`, `long child name`, true, undefined],
    [
      `/hook-up-to-api`,
      `Hook up to external API`,
      false,
      { '/hook-up-to-api': `Hook up to external API` },
    ],
    [
      `/use-without-svelte`,
      `Use without Svelte`,
      false,
      { '/use-without-svelte': `Use without Svelte` },
    ],
  ])(`format_label: %s -> "%s"`, (route, expected, is_dropdown_child, labels) => {
    const routes = is_dropdown_child ? [[`/parent`, [`/parent`, route]]] : [route]
    mount(Nav, { target: document.body, props: { routes, labels } })

    const link = is_dropdown_child
      ? document.querySelectorAll(`.dropdown-menu a`)[1]
      : document.querySelector(`a[href="${route}"]`)

    expect(link?.textContent?.trim()).toBe(expected)
  })

  test(`custom labels skip text-transform capitalization`, () => {
    mount(Nav, {
      target: document.body,
      props: {
        routes: [`/auto`, `/custom`, [`/parent`, [`/parent/child`]]],
        labels: { '/custom': `Custom Label` },
      },
    })

    expect(doc_query(`a[href="/auto"]`).getAttribute(`style`)).toContain(`text-transform`)
    expect(doc_query(`a[href="/custom"]`).getAttribute(`style`)).toBe(``)
  })

  test(`dropdown accessibility and state management`, async () => {
    const mock_page = { url: { pathname: `/parent/child` } } as Page
    mount(Nav, {
      target: document.body,
      props: {
        routes: [
          [`/parent`, [`/parent`, `/parent/child`]],
          [`/other`, [`/other`]],
        ],
        page: mock_page,
      },
    })

    const [dropdown1, dropdown2] = Array.from(
      document.querySelectorAll(`.dropdown-wrapper`),
    )
    const menu1 = dropdown1.querySelector(`.dropdown-menu`) as HTMLElement

    // aria-expanded toggles correctly
    expect(dropdown1.getAttribute(`aria-expanded`)).toBe(`false`)
    await click(dropdown1)
    expect(dropdown1.getAttribute(`aria-expanded`)).toBe(`true`)
    expect(menu1.classList.contains(`visible`)).toBe(true)

    // Escape key closes dropdown
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(menu1.classList.contains(`visible`)).toBe(false)

    // Multiple dropdowns work independently
    await click(dropdown1)
    const menu2 = dropdown2.querySelector(`.dropdown-menu`) as HTMLElement
    expect(menu1.classList.contains(`visible`)).toBe(true)
    expect(menu2.classList.contains(`visible`)).toBe(false)

    await click(dropdown2)
    expect(menu1.classList.contains(`visible`)).toBe(false)
    expect(menu2.classList.contains(`visible`)).toBe(true)

    // aria-current applied to dropdown items
    const dropdown_links = dropdown1.querySelectorAll(`a`)
    expect(dropdown_links[0].getAttribute(`aria-current`)).toBe(`page`)
    expect(dropdown_links[1].getAttribute(`aria-current`)).toBe(`page`)
  })
})
