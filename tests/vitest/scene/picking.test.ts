import { TAP_MS, TouchTaps } from '#lib/scene/interactivity.js'
import { front_hit } from '#lib/scene/picking.js'
import { Object3D, Plane, Vector3 } from 'three/webgpu'
import { expect, test, vi } from 'vitest'

// Raycaster hits come sorted nearest first; each hit is labelled by its distance along z
const hit = (z_coord: number, pick_rank?: number) => {
  const object = new Object3D()
  if (pick_rank !== undefined) object.userData.pick_rank = pick_rank
  return { point: new Vector3(0, 0, z_coord), object, z_coord }
}

// clipped-off hits (z < 0) are skipped before ranking
const keeps_positive_z = new Plane(new Vector3(0, 0, 1), 0)

test.each([
  [`keeps only the nearest of equal ranks`, [hit(1), hit(2), hit(3)], null, [1]],
  [`an empty ray picks nothing`, [], null, []],
  [`a ranked hit beats nearer unranked ones`, [hit(1), hit(2, 1), hit(3)], null, [2]],
  [`the nearest of the top rank wins`, [hit(1), hit(2, 2), hit(3, 1), hit(4, 2)], null, [2]],
  [`a negative rank only wins on its own`, [hit(1, -1), hit(2)], null, [2]],
  [`a negative rank alone is still picked`, [hit(1, -1)], null, [1]],
  [`a clipped ranked hit loses`, [hit(-2, 5), hit(-1), hit(1), hit(2)], keeps_positive_z, [1]],
  [`all hits clipped picks nothing`, [hit(-2), hit(-1)], keeps_positive_z, []],
])(`front_hit: %s`, (_desc, hits, clip_plane, expected) => {
  expect(front_hit(hits, clip_plane).map(({ z_coord }) => z_coord)).toEqual(expected)
})

// Gestures (`name:object`) as threlte dispatches them to two touch_hover-wrapped objects (0, 1),
// or `miss` on empty space. A click (at most 8 px from its press, else threlte sends none) first
// reaches every object it missed, then the hit one. `release` is scene_interactivity's on orbit
// (hover raycasts off). Then the objects whose onclick ran and the one showing its tooltip.
test.each<[string, string, number[], number | null]>([
  [`a tap shows the tooltip and keeps it`, `tap:0`, [0], 0],
  [`a second tap on the same object hides it`, `tap:0 tap:0`, [0, 0], null],
  [`a tap on another object moves it there`, `tap:0 tap:1`, [0, 1], 1],
  [`an empty-space tap hides it`, `tap:0 miss`, [0], null],
  [`an orbit hides it, the next tap shows it again`, `tap:0 release tap:0`, [0, 0], 0],
  [`a drag shows nothing`, `drag:0`, [], null],
  [`a drag leaves a held tooltip alone`, `tap:0 drag:1`, [0], 0],
  [`a long press shows nothing`, `long_press:0`, [0], null],
  [`mouse hovers pass through`, `hover:0 hover:1`, [], 1],
  [`a mouse click holds nothing`, `hover:0 click:0 leave:0`, [0], null],
])(`TouchTaps: %s`, async (_desc, gestures, clicked, expected) => {
  const taps = new TouchTaps()
  let shown: number | null = null
  const on_click = vi.fn()
  const objects = [0, 1].map((idx) => {
    const eventObject = new Object3D()
    const props = taps.wrap({
      onpointerenter: () => (shown = idx),
      onpointermove: () => (shown = idx),
      onpointerleave: () => (shown = null),
      onclick: () => on_click(idx),
    })
    const at = (pointerType: string, timeStamp = 0) => {
      const nativeEvent = new PointerEvent(`click`, { pointerType })
      Object.defineProperty(nativeEvent, `timeStamp`, { value: timeStamp })
      return { eventObject, nativeEvent }
    }
    return { props, at }
  })
  for (const [gesture, idx] of gestures.split(` `).map((step) => step.split(`:`))) {
    if (gesture === `release`) taps.release()
    else if (gesture === `miss`) {
      const click = new MouseEvent(`click`)
      for (const { props } of objects) props.onpointermissed(click)
    } else {
      const { props, at } = objects[Number(idx)]
      const event = at([`hover`, `click`, `leave`].includes(gesture) ? `mouse` : `touch`)
      if (gesture === `hover`) props.onpointermove?.(event)
      if (gesture === `leave`) props.onpointerleave?.(event)
      if (gesture === `drag`) {
        const { onpointerdown, onpointerenter, onpointermove, onpointerleave } = props
        for (const handler of [onpointerdown, onpointerenter, onpointermove, onpointerleave])
          handler?.(event)
      }
      if ([`tap`, `long_press`, `click`].includes(gesture)) {
        props.onpointerdown?.(event)
        const click = at(
          event.nativeEvent.pointerType,
          gesture === `long_press` ? TAP_MS + 1 : TAP_MS,
        )
        for (const other of objects) {
          if (other.props !== props) other.props.onpointermissed(click.nativeEvent)
        }
        props.onclick?.(click)
      }
    }
    await Promise.resolve() // missed clicks release in a microtask
  }
  expect(on_click.mock.calls.flat()).toEqual(clicked)
  expect(shown).toBe(expected)
})
