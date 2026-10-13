<script lang="ts">
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'

  // An error that replaces the view: blurs the stale viewer behind a card centered on it.
  // Needs a positioned ancestor. Non-fatal messages over a usable view go in ViewerNotices.
  let {
    message = $bindable(),
    dismissible = false,
  }: { message?: string | null; dismissible?: boolean } = $props()
</script>

{#if message}
  <div class="viewer-error">
    <StatusMessage
      bind:message
      type="error"
      {dismissible}
      style="max-width: min(100%, 36em)"
    />
  </div>
{/if}

<style>
  .viewer-error {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    place-items: center;
    padding: 1em;
    overflow: auto;
    overflow-wrap: anywhere;
    backdrop-filter: blur(8px);
  }
</style>
