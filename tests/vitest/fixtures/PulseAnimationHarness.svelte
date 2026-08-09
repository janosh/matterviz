<script lang="ts">
  import { create_pulse_animation } from '$lib/effects.svelte'
  import { untrack } from 'svelte'

  let {
    active,
    on_tick,
    element,
  }: {
    active: () => boolean
    on_tick?: () => void
    element?: () => Element | null | undefined
  } = $props()

  // Leaving `element` undefined opts out of visibility gating. untrack because
  // create_pulse_animation reads the option once too.
  const pulse = create_pulse_animation(() => active(), {
    on_tick: () => on_tick?.(),
    element: untrack(() => element),
  })
</script>

<span data-testid="pulse" data-time={pulse.time}></span>
