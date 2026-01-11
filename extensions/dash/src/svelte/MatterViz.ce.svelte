<svelte:options
  customElement={{
    tag: `mv-matterviz`,
    shadow: `none`,
    props: {
      component: { type: `String`, reflect: false },
      props: { type: `Object`, reflect: false },
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
    font-family:
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      'Liberation Mono',
      'Courier New',
      monospace;
    font-size: 12px;
    white-space: pre-wrap;
    padding: 0.5rem;
  }
  .mv-loading {
    font-size: 12px;
    color: #888;
    padding: 0.5rem;
  }
</style>

{#if resolved.component && Object.keys(mv_props).length > 0}
  {@const Component = resolved.component}
  <Component {...mv_props} />
{:else if !resolved.component}
  <div class="mv-error">
    {resolved.error}
    {#if resolved.matches}
      Possible matches:
      {#each resolved.matches as m}
        \n- {m}
      {/each}
    {/if}
  </div>
{:else}
  <!-- Waiting for props to be set -->
  <div class="mv-loading">Loading {component}...</div>
{/if}
