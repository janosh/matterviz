import type { TapEvent } from '#lib/scene/index.js'
import type { BondPair, Site } from '#lib/structure/index.js'
import { make_site } from '#lib/structure/site.js'
import {
  ATOM_HOVER_CLEAR_DELAY_MS,
  bond_endpoint_hit_site_idx,
  bond_menu_position,
  EDIT_BONDS_CLICK_DEDUPE_MS,
  instance_handlers,
  is_shift_click,
  next_site_selection,
  type PickState,
  scene_cursor,
  ScenePointer,
} from '#lib/structure/scene-picking.svelte.js'
import { MAX_SELECTED_SITES } from '#lib/structure/measure.js'
import { Group, Vector3 } from 'three/webgpu'
import { describe, expect, onTestFinished, test, vi } from 'vitest'

const state = (overrides: Partial<PickState> = {}): PickState => ({
  measure_mode: `distance`,
  bond_edit_mode: `add`,
  bond_edits_enabled: true,
  add_atom_mode: false,
  interactive: true,
  measured_sites: [],
  selected_sites: [],
  hovered_idx: null,
  hovered_bond_key: null,
  can_select_bond_site: () => true,
  is_image_site: () => false,
  ...overrides,
})

// a selection whose measured and selected sites agree
const picks = (sites: number[]) => ({ measured_sites: sites, selected_sites: sites })

describe(`next_site_selection`, () => {
  // oxfmt-ignore
  test.each([
    [`distance adds a pick`, 2, state(picks([0])), picks([0, 2])],
    [`distance removes a repeat pick`, 0, state(picks([0, 1])), picks([1])],
    [`angle rolls the oldest pick out`, 3,
      state({ measure_mode: `angle`, measured_sites: [0, 1, 2], selected_sites: [0, 1, 2, 7] }),
      { measured_sites: [1, 2, 3], selected_sites: [1, 2, 7, 3] }],
    [`angle roll of a site already selected (not measured) moves it, not repeats it`, 5,
      state({ measure_mode: `angle`, measured_sites: [0, 1, 2], selected_sites: [5] }),
      { measured_sites: [1, 2, 5], selected_sites: [5] }],
    // measured picks decide: a selected-only site joins both lists instead of toggling off
    [`distance pick of a site selected but not measured`, 4,
      state({ measured_sites: [0], selected_sites: [4, 0] }), { measured_sites: [0, 4], selected_sites: [0, 4] }],
    [`angle re-pick at the cap toggles off, not rolls`, 1,
      state({ measure_mode: `angle`, ...picks([0, 1, 2]) }), picks([0, 2])],
    [`edit-atoms click replaces the selection`, 4, state({ measure_mode: `edit-atoms`, ...picks([1, 2]) }), picks([4])],
    [`edit-atoms click on a selected site clears it`, 1,
      state({ measure_mode: `edit-atoms`, selected_sites: [1] }), picks([])],
    [`edit-atoms shift-click toggles into the selection`, 4,
      state({ measure_mode: `edit-atoms`, selected_sites: [1] }), picks([1, 4]), true],
    [`edit-bonds delete mode clears`, 4,
      state({ measure_mode: `edit-bonds`, bond_edit_mode: `delete`, ...picks([1]) }), picks([])],
    [`edit-bonds first pick`, 4, state({ measure_mode: `edit-bonds` }), picks([4])],
    [`edit-bonds re-pick of the lone pick deselects without a pair`, 3,
      state({ measure_mode: `edit-bonds`, ...picks([3]) }), picks([])],
    [`edit-bonds second pick completes the bond pair`, 5,
      state({ measure_mode: `edit-bonds`, ...picks([3]) }), { ...picks([3, 5]), bond_pair: [3, 5] }],
  ] as const)(`%s`, (_label, site_idx, input, expected, shift: boolean = false) => {
    // toEqual treats an absent bond_pair as undefined, but fails on an unexpected pair
    expect(next_site_selection(site_idx, input, shift)).toEqual(expected)
  })

  // oxfmt-ignore
  test.each([
    [`inactive edit-bonds pane`, state({ measure_mode: `edit-bonds`, interactive: false })],
    [`unselectable bond site`, state({ measure_mode: `edit-bonds`, can_select_bond_site: () => false })],
    [`inactive edit-atoms pane`, state({ measure_mode: `edit-atoms`, interactive: false })],
    [`edit-atoms image site`, state({ measure_mode: `edit-atoms`, is_image_site: () => true })],
  ])(`%s leaves the selection unchanged`, (_label, input) => {
    expect(next_site_selection(1, input, false)).toBeNull()
  })

  test(`distance refuses a pick past the cap and warns`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => undefined)
    onTestFinished(() => warn.mockRestore())
    const full = Array.from({ length: MAX_SELECTED_SITES }, (_unused, idx) => idx)
    expect(
      next_site_selection(9, state({ measured_sites: full, selected_sites: full }), false),
    ).toBeNull()
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`limit reached (${MAX_SELECTED_SITES})`),
    )
  })
})

// oxfmt-ignore
test.each([
  [`threlte-wrapped shift click`, { nativeEvent: new MouseEvent(`click`, { shiftKey: true }) }, true],
  [`plain shift click`, new MouseEvent(`click`, { shiftKey: true }), true],
  [`shift pointerdown (site labels)`, new PointerEvent(`pointerdown`, { shiftKey: true }), true],
  [`unshifted click`, { nativeEvent: new MouseEvent(`click`) }, false],
  [`keyboard event`, new KeyboardEvent(`keydown`, { shiftKey: true }), false],
  [`no event`, undefined, false],
])(`is_shift_click: %s`, (_label, event, expected) => {
  expect(is_shift_click(event as Event | TapEvent | undefined)).toBe(expected)
})

// oxfmt-ignore
test.each([
  [`nothing hovered`, {}, `default`],
  [`inactive pane`, { interactive: false, hovered_idx: 0 }, `default`],
  [`add-atom mode`, { measure_mode: `edit-atoms`, add_atom_mode: true, hovered_idx: 0 }, `crosshair`],
  [`hovered bond`, { measure_mode: `edit-bonds`, hovered_bond_key: `0-1` }, `pointer`],
  // a hovered bond outranks the atom under it, which alone would give `pointer`
  [`hovered bond, edits disabled`,
    { measure_mode: `edit-bonds`, hovered_bond_key: `0-1`, bond_edits_enabled: false, hovered_idx: 0 }, `not-allowed`],
  [`edit-bonds selectable atom`, { measure_mode: `edit-bonds`, hovered_idx: 0 }, `pointer`],
  [`edit-bonds unselectable atom`,
    { measure_mode: `edit-bonds`, hovered_idx: 0, can_select_bond_site: () => false }, `not-allowed`],
  [`edit-bonds delete mode atom`,
    { measure_mode: `edit-bonds`, bond_edit_mode: `delete`, hovered_idx: 0 }, `not-allowed`],
  [`edit-atoms image atom`, { measure_mode: `edit-atoms`, hovered_idx: 0, is_image_site: () => true }, `not-allowed`],
  [`measurement atom`, { hovered_idx: 0 }, `pointer`],
] as const)(`scene_cursor: %s`, (_label, overrides, expected) => {
  expect(scene_cursor(state(overrides as Partial<PickState>))).toBe(expected)
})

describe(`bond endpoint picking`, () => {
  const bond: BondPair = {
    pos_1: [0, 0, 0],
    pos_2: [2, 0, 0],
    site_idx_1: 0,
    site_idx_2: 1,
    bond_length: 2,
  }
  // a translated parent: hits arrive in world space, sites sit in its local space
  const parent = new Group()
  parent.position.set(10, 0, 0)
  parent.updateMatrixWorld()
  const sites: Site[] = [
    make_site(`C`, [0, 0, 0], [0, 0, 0], `C`),
    make_site(`O`, [0, 0, 0], [-2, 0, 0], `O`),
    // the PBC image of site 1 drawn at the bond's far end
    { ...make_site(`O`, [0, 0, 0], [2, 0, 0], `O`), provenance: { image_of: 1 } },
  ]

  const zero_bond: BondPair = { ...bond, pos_2: bond.pos_1 }

  test.each([
    [`near end 1`, bond, 10.5, parent, sites, 0],
    [`middle`, bond, 11, parent, sites, null],
    [`near end 2 picks the image drawn there`, bond, 11.5, parent, sites, 2],
    [`near end 2 without sites picks the bonded site`, bond, 11.5, parent, undefined, 1],
    [`no hit point`, bond, undefined, parent, sites, null],
    [`no parent`, bond, 11.5, null, sites, null],
    [`zero-length bond`, zero_bond, 11.5, parent, sites, null],
  ])(`%s`, (_label, picked_bond, world_x, bond_parent, bond_sites, expected) => {
    const point = world_x === undefined ? undefined : new Vector3(world_x, 0, 0)
    expect(bond_endpoint_hit_site_idx(picked_bond, point, bond_parent, bond_sites)).toBe(
      expected,
    )
  })

  test(`menu anchors at the hit in parent space, else the bond midpoint`, () => {
    expect(bond_menu_position(bond)).toEqual([1, 0, 0])
    expect(bond_menu_position(bond, new Vector3(10.5, 1, 0), parent)).toEqual([0.5, 1, 0])
  })
})

describe(`ScenePointer`, () => {
  const make_pointer = () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const hover = { idx: null as number | null }
    const pointer = new ScenePointer({
      get: () => hover.idx,
      set: (site_idx) => (hover.idx = site_idx),
    })
    onTestFinished(pointer.dispose)
    return { pointer, hover }
  }

  test(`hover clears after the delay unless the pointer returns`, () => {
    const { pointer, hover } = make_pointer()
    pointer.set_hover(3)
    expect([hover.idx, pointer.tooltip_active]).toEqual([3, true])
    pointer.schedule_hover_clear(3)
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS - 1)
    pointer.set_hover(3) // back before the clear fired
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS)
    expect(hover.idx).toBe(3)
    pointer.schedule_hover_clear(3)
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS)
    expect([hover.idx, pointer.tooltip_active]).toEqual([null, false])
  })

  test(`clearing another site's hover is a no-op; drop_hover clears and cancels`, () => {
    const { pointer, hover } = make_pointer()
    pointer.set_hover(1)
    pointer.clear_hover(2)
    expect([hover.idx, pointer.tooltip_active]).toEqual([1, true])
    pointer.schedule_hover_clear(1)
    pointer.drop_hover()
    // the tooltip flag goes too, or an external hover would pop up the 3D tooltip
    expect([hover.idx, pointer.tooltip_active]).toEqual([null, false])
    // re-hover the same site: a surviving timer would clear it again
    pointer.set_hover(1)
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS)
    expect(hover.idx).toBe(1)
  })

  test(`dispose cancels a pending hover clear`, () => {
    const { pointer, hover } = make_pointer()
    pointer.set_hover(5)
    pointer.schedule_hover_clear(5)
    pointer.dispose()
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS)
    expect(hover.idx).toBe(5)
  })

  test(`set_hover hovers and cancels a scheduled clear, which clears after the delay`, () => {
    const { pointer, hover } = make_pointer()
    pointer.set_hover(7)
    expect(hover.idx).toBe(7)
    pointer.schedule_hover_clear(7)
    pointer.set_hover(7) // moving back over the atom cancels the clear
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS)
    expect(hover.idx).toBe(7)
    pointer.schedule_hover_clear(7)
    vi.advanceTimersByTime(ATOM_HOVER_CLEAR_DELAY_MS)
    expect(hover.idx).toBeNull()
  })

  test(`a pressed site's click is skipped once, within the dedupe window`, () => {
    const { pointer } = make_pointer()
    pointer.remember_press(2)
    expect([pointer.skip_pressed_click(1), pointer.skip_pressed_click(2)]).toEqual([
      false,
      true,
    ])
    expect(pointer.skip_pressed_click(2)).toBe(false)
    pointer.remember_press(2)
    vi.advanceTimersByTime(EDIT_BONDS_CLICK_DEDUPE_MS)
    expect(pointer.skip_pressed_click(2)).toBe(false)
  })
})

test(`instance_handlers map an instanceId to its record's site and ignore misses`, () => {
  const calls: [string, number, number | undefined][] = []
  const record = (name: string) => (site_idx: number, event: TapEvent) =>
    calls.push([name, site_idx, event.instanceId])
  const handlers = instance_handlers([{ site_idx: 4 }, { site_idx: 9 }], {
    onpointerenter: record(`enter`),
    onpointermove: record(`move`),
    onpointerleave: record(`leave`),
    onpointerdown: record(`down`),
    onclick: record(`click`),
  })
  const event = (instanceId?: number) => ({ nativeEvent: { timeStamp: 0 }, instanceId })
  handlers.onclick?.(event(1))
  handlers.onpointerenter?.(event(0))
  handlers.onpointerdown?.(event(5))
  handlers.onpointermove?.(event())
  expect(calls).toEqual([
    [`click`, 9, 1],
    [`enter`, 4, 0],
  ])
})
