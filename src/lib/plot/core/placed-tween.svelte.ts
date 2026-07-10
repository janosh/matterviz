// Tweened position for auto-placed plot elements (legend, colorbar) with hover lock,
// debounced release, resize detection, and stability gating

import { untrack } from 'svelte'
import { Tween, type TweenOptions } from 'svelte/motion'

const HOVER_DEBOUNCE_MS = 300

type Point = { x: number; y: number }

// Tweened position for an auto-placed plot element with the stability gating shared
// by BarPlot/BoxPlot/Histogram/ScatterPlot legends: snap (no animation) on first
// placement, follow container resizes, stay put while hovered (debounced hover lock),
// and track placement continuously only when `responsive`. Creates $effects, so it
// must be called during component init.
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
  // Hover lock: placement updates pause while the element is hovered; release is
  // debounced so brief mouse-outs don't cause jumps
  let hover_locked = $state(false)
  let unlock_timeout: ReturnType<typeof setTimeout> | null = null
  const set_locked = (locked: boolean): void => {
    // Always clear any pending unlock so rapid calls don't queue multiple timeouts
    if (unlock_timeout) clearTimeout(unlock_timeout)
    if (locked) hover_locked = true
    else unlock_timeout = setTimeout(() => (hover_locked = false), HOVER_DEBOUNCE_MS)
  }

  // Plain (untracked) flags: only read/written inside the effect below, and outcomes
  // don't depend on re-running when they flip
  let prev_dims: { width: number; height: number } | null = null
  let has_initial_placement = false

  const coords = new Tween<Point>(
    { x: 0, y: 0 },
    untrack(() => ({ duration: 400, ...opts.tween?.() })),
  )

  // Clear pending unlock timeout to prevent state updates after unmount
  $effect(() => () => {
    if (unlock_timeout) clearTimeout(unlock_timeout)
  })

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

    // Track dimensions for resize detection
    const dims_changed = !prev_dims || prev_dims.width !== width || prev_dims.height !== height
    if (dims_changed) prev_dims = { width, height }

    // Skip expensive DOM placement before evaluating it: non-responsive
    // elements stay fixed after their initial placement until the plot resizes.
    if (!dims_changed && (hover_locked || (!opts.responsive() && has_initial_placement)))
      return
    const placement = opts.placement()
    if (!placement) return

    void coords.set(
      { x: placement.x, y: placement.y },
      // Skip animation on initial placement to avoid jump from (0, 0)
      has_initial_placement ? undefined : { duration: 0 },
    )
    // Only lock position after the element has an actual measured size
    if (opts.element()) has_initial_placement = true
  })

  return { coords, set_locked }
}
