<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    error_msg: string
    on_dismiss: () => void
    // Custom error snippet for advanced error handling
    error_snippet?: Snippet<[{ error_msg: string; on_dismiss: () => void }]>
  }
  let { error_msg, on_dismiss, error_snippet }: Props = $props()
</script>

<div class="error-message">
  {#if error_snippet}
    {@render error_snippet({ error_msg, on_dismiss })}
  {:else if error_msg.startsWith(`<`)}
    <!-- Render HTML content for unsupported format messages -->
    {@html error_msg}
    <button onclick={on_dismiss}>Dismiss</button>
  {:else}
    <h3>Error</h3>
    <p>{error_msg}</p>
    <button onclick={on_dismiss}>Dismiss</button>
  {/if}
</div>

<style>
  .error-message {
    height: 100%;
    padding: 2rem;
    place-content: center;
    place-items: center;
    text-align: center;
    color: var(--error-color);
    border-radius: var(--border-radius);
    border: var(--error-border);
    box-sizing: border-box;
    flex: 1;
  }
  .error-message p {
    max-width: 30em;
    word-wrap: break-word;
    hyphens: auto;
    margin: auto;
    line-height: 1.5;
  }
  .error-message button {
    margin-top: 1rem;
    background: var(--error-button-bg);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    transition: background-color 0.2s;
  }
  .error-message button:hover {
    background: var(--error-button-hover-bg);
  }
  /* Styles for unsupported format messages */
  .error-message :global(.unsupported-format) {
    text-align: left;
    max-width: 90%;
    max-height: 70vh;
    margin: 0 auto;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .error-message :global(.unsupported-format h4) {
    color: var(--error-color);
    margin: 0 0 1rem 0;
    font-size: 1.1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .error-message :global(.unsupported-format h5) {
    margin: 0.75rem 0 0.25rem 0;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .error-message :global(.unsupported-format p) {
    margin: 0.25rem 0;
    text-align: left;
    font-size: 0.85rem;
  }
  .error-message :global(.unsupported-format ul) {
    text-align: left;
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }
  .error-message :global(.unsupported-format li) {
    margin: 0.25rem 0;
  }
  .error-message :global(.unsupported-format .code-options) {
    margin: 1rem 0 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }
  .error-message :global(.unsupported-format .code-options > div) {
    margin: 0;
  }
  .error-message :global(.unsupported-format .code-options strong) {
    display: block;
    margin-bottom: 0.25rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .error-message :global(.unsupported-format pre) {
    padding: 0.5rem;
    margin: 0;
    overflow-x: auto;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
    font-size: 0.75rem;
    line-height: 1.2;
    max-height: 150px;
    overflow-y: auto;
  }
  .error-message :global(.unsupported-format p code) {
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
  }
</style>
