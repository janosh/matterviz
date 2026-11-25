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
  faceIndex?: number | null
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

// Touch has no hover (a finger only moves while orbiting), so TouchTaps turns taps into
// hovers: `wrap` drops touch enter/move/leave from an object's hover handlers and replays
// enter and move on a tap, so its tooltip shows and stays until a tap on it again, elsewhere
// or on empty space (onpointermissed), or `release` (an orbit), replays its leave. Presses,
// clicks, mouse and pen events pass through. One per scene, so the held tooltip moves between
// its objects; `tap_key` names what a tap holds where one object draws several marks
// (polyhedron faces). `clicks` hooks in a TooltipPin: `on_click` after any wrapped object's
// click (after a tap's hover), `on_empty_click` for a click no wrapped object took.
type SceneClicks = { on_click?: () => void; on_empty_click?: () => void }
export class TouchTaps {
  // the press starting the current gesture, and which object was held when it started
  #press: { touch: boolean; at: number; held: string | undefined } | null = null
  #held: { key: string; leave: () => void } | null = null
  #claimed: unknown = null // the last click a wrapped object took
  readonly #clicks: SceneClicks

  constructor(clicks: SceneClicks = {}) {
    this.#clicks = clicks
  }

  release = (): void => {
    const held = this.#held
    this.#held = null
    held?.leave()
  }

  wrap = (handlers: HoverHandlers, tap_key = key_of): TouchHoverProps => {
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
          const key = tap_key(event)
          this.release()
          if (press.held !== key) {
            onpointerenter?.(event)
            onpointermove?.(event)
            this.#held = { key, leave: () => onpointerleave?.(event) }
          }
        }
        onclick?.(event)
        this.#clicks.on_click?.()
      },
      // Threlte calls this on each object a click missed before the hit one's onclick, so
      // release once the dispatch is over and no wrapped object took the click
      onpointermissed: (event) =>
        queueMicrotask(() => {
          if (this.#claimed === event) return
          this.release()
          this.#clicks.on_empty_click?.()
        }),
    }
  }
}

// Threlte interactivity() for a 3D scene (call during component init) dispatching each pointer
// event to the one object front_hit picks, so handlers need no stopPropagation(). `clip_plane`
// is read per event. `touch_hover` wraps hover handlers for touch taps (see TouchTaps);
// `set_hover_enabled(false)` stops hover raycasts and hides a tapped tooltip;
// `set_camera_is_moving` (for build_orbit_props) does so while the camera moves and calls
// `clear_hover` as it starts, since a hovered mark gets no pointerleave then. A drag would
// otherwise raycast on each pointermove, and a tooltip hopping under the cursor reads as flicker.
// `on_click`/`on_empty_click` see clicks on and off wrapped objects (a TooltipPin).
export const scene_interactivity = ({
  clip_plane,
  clear_hover,
  ...clicks
}: { clip_plane?: () => Plane | null; clear_hover?: () => void } & SceneClicks = {}) => {
  const { enabled } = extras.interactivity({
    filter: (hits) => front_hit(hits, clip_plane?.()),
  })
  const taps = new TouchTaps(clicks)
  const set_hover_enabled = (on: boolean): void => {
    enabled.set(on)
    if (!on) taps.release()
  }
  const set_camera_is_moving = (moving: boolean): void => {
    set_hover_enabled(!moving)
    if (moving) clear_hover?.()
  }
  return { set_hover_enabled, set_camera_is_moving, touch_hover: taps.wrap }
}
