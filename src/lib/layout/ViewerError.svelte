<script lang="ts">
  import { StatusMessage } from 'svelte-widgets'

  let {
    message = $bindable(),
    dismissible = false,
  }: { message?: string | null; dismissible?: boolean } = $props()
</script>

{#if message}
  <div class="viewer-error">
    <StatusMessage bind:message type="error" {dismissible} />
  </div>
{/if}

<style>
  .viewer-error {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    overflow: auto;
    overflow-wrap: anywhere;
  }
</style>
