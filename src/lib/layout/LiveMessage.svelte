<script lang="ts">
  import type { Snippet } from 'svelte'

  // Visually hidden polite live region: screen readers announce its text as it changes
  let { children }: { children: Snippet } = $props()
</script>

<span class="sr-only" aria-live="polite">{@render children()}</span>

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
