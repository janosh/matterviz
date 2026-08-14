import PaneDivider from '$lib/layout/PaneDivider.svelte'
import { flushSync, mount, unmount } from 'svelte'
import { expect, onTestFinished, test } from 'vitest'

const pointer_event = (
  type: string,
  init: { button?: number; clientX?: number; clientY?: number; pointerId?: number } = {},
): PointerEvent =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init })

const mount_divider = (
  orientation: `horizontal` | `vertical`,
  direction: `ltr` | `rtl` = `ltr`,
  ratio?: number,
) => {
  const parent = document.createElement(`div`)
  parent.dir = direction
  parent.style.direction = direction
  document.body.append(parent)
  parent.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 100, y: 50, width: 400, height: 200 })
  const component = mount(PaneDivider, { target: parent, props: { orientation, ratio } })
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
  [`horizontal`, `ltr`, `ArrowRight`],
  [`horizontal`, `rtl`, `ArrowLeft`],
  [`vertical`, `ltr`, `ArrowDown`],
] as const)(`%s %s keyboard resizing clamps with %s`, (orientation, direction, key) => {
  const { divider, parent } = mount_divider(orientation, direction)
  for (let repeat = 0; repeat < 10; repeat++) {
    divider.dispatchEvent(
      new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true }),
    )
  }
  flushSync()
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`85%`)
  expect(divider.getAttribute(`aria-valuenow`)).toBe(`85`)
})

test(`keyboard resizing starts from the safe ratio for non-finite input`, () => {
  const { divider, parent } = mount_divider(`horizontal`, `ltr`, Number.NaN)
  divider.dispatchEvent(
    new KeyboardEvent(`keydown`, { key: `ArrowRight`, bubbles: true, cancelable: true }),
  )
  flushSync()
  expect(parent.style.getPropertyValue(`--split-pane-size`)).toBe(`${0.55 * 100}%`)
  expect(divider.getAttribute(`aria-valuenow`)).toBe(`55`)
})

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
