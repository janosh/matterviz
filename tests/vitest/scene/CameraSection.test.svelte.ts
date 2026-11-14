import type { CameraProjection } from '#lib/settings.js'
import CameraSection from '#lib/scene/CameraSection.svelte'
import { flushSync } from 'svelte'
import { expect, test, vi } from 'vite-plus/test'
import { bind_props, mount_in_test } from '../setup'

const reset_selector = `button[title="Reset camera to defaults"]`

// Caller keys/reset (for the section's children) merge with the projection's own tracking, so
// passing them never drops the projection reset
// oxfmt-ignore
test.each([
  { projection: `perspective`, caller_keys: undefined, with_reset: false, shows_reset: false },
  { projection: `orthographic`, caller_keys: undefined, with_reset: false, shows_reset: true },
  { projection: `orthographic`, caller_keys: [], with_reset: true, shows_reset: true },
  { projection: `perspective`, caller_keys: [`auto_rotate`], with_reset: true, shows_reset: true },
  { projection: `orthographic`, caller_keys: [`auto_rotate`], with_reset: true, shows_reset: true },
] as const)(
  `projection=$projection caller_keys=$caller_keys on_reset=$with_reset`,
  ({ projection, caller_keys, with_reset, shows_reset }) => {
    const state = $state<{ camera_projection: CameraProjection }>({
      camera_projection: projection,
    })
    const on_reset = vi.fn()
    mount_in_test(
      CameraSection,
      bind_props(
        {
          default_projection: `perspective` as const,
          ...(caller_keys && { changed_keys: caller_keys }),
          ...(with_reset && { on_reset }),
        },
        state,
      ),
    )
    flushSync()
    const reset_button = document.querySelector<HTMLButtonElement>(reset_selector)
    expect(Boolean(reset_button)).toBe(shows_reset)
    reset_button?.click()
    flushSync()
    expect(state.camera_projection).toBe(`perspective`)
    expect(on_reset).toHaveBeenCalledTimes(shows_reset && with_reset ? 1 : 0)
    // Only caller keys keep the section dirty once the projection is back at its default
    expect(Boolean(document.querySelector(reset_selector))).toBe(Boolean(caller_keys?.length))
  },
)
