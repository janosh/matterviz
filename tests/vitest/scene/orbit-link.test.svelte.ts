// Orbit link (scene/orbit-link): orbiting one member turns the others to its view direction,
// each keeping its own orbit target and distance, and its gestures read as theirs
import { lock_fly_to } from '#lib/scene/fly-to.js'
import {
  create_orbit_link,
  join_orbit_link,
  link_orbits,
  scope_orbit_link,
} from '#lib/scene/orbit-link.svelte.js'
import { type Component, flushSync, mount, unmount } from 'svelte'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { describe, expect, onTestFinished, test, vi } from 'vitest'

// Real controls on a camera at `position` orbiting `target`
const make_controls = (position: Vector3, target = new Vector3()): OrbitControls => {
  const camera = new PerspectiveCamera()
  camera.position.copy(position)
  const controls = new OrbitControls(camera, document.createElement(`div`))
  controls.target.copy(target)
  controls.update()
  onTestFinished(() => controls.dispose())
  return controls
}
const view_dir = ({ object, target }: OrbitControls): Vector3 =>
  object.position.clone().sub(target).normalize()
const distance = ({ object, target }: OrbitControls): number =>
  object.position.distanceTo(target)
// Orbit `controls` to look from `direction` at its target, as a drag would
const orbit = (controls: OrbitControls, direction: Vector3): void => {
  const radius = distance(controls)
  controls.object.position
    .copy(controls.target)
    .addScaledVector(direction.clone().normalize(), radius)
  controls.update()
}
// f64 vector math through three's spherical round trip: ~1e-15, far below any visible error
const expect_parallel = (dir_a: Vector3, dir_b: Vector3): void => {
  expect(dir_a.distanceTo(dir_b)).toBeLessThan(1e-12)
}

// A crystal-sized scene off the origin and a zone-sized one at it, as a structure (Å) beside
// its Fermi surface (Å⁻¹)
const setups = () => [
  make_controls(new Vector3(10, 3, 8), new Vector3(1, 2, 3)),
  make_controls(new Vector3(0.5, 0.15, 0.4)),
  make_controls(new Vector3(0, 0, 7), new Vector3(-1, 0, 0)),
]

describe(`create_orbit_link`, () => {
  test.each([0, 1, 2])(
    `member %i leads, the others turn alike and keep their framing`,
    (lead) => {
      const members = setups()
      const link = create_orbit_link()
      for (const controls of members) link.join(controls)
      const before = members.map((controls) => ({
        target: controls.target.clone(),
        distance: distance(controls),
      }))
      const direction = new Vector3(-2, 1, 3).normalize()
      orbit(members[lead], direction)
      for (const [idx, controls] of members.entries()) {
        expect_parallel(view_dir(controls), direction)
        expect(controls.target.toArray()).toEqual(before[idx].target.toArray())
        expect(Math.abs(distance(controls) - before[idx].distance)).toBeLessThan(
          1e-12 * before[idx].distance,
        )
        // re-aimed: the camera looks at its own target along the shared direction
        const forward = controls.object.getWorldDirection(new Vector3())
        expect_parallel(forward, direction.clone().negate())
      }
    },
  )

  test(`forwards the leader's start and end once to every follower, never back`, () => {
    const members = setups()
    const link = create_orbit_link()
    const events = members.map((controls) => {
      link.join(controls)
      const seen: string[] = []
      for (const type of [`start`, `end`] as const)
        controls.addEventListener(type, () => seen.push(type))
      return seen
    })
    const [leader] = members
    leader.dispatchEvent({ type: `start` })
    orbit(leader, new Vector3(1, 1, 1))
    leader.dispatchEvent({ type: `end` })
    for (const seen of events) expect(seen).toEqual([`start`, `end`])
  })

  test(`a left member stops following both ways`, () => {
    const [scene_a, scene_b] = setups()
    const link = create_orbit_link()
    const leave_a = link.join(scene_a)
    link.join(scene_b)
    leave_a?.()
    const dir_b = view_dir(scene_b)
    orbit(scene_a, new Vector3(1, 0, 0))
    expect(view_dir(scene_b).toArray()).toEqual(dir_b.toArray())
    const dir_a = view_dir(scene_a)
    orbit(scene_b, new Vector3(0, 0, 1))
    expect(view_dir(scene_a).toArray()).toEqual(dir_a.toArray())
  })

  test(`a late joiner takes up the others' view, an unframed peer has none to give`, () => {
    const [late, early, unframed] = setups()
    const link = create_orbit_link()
    unframed.object.position.copy(unframed.target) // camera on its target: no direction
    link.join(unframed)
    const before = view_dir(early)
    link.join(early)
    expect(view_dir(early).toArray()).toEqual(before.toArray())
    const direction = new Vector3(1, -2, 2).normalize()
    orbit(early, direction)
    const [target, radius] = [late.target.clone(), distance(late)]
    link.join(late)
    expect_parallel(view_dir(late), direction)
    expect(late.target.toArray()).toEqual(target.toArray())
    expect(Math.abs(distance(late) - radius)).toBeLessThan(1e-12 * radius)
  })

  test(`a member a camera flight holds stays where the flight puts it`, () => {
    const [leader, flying] = setups()
    const link = create_orbit_link()
    link.join(leader)
    link.join(flying)
    lock_fly_to(flying, true)
    onTestFinished(() => lock_fly_to(flying, false))
    const before = flying.object.position.toArray()
    orbit(leader, new Vector3(1, 2, 0))
    expect(flying.object.position.toArray()).toEqual(before)
  })
})

describe(`orbit link context`, () => {
  // A host linking its scenes: `linked` joins directly, `scoped` through scope_orbit_link
  // gated by `scope.enabled` (as a multi-view grid pane)
  test(`a scope keeps its scenes out while disabled and lets them back in`, () => {
    const [linked, scoped] = setups()
    const scope = $state({ enabled: false })
    const Host: Component = () => {
      link_orbits()
      join_orbit_link(() => linked)
      scope_orbit_link(() => scope.enabled)
      join_orbit_link(() => scoped)
      return {}
    }
    const host = mount(Host, { target: document.body })
    onTestFinished(() => void unmount(host))
    flushSync()
    const before = view_dir(scoped)
    orbit(linked, new Vector3(0, 1, 2))
    expect(view_dir(scoped).toArray()).toEqual(before.toArray())

    scope.enabled = true
    flushSync()
    const direction = new Vector3(3, -1, 1).normalize()
    orbit(linked, direction)
    expect_parallel(view_dir(scoped), direction)
  })

  test(`without a host, joining is a no-op`, () => {
    const add_listener = vi.spyOn(OrbitControls.prototype, `addEventListener`)
    onTestFinished(() => add_listener.mockRestore())
    const [lone] = setups()
    add_listener.mockClear()
    const Lone: Component = () => {
      join_orbit_link(() => lone)
      return {}
    }
    const lone_scene = mount(Lone, { target: document.body })
    onTestFinished(() => void unmount(lone_scene))
    flushSync()
    expect(add_listener).not.toHaveBeenCalled()
  })
})
