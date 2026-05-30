import type { StructurePopupContext } from '$lib/convex-hull'
import StructurePopup from '$lib/convex-hull/StructurePopup.svelte'
import { createRawSnippet, flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, make_crystal, svg_query } from '../setup'

const mock_structure = make_crystal(3, [[`Li`, [0, 0, 0], 1]])

describe(`StructurePopup`, () => {
  test(`closes on Escape key`, () => {
    const onclose = vi.fn()
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure, onclose },
    })
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    expect(onclose).toHaveBeenCalledOnce()
  })

  test(`closes on click outside`, () => {
    const onclose = vi.fn()
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure, onclose },
    })
    flushSync()
    document.body.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true }))
    expect(onclose).toHaveBeenCalledOnce()
  })

  test(`does not close on click inside`, () => {
    const onclose = vi.fn()
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure, onclose },
    })
    doc_query(`.structure-popup`).dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true }))
    expect(onclose).not.toHaveBeenCalled()
  })

  test(`requests hover-visible structure controls`, () => {
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure, width: 360, height: 360 },
    })
    flushSync()

    const controls = doc_query(`.structure-popup .control-buttons`)
    expect(controls.classList.contains(`hover-visible`)).toBe(true)
    expect(controls.classList.contains(`always-visible`)).toBe(false)
    const structure_style = doc_query(`.structure-popup .structure`).style
    expect(structure_style.getPropertyValue(`--struct-width`)).toBe(`360px`)
    expect(structure_style.getPropertyValue(`--struct-height`)).toBe(`360px`)
  })

  test(`preserves custom popup classes`, () => {
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure, class: `custom-popup-class` },
    })
    flushSync()

    expect(doc_query(`.structure-popup`).classList.contains(`custom-popup-class`)).toBe(true)
  })

  test(`reuses draggable pane handle for dragging`, () => {
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure },
    })
    flushSync()

    const popup = doc_query(`.structure-popup`)
    const handle = svg_query(`.structure-popup .control-tab .drag-handle`)
    expect(handle).toBeInstanceOf(SVGSVGElement)

    handle.dispatchEvent(
      new MouseEvent(`mousedown`, { bubbles: true, clientX: 10, clientY: 20 }),
    )
    globalThis.dispatchEvent(new MouseEvent(`mousemove`, { clientX: 35, clientY: 50 }))
    globalThis.dispatchEvent(new MouseEvent(`mouseup`, { bubbles: true }))

    expect(popup.style.left).toBe(`25px`)
    expect(popup.style.top).toBe(`30px`)
    expect(popup.style.right).toBe(`auto`)
    expect(popup.style.transform).toBe(``)
  })

  test(`clips popup content while leaving drag handle visible`, () => {
    mount(StructurePopup, {
      target: document.body,
      props: { structure: mock_structure },
    })
    flushSync()

    expect(getComputedStyle(doc_query(`.structure-popup`)).overflow).toBe(`visible`)
    const content_style = getComputedStyle(doc_query(`.structure-popup-content`))
    expect(content_style.overflow).toBe(`hidden`)
    expect(content_style.borderRadius).toBe(`8px`)
  })

  test.each([
    { formula_source: `structure composition`, stats: { id: `test-id` } },
    { formula_source: `stats formula`, stats: { id: `test-id`, formula: `Li2O` } },
  ])(
    `renders subscripted formula from $formula_source in stats box`,
    ({ stats: popup_stats }) => {
      const structure = make_crystal(3, [
        [`Li`, [0, 0, 0], 1],
        [`Li`, [0.5, 0.5, 0.5], 1],
        [`O`, [0.25, 0.25, 0.25], -2],
      ])
      mount(StructurePopup, {
        target: document.body,
        props: { structure, stats: popup_stats },
      })
      flushSync()

      const stats_box = doc_query(`.structure-stats`)
      expect(stats_box.textContent).toContain(`test-id`)
      expect(stats_box.innerHTML).toContain(`Li<sub>2</sub>`)
    },
  )

  test(`custom top_left snippet replaces default stats content`, () => {
    let received_context: StructurePopupContext | undefined
    const top_left = createRawSnippet<[StructurePopupContext]>((context) => {
      received_context = context()
      return {
        render: () =>
          `<strong class="custom-popup-info">${context().stats?.id} custom</strong>`,
      }
    })

    mount(StructurePopup, {
      target: document.body,
      props: {
        structure: mock_structure,
        stats: { id: `custom-id`, formula: `Li2O` },
        top_left,
      },
    })
    flushSync()

    const stats = doc_query(`.structure-stats`)
    expect(stats.textContent).toBe(`custom-id custom`)
    expect(stats.innerHTML).not.toContain(`ID =`)
    expect(stats.querySelector(`.custom-popup-info`)).toBeInstanceOf(HTMLElement)
    expect(received_context?.structure).toBe(mock_structure)
    expect(received_context?.formula_html).toContain(`Li<sub>2</sub>`)
  })

  test(`renders children beside the structure with shared context`, () => {
    const children = createRawSnippet<[StructurePopupContext]>((context) => ({
      render: () => `<div class="popup-children">${context().stats?.id} extra</div>`,
    }))

    mount(StructurePopup, {
      target: document.body,
      props: {
        structure: mock_structure,
        stats: { id: `mp-1` },
        children,
      },
    })
    flushSync()

    const extra = doc_query(`.structure-popup-content .popup-children`)
    expect(extra.textContent).toBe(`mp-1 extra`)
  })
})
