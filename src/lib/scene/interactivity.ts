// Kept out of picking.ts so its pure raycast helpers (atom-instances) don't load @threlte/extras
import * as extras from '@threlte/extras'
import type { Plane } from 'three/webgpu'
import { front_hit } from './picking'

// The fields of a threlte pointer event TouchTaps reads. nativeEvent is the DOM event (a click's
// may be a plain MouseEvent, so pointerType is taken from its pointerdown).
export type TapEvent = {
  nativeEvent: { pointerType?: string; timeStamp: number }
  eventObject?: { uuid: string }
  instanceId?: number
}
// Method syntax keeps the parameter bivariant, so hosts' handlers can take their own event types
type Handler = { handle(event: TapEvent): void }[`handle`]
export type HoverHandlers = Partial<
  Record<
    `onpointerenter` | `onpointermove` | `onpointerleave` | `onpointerdown` | `onclick`,
    Handler
  >
>
export type TouchHoverProps = HoverHandlers & { onpointermissed: (event: MouseEvent) => void }

// A press released within this long (and, per threlte's click, within 8 px on the same object)
// is a tap; a longer one is a long press, which shows nothing
export const TAP_MS = 500

const is_touch = (event: TapEvent): boolean => event.nativeEvent.pointerType === `touch`
// the tapped object, an instanced mesh's per instance (like threlte's own hover identity)
const key_of = ({ eventObject, instanceId }: TapEvent): string =>
  `${eventObject?.uuid}|${instanceId}`

// Touch has no hover: a finger only moves while dragging (orbiting) and its lift fires
// pointerleave. TouchTaps turns taps into hovers instead. `wrap` drops touch pointerenter, move
// and leave from an object's hover handlers, so a drag never shows or moves a tooltip, and a tap
// on the object replays its enter and move, so its tooltip shows as if hovered and stays. A tap
// on the same object again, on another one or on empty space (threlte's onpointermissed) replays
// its leave, as does `release` (hover raycasts switched off for an orbit). Presses and clicks
// still reach the object's own handlers, mouse and pen events pass through untouched. One per
// scene, so a tap moves the one held tooltip between all objects wrapped in it.
export class TouchTaps {
  // the press starting the current gesture, and which object was held when it started
  #press: { touch: boolean; at: number; held: string | undefined } | null = null
  #held: { key: string; leave: () => void } | null = null
  #claimed: unknown = null // the last click a wrapped object took

  release = (): void => {
    const held = this.#held
    this.#held = null
    held?.leave()
  }

  wrap = (handlers: HoverHandlers): TouchHoverProps => {
    const { onpointerenter, onpointermove, onpointerleave, onpointerdown, onclick } = handlers
    const unless_touch = (handler?: (event: TapEvent) => void) =>
      handler &&
      ((event: TapEvent) => {
        if (!is_touch(event)) handler(event)
      })
    return {
      onpointerenter: unless_touch(onpointerenter),
      onpointermove: unless_touch(onpointermove),
      onpointerleave: unless_touch(onpointerleave),
      onpointerdown: (event) => {
        const { timeStamp: at } = event.nativeEvent
        this.#press = { touch: is_touch(event), at, held: this.#held?.key }
        onpointerdown?.(event)
      },
      onclick: (event) => {
        const press = this.#press
        this.#press = null
        this.#claimed = event.nativeEvent
        if (press?.touch && event.nativeEvent.timeStamp - press.at <= TAP_MS) {
          const key = key_of(event)
          this.release()
          if (press.held !== key) {
            onpointerenter?.(event)
            onpointermove?.(event)
            this.#held = { key, leave: () => onpointerleave?.(event) }
          }
        }
        onclick?.(event)
      },
      // Threlte calls this on each object a click missed before the hit one's onclick, so
      // release once the dispatch is over and no wrapped object took the click
      onpointermissed: (event) =>
        queueMicrotask(() => {
          if (this.#claimed !== event) this.release()
        }),
    }
  }
}

// Threlte interactivity() for a 3D scene, dispatching each pointer event to the one object
// front_hit picks, so handlers never need stopPropagation() to fend off the objects behind.
// `clip_plane` is read per event, so pass a getter of reactive state. Call during component
// init, like interactivity() itself. `touch_hover` wraps an object's hover handlers so touch
// taps show its tooltip (see TouchTaps), `set_hover_enabled(false)` stops hover raycasts (while
// the camera moves) and hides a tapped tooltip as the orbit would a hovered one.
export const scene_interactivity = ({
  clip_plane,
}: { clip_plane?: () => Plane | null } = {}) => {
  const { enabled } = extras.interactivity({
    filter: (hits) => front_hit(hits, clip_plane?.()),
  })
  const taps = new TouchTaps()
  return {
    set_hover_enabled: (on: boolean): void => {
      enabled.set(on)
      if (!on) taps.release()
    },
    touch_hover: taps.wrap,
  }
}
