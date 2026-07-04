<script lang="ts">
  import { create_pulse_animation } from '$lib/effects.svelte'

  let {
    active,
    on_tick,
  }: {
    active: () => boolean
    on_tick?: () => void
  } = $props()

  const pulse = create_pulse_animation(() => active(), { on_tick: () => on_tick?.() })
</script>

<span data-testid="pulse" data-time={pulse.time}></span>
