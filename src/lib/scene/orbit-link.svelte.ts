// Rotation link between sibling 3D scenes: a host provides a link during init, every
// SceneCamera below joins it with its OrbitControls, and orbiting (or auto-rotating, resetting,
// a gizmo fly-to, a landed camera flight) any member turns the others to the same view
// direction, as does joining late (a viewer remounting its camera on a projection toggle).
// Members turn at the leader's rate, so of several auto-rotating members each adds its own
// steps: let one auto-rotate. Each member keeps its own orbit target, distance, zoom and pan,
// so scenes of different size and units (a crystal in Å, its Fermi surface in Å⁻¹) stay framed.
// Meant for scenes sharing one Cartesian frame with the same camera up vector (the scene
// default +y), else equal directions do not mean equal views.
import { getContext, setContext } from 'svelte'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Vector3 } from 'three/webgpu'
import { flight_holds } from './fly-to'

export type OrbitLink = { join: (controls: OrbitControls) => (() => void) | undefined }

// A link group, independent of Svelte context (for tests and custom hosts)
export function create_orbit_link(): OrbitLink {
  const members = new Set<OrbitControls>()
  // set while followers are moved: their own events must not lead in turn
  let following = false
  const follow = (leader: OrbitControls, move: (member: OrbitControls) => void): void => {
    if (following) return
    following = true
    try {
      for (const member of members) {
        // a camera flight's poses are absolute, nothing else moves its camera
        if (member !== leader && !flight_holds(member)) move(member)
      }
    } finally {
      following = false
    }
  }
  const direction = new Vector3()
  // Sets `direction` to the member's view direction; false for a camera on its target (not
  // yet framed) or off any finite position (NaN, Infinity), which has none to share
  const read_direction = ({ object, target }: OrbitControls): boolean => {
    direction.subVectors(object.position, target)
    const length_sq = direction.lengthSq()
    if (!(length_sq > 0 && Number.isFinite(length_sq))) return false
    direction.normalize()
    return true
  }
  const aim = (member: OrbitControls): void => {
    const distance = member.object.position.distanceTo(member.target)
    member.object.position.copy(member.target).addScaledVector(direction, distance)
    // re-aims the camera and emits `change` (none for an unmoved pose, e.g. after a
    // zoom-only wheel tick), which re-renders its canvas; without the member's own
    // auto-rotate step, else each leader step would add one per auto-rotating follower
    const { autoRotate } = member
    member.autoRotate = false
    member.update()
    member.autoRotate = autoRotate
  }
  return {
    join: (controls) => {
      // a late joiner takes up the others' view (read_direction leaves it in `direction`),
      // before its own listeners would echo that back
      if ([...members].some(read_direction) && !flight_holds(controls)) aim(controls)
      members.add(controls)
      // a follower's own change (e.g. its damping gliding on during a re-aim) must not
      // overwrite the shared direction the remaining followers are still aimed along
      const on_change = () => {
        if (!following && read_direction(controls)) follow(controls, aim)
      }
      // Followers see the leader's gesture as their own, so their hosts track the move as for
      // a drag (hover suppressed meanwhile, pose synced and reported once it ends)
      const on_start = () =>
        follow(controls, (member) => member.dispatchEvent({ type: `start` }))
      const on_end = () => follow(controls, (member) => member.dispatchEvent({ type: `end` }))
      controls.addEventListener(`change`, on_change)
      controls.addEventListener(`start`, on_start)
      controls.addEventListener(`end`, on_end)
      return () => {
        members.delete(controls)
        controls.removeEventListener(`change`, on_change)
        controls.removeEventListener(`start`, on_start)
        controls.removeEventListener(`end`, on_end)
      }
    },
  }
}

const ORBIT_LINK = Symbol(`orbit-link`)

// A link that only takes members while `enabled`, read on every join: a member joining inside
// an effect re-joins when it changes
const gate = (link: OrbitLink, enabled: () => boolean): OrbitLink => ({
  join: (controls) => (enabled() ? link.join(controls) : undefined),
})

// In a host, during init: link the rotations of all scenes rendered below it
export const link_orbits = (enabled = () => true): void => {
  setContext(ORBIT_LINK, gate(create_orbit_link(), enabled))
}

// In a component between host and scenes, during init: keep its scenes out of the enclosing
// link while `enabled` is false (e.g. a multi-view grid, whose panes look along fixed axes)
export function scope_orbit_link(enabled: () => boolean): void {
  const parent = getContext<OrbitLink | undefined>(ORBIT_LINK)
  if (parent) setContext(ORBIT_LINK, gate(parent, enabled))
}

// In a scene camera, during init: join the enclosing link (if any) once controls exist
export function join_orbit_link(controls: () => OrbitControls | undefined): void {
  const link = getContext<OrbitLink | undefined>(ORBIT_LINK)
  if (!link) return
  $effect(() => {
    const orbit_controls = controls()
    return orbit_controls ? link.join(orbit_controls) : undefined
  })
}
