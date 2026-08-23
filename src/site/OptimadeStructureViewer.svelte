<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { sanitize_html } from '$lib/sanitize'
  import { Icon } from 'svelte-widgets'
  import { Database, Globe, Link } from 'svelte-widgets/icons'
  import {
    decode_structure_id,
    detect_provider_from_slug,
    encode_structure_id,
    fetch_optimade_providers,
    fetch_optimade_structure,
    fetch_suggested_structures,
  } from '$lib/api/optimade'
  import type { OptimadeProvider, OptimadeStructure } from '$lib/api/optimade'
  import { Composition, get_electro_neg_formula } from '$lib/composition'
  import { Structure } from '$lib/structure'
  import type { AnyStructure } from '$lib/structure'
  import { optimade_to_structure } from '$lib/structure/parse'
  import { onMount, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { tooltip } from 'svelte-widgets/attachments'

  // Without props the viewer is driven by the /optimade-[slug] route and keeps the URL in sync
  let {
    structure_id: init_structure_id,
    selected_provider: init_provider,
    ...rest
  }: {
    structure_id?: string
    selected_provider?: string
  } & HTMLAttributes<HTMLDivElement> = $props()
  const routed = untrack(() => !init_structure_id && !init_provider)

  let structure = $state<AnyStructure | null>(null)
  let loading_struct = $state(false)
  let loading_suggestions = $state(false)
  let struct_error = $state<string | null>(null)
  let available_providers = $state<OptimadeProvider[]>([])
  let providers_error = $state<string | null>(null)
  // Initialized from props but mutated by user interactions, hence $state + untrack
  let selected_db = $state(untrack(() => init_provider ?? `mp`))
  let input_value = $state(untrack(() => init_structure_id ?? ``))
  let suggested_structures = $state<OptimadeStructure[]>([])
  let structure_id = $derived(input_value.trim())
  let provider_config = $derived(
    available_providers.find((provider) => provider.id === selected_db),
  )

  onMount(load_providers)

  // Route slug (e.g. /optimade-mp-149 or /optimade-cod-1000000) picks provider + id
  $effect(() => {
    if (!routed || available_providers.length === 0) return
    const decoded_slug = decode_structure_id(page.params.slug ?? ``)
    const provider = detect_provider_from_slug(decoded_slug, available_providers)
    if (provider) {
      selected_db = provider
      input_value = decoded_slug.startsWith(`${provider}-`)
        ? decoded_slug
        : `${provider}-${decoded_slug}`
    } else input_value = decoded_slug
  })

  // Suggestions follow the provider only (not every structure navigation within it)
  $effect(() => {
    if (available_providers.length > 0) void load_suggested_structures()
  })
  $effect(() => {
    if (structure_id && available_providers.length > 0) void load_structure_data()
  })

  async function load_providers() {
    providers_error = null
    available_providers = await fetch_optimade_providers().catch((err) => {
      console.error(`Failed to load providers:`, err)
      providers_error = `Failed to load providers. Click Retry to try again.`
      return []
    })
  }

  // Every keystroke/provider switch starts a fetch; only the latest may write back, else a
  // slow older response lands on top of a newer one
  let structure_request_id = 0
  async function load_structure_data() {
    const request_id = ++structure_request_id
    loading_struct = true
    struct_error = null
    let error: string | null = null
    const data = await fetch_optimade_structure(
      structure_id,
      selected_db,
      available_providers,
    ).catch((err) => {
      error = `Failed to load structure: ${err}`
      return null
    })
    if (request_id !== structure_request_id) return
    if (data) {
      try {
        structure = optimade_to_structure(data)
      } catch (err) {
        error = `Failed to convert structure data: ${err}`
      }
    }
    struct_error = error
    loading_struct = false
  }

  let suggestions_request_id = 0
  async function load_suggested_structures() {
    const request_id = ++suggestions_request_id
    loading_suggestions = true
    const structures = await fetch_suggested_structures(selected_db, available_providers, 12)
    if (request_id !== suggestions_request_id) return
    suggested_structures = structures
    loading_suggestions = false
  }

  function navigate_to_structure(id: string) {
    input_value = id
    if (routed)
      void goto(`/optimade-${encode_structure_id(id)}`, { keepFocus: true, noScroll: true })
  }
</script>

<div class="input-section">
  <input
    class="structure-input"
    placeholder="Enter structure ID"
    bind:value={input_value}
    onkeydown={(event) => {
      if (event.key === `Enter`) navigate_to_structure(structure_id)
    }}
  />
  <button
    class="fetch-button"
    onclick={() => navigate_to_structure(structure_id)}
    disabled={loading_struct || !structure_id}
  >
    {loading_struct ? `Loading...` : `Fetch`}
  </button>
</div>

<div class="main-layout full-bleed" {...rest}>
  <div class="db-column">
    <h3>
      Providers
      <span style="font-weight: lighter">({available_providers.length})</span>
    </h3>

    {#if providers_error}
      <div class="error-message">
        <p>{providers_error}</p>
        <button class="retry-button" onclick={load_providers}>Retry</button>
      </div>
    {:else if available_providers.length === 0}
      <p>Loading providers...</p>
    {:else}
      <div class="db-grid">
        {#each available_providers as { id, attributes } (id)}
          <div class:selected={id === selected_db}>
            <button
              class="db-select"
              {@attach tooltip({ allow_html: true, content: sanitize_html(attributes.name) })}
              onclick={() => {
                selected_db = id
                input_value = ``
              }}
            >
              <Icon icon={Database} />
              {id}
            </button>
            <a
              href={attributes.base_url}
              title="API"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon icon={Link} />
            </a>
            {#if attributes.homepage}
              <a
                href={attributes.homepage}
                title="Home"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon icon={Globe} />
              </a>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="suggestions-column">
    {#if suggested_structures.length > 0}
      <h3>
        Suggested Structures
        <span style="font-weight: lighter">({suggested_structures.length})</span>
      </h3>
      {#if loading_suggestions}
        <p>Loading...</p>
      {:else}
        <div class="structure-suggestions">
          {#each suggested_structures as struct (struct.id)}
            {@const formula = get_electro_neg_formula(
              struct.attributes.chemical_formula_descriptive ?? ``,
            )}
            <button onclick={() => navigate_to_structure(struct.id)}>
              <span style="font-family: monospace">{struct.id}</span>
              {#if formula}
                <span style="font-weight: lighter">{@html sanitize_html(formula)}</span>
              {/if}
              {#if struct.attributes.chemical_formula_descriptive}
                <Composition
                  composition={struct.attributes.chemical_formula_descriptive}
                  mode="pie"
                  style="min-height: 80px; height: 80px; grid-row: 1/span 2; grid-column: 2"
                />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <div class="structure-column">
    {#if struct_error}
      <div class="error-message">
        <p>{struct_error}</p>
      </div>
    {/if}

    {#if loading_struct}
      <p>Loading structure from {provider_config?.attributes.name}...</p>
    {/if}

    {#if structure}
      <h2 style="margin: 0 2pt 10pt">
        {@html sanitize_html(get_electro_neg_formula(structure))}
        {#if structure_id}
          <span>({structure_id})</span>
        {/if}
      </h2>
      <Structure {structure} style="height: 100%" />
    {/if}
  </div>
</div>

<style>
  .input-section {
    display: flex;
    gap: 0.5em;
    margin-bottom: 1.5em;
    justify-content: center;
  }
  .structure-input {
    flex: 1;
    max-width: 400px;
    padding: 0.4em 0.6em;
    font-size: 0.95em;
    border-radius: 4pt;
    border: 1px solid var(--border-color);
    background: var(--surface-bg);
  }
  .fetch-button,
  .retry-button {
    padding: 0.4em 0.8em;
    font-size: 0.95em;
    border-radius: 4pt;
    border: 1px solid var(--border-color);
    background: var(--btn-bg);
  }
  .fetch-button:hover {
    background: var(--btn-bg-hover);
  }
  .main-layout {
    display: grid;
    grid-template-columns: minmax(250px, 280px) minmax(280px, 320px) 1fr;
    gap: clamp(1em, 2vw, 1.5em);
    max-height: 80vh;
  }
  .db-column,
  .suggestions-column,
  .structure-column {
    max-height: inherit;
  }
  .db-column h3,
  .suggestions-column h3 {
    margin: 0 0 0.75em;
    padding: 0.5em 0 0 0;
  }
  .db-grid {
    display: grid;
    gap: 6pt;
    overflow-y: auto;
    height: 100%;
  }
  .db-grid div {
    display: flex;
    align-items: center;
    gap: 6pt;
    padding: 0.3em 0.5em;
    border: 1px solid var(--border-color);
    border-radius: 4pt;
  }
  .db-grid div:hover {
    background: var(--btn-bg-hover);
  }
  .db-grid div.selected {
    border: 1px solid var(--accent-color);
  }
  .db-select {
    display: flex;
    align-items: center;
    gap: 6pt;
    background: none;
    font: inherit;
    flex: 1;
  }
  .db-grid a {
    padding: 2pt;
    border-radius: 3pt;
    font-size: 0.9em;
  }
  .db-grid a:hover {
    background: var(--btn-bg-hover);
  }
  .structure-suggestions {
    display: grid;
    gap: 0.5em;
    overflow-y: auto;
    height: 100%;
  }
  .structure-suggestions button {
    display: grid;
    justify-content: space-between;
    gap: 0.75em;
    align-items: center;
    padding: 0.5em 0.75em;
    border: 1px solid var(--border-color);
    border-radius: 4pt;
    background: none;
    font: inherit;
    text-align: left;
  }
  .structure-suggestions button:hover {
    background: var(--btn-bg-hover);
  }
  .structure-column h2 span {
    font-weight: lighter;
    color: var(--text-color-muted);
  }
  .error-message {
    text-align: center;
    color: #ff6b6b;
    margin: 1em 0;
  }
  @media (max-width: 1250px) {
    .main-layout {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto 1fr;
    }
    .structure-column {
      grid-column: 1 / -1;
      order: -1;
    }
  }
</style>
