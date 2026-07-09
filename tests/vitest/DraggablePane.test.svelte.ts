import { DraggablePane } from '$lib'
import { createRawSnippet, mount, tick } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

describe(`DraggablePane`, () => {
  const default_props = {
    children: createRawSnippet(() => ({ render: () => `Pane Content` })),
  }
  const click = (el: Element) => {
    el.dispatchEvent(new MouseEvent(`click`, { bubbles: true, cancelable: true }))
  }

  test(`no toggle when !show_pane`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show_pane: false },
    })
    expect(document.querySelector(`.pane-toggle`)).toBeNull()
  })

  test(`pane hidden when !show`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const pane: Element | null = document.querySelector(`.draggable-pane`)
    expect(pane).toBeInstanceOf(HTMLElement)
    expect(pane?.getAttribute(`style`)).toContain(`display: none`)
  })

  test(`toggle shows then hides pane with correct display and classes`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)
    let pane: Element | null = document.querySelector(`.draggable-pane`)

    // Initially hidden
    expect(pane?.classList.contains(`pane-open`)).toBe(false)
    expect(pane?.getAttribute(`style`)).toContain(`display: none`)

    // Click to show
    click(button)
    await tick()
    pane = document.querySelector(`.draggable-pane`)
    expect(pane?.classList.contains(`pane-open`)).toBe(true)
    expect(pane?.getAttribute(`style`)).toContain(`display: grid`)

    // Click to hide
    click(button)
    await tick()
    pane = document.querySelector(`.draggable-pane`)
    expect(pane?.classList.contains(`pane-open`)).toBe(false)
  })

  test(`calls onclose when closed`, () => {
    const onclose = vi.fn()
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, onclose, show: true, show_pane: true },
    })

    const button = doc_query(`.pane-toggle`)
    click(button)
    expect(onclose).toHaveBeenCalled()
  })

  test(`handles click outside pane correctly`, () => {
    const onclose = vi.fn()
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true, show_pane: true, onclose },
    })

    const pane = document.querySelector(`.draggable-pane`) as HTMLElement
    const button = document.querySelector(`button`) as HTMLElement

    expect(pane).toBeInstanceOf(HTMLElement)
    expect(button).toBeInstanceOf(HTMLElement)

    expect(onclose).not.toHaveBeenCalled()

    // Click outside pane (on document body)
    document.body.click()

    // Pane should close when clicking outside
    expect(onclose).toHaveBeenCalled()
  })

  test(`Escape closes only when pane is open`, async () => {
    const onclose = vi.fn()

    // First test: Escape when pane is closed should not call onclose
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, onclose, show: false },
    })

    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(onclose).not.toHaveBeenCalled()

    // Clean up and test second scenario
    document.body.innerHTML = ``
    onclose.mockClear()

    // Second test: Escape when pane is open should call onclose
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, onclose, show: true },
    })

    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  test(`toggle props applied`, () => {
    const toggle_props: HTMLAttributes<HTMLButtonElement> = {
      title: `Custom Title`,
      class: `custom-class`,
    }
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, toggle_props },
    })
    const button = doc_query(`.pane-toggle`)

    expect(button.getAttribute(`title`)).toBe(`Custom Title`)
    expect(button.classList.contains(`custom-class`)).toBe(true)
  })

  test(`pane props applied`, () => {
    const pane_props: HTMLAttributes<HTMLDivElement> = {
      class: `custom-pane-class`,
      'data-testid': `custom-pane`,
    }
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true, pane_props },
    })
    const pane = doc_query(`[data-testid="custom-pane"]`)

    expect(pane.classList.contains(`custom-pane-class`)).toBe(true)
    expect(pane.classList.contains(`toc-exclude`)).toBe(true)
  })

  test(`max_width applied`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true, max_width: `600px` },
    })
    const pane = doc_query(`.draggable-pane`)
    expect(pane.style.maxWidth).toBe(`600px`)
  })

  test(`fixed panes clamp below low toggle buttons`, async () => {
    const original_inner_height = window.innerHeight
    const original_inner_width = window.innerWidth
    Object.defineProperties(window, {
      innerHeight: { configurable: true, value: 800 },
      innerWidth: { configurable: true, value: 900 },
    })
    try {
      mount(DraggablePane, {
        target: document.body,
        props: { ...default_props, position: `fixed` },
      })
      const button = doc_query(`.pane-toggle`)
      const pane = doc_query<HTMLElement>(`.draggable-pane`)
      vi.spyOn(button, `getBoundingClientRect`).mockReturnValue({
        bottom: 760,
        height: 24,
        left: 430,
        right: 460,
        top: 736,
        width: 30,
        x: 430,
        y: 736,
        toJSON: () => ({}),
      } as DOMRect)
      vi.spyOn(pane, `getBoundingClientRect`).mockReturnValue({
        bottom: 1_000,
        height: 320,
        left: 0,
        right: 450,
        top: 760,
        width: 450,
        x: 0,
        y: 760,
        toJSON: () => ({}),
      } as DOMRect)

      click(button)
      await tick()

      expect(pane.style.top).toBe(`612px`)
      expect(pane.style.getPropertyValue(`--pane-viewport-clamp`)).toBe(`180px`)
    } finally {
      Object.defineProperties(window, {
        innerHeight: { configurable: true, value: original_inner_height },
        innerWidth: { configurable: true, value: original_inner_width },
      })
    }
  })

  test(`ARIA defaults`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)
    const pane = doc_query(`.draggable-pane`)

    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(pane.getAttribute(`aria-label`)).toBe(`Draggable pane`)
    expect(pane.getAttribute(`aria-modal`)).toBe(`false`)
  })

  test(`ARIA toggles on click`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)

    // Click to expand
    click(button)
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    // Click to collapse
    click(button)
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test(`renders control buttons with drag handle`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const control_tab = document.querySelector(`.control-tab`)
    expect(control_tab).toBeInstanceOf(HTMLDivElement)
    // Drag handle is always visible for dragging the pane
    expect(control_tab?.querySelector(`.drag-handle`)).toBeInstanceOf(SVGSVGElement)
  })
})
