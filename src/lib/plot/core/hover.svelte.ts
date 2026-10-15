// Shared hover-state guard for chart components.

import { untrack } from 'svelte'

// A data swap or a hidden series fires no pointer event, so a hover whose item is gone would
// linger (and the host's on_*_hover never hear null). Runs `clear` once `is_stale` turns truthy.
// Creates an $effect, so it must be called during component init.
export function clear_stale_hover(is_stale: () => unknown, clear: () => void): void {
  $effect.pre(() => {
    if (is_stale()) untrack(clear)
  })
}
