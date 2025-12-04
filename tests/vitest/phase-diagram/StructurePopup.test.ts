import type { AnyStructure } from '$lib'
import StructurePopup from '$lib/phase-diagram/StructurePopup.svelte'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

const mock_structure: AnyStructure = {
  sites: [{
    species: [{ element: `Li`, occu: 1, oxidation_state: 1 }],
    xyz: [0, 0, 0],
    abc: [0, 0, 0],
    label: `Li`,
    properties: {},
  }],
  lattice: {
    matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
    pbc: [true, true, true],
    a: 3,
    b: 3,
    c: 3,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 27,
  },
}

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
    const event = new MouseEvent(`mousedown`, { bubbles: true })
    Object.defineProperty(event, `target`, { value: document.body })
    globalThis.dispatchEvent(event)
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
