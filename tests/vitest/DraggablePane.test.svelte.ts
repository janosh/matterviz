import { DraggablePane } from '$lib'
import { createRawSnippet, mount, tick } from 'svelte'
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

  test(`toggle shows then hides pane, updating display, classes and ARIA`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)
    const pane = doc_query(`.draggable-pane`)

    // Initially hidden, with ARIA defaults
    expect(pane.classList.contains(`pane-open`)).toBe(false)
    expect(pane.getAttribute(`style`)).toContain(`display: none`)
    expect(pane.getAttribute(`aria-label`)).toBe(`Draggable pane`)
    expect(pane.getAttribute(`aria-modal`)).toBe(`false`)
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)

    // Click to show
    click(button)
    await tick()
    expect(pane.classList.contains(`pane-open`)).toBe(true)
    expect(pane.getAttribute(`style`)).toContain(`display: grid`)
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    // Click to hide
    click(button)
    await tick()
    expect(pane.classList.contains(`pane-open`)).toBe(false)
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
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

  test(`click outside the pane closes it`, () => {
    const onclose = vi.fn()
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true, show_pane: true, onclose },
    })

    expect(onclose).not.toHaveBeenCalled()
    document.body.click()
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

  test(`toggle_props, pane_props and max_width forwarded to their elements`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: {
        ...default_props,
        show: true,
        max_width: `600px`,
        toggle_props: { title: `Custom Title`, class: `custom-class` },
        pane_props: { class: `custom-pane-class`, 'data-testid': `custom-pane` },
      },
    })

    const button = doc_query(`.pane-toggle`)
    expect(button.getAttribute(`title`)).toBe(`Custom Title`)
    expect(button.classList.contains(`custom-class`)).toBe(true)

    const pane = doc_query(`[data-testid="custom-pane"]`)
    expect(pane.classList.contains(`custom-pane-class`)).toBe(true)
    expect(pane.classList.contains(`toc-exclude`)).toBe(true)
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
      const pane = doc_query(`.draggable-pane`)
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
      })
      vi.spyOn(pane, `getBoundingClientRect`).mockReturnValue({
        bottom: 1000,
        height: 320,
        left: 0,
        right: 450,
        top: 760,
        width: 450,
        x: 0,
        y: 760,
        toJSON: () => ({}),
      })

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
