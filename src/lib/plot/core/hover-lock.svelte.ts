// Shared utilities for auto-placed plot elements (legend, colorbar): hover lock with
// debounced release, resize detection, and a tweened position with stability gating

import { untrack } from 'svelte'
import { Tween, type TweenOptions } from 'svelte/motion'

const HOVER_DEBOUNCE_MS = 300

// Reactive wrapper that exposes state via a stable object reference
interface ReactiveBoolean {
  readonly current: boolean
}

// Creates hover lock state and handlers for a plot element
function create_hover_lock(): {
  is_locked: ReactiveBoolean
  set_locked: (locked: boolean) => void
  cleanup: () => void
} {
  let is_locked = $state(false)
  let timeout: ReturnType<typeof setTimeout> | null = null

  // Stable object reference with getter - Svelte tracks the getter read
  const locked_ref: ReactiveBoolean = {
    get current() {
      return is_locked
    },
  }

  return {
    is_locked: locked_ref,
    set_locked(locked: boolean) {
      // Always clear any pending unlock so rapid calls don't queue multiple timeouts
      if (timeout) clearTimeout(timeout)
      if (locked) is_locked = true
      else timeout = setTimeout(() => (is_locked = false), HOVER_DEBOUNCE_MS)
    },
    // Clear pending timeout to prevent state updates after unmount
    cleanup() {
      if (timeout) clearTimeout(timeout)
    },
  }
}

// Tracks previous dimensions for resize detection
function create_dimension_tracker(): {
  has_changed: (width: number, height: number) => boolean
  update: (width: number, height: number) => void
} {
  let prev = $state<{ width: number; height: number } | null>(null)

  return {
    has_changed(width: number, height: number): boolean {
      if (!prev) return true
      return prev.width !== width || prev.height !== height
    },
    update(width: number, height: number) {
      prev = { width, height }
    },
  }
}

type Point = { x: number; y: number }

// Tweened position for an auto-placed plot element with the stability gating shared
// by BarPlot/BoxPlot/Histogram legends: snap (no animation) on first placement,
// follow container resizes, stay put while hovered (debounced hover lock), and track
// placement continuously only when `responsive`. Owns its hover lock, dimension
// tracker and the placement $effect, so it must be called during component init.
export function create_placed_tween(opts: {
  // Auto-computed target position (null disables updates, e.g. legend hidden)
  placement: () => Point | null
  dims: () => { width: number; height: number }
  responsive: () => boolean
  // Placed element; position only locks once it exists (has a measured size)
  element: () => Element | null | undefined
  // Initial tween config, read once at creation
  tween?: () => TweenOptions<Point> | undefined
  // While true, leave coords untouched (e.g. element is mid-drag)
  suspended?: () => boolean
  // Manual override (e.g. user-dragged position): applied immediately, no animation
  manual_position?: () => Point | null
}): { coords: Tween<Point>; set_locked: (locked: boolean) => void } {
  const hover = create_hover_lock()
  const dim_tracker = create_dimension_tracker()
  // Plain (untracked) flag: only read/written inside the effect below, and outcomes
  // don't depend on re-running when it flips
  let has_initial_placement = false

  const coords = new Tween<Point>(
    { x: 0, y: 0 },
    untrack(() => ({ duration: 400, ...opts.tween?.() })),
  )

  // Clear pending hover lock timeout on unmount
  $effect(() => () => hover.cleanup())

  // Update position with stability checks
  $effect(() => {
    const { width, height } = opts.dims()
    if (!width || !height) return
    if (opts.suspended?.()) return
    const manual = opts.manual_position?.()
    if (manual) {
      // Immediate update (no animation) for manually positioned elements
      void coords.set({ x: manual.x, y: manual.y }, { duration: 0 })
      return
    }
    const placement = opts.placement()
    if (!placement) return

    // Track dimensions for resize detection
    const dims_changed = dim_tracker.has_changed(width, height)
    if (dims_changed) dim_tracker.update(width, height)

    // Only update if: resize occurred, OR (not hover-locked AND (responsive OR not
    // yet initially placed))
    const should_update =
      dims_changed ||
      (!hover.is_locked.current && (opts.responsive() || !has_initial_placement))
    if (should_update) {
      void coords.set(
        { x: placement.x, y: placement.y },
        // Skip animation on initial placement to avoid jump from (0, 0)
        has_initial_placement ? undefined : { duration: 0 },
      )
      // Only lock position after the element has an actual measured size
      if (opts.element()) has_initial_placement = true
    }
  })

  return { coords, set_locked: hover.set_locked }
}
