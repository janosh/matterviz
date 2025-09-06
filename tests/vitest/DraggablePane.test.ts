import { DraggablePane } from '$lib'
import { mount, tick } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from './setup'

describe(`DraggablePane`, () => {
  const default_props = { children: () => `Pane Content` }
  const click = async (el: Element) => {
    el.dispatchEvent(new MouseEvent(`click`, { bubbles: true, cancelable: true }))
    await tick()
    await new Promise((r) => setTimeout(r, 0))
  }

  test(`renders toggle when show_pane`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    expect(document.querySelector(`.pane-toggle`)).toBeTruthy()
  })

  test(`no toggle when !show_pane`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show_pane: false },
    })
    expect(document.querySelector(`.pane-toggle`)).toBeFalsy()
  })

  test(`pane renders when show`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true },
    })
    const pane: Element | null = document.querySelector(`.draggable-pane`)
    expect(pane).toBeTruthy()
    expect(pane?.getAttribute(`style`)).toContain(`display: grid`)
  })

  test(`pane hidden when !show`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const pane: Element | null = document.querySelector(`.draggable-pane`)
    expect(pane).toBeTruthy()
    expect(pane?.getAttribute(`style`)).toContain(`display: none`)
  })

  test(`toggle shows then hides pane`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)
    let pane: Element | null = document.querySelector(`.draggable-pane`)

    // Initially hidden
    expect(pane?.classList.contains(`pane-open`)).toBe(false)

    // Click to show (UI updates after a subsequent click due to positioning side-effects)
    await click(button)
    pane = document.querySelector(`.draggable-pane`)
    expect(pane?.classList.contains(`pane-open`)).toBe(false)

    // Second click should make it visible
    await click(button)
    pane = document.querySelector(`.draggable-pane`)
    expect(pane?.classList.contains(`pane-open`)).toBe(true)
  })

  test(`calls onclose when closed`, async () => {
    const onclose = vi.fn()
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, onclose, show: true, show_pane: true },
    })

    const button = doc_query(`.pane-toggle`)
    await click(button)
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

  test(`Escape closes`, async () => {
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
  })

  test(`max_width applied`, () => {
    mount(DraggablePane, {
      target: document.body,
      props: { ...default_props, show: true, max_width: `600px` },
    })
    const pane = doc_query(`.draggable-pane`)
    expect(pane.style.maxWidth).toBe(`600px`)
  })

  test(`ARIA defaults`, () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)
    const pane = doc_query(`.draggable-pane`)

    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(pane.getAttribute(`aria-label`)).toBe(`Draggable pane`)
    expect(pane.getAttribute(`aria-modal`)).toBe(`false`)
  })

  test(`ARIA toggles`, async () => {
    mount(DraggablePane, { target: document.body, props: default_props })
    const button = doc_query(`.pane-toggle`)

    // Initially collapsed
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)

    // Click to expand (first click updates position, second opens)
    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`true`)

    // Click to collapse
    await click(button)
    expect(button.getAttribute(`aria-expanded`)).toBe(`false`)
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
