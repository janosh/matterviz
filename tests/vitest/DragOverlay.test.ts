import { DragOverlay } from '$lib/feedback'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from './setup'

describe(`DragOverlay`, () => {
  test(`renders only when visible and forwards style (used for stacking by ConvexHullChrome)`, () => {
    mount(DragOverlay, { target: document.body, props: { visible: false } })
    expect(document.querySelector(`.drag-overlay`)).toBeNull()

    document.body.innerHTML = ``
    mount(DragOverlay, {
      target: document.body,
      props: { visible: true, message: `Drop it`, style: `z-index: 1` },
    })
    const overlay = doc_query<HTMLDivElement>(`.drag-overlay`)
    expect(overlay.style.zIndex).toBe(`1`)
    expect(overlay.textContent).toContain(`Drop it`)
  })
})
