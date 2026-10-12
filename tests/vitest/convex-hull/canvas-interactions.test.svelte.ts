import {
  create_hull_selection,
  HOVER_PREVIEW_DELAY_MS,
} from '#lib/convex-hull/canvas-interactions.svelte.js'
import type { AnyStructure } from '#lib/structure/index.js'
import type { ConvexHullEntry } from '#lib/convex-hull/types.js'
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
function mount_selection(
  overrides: Partial<Parameters<typeof create_hull_selection>[0]> = {},
  entries: ConvexHullEntry[] = [entry],
) {
  let selection!: ReturnType<typeof create_hull_selection>
  const destroy = $effect.root(() => {
    selection = create_hull_selection({
      entries: () => entries,
      plot_entries: () => entries,
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
      ...overrides,
    })
  })
  flushSync()
  return { selection, destroy }
}

describe(`create_hull_selection timers: copy feedback and hover preview`, () => {
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

  it.each([`reset`, `destroy`] as const)(
    `%s clears the pending hide timer`,
    async (action) => {
      const { selection, destroy } = mount_selection()
      await selection.copy_entry_data(entry, { x: 1, y: 2 })
      selection.set_hover({ entry, position: { x: 1, y: 2 } })
      expect(vi.getTimerCount()).toBe(1)
      if (action === `reset`) {
        const pending_copy = selection.copy_entry_data(entry, { x: 3, y: 4 })
        selection.reset()
        await pending_copy
        expect(selection.hover_data).toBeNull()
        expect(selection.copy_feedback.visible).toBe(false)
      } else destroy()
      expect(vi.getTimerCount()).toBe(0)
      if (action === `reset`) destroy()
    },
  )

  // === Hover preview ===
  const with_structure = (entry_id: string) => ({
    ...entry,
    entry_id,
    structure: { sites: [], entry_id } as unknown as AnyStructure,
  })
  const [entry_a, entry_b] = [with_structure(`a`), with_structure(`b`)]
  const no_structure = { ...entry, entry_id: `c` }
  const entries = [entry_a, entry_b, no_structure]
  const hover = (target: ConvexHullEntry, x_pos = 1) => ({
    entry: target,
    position: { x: x_pos, y: 2 },
  })

  it(`opens after the delay, follows the pointer between entries, closes on leave, reset and pin`, () => {
    let enabled = false
    let selected: ConvexHullEntry | null = null
    const { selection, destroy } = mount_selection(
      {
        enable_structure_preview: () => enabled,
        selected_entry: () => selected,
        set_selected_entry: (value) => (selected = value),
      },
      entries,
    )
    const wait_for_preview = () => vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS)
    const preview_id = () => selection.preview?.entry.entry_id ?? null
    selection.set_hover(hover(entry_a))
    wait_for_preview()
    expect(preview_id()).toBeNull() // previews disabled
    enabled = true
    selection.set_hover(hover(entry_b))
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1)
    selection.set_hover(hover(entry_b, 5)) // moving within one point keeps the timer
    expect(preview_id()).toBeNull()
    vi.advanceTimersByTime(1)
    expect([preview_id(), selection.modal_open]).toEqual([`b`, false])
    expect(selection.preview?.structure).toBe(entry_b.structure)
    selection.set_hover(hover(entry_a)) // already showing: switches without a delay
    expect(preview_id()).toBe(`a`)
    selection.set_hover(hover(no_structure))
    expect(preview_id()).toBeNull()
    selection.set_hover(hover(entry_a)) // a fresh hover waits again, a reset cancels it
    selection.reset()
    wait_for_preview()
    expect(preview_id()).toBeNull()
    selection.set_hover(hover(entry_a))
    wait_for_preview()
    selection.select_entry(entry_a) // the pinned popup takes over
    expect([preview_id(), selection.modal_open]).toEqual([null, true])
    flushSync() // re-run the selection effect, which re-assigns the pinned structure
    // The raw entry structure, not a $state proxy of it: Structure compares identities
    expect(selection.selected_structure).toBe(entry_a.structure)
    selection.set_hover(hover(entry_b))
    wait_for_preview()
    expect(preview_id()).toBeNull() // no previews while a popup is pinned
    destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
