<!-- eslint-disable @stylistic/quotes -- svelte parser requires non-backtick tag -->
<svelte:options
  customElement={{
    tag: 'mv-matterviz',
    shadow: 'none',
    props: {
      component: { type: 'String', reflect: false },
      props: { type: 'Object', reflect: false },
    },
  }}
/>

<script>
  import { listComponentKeys, resolveMattervizComponent } from './resolver'

  // Custom element props (component identifier + props bag)
  let { component = `Structure`, props = {} } = $props()

  let resolved = $derived(resolveMattervizComponent(component))
  let mv_props = $derived(props ?? {})

  // Expose discovered components for easy debugging in the browser console.
  if (typeof window !== `undefined` && !window.__matterviz_components) {
    window.__matterviz_components = listComponentKeys()
  }
</script>

<style>
  :host {
    display: block;
  }
  .mv-error {
    font-family: monospace;
    font-size: 12px;
    white-space: pre-wrap;
    padding: 0.5rem;
  }
</style>

{#if resolved.component}
  {@const Component = resolved.component}
  <Component {...mv_props} />
{:else}
  <div class="mv-error">
    {resolved.error}
    {#if resolved.matches}
      Possible matches:
      {#each resolved.matches as match (match)}
        \n- {match}
      {/each}
    {/if}
  </div>
{/if}
