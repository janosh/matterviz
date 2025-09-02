<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    text?: string
  }
  let { text = `Loading...`, ...rest }: Props = $props()
</script>

<div class="spinner-overlay" role="status" aria-live="polite" {...rest}>
  <div class="spinner" aria-hidden="true"></div>
  <p>{text}</p>
</div>

<style>
  .spinner-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--spinner-bg);
    color: var(--spinner-text-color, #333);
    backdrop-filter: blur(4px);
    z-index: var(--spinner-z-index, 10);
  }
  .spinner {
    width: var(--spinner-size, 40px);
    height: var(--spinner-size, 40px);
    border: var(--spinner-border-width, 4px) solid var(--spinner-track-color, #f3f3f3);
    border-top: var(--spinner-border-width, 4px) solid var(--spinner-color, #007acc);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
    box-sizing: border-box;
  }
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
