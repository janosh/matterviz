// Tweened position for auto-placed plot elements (legend, colorbar) with hover lock,
// debounced release, resize detection, and stability gating

import { untrack } from 'svelte'
import { Tween, type TweenOptions } from 'svelte/motion'

const HOVER_DEBOUNCE_MS = 300

type Point = { x: number; y: number }

// Tweened position for an auto-placed plot element with the stability gating shared
// by BarPlot/BoxPlot/Histogram/ScatterPlot legends: snap (no animation) on first
// placement, follow container/element resizes, stay put while hovered (debounced
// hover lock), and track placement continuously only when `responsive`. Creates
// $effects, so it must be called during component init.
export function create_placed_tween(opts: {
  // Auto-computed target position (null disables updates, e.g. legend hidden).
  // Must measure fresh on each call rather than return a memoized DOM measurement.
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
  // Notify related layout state when the observed decoration footprint changes.
  on_element_resize?: () => void
  // Recompute when another decoration that affects this placement changes.
  placement_revision?: () => unknown
}): { coords: Tween<Point>; placed: () => boolean; set_locked: (locked: boolean) => void } {
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

  // Previous plot dimensions stay plain; they only classify the current effect run.
  let prev_dims: { width: number; height: number } | null = null
  let element_size_revision = $state(0)
  let prev_element_size_revision = 0
  let previous_element: Element | null = null
  let previous_placement_revision: unknown
  let placed = $state(false)
  const invalidate_element_size = (): void => {
    element_size_revision += 1
  }

  const coords = new Tween<Point>(
    { x: 0, y: 0 },
    untrack(() => ({ duration: 400, ...opts.tween?.() })),
  )

  // Clear pending unlock timeout to prevent state updates after unmount
  $effect(() => () => {
    if (unlock_timeout) clearTimeout(unlock_timeout)
  })

  // Decoration content (title, orientation, tick labels) can resize without the
  // plot dimensions changing. Observe it so frozen placements are recomputed.
  $effect(() => {
    const element = opts.element()
    if (!element || typeof ResizeObserver === `undefined`) return undefined
    if (previous_element && previous_element !== element) invalidate_element_size()
    previous_element = element
    const initialized_elements = new WeakSet<Element>()
    const observed_elements = new WeakSet<Element>()
    const observer = new ResizeObserver((entries) => {
      const size_changed = entries.some(({ target }) => initialized_elements.has(target))
      for (const { target } of entries) initialized_elements.add(target)
      if (size_changed) invalidate_element_size()
    })
    const observe_tree = (root: Element): void => {
      for (const target of [root, ...root.querySelectorAll(`*`)]) {
        if (observed_elements.has(target)) continue
        observed_elements.add(target)
        observer.observe(target)
      }
    }
    const unobserve_tree = (root: Element): void => {
      for (const target of [root, ...root.querySelectorAll(`*`)]) {
        observer.unobserve(target)
        observed_elements.delete(target)
        initialized_elements.delete(target)
      }
    }
    observe_tree(element)

    const mutation_observer =
      typeof MutationObserver === `undefined`
        ? null
        : new MutationObserver((records) => {
            let footprint_changed = false
            for (const record of records) {
              if (record.type === `attributes` && record.target === element) continue
              footprint_changed = true
              for (const node of record.addedNodes) {
                if (node instanceof Element) observe_tree(node)
              }
              for (const node of record.removedNodes) {
                if (node instanceof Element) unobserve_tree(node)
              }
            }
            if (footprint_changed) invalidate_element_size()
          })
    mutation_observer?.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [`class`, `style`],
    })
    return () => {
      observer.disconnect()
      mutation_observer?.disconnect()
    }
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
    }
    // Leave resize revisions pending so unlock recomputes the latest placement.
    if (hover_locked) return

    // Track dimensions for resize detection
    const dims_changed = !prev_dims || prev_dims.width !== width || prev_dims.height !== height
    if (dims_changed) prev_dims = { width, height }
    const element_size_changed = prev_element_size_revision !== element_size_revision
    if (element_size_changed) {
      prev_element_size_revision = element_size_revision
      opts.on_element_resize?.()
    }
    if (manual) return
    const placement_revision = opts.placement_revision?.()
    const placement_invalidated = !Object.is(previous_placement_revision, placement_revision)
    previous_placement_revision = placement_revision
    const responsive = opts.responsive()
    // A non-responsive tween tracks `placed` once so it immediately reruns and
    // unsubscribes from the expensive placement chain after its first placement.
    const has_initial_placement = responsive ? untrack(() => placed) : placed

    // Skip expensive DOM placement before evaluating it: non-responsive
    // elements stay fixed after their initial placement until the plot resizes.
    if (
      !dims_changed &&
      !element_size_changed &&
      !placement_invalidated &&
      !responsive &&
      has_initial_placement
    )
      return
    const placement = opts.placement()
    if (!placement) return

    void coords.set(
      { x: placement.x, y: placement.y },
      // Skip animation on initial placement to avoid jump from (0, 0)
      has_initial_placement ? undefined : { duration: 0 },
    )
    // Only lock position after the element has an actual measured size
    if (opts.element()) placed = true
  })

  return { coords, placed: () => placed, set_locked }
}
