// Shared utility for hover lock behavior on plot elements (legend, colorbar)
// Prevents element repositioning while user is hovering, with debounced release

export const HOVER_DEBOUNCE_MS = 300

// Reactive wrapper that exposes state via a stable object reference
interface ReactiveBoolean {
  readonly current: boolean
}

// Creates hover lock state and handlers for a plot element
export function create_hover_lock(): {
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
      if (locked) {
        if (timeout) clearTimeout(timeout)
        is_locked = true
      } else {
        timeout = setTimeout(() => (is_locked = false), HOVER_DEBOUNCE_MS)
      }
    },
    cleanup() {
      if (timeout) clearTimeout(timeout)
    },
  }
}

// Tracks previous dimensions for resize detection
export function create_dimension_tracker(): {
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
