import { create_hull_selection } from '$lib/convex-hull/canvas-interactions.svelte'
import type { ConvexHullEntry } from '$lib/convex-hull/types'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const entry: ConvexHullEntry = {
  composition: { Li: 1, O: 1 },
  energy: -1,
  entry_id: `li-o`,
  e_above_hull: 0,
  x: 0.5,
  y: 0,
  z: 0,
  is_element: false,
}

// Factory under an effect root so its $effect cleanups run on destroy, like a component's
function mount_selection() {
  let selection!: ReturnType<typeof create_hull_selection>
  const destroy = $effect.root(() => {
    selection = create_hull_selection({
      entries: () => [entry],
      plot_entries: () => [entry],
      selected_entry: () => null,
      set_selected_entry: () => {},
      enable_click_selection: () => true,
      enable_structure_preview: () => false,
      allow_file_drop: () => false,
      on_point_click: () => undefined,
      on_point_hover: () => undefined,
      on_file_drop: () => undefined,
      entry_category: () => null,
      wrapper: () => undefined,
      actions: () => ({}),
    })
  })
  flushSync()
  return { selection, destroy }
}

describe(`create_hull_selection copy feedback`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    })
  })
  afterEach(() => vi.useRealTimers())

  it(`a second copy restarts the hide timer instead of hiding the fresh feedback early`, async () => {
    const { selection, destroy } = mount_selection()
    await selection.copy_entry_data(entry, { x: 1, y: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    await selection.copy_entry_data(entry, { x: 3, y: 4 })
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000) // first copy's 1.5 s window has passed
    expect(selection.copy_feedback).toEqual({ visible: true, position: { x: 3, y: 4 } })
    await vi.advanceTimersByTimeAsync(500)
    expect(selection.copy_feedback.visible).toBe(false)
    destroy()
  })

  it(`destroying the owner clears the pending hide timer`, async () => {
    const { selection, destroy } = mount_selection()
    await selection.copy_entry_data(entry, { x: 1, y: 2 })
    expect(vi.getTimerCount()).toBe(1)
    destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
