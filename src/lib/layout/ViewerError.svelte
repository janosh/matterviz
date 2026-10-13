<script lang="ts">
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'

  // `center` blurs the stale viewer behind a card centered on it; `top` floats the card at
  // the top edge over a still-usable view (e.g. a plot whose fit failed) and passes clicks
  // through everywhere else. Needs a positioned ancestor either way.
  let {
    message = $bindable(),
    dismissible = false,
    placement = `center`,
  }: {
    message?: string | null
    dismissible?: boolean
    placement?: `center` | `top`
  } = $props()
</script>

{#if message}
  <div class={[`viewer-error`, placement]}>
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
  /* above plot legends (z 2), below the corner controls (z 10) that the side padding clears */
  .viewer-error.top {
    z-index: 5;
    place-items: start center;
    padding: 0.5em 4em;
    backdrop-filter: none;
    pointer-events: none;
    > :global(*) {
      pointer-events: auto;
    }
  }
</style>
