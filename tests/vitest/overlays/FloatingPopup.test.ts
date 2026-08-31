import FloatingPopup from '$lib/overlays/FloatingPopup.svelte'
import { type ComponentProps, createRawSnippet, flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, svg_query } from '../setup'

const mount_popup = (props: Partial<ComponentProps<typeof FloatingPopup>> = {}): void => {
  mount(FloatingPopup, { target: document.body, props })
  flushSync()
}

describe(`FloatingPopup`, () => {
  test.each([
    {
      name: `closes on Escape key`,
      act: () => globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` })),
      expect_close: true,
    },
    {
      name: `closes on click outside`,
      act: () => document.body.dispatchEvent(new MouseEvent(`click`, { bubbles: true })),
      expect_close: true,
    },
    {
      name: `can keep popups open on outside click`,
      props: { close_on_outside: false },
      act: () => document.body.dispatchEvent(new MouseEvent(`click`, { bubbles: true })),
      expect_close: false,
    },
    {
      name: `does not close on click inside`,
      act: () =>
        doc_query(`.floating-popup`).dispatchEvent(new MouseEvent(`click`, { bubbles: true })),
      expect_close: false,
    },
    {
      // the popup is draggable, so a press that starts outside must not close it before
      // the drag even begins; only the completed click does
      name: `ignores a bare mousedown outside`,
      act: () => document.body.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true })),
      expect_close: false,
    },
  ])(`$name`, ({ props = {}, act, expect_close }) => {
    const on_close = vi.fn()
    mount_popup({ on_close, ...props })
    act()
    if (expect_close) expect(on_close).toHaveBeenCalledOnce()
    else expect(on_close).not.toHaveBeenCalled()
  })

  test.each([
    { place: `right`, side_class: `right`, manual: false },
    { place: `left`, side_class: `left`, manual: false },
    { place: `manual`, side_class: `manual`, manual: true },
  ] as const)(`place=$place sets the placement class`, ({ place, side_class, manual }) => {
    mount_popup({ place, class: `custom-popup-class`, style: `left: 12px; top: 34px` })

    const popup = doc_query(`.floating-popup`)
    expect(popup.classList.contains(side_class)).toBe(true)
    expect(popup.classList.contains(`custom-popup-class`)).toBe(true)
    expect(popup.getAttribute(`role`)).toBe(`dialog`)
    // manual placement leaves positioning to the caller's inline style; the side placements
    // center vertically beside the positioned ancestor
    const { top, transform } = getComputedStyle(popup)
    if (manual) expect(top).toBe(`34px`)
    else expect(transform).toBe(`translateY(-50%)`)
  })

  // the close_button snippet handed to children is exercised by the StructurePopup and
  // BrillouinZonePopup tests, which place it in their viewers' control rows
  test(`renders children inside the content box`, () => {
    const children = createRawSnippet<[{ close_button: unknown }]>(() => ({
      render: () => `<div class="popup-body">body</div>`,
    }))
    mount_popup({ children })

    expect(doc_query(`.floating-popup-content .popup-body`).textContent).toBe(`body`)
  })

  test(`reuses draggable pane handle for dragging`, () => {
    mount_popup()

    const popup = doc_query(`.floating-popup`)
    const handle = svg_query(`.floating-popup .control-tab .drag-handle`)
    expect(handle).toBeInstanceOf(SVGSVGElement)

    // svelte-widgets' draggable follows the captured pointer on the handle itself, so the
    // move and release have to be dispatched there rather than on window
    const drag = (type: string, coords?: { clientX: number; clientY: number }) =>
      handle.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          isPrimary: true,
          button: 0,
          pointerId: 1,
          ...coords,
        }),
      )
    drag(`pointerdown`, { clientX: 10, clientY: 20 })
    drag(`pointermove`, { clientX: 35, clientY: 50 })
    drag(`pointerup`)

    expect(popup.style.left).toBe(`25px`)
    expect(popup.style.top).toBe(`30px`)
    expect(popup.style.right).toBe(`auto`)
    expect(popup.style.transform).toBe(``)
  })

  test(`can hide the drag handle`, () => {
    mount_popup({ show_drag_handle: false })

    const popups = [...document.querySelectorAll(`.floating-popup`)]
    const popup_children = [...(popups.at(-1)?.children ?? [])]
    expect(popup_children.some((child) => child.classList.contains(`control-tab`))).toBe(false)
  })

  test(`arrow_x draws a bottom pointer at that x, none by default`, () => {
    mount_popup()
    expect(document.querySelector(`.popup-arrow`)).toBeNull()
    mount_popup({ arrow_x: 42 })
    const arrow = doc_query(`.popup-arrow`)
    expect(arrow.style.left).toBe(`42px`)
    // sits after the content so it can paint over the content's bottom border
    expect(arrow.previousElementSibling?.classList.contains(`floating-popup-content`)).toBe(
      true,
    )
  })

  test(`clips popup content while leaving drag handle visible`, () => {
    mount_popup()

    expect(getComputedStyle(doc_query(`.floating-popup`)).overflow).toBe(`visible`)
    const content_style = getComputedStyle(doc_query(`.floating-popup-content`))
    expect(content_style.overflow).toBe(`hidden`)
    expect(content_style.borderRadius).toBe(`8px`)
  })
})
