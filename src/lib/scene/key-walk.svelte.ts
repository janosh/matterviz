// Keyboard hover for the 3D scenes. A scene lists its hover targets (atoms, faces, domains,
// rods, markers) in the order users expect and how the pointer hovers, leaves and clicks one;
// the viewer root's one tab stop then walks them: arrows step and wrap, Home/End jump,
// Enter/Space does what a click would (select, or pin the tooltip), Escape unpins, then
// clears, as does focus leaving the viewer. A target the pointer hovers is where the walk
// stands, so keys pick up from the mouse. Each step replays the target's pointer handlers,
// so a keyboard user gets the same tooltip, HoverHighlight and on_*_hover payload as the
// mouse, and the viewer's live region announces the target.
import type { Vec3 } from '#lib/math.js'
import {
  focus_left,
  is_activation_key,
  step_point_cursor,
} from '#lib/plot/core/interactions.js'
import { useThrelte } from '@threlte/core'
import { getContext, setContext } from 'svelte'
import { on } from 'svelte/events'
import { is_modifier_chord } from 'svelte-widgets/utils'
import { Vector3 } from 'three/webgpu'
import type { ThreltePointerEvent } from './props.svelte'

export type KeyWalkOptions<T> = {
  // in walk order; any array-like, so a million-marker scene can walk its key column as is
  targets: () => ArrayLike<T>
  // whether there is anything to walk, when that is cheaper to tell than listing the targets
  // (read on every change of its inputs; targets only on key presses)
  active?: () => boolean
  hover: (target: T) => void // what the pointer entering the target does
  leave: (target: T) => void // and leaving it
  click?: (target: T) => void // Enter/Space, where a click on the target does something
  unpin?: () => boolean // Escape unpins first, for a scene holding its own TooltipPin
  hovered?: (target: T) => boolean // whether the pointer hovers the target
  label: (target: T) => string // announced by the viewer's live region
}

export class KeyWalk<T> {
  idx = $state<number | null>(null)
  readonly #options: KeyWalkOptions<T>

  constructor(options: KeyWalkOptions<T>) {
    this.#options = options
  }

  // The cursor's target, null before the first step, once cleared or when it was dropped
  get current(): T | null {
    return this.idx === null ? null : (this.#options.targets()[this.idx] ?? null)
  }

  get message(): string {
    const { current } = this
    return current === null ? `` : this.#options.label(current)
  }

  // Whether the key was taken. Chords, composing and keys something else handled are not.
  handle_key = (event: KeyboardEvent): boolean => {
    if (event.defaultPrevented || event.isComposing || is_modifier_chord(event)) return false
    const { targets, hovered, hover, leave, click, unpin } = this.#options
    const items = targets()
    let pointer_idx = -1
    if (hovered) {
      for (let idx = 0; idx < items.length && pointer_idx === -1; idx++) {
        if (hovered(items[idx])) pointer_idx = idx
      }
    }
    const idx = pointer_idx === -1 ? this.idx : pointer_idx
    const current = idx === null ? null : (items[idx] ?? null)
    if (event.key === `Escape`) {
      if (unpin?.()) return true
      if (current === null) return false
      this.idx = null
      leave(current)
      return true
    }
    if (is_activation_key(event)) {
      if (current === null || !click) return false
      click(current)
      return true
    }
    const next = step_point_cursor(event.key, current === null ? null : idx, items.length)
    if (next === null) return false
    // like the pointer moving from one object to the next: leave, then enter
    if (current !== null) leave(current)
    this.idx = next
    hover(items[next])
    return true
  }

  clear = (): void => {
    const { current } = this
    this.idx = null
    if (current !== null) this.#options.leave(current)
  }
}

type Walk = Pick<KeyWalk<unknown>, `handle_key` | `clear` | `message`>

// The viewer root a scene's KeyWalk takes keys from (key_walk_root) and what it announces
export class KeyWalkRoot {
  walk = $state.raw<Walk | null>(null)

  get message(): string {
    return this.walk?.message ?? ``
  }

  // Attach to the viewer's focusable root. Keys walk only with the root itself focused (not a
  // control inside it) and are read off the window, after the root's own shortcuts and every
  // enclosing viewer's: a key one of them took (Trajectory's arrows step frames, the ternary
  // diagram's ArrowLeft/Right step temperature) never walks.
  attach = (node: HTMLElement): (() => void) => {
    const off_keydown = on(window, `keydown`, (event) => {
      if (event.target === node && this.walk?.handle_key(event)) event.preventDefault()
    })
    const off_focusout = on(node, `focusout`, (event) => {
      if (focus_left(event, node)) this.walk?.clear()
    })
    return () => {
      off_keydown()
      off_focusout()
    }
  }
}

const KEY_WALK = Symbol(`key-walk`)

// In a viewer host, during init: the root its scene's walk registers with. Render its
// `message` in a LiveMessage and {@attach} its `attach` to the focusable root.
export const key_walk_root = (): KeyWalkRoot => setContext(KEY_WALK, new KeyWalkRoot())

// In a scene, during init: its KeyWalk, driven by the enclosing key_walk_root while it has
// targets, so an inactive multi-view pane (no targets) leaves the keys to the active one
export function scene_key_walk<T>(options: KeyWalkOptions<T>): KeyWalk<T> {
  const walk = new KeyWalk(options)
  const root = getContext<KeyWalkRoot | undefined>(KEY_WALK)
  const { active = () => options.targets().length > 0 } = options
  $effect(() => {
    if (!root || !active()) return undefined
    root.walk = walk
    return () => {
      if (root.walk === walk) root.walk = null
    }
  })
  return walk
}

// A pointer event at world-space `point`, placed at its projection on the canvas, so a KeyWalk
// can replay an object's pointer handlers. `hit` adds the face or instance they read. Call
// during scene init (it reads the Threlte context).
export function scene_pointer() {
  const { camera, dom } = useThrelte()
  return (
    point: Vec3,
    hit: Pick<ThreltePointerEvent, `face` | `faceIndex` | `instanceId`> = {},
  ): ThreltePointerEvent => {
    const world = new Vector3(...point)
    const cam = camera.current
    cam.updateMatrixWorld()
    const { x: ndc_x, y: ndc_y } = world.clone().project(cam)
    const { left, top, width, height } = dom.getBoundingClientRect()
    const nativeEvent = new PointerEvent(`pointermove`, {
      clientX: left + ((ndc_x + 1) / 2) * width,
      clientY: top + ((1 - ndc_y) / 2) * height,
    })
    return { ...hit, point: world, nativeEvent, stopPropagation: () => {} }
  }
}
