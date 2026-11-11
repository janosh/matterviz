<script lang="ts" module>
  import type { ComponentDoc } from '#root/src/scripts/prop-docs.ts'

  // One fetch per component for the page's lifetime, shared by the prefetch and the table
  const loads = new Map<string, Promise<ComponentDoc>>()
  const load_props = (name: string): Promise<ComponentDoc> => {
    let load = loads.get(name)
    if (!load) {
      load = import(`virtual:prop-docs`).then(async ({ default: loaders }) => {
        const loader = loaders[name]
        if (!loader) throw new Error(`No props extracted for ${name}`)
        return (await loader()).default
      })
      // a failure (e.g. an extraction error mid-edit on the dev server) is not cached: the
      // next open retries
      load.catch(() => loads.delete(name))
      loads.set(name, load)
    }
    return load
  }

  // Types past this many characters show their first two lines until clicked
  const LONG_TYPE = 80
</script>

<script lang="ts">
  // Collapsible prop reference for the current demo page's components, generated from the
  // `$props()` declarations by src/scripts/prop-docs.ts. Fetched once the browser idles after
  // the page loads, so opening a table finds its props ready instead of waiting on the fetch
  // (and on a dev server, the extraction).
  import { page } from '$app/state'
  import { page_components } from '#site/state.svelte.js'

  let open: Record<string, boolean> = $state({})
  let expanded: Record<string, boolean> = $state({})
  let names = $derived(page_components(page.route.id ?? ``))
  $effect(() => {
    const pending = names // read here, so a new page's components prefetch too
    // a failed prefetch surfaces when the table is opened (the {:catch} below), not here
    const prefetch = () => pending.forEach((name) => load_props(name).catch(() => {}))
    if (`requestIdleCallback` in globalThis) requestIdleCallback(prefetch)
    else setTimeout(prefetch, 500) // Safari has no requestIdleCallback
  })
</script>

{#each names as name (name)}
  <details bind:open={open[name]}>
    <!-- the name is a span, not <code>: the site links every <code> naming a component to its
    source, and a link in the summary took the click that should open the table -->
    <summary>Props of <span class="component-name">{name}</span></summary>
    {#if open[name]}
      {#await load_props(name)}
        <p>Loading props...</p>
      {:then { props, rest_attributes }}
        <!-- page-wide (up to 1400px) like the demos, so long types and descriptions wrap in
        their columns instead of scrolling the table sideways -->
        <table class="bleed-1400">
          <thead>
            <tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr>
          </thead>
          <tbody>
            {#each props as { name: prop, type, default: fallback, default_value, description, bindable, required } (prop)}
              {@const key = `${name}.${prop}`}
              <tr>
                <td>
                  <code>{prop}</code>
                  {#if required}<small>required</small>{/if}
                  {#if bindable}<small>bindable</small>{/if}
                </td>
                <td>
                  {#if type && type.length > LONG_TYPE}
                    <button
                      type="button"
                      class="long-type"
                      class:expanded={expanded[key]}
                      aria-expanded={Boolean(expanded[key])}
                      title={expanded[key] ? `Collapse type` : `Show full type`}
                      onclick={() => (expanded[key] = !expanded[key])}
                    >
                      <code>{type}</code>
                    </button>
                  {:else if type}<code>{type}</code>{/if}
                </td>
                <td>
                  <!-- a constant or setting shows its value, the name beneath -->
                  {#if default_value}
                    <code>{default_value}</code><small>{fallback}</small>
                  {:else if fallback}<code>{fallback}</code>{/if}
                </td>
                <!-- `code` spans in the source comment render as code (odd parts of the split) -->
                <td
                  >{#each description?.split(/`([^`]+)`/) ?? [] as part, idx (idx)}{#if idx % 2}<code
                        >{part}</code
                      >{:else}{part}{/if}{/each}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
        {#if rest_attributes}
          <p class="rest-attributes">
            Also takes any {rest_attributes} attribute (class, style, aria-*, event handlers, ...),
            passed on to its root element.
          </p>
        {/if}
      {:catch error}
        <p>Failed to load the props of {name}: {error}</p>
      {/await}
    {/if}
  </details>
{/each}

<style>
  details {
    margin-block: 2em;
  }
  summary {
    cursor: pointer;
    font-weight: bold;
  }
  .component-name {
    font-family: monospace;
  }
  /* reference detail, not page prose: a step below the body text. Descriptions get the room
     long types would otherwise take */
  table {
    font-size: 0.85em;
    td:nth-child(2) {
      max-width: 28em;
    }
    :is(td, th):nth-child(4) {
      min-width: 22em;
    }
  }
  td small {
    display: block;
    opacity: 0.7;
  }
  .long-type {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    text-align: start;
    cursor: pointer;
    &:not(.expanded) code {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }
  }
  .rest-attributes {
    font-size: 0.85em;
    opacity: 0.8;
  }
</style>
