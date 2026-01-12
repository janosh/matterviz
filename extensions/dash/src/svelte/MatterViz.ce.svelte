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
  import { list_component_keys, resolve_matterviz_component } from './resolver'

  // Custom element props (component identifier + props bag)
  let { component = `Structure`, props = {} } = $props()

  // Ensure props is always a plain object to prevent spread errors
  // Custom elements may receive non-object values during initialization
  let safe_props = $derived(
    props && typeof props === `object` && !Array.isArray(props) ? props : {},
  )

  let resolved = $derived(resolve_matterviz_component(component))

  // Expose discovered components for easy debugging in the browser console.
  if (typeof globalThis !== `undefined` && !globalThis.__matterviz_components) {
    globalThis.__matterviz_components = list_component_keys()
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
  <Component {...safe_props} />
{:else}
  <div class="mv-error">
    {resolved.error}
    {#if resolved.matches}
      Possible matches:
      {#each resolved.matches as match (match)}
        <br />- {match}
      {/each}
    {/if}
  </div>
{/if}
