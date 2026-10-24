import type { SaedOptions, SaedPatternData, SaedSpot } from '#lib/xrd/index.js'
import { compute_saed_pattern } from '#lib/xrd/saed.js'
import SaedPattern from '#lib/xrd/SaedPattern.svelte'
import { mount, tick, unmount } from 'svelte'
import { expect, test } from 'vitest'
import { bind_props, query, resize_element } from '../setup'
import { make_crystal } from '../test-fixtures'

// Simple cubic Al, by default down [001]: a square net of hk0 spots, strongest first
const crystal = make_crystal(4, [{ element: `Al`, abc: [0, 0, 0], label: `A1` }])
const saed = (options: SaedOptions = {}): SaedPatternData =>
  compute_saed_pattern(crystal, { zone_axis: [0, 0, 1], max_g: 0.6, ...options })
const pattern = saed()

test(`spots expose hover and a toggling pin matched by hkl, by pointer and keyboard`, async () => {
  const [first, second, third] = pattern.spots
  // pinned as a structurally equal copy, as a recomputed pattern would hand back
  const state = $state<{
    pattern: SaedPatternData
    hovered_spot: SaedSpot | null
    selected_spot: SaedSpot | null
  }>({ pattern, hovered_spot: null, selected_spot: { ...third, hkl: [...third.hkl] } })
  const component = mount(SaedPattern, { target: document.body, props: bind_props({}, state) })
  await resize_element(query(document.body, `.saed-pattern`), 400, 400)
  const circles = [...document.querySelectorAll<SVGCircleElement>(`circle.spot`)]
  expect(circles).toHaveLength(pattern.spots.length)
  const flags = (attr: string, value: string) =>
    circles.map((circle) => circle.getAttribute(attr) === value)
  const only = (spot_idx: number) => circles.map((_, idx) => idx === spot_idx)
  expect(flags(`aria-pressed`, `true`)).toEqual(only(2))

  circles[1].dispatchEvent(new MouseEvent(`mouseenter`))
  await tick()
  expect(state.hovered_spot).toEqual(second)
  expect(circles[1].classList.contains(`hovered`)).toBe(true)
  circles[1].dispatchEvent(new MouseEvent(`mouseleave`))
  expect(state.hovered_spot).toBeNull()

  // a click moves the pin, a second click on the pinned spot releases it
  for (const expected of [second, null]) {
    circles[1].dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(state.selected_spot).toEqual(expected)
    expect(flags(`aria-pressed`, `true`)).toEqual(only(expected ? 1 : -1))
  }

  // one tab stop; focus is the keyboard's hover, arrows step and Enter pins
  expect(flags(`tabindex`, `0`)).toEqual(only(0))
  circles[0].focus()
  await tick()
  expect(state.hovered_spot).toEqual(first)
  circles[0].dispatchEvent(new KeyboardEvent(`keydown`, { key: `ArrowRight`, bubbles: true }))
  await tick()
  expect(document.activeElement).toBe(circles[1])
  expect(state.hovered_spot).toEqual(second)
  circles[1].dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
  await tick()
  expect(state.selected_spot).toEqual(second)
  expect(circles[1].getAttribute(`aria-label`)).toBe(`(${second.hkl.join(`, `)}), ZOLZ`)

  // a new pattern re-resolves hover and pin by hkl: one still holding that reflection (down
  // [100], at another in-plane position) hands back its own spot, one lacking it drops both
  const side_view = saed({ zone_axis: [1, 0, 0] })
  const resolved = side_view.spots.find((spot) => spot.hkl.join(`,`) === second.hkl.join(`,`))
  expect(resolved?.position_2d).not.toEqual(second.position_2d)
  state.pattern = side_view
  await tick()
  expect(state).toMatchObject({ hovered_spot: resolved, selected_spot: resolved })
  state.pattern = saed({ zone_axis: [1, 1, 1] })
  await tick()
  expect(state).toMatchObject({ hovered_spot: null, selected_spot: null })
  await unmount(component)
})

test(`a pattern without spots overlays the shared empty state`, async () => {
  const component = mount(SaedPattern, {
    target: document.body,
    props: { pattern: { ...pattern, spots: [] } },
  })
  await resize_element(query(document.body, `.saed-pattern`), 400, 400)
  expect(
    document.querySelector(`.saed-pattern .empty-state.overlay[role="status"]`)?.textContent,
  ).toMatch(/No reflections satisfy the excitation condition/)
  await unmount(component)
})
