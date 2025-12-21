import StructurePopup from '$lib/convex-hull/StructurePopup.svelte'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { make_crystal } from '../setup'

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
    document.querySelector(`.structure-popup`)?.dispatchEvent(
      new MouseEvent(`mousedown`, { bubbles: true }),
    )
    expect(onclose).not.toHaveBeenCalled()
  })
})
