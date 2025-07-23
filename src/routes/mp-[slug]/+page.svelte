<script lang="ts">
  import MpDetails from './MpDetails.svelte'
  // see https://svelte.dev/docs/svelte/runtime-errors#Shared-errors-await_outside_boundary for why this file
</script>

<svelte:boundary>
  <MpDetails />

  {#snippet pending()}
    <p style="text-align: center">Loading Materials Project data...</p>
  {/snippet}
</svelte:boundary>
