import { TAP_MS, TouchTaps } from '#lib/scene/interactivity.js'
import { front_hit, SphereInstances } from '#lib/scene/picking.js'
import {
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three/webgpu'
import { expect, test, vi } from 'vitest'
import { make_rng } from '../numeric-helpers'

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

// nearest_only reports exactly the hit native instancing sorts first (same distance, point,
// face and instanceId), in dense clouds with duplicate markers (ties go to the lower instance)
// and under a non-uniformly scaled, rotated mesh transform
test.each([
  [1, 3000, 0.4],
  [2, 500, 0.1],
])(
  `SphereInstances nearest_only matches native front hits (seed %i, %i points)`,
  (seed, n_points, max_radius) => {
    const rng = make_rng(seed)
    const geometry = new SphereGeometry(1, 12, 12)
    const material = new MeshBasicMaterial()
    const fast = Object.assign(new SphereInstances(geometry, material, n_points), {
      nearest_only: true,
    })
    const native = new InstancedMesh(geometry, material, n_points)
    const matrix = new Matrix4()
    for (let idx = 0; idx < n_points; idx++) {
      // every 10th marker duplicates the one before it
      if (idx % 10 !== 9) {
        const radius = 0.05 + max_radius * rng()
        matrix
          .makeScale(radius, radius, radius)
          .setPosition(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2)
      }
      for (const mesh of [fast, native]) mesh.setMatrixAt(idx, matrix)
    }
    for (const mesh of [fast, native]) {
      mesh.rotation.set(0.3, -0.5, 0.1)
      mesh.scale.set(1, 2.5, 0.7)
      mesh.position.set(1, -2, 0.5)
      mesh.updateMatrixWorld(true)
    }
    let n_hit_rays = 0
    for (let ray_idx = 0; ray_idx < 80; ray_idx++) {
      const origin = new Vector3(rng() * 2 - 1, rng() * 2 - 1, 20)
      const target = new Vector3(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2).applyMatrix4(
        native.matrixWorld,
      )
      const raycaster = new Raycaster(origin, target.sub(origin).normalize())
      const [actual, [expected]] = [fast, native].map((mesh) =>
        raycaster.intersectObject(mesh),
      )
      expect(actual).toEqual(expected ? [{ ...expected, object: fast }] : [])
      if (expected) n_hit_rays++
    }
    expect(n_hit_rays).toBeGreaterThan(40) // dense enough that most rays cross many markers
  },
)

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
