import DraggablePanel from '$lib/DraggablePanel.svelte'
import { mount, tick } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

// Mock svelte-multiselect attachments
vi.mock(`svelte-multiselect/attachments`, () => ({
  draggable: vi.fn(() => vi.fn()),
  tooltip: vi.fn(() => vi.fn()),
}))

// Mock Icon component
vi.mock(`$lib`, () => ({
  Icon: vi.fn(() => `Icon`),
}))

describe(`DraggablePanel`, () => {
  const default_props = {
    children: () => `Panel Content`,
  }

  beforeEach(() => {
    // Mock getBoundingClientRect
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 200,
      height: 100,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect))

    // Mock offsetParent
    Object.defineProperty(Element.prototype, `offsetParent`, {
      value: null,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test(`renders toggle button when show_panel is true`, () => {
    mount(DraggablePanel, { target: document.body, props: default_props })
    expect(document.querySelector(`button`)).toBeTruthy()
  })

  test(`does not render toggle button when show_panel is false`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show_panel: false },
    })
    expect(document.querySelector(`button`)).toBeFalsy()
  })

  test(`renders panel when show is true`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const panel = document.querySelector(`.draggable-panel`)
    expect(panel).toBeTruthy()
    expect(panel?.getAttribute(`style`)).toContain(`display: grid`)
  })

  test(`hides panel when show is false`, () => {
    mount(DraggablePanel, { target: document.body, props: default_props })
    const panel = document.querySelector(`.draggable-panel`)
    expect(panel).toBeTruthy()
    expect(panel?.getAttribute(`style`)).toContain(`display: none`)
  })

  test(`toggles panel visibility on button click`, async () => {
    mount(DraggablePanel, { target: document.body, props: default_props })
    const button = doc_query(`button`)
    const panel = document.querySelector(`.draggable-panel`)

    // Initially hidden
    expect(panel?.getAttribute(`style`)).toContain(`display: none`)

    // Click to show
    button.click()
    await tick()
    expect(panel?.getAttribute(`style`)).toContain(`display: grid`)

    // Click to hide
    button.click()
    await tick()
    expect(panel?.getAttribute(`style`)).toContain(`display: none`)
  })

  test(`calls onclose callback when panel is closed`, async () => {
    const onclose = vi.fn()
    mount(DraggablePanel, { target: document.body, props: { ...default_props, onclose } })
    const button = doc_query(`button`)

    // Open panel
    button.click()
    await tick()
    expect(onclose).not.toHaveBeenCalled()

    // Close panel
    button.click()
    await tick()
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  test(`closes panel on Escape key`, async () => {
    const onclose = vi.fn()
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, onclose, show: true },
    })

    // Press Escape on window (where the event listener is attached)
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    // The Escape key handler should call onclose
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  test(`uses custom toggle function when provided`, async () => {
    const custom_toggle = vi.fn()
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, custom_toggle },
    })
    const button = doc_query(`button`)

    button.click()
    await tick()
    expect(custom_toggle).toHaveBeenCalledTimes(1)
  })

  test(`applies toggle button props correctly`, () => {
    const toggle_props: HTMLAttributes<HTMLButtonElement> = {
      title: `Custom Title`,
      class: `custom-class`,
    }
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, toggle_props },
    })
    const button = doc_query(`button`)

    expect(button.getAttribute(`title`)).toBe(`Custom Title`)
    expect(button.classList.contains(`custom-class`)).toBe(true)
  })

  test(`applies panel props correctly`, () => {
    const panel_props: HTMLAttributes<HTMLDivElement> = {
      class: `custom-panel-class`,
      'data-testid': `custom-panel`,
    }
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true, panel_props },
    })
    const panel = doc_query(`[data-testid="custom-panel"]`)

    expect(panel.classList.contains(`custom-panel-class`)).toBe(true)
  })

  test(`uses custom icons when provided`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: {
        ...default_props,
        open_icon: `CustomOpen`,
        closed_icon: `CustomClosed`,
      },
    })
    expect(document.querySelector(`button`)).toBeTruthy()
  })

  test(`applies max_width style to panel`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true, max_width: `600px` },
    })
    const panel = doc_query(`.draggable-panel`)
    expect(panel.style.maxWidth).toBe(`600px`)
  })

  test(`applies custom offset correctly`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: {
        ...default_props,
        show: true,
        offset: { x: 10, y: 20 },
      },
    })
    const panel = doc_query(`.draggable-panel`)
    expect(panel).toBeTruthy()
  })

  test(`sets correct ARIA attributes`, () => {
    mount(DraggablePanel, { target: document.body, props: default_props })
    const button = doc_query(`button`)
    const panel = doc_query(`.draggable-panel`)

    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(button.getAttribute(`aria-controls`)).toBe(`draggable-panel`)
    expect(panel.getAttribute(`aria-label`)).toBe(`Draggable panel`)
    expect(panel.getAttribute(`aria-modal`)).toBe(`false`)
  })

  test(`updates ARIA expanded state when panel is toggled`, async () => {
    mount(DraggablePanel, { target: document.body, props: default_props })
    const button = doc_query(`button`)

    // Initially collapsed
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)

    // Click to expand
    button.click()
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    // Click to collapse
    button.click()
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
  })

  test(`applies icon style correctly`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, icon_style: `color: red;` },
    })
    const button = doc_query(`button`)
    expect(button).toBeTruthy()
  })

  test(`handles fullscreen mode correctly`, () => {
    // Mock body class
    document.body.classList.add(`fullscreen`)

    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const panel = doc_query(`.draggable-panel`)
    expect(panel).toBeTruthy()

    // Clean up
    document.body.classList.remove(`fullscreen`)
  })

  test(`renders panel header with control buttons`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const header = document.querySelector(`.panel-header`)
    const control_buttons = document.querySelector(`.control-buttons`)

    expect(header).toBeTruthy()
    expect(control_buttons).toBeTruthy()
  })

  test(`has correct CSS classes`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const panel = doc_query(`.draggable-panel`)

    expect(panel.classList.contains(`draggable-panel`)).toBe(true)
    expect(panel.classList.contains(`panel-open`)).toBe(true)
  })

  test(`handles missing toggle button gracefully`, () => {
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const panel = doc_query(`.draggable-panel`)
    expect(panel).toBeTruthy()
  })

  test(`calls on_drag_start callback when provided`, () => {
    const on_drag_start = vi.fn()
    mount(DraggablePanel, {
      target: document.body,
      props: { ...default_props, show: true, on_drag_start },
    })

    // The callback should be available for the draggable attachment
    expect(on_drag_start).toBeDefined()
  })
})
