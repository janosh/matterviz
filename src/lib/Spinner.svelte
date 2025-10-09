<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let { text, ...rest }: { text?: string } & HTMLAttributes<HTMLDivElement> = $props()
</script>

<div class="spinner" role="status" aria-live="polite" aria-busy="true" {...rest}>
  <div class="spinner" aria-hidden="true"></div>
  {#if text}
    <span>{text}</span>
  {/if}
</div>

<style>
  .spinner {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin: var(--spinner-margin, 3pt);
    > div {
      width: var(--spinner-size, 1em);
      height: var(--spinner-size, 1em);
      border: var(--spinner-border-width, 4px) solid var(--spinner-track-color, #f3f3f3);
      border-top: var(--spinner-border-width, 4px) solid var(--spinner-color, #007acc);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      box-sizing: border-box;
    }
  }
  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }
</style>
