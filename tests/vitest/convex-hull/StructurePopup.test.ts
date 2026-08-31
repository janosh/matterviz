import type { StructurePopupContext } from '$lib/convex-hull'
import StructurePopup from '$lib/convex-hull/StructurePopup.svelte'
import { type ComponentProps, createRawSnippet, flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, make_crystal } from '../setup'

// The shared shell (Escape/click-outside dismissal, dragging, drag tab) is covered by
// tests/vitest/overlays/FloatingPopup.test.ts; these cover what StructurePopup adds

const mock_structure = make_crystal(3, [[`Li`, [0, 0, 0], 1]])

const mount_popup = (props: Partial<ComponentProps<typeof StructurePopup>> = {}): void => {
  mount(StructurePopup, {
    target: document.body,
    props: { structure: mock_structure, ...props },
  })
  flushSync()
}

describe(`StructurePopup`, () => {
  test.each([
    { place_right: true, side_class: `right` },
    { place_right: false, side_class: `left` },
  ])(
    `place_right=$place_right maps to the shell's $side_class placement`,
    ({ place_right, side_class }) => {
      mount_popup({ place_right, class: `custom-popup-class` })

      const popup = doc_query(`.structure-popup`)
      expect(popup.classList.contains(`floating-popup`)).toBe(true)
      expect(popup.classList.contains(side_class)).toBe(true)
      expect(popup.classList.contains(`custom-popup-class`)).toBe(true)
    },
  )

  test(`requests hover-visible structure controls and forwards on_close to the shell`, () => {
    const on_close = vi.fn()
    mount_popup({ width: 360, height: 360, on_close })

    const controls = doc_query(`.structure-popup .control-buttons`)
    expect(controls.classList.contains(`hover-visible`)).toBe(true)
    expect(controls.classList.contains(`always-visible`)).toBe(false)
    const structure_style = doc_query(`.structure-popup .structure`).style
    expect(structure_style.getPropertyValue(`--struct-width`)).toBe(`360px`)
    expect(structure_style.getPropertyValue(`--struct-height`)).toBe(`360px`)

    // the shell's close button in the viewer's control row, and its Escape handling
    doc_query<HTMLButtonElement>(`.structure-popup .control-buttons .close-btn`).click()
    expect(on_close).toHaveBeenCalledOnce()
    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    expect(on_close).toHaveBeenCalledTimes(2)
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
      mount_popup({ structure, stats: popup_stats })

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

    mount_popup({ stats: { id: `custom-id`, formula: `Li2O` }, top_left })

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

    mount_popup({ stats: { id: `mp-1` }, children })

    const extra = doc_query(`.floating-popup-content .popup-children`)
    expect(extra.textContent).toBe(`mp-1 extra`)
  })
})
