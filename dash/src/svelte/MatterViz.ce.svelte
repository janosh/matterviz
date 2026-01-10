<svelte:options
  customElement={{
    tag: 'mv-matterviz',
    shadow: 'none'
  }}
  accessors={true}
/>

<script>
  import { listComponentKeys, resolveMattervizComponent } from './resolver';

  // Custom element props (component identifier + props bag)
  export let component = 'Structure';
  export let props = {};

  $: resolved = resolveMattervizComponent(component);
  $: mvProps = props || {};

  // Expose discovered components for easy debugging in the browser console.
  if (typeof window !== 'undefined' && !window.__matterviz_components) {
    window.__matterviz_components = listComponentKeys();
  }
</script>

<style>
  :host {
    display: block;
  }
  .mv-error {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    white-space: pre-wrap;
    padding: 0.5rem;
  }
</style>

{#if resolved.component}
  <svelte:component this={resolved.component} {...mvProps} />
{:else}
  <div class="mv-error">
    {resolved.error}
    {#if resolved.matches}

      Possible matches:
      {#each resolved.matches as m}
        \n- {m}
      {/each}
    {/if}
  </div>
{/if}
