<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    error_msg,
    on_dismiss,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { error_msg: string; on_dismiss: () => void } = $props()
</script>

<div {...rest}>
  <h3>Error</h3>
  <p>{error_msg}</p>
  <button onclick={on_dismiss}>Dismiss</button>
</div>

<style>
  div {
    height: 100%;
    padding: 2rem;
    place-content: center;
    place-items: center;
    text-align: center;
    color: var(--error-color);
    border-radius: var(--border-radius, 3pt);
    border: var(--error-border);
    box-sizing: border-box;
    flex: 1;
  }
  div p {
    max-width: 30em;
    word-wrap: break-word;
    hyphens: auto;
    margin: auto;
    line-height: 1.5;
  }
  div button {
    margin-top: 1rem;
    background: var(--error-btn-bg);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    transition: background-color 0.2s;
  }
  div button:hover {
    background: var(--error-btn-bg-hover);
  }
</style>
