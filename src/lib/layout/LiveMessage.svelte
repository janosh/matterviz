<script lang="ts">
  // Visually hidden polite live region: screen readers announce `message` as it changes. Keep
  // it mounted while empty: a region inserted together with its first message is often missed.
  let { message }: { message: string } = $props()
</script>

<span class="sr-only" aria-live="polite">{message}</span>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
</style>
