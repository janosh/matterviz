<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    error_message: string
    on_dismiss: () => void
    // Custom error snippet for advanced error handling
    error_snippet?: Snippet<[{ error_message: string; on_dismiss: () => void }]>
  }
  let { error_message, on_dismiss, error_snippet }: Props = $props()
</script>

<div class="error-message">
  {#if error_snippet}
    {@render error_snippet({ error_message, on_dismiss })}
  {:else if error_message.includes(`<div class="unsupported-format">`)}
    <!-- Render HTML content for unsupported format messages -->
    {@html error_message}
    <button onclick={on_dismiss}>Dismiss</button>
  {:else}
    <h3>Error</h3>
    <p>{error_message}</p>
    <button onclick={on_dismiss}>Dismiss</button>
  {/if}
</div>

<style>
  .error-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    text-align: center;
    background: var(--trajectory-error-bg);
    color: var(--trajectory-error-color);
    border-radius: 8px;
    border: 1px solid var(--trajectory-error-border);
    box-sizing: border-box;
  }
  .error-message p {
    max-width: 30em;
    word-wrap: break-word;
    hyphens: auto;
    line-height: 1.5;
  }
  .error-message button {
    margin-top: 1rem;
    background: var(--trajectory-error-button-bg);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    transition: background-color 0.2s;
  }
  .error-message button:hover {
    background: var(--trajectory-error-button-hover-bg);
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
    color: var(--trajectory-error-color);
    margin: 0 0 1rem 0;
    font-size: 1.1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .error-message :global(.unsupported-format h5) {
    color: var(--trajectory-text-color);
    margin: 0.75rem 0 0.25rem 0;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .error-message :global(.unsupported-format p) {
    color: var(--trajectory-text-color);
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
    color: var(--trajectory-text-color);
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
    color: var(--trajectory-code-title-color);
    display: block;
    margin-bottom: 0.25rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .error-message :global(.unsupported-format pre) {
    background: var(--trajectory-pre-bg);
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
    background: var(--trajectory-inline-code-bg);
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
    font-size: 0.85em;
  }
</style>
