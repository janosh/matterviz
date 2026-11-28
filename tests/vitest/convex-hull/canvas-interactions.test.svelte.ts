import {
  create_hull_selection,
  HOVER_PREVIEW_DELAY_MS,
} from '#lib/convex-hull/canvas-interactions.svelte'
import { build_entry_tooltip_text } from '#lib/convex-hull/helpers'
import { create_hull_data_pipeline } from '#lib/convex-hull/hull-state.svelte'
import type { AnyStructure } from '#lib/structure/index'
import { MAGNETIC_ORDERING_CATEGORY, type ConvexHullEntry } from '#lib/convex-hull/types'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { make_phase } from '../test-fixtures'

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
      set_probe: () => {},
      on_point_hover: () => undefined,
      on_file_load: () => undefined,
      entry_category: () => null,
      wrapper: () => undefined,
      actions: () => ({}),
      ...overrides,
    })
  })
  flushSync()
  return { selection, destroy }
}

describe(`create_hull_selection: copy and hover preview`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, `clipboard`, {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    })
  })
  afterEach(() => vi.useRealTimers())

  // a denied clipboard resolves false (the toast says so) rather than rejecting unseen
  it.each([
    [true, `lands`],
    [false, `is denied`],
  ])(`copy_entry_data resolves %s when the write %s`, async (lands) => {
    const { selection, destroy } = mount_selection()
    if (!lands)
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error(`denied`))
    expect(await selection.copy_entry_data(entry, { x: 1, y: 2 })).toBe(lands)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      build_entry_tooltip_text(entry, null),
    )
    destroy()
  })

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

// Category markers are applied once per model, so a threshold step keeps the plot entries'
// identities: selection, hover and popups match id-less entries by identity. The gas controls'
// config is only exposed for a gas some entry's elements derive from (O2, not N2, for Li-O).
it.each([
  [0.5, `N2`],
  [0.05, `O2`],
] as const)(
  `hull distance threshold %s keeps the marked plot entries (%s enabled)`,
  (threshold, gas) => {
    const entries = [
      make_phase({ Li: 1 }),
      make_phase({ O: 1 }),
      make_phase({ Li: 1, O: 1 }, -1, { magnetic_ordering: `FM` }),
      make_phase({ Li: 2, O: 1 }, -0.5, { magnetic_ordering: `AFM` }),
    ]
    let max_hull_dist = $state(1)
    let pipeline!: ReturnType<typeof create_hull_data_pipeline>
    const destroy = $effect.root(() => {
      pipeline = create_hull_data_pipeline({
        entries: () => entries,
        temperature: () => undefined,
        interpolate_temperature: () => true,
        max_interpolation_gap: () => 500,
        gas_config: () => ({ enabled_gases: [gas] }),
        gas_pressures: () => ({}),
        energy_source_mode: () => `on-the-fly`,
        components: () => undefined,
        open_elements: () => undefined,
        max_hull_dist_show_phases: () => max_hull_dist,
        show_stable: () => true,
        show_unstable: () => true,
        entry_category: () => MAGNETIC_ORDERING_CATEGORY,
        hidden_categories: () => [],
        label_threshold: () => 50,
        set_temperature: () => {},
        set_max_hull_dist_show_phases: (value) => (max_hull_dist = value),
        hide_labels: () => {},
      })
    })
    flushSync()
    max_hull_dist = 1
    flushSync()
    const before = pipeline.plot_entries
    expect(before.filter(({ marker }) => marker)).toHaveLength(2)
    max_hull_dist = threshold
    flushSync()
    expect(pipeline.plot_entries.length).toBeGreaterThan(0)
    for (const plot_entry of pipeline.plot_entries) expect(before).toContain(plot_entry)
    expect(pipeline.gas_config?.enabled_gases).toEqual(gas === `O2` ? [`O2`] : undefined)
    destroy()
  },
)
