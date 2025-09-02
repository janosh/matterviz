import { DraggablePane } from '$lib'
import { mount, tick } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

describe(`DraggablePane`, () => {
  const default_props = { children: () => `Pane Content` }

  test(`renders toggle button when show_pane is true`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    expect(document.querySelector(`button`)).toBeTruthy()
  })

  test(`does not render toggle button when show_pane is false`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show_pane: false },
    })
    expect(document.querySelector(`button`)).toBeFalsy()
  })

  test(`renders pane when show is true`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const pane = document.querySelector(`.draggable-pane`)
    expect(pane).toBeTruthy()
    expect(pane?.getAttribute(`style`)).toContain(`display: grid`)
  })

  test(`hides pane when show is false`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const pane = document.querySelector(`.draggable-pane`)
    expect(pane).toBeTruthy()
    expect(pane?.getAttribute(`style`)).toContain(`display: none`)
  })

  test(`toggles pane visibility on button click`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`button`)
    const pane = document.querySelector(`.draggable-pane`)

    // Initially hidden
    expect(pane?.getAttribute(`style`)).toContain(`display: none`)

    // Click to show
    button.click()
    await tick()
    expect(pane?.getAttribute(`style`)).toContain(
      `max-width: 450px; top: 50px; left: 50px; display: none;`,
    )

    // Click to hide
    button.click()
    await tick()
    expect(pane?.getAttribute(`style`)).toContain(
      `max-width: 450px; top: 5px; left: -445px; display: grid; right: auto; bottom: auto;`,
    )
  })

  test(`calls onclose callback when pane is closed`, async () => {
    const onclose = vi.fn()
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, onclose, show: true, show_pane: true },
    })

    const button = doc_query(`button`)
    button.click()
    await tick()
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

    expect(pane).toBeTruthy()
    expect(button).toBeTruthy()

    expect(onclose).not.toHaveBeenCalled()

    // Click outside pane (on document body)
    document.body.click()

    // Pane should close when clicking outside
    expect(onclose).toHaveBeenCalled()
  })

  test(`closes pane on Escape key`, async () => {
    const onclose = vi.fn()
    mount(DraggablePane, {
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
    mount(DraggablePane, {
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
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, toggle_props },
    })
    const button = doc_query(`button`)

    expect(button.getAttribute(`title`)).toBe(`Custom Title`)
    expect(button.classList.contains(`custom-class`)).toBe(true)
  })

  test(`applies pane props correctly`, () => {
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
  })

  test(`applies max_width style to pane`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true, max_width: `600px` },
    })
    const pane = doc_query(`.draggable-pane`)
    expect(pane.style.maxWidth).toBe(`600px`)
  })

  test(`sets correct ARIA attributes`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`button`)
    const pane = doc_query(`.draggable-pane`)

    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(pane.getAttribute(`aria-label`)).toBe(`Draggable pane`)
    expect(pane.getAttribute(`aria-modal`)).toBe(`false`)
  })

  test(`updates ARIA expanded state when pane is toggled`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`button`)

    // Initially collapsed
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)

    // Click to expand
    button.click()
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)

    // Click to collapse
    button.click()
    await tick()
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)
  })

  test(`renders control buttons`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const control_buttons = document.querySelector(`.control-buttons`)

    expect(control_buttons).toBeTruthy()
    expect(control_buttons).toBeInstanceOf(HTMLDivElement)
  })

  test(`has correct CSS classes`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const pane = doc_query(`.draggable-pane`)

    expect(pane.classList.contains(`draggable-pane`)).toBe(true)
    expect(pane.classList.contains(`pane-open`)).toBe(true)
  })
})
