<script lang="ts">
  import { create_flash } from '$lib/effects.svelte'
  import { untrack } from 'svelte'

  let {
    resting = `idle`,
    duration_ms = 1000,
    bind_flash = undefined,
  }: {
    resting?: string
    duration_ms?: number
    // handed back so a test can drive show/reset from outside the component
    bind_flash?: (flash: ReturnType<typeof create_flash<string>>) => void
  } = $props()

  // untracked: create_flash captures its resting value and window once, at init, by design
  const flash = untrack(() => create_flash(resting, duration_ms))
  untrack(() => bind_flash?.(flash))
</script>

<span data-testid="flash">{flash.value}</span>
