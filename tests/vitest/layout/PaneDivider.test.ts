import PaneDivider from '$lib/layout/PaneDivider.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { expect, onTestFinished, test } from 'vitest'

const pointer_event = (
  type: string,
  init: { button?: number; clientX?: number; clientY?: number; pointerId?: number } = {},
): PointerEvent =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })

type PixelClamps = { min_px?: number; max_px?: number; second_min_px?: number }
const mount_divider = (
  orientation: `horizontal` | `vertical`,
  direction: `ltr` | `rtl` = `ltr`,
  ratio?: number,
  clamps: PixelClamps = {},
) => {
  const parent = document.createElement(`div`)
  parent.dir = direction
  parent.style.direction = direction
  document.body.append(parent)
  parent.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 100, y: 50, width: 400, height: 200 })
  const component = mount(PaneDivider, {
    target: parent,
    props: { orientation, ratio, ...clamps },
  })
  onTestFinished(() => unmount(component).finally(() => parent.remove()))
  flushSync()
  const divider = parent.querySelector<HTMLElement>(`[role="separator"]`)
  if (!divider) throw new Error(`Pane divider not found`)
  return { divider, parent }
}

test.each([
  [`horizontal`, `ltr`, { clientX: 400 }, `vertical`],
  [`horizontal`, `rtl`, { clientX: 200 }, `vertical`],
  [`vertical`, `ltr`, { clientY: 200 }, `horizontal`],
] as const)(
  `%s %s divider resizes during pointer movement`,
  (orientation, direction, position, aria) => {
    const { divider, parent } = mount_divider(orientation, direction)
    expect(divider.getAttribute(`aria-orientation`)).toBe(aria)
    divider.dispatchEvent(pointer_event(`pointerdown`, { pointerId: 7 }))
    divider.dispatchEvent(pointer_event(`pointermove`, { ...position, pointerId: 7 }))

    // The split changes before pointerup, rather than snapping on release.
    expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`75%`)
    divider.dispatchEvent(pointer_event(`pointerup`, { pointerId: 7 }))
    divider.dispatchEvent(pointer_event(`pointermove`, { pointerId: 7 }))
    expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`75%`)
  },
)

test.each([
  [`horizontal LTR`, `horizontal`, `ltr`, `ArrowRight`, undefined, 10, 85],
  [`horizontal RTL`, `horizontal`, `rtl`, `ArrowLeft`, undefined, 10, 85],
  [`vertical`, `vertical`, `ltr`, `ArrowDown`, undefined, 10, 85],
  [`non-finite start`, `horizontal`, `ltr`, `ArrowRight`, Number.NaN, 1, 55],
] as const)(
  `%s keyboard resizing clamps`,
  (_name, orientation, direction, key, ratio, repeats, expected) => {
    const { divider, parent } = mount_divider(orientation, direction, ratio)
    for (let repeat = 0; repeat < repeats; repeat++) {
      divider.dispatchEvent(
        new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true }),
      )
    }
    flushSync()
    const split_percentage = parent.style.getPropertyValue(`--split-pane-size`)
    expect(split_percentage.endsWith(`%`)).toBe(true)
    expect(Number(split_percentage.slice(0, -1))).toBeCloseTo(expected, 12)
    expect(divider.getAttribute(`aria-valuenow`)).toBe(`${expected}`)
  },
)

test(`an active drag ignores other pointers and ends on lost capture`, () => {
  const { divider, parent } = mount_divider(`horizontal`)
  divider.dispatchEvent(pointer_event(`pointerdown`, { pointerId: 7 }))
  divider.dispatchEvent(pointer_event(`pointerdown`, { pointerId: 8 }))
  divider.dispatchEvent(pointer_event(`pointermove`, { clientX: 400, pointerId: 8 }))
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`50%`)

  divider.dispatchEvent(pointer_event(`pointermove`, { clientX: 400, pointerId: 7 }))
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`75%`)
  divider.dispatchEvent(pointer_event(`lostpointercapture`, { pointerId: 7 }))
  divider.dispatchEvent(pointer_event(`pointermove`, { clientX: 200, pointerId: 7 }))
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`75%`)

  divider.dispatchEvent(pointer_event(`pointerdown`, { button: 1, pointerId: 9 }))
  divider.dispatchEvent(pointer_event(`pointermove`, { clientX: 200, pointerId: 9 }))
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`75%`)
})

// Pixel clamps tighten the [15%, 85%] ratio clamps using the container's measured size (400
// px wide, 200 px tall here); an over-constrained container settles at the first pane's floor,
// and a floor wider than the container caps at 100% rather than pushing the divider outside
test.each([
  [`min_px`, `horizontal`, { min_px: 120 }, { clientX: 120 }, 30, { clientX: 480 }, 85],
  [
    `min_px past the container`,
    `horizontal`,
    { min_px: 500, second_min_px: 50 },
    { clientX: 120 },
    100,
    { clientX: 480 },
    100,
  ],
  [`max_px`, `horizontal`, { max_px: 100 }, { clientX: 480 }, 25, { clientX: 120 }, 15],
  [
    `second_min_px`,
    `horizontal`,
    { second_min_px: 300 },
    { clientX: 480 },
    25,
    { clientX: 120 },
    15,
  ],
  [`vertical min_px`, `vertical`, { min_px: 80 }, { clientY: 60 }, 40, { clientY: 240 }, 85],
  [
    `both floors`,
    `horizontal`,
    { min_px: 200, second_min_px: 300 },
    { clientX: 120 },
    50,
    { clientX: 480 },
    50,
  ],
] as const)(
  `%s clamps pointer drags in pixels`,
  (_name, orientation, clamps, low, low_pct, high, high_pct) => {
    const { divider, parent } = mount_divider(orientation, `ltr`, 0.5, clamps)
    divider.dispatchEvent(pointer_event(`pointerdown`, { pointerId: 4 }))
    divider.dispatchEvent(pointer_event(`pointermove`, { ...low, pointerId: 4 }))
    expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`${low_pct}%`)
    divider.dispatchEvent(pointer_event(`pointermove`, { ...high, pointerId: 4 }))
    expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`${high_pct}%`)
  },
)

test(`an initial ratio outside the pixel clamps is shown clamped`, () => {
  const { divider, parent } = mount_divider(`horizontal`, `ltr`, 0.2, { min_px: 160 })
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`40%`)
  expect(divider.getAttribute(`aria-valuenow`)).toBe(`40`)
})
