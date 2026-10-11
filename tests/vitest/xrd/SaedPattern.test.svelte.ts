import type { SaedSpot } from '#lib/xrd/index.js'
import { compute_saed_pattern } from '#lib/xrd/saed.js'
import SaedPattern from '#lib/xrd/SaedPattern.svelte'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import { bind_props, query, resize_element } from '../setup'
import { make_crystal } from '../test-fixtures'

// Simple cubic Al down [001]: a square net of hk0 spots, strongest first
const pattern = compute_saed_pattern(
  make_crystal(4, [{ element: `Al`, abc: [0, 0, 0], label: `A1` }]),
  { zone_axis: [0, 0, 1], max_g: 0.6 },
)

let component: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ``
})

const mount_saed = async (state: {
  hovered_spot: SaedSpot | null
  selected_spot: SaedSpot | null
}): Promise<SVGCircleElement[]> => {
  component = mount(SaedPattern, {
    target: document.body,
    props: bind_props({ pattern }, state),
  })
  await resize_element(query(document.body, `.saed-pattern`), 400, 400)
  return [...document.querySelectorAll<SVGCircleElement>(`circle.spot`)]
}

test(`spots expose hover and a toggling pin with their hkl, by pointer and keyboard`, async () => {
  const state = $state<{ hovered_spot: SaedSpot | null; selected_spot: SaedSpot | null }>({
    hovered_spot: null,
    selected_spot: null,
  })
  const circles = await mount_saed(state)
  expect(circles).toHaveLength(pattern.spots.length)
  expect(pattern.spots.length).toBeGreaterThan(4)
  // every spot lies in the zero-order zone of [001], so its hkl has l = 0
  expect(pattern.spots.every(({ hkl }) => hkl[2] === 0)).toBe(true)
  const [first, second] = pattern.spots
  const pressed = () => circles.map((circle) => circle.getAttribute(`aria-pressed`))

  circles[1].dispatchEvent(new MouseEvent(`mouseenter`))
  await tick()
  expect(state.hovered_spot).toEqual(second)
  expect(circles[1].classList.contains(`hovered`)).toBe(true)
  circles[1].dispatchEvent(new MouseEvent(`mouseleave`))
  expect(state.hovered_spot).toBeNull()

  circles[1].dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
  await tick()
  expect(state.selected_spot).toEqual(second)
  expect(pressed().filter((val) => val === `true`)).toHaveLength(1)
  expect(circles[1].classList.contains(`selected`)).toBe(true)
  circles[1].dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
  await tick()
  expect(state.selected_spot).toBeNull()
  expect(pressed().every((val) => val === `false`)).toBe(true)

  // one tab stop; focus is the keyboard's hover, arrows step and Enter pins
  expect(circles.filter((circle) => circle.getAttribute(`tabindex`) === `0`)).toEqual([
    circles[0],
  ])
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
})

test(`a pin is matched by hkl, so it survives a recomputed pattern`, async () => {
  const state = $state<{ hovered_spot: SaedSpot | null; selected_spot: SaedSpot | null }>({
    hovered_spot: null,
    // a structurally equal copy, as a recomputed pattern would hand back
    selected_spot: { ...pattern.spots[2], hkl: [...pattern.spots[2].hkl] },
  })
  const circles = await mount_saed(state)
  expect(circles.map((circle) => circle.classList.contains(`selected`))).toEqual(
    circles.map((_, idx) => idx === 2),
  )
})
