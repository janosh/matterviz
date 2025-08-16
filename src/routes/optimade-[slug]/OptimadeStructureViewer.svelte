<script lang="ts">
  import { page } from '$app/state'
  import { Icon } from '$lib'
  import type {
    OptimadeDatabase,
    OptimadeProvider,
    OptimadeStructure,
  } from '$lib/api/optimade'
  import {
    decode_structure_id,
    detect_provider_from_slug,
    encode_structure_id,
    fetch_optimade_providers,
    fetch_optimade_structure,
    fetch_provider_databases,
    fetch_suggested_structures,
  } from '$lib/api/optimade'
  import { Composition } from '$lib/composition'
  import { get_electro_neg_formula } from '$lib/composition/parse'
  import type { PymatgenStructure } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import { optimade_to_pymatgen } from '$lib/structure/parse'
  import { tooltip } from 'svelte-multiselect'

  let structure = $state<PymatgenStructure | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let available_providers = $state<OptimadeProvider[]>([])
  let providers_error = $state<string | null>(null)
  let selected_db = $state(`mp`)
  let available_dbs = $state<OptimadeDatabase[]>([])
  let input_value = $state(``)
  let suggested_structures = $state<OptimadeStructure[]>([])
  let loading_suggestions = $state(false)
  let last_loaded_db = $state<string | null>(null)

  $effect(() => { // Initialize from URL slug
    const decoded_slug = decode_structure_id(page.params.slug ?? ``)
    if (available_providers.length > 0) {
      {
        const provider = detect_provider_from_slug(decoded_slug, available_providers)
        if (provider) {
          selected_db = provider
          input_value = decoded_slug.startsWith(`${provider}-`)
            ? decoded_slug
            : `${provider}-${decoded_slug}`
        } else input_value = decoded_slug
      }
    }
  })

  $effect(() => { // Load providers on mount
    load_providers()
  })

  // Load data when database or structure ID changes
  $effect(() => {
    if (selected_db && available_providers.length > 0) {
      load_databases()
      // Only load suggested structures when switching to different database
      // prevents refetching when navigating between structures within same database
      if (last_loaded_db !== selected_db) {
        load_suggested_structures()
        last_loaded_db = selected_db
      }
    }
    if (structure_id && selected_db && available_providers.length > 0) {
      load_structure_data()
    }
  })

  let structure_id = $derived(input_value.trim())
  let db_config = $derived(available_providers.find((p) => p.id === selected_db))
  let pretty_formula = $derived(structure ? get_electro_neg_formula(structure) : ``)

  async function load_providers() {
    providers_error = null
    available_providers = await fetch_optimade_providers().catch((err) => {
      console.error(`Failed to load providers:`, err)
      providers_error = `Failed to load providers. Click Retry to try again.`
      return []
    })
  }

  async function load_structure_data() {
    loading = true
    error = null
    const data = await fetch_optimade_structure(
      structure_id,
      selected_db,
      available_providers,
    ).catch(
      (err) => {
        error = `Failed to load structure: ${err}`
        return null
      },
    )

    if (data) {
      structure = optimade_to_pymatgen(data)
      if (!structure) error = `Failed to convert structure data`
    } else if (!error) {
      error = `Structure ${structure_id} not found`
    }
    loading = false
  }

  async function load_databases() {
    available_dbs = await fetch_provider_databases(selected_db, available_providers)
  }

  async function load_suggested_structures() {
    loading_suggestions = true
    suggested_structures = await fetch_suggested_structures(
      selected_db,
      available_providers,
      12,
    )
    loading_suggestions = false
  }

  function navigate_to_structure(id: string) {
    input_value = id
    history.pushState({}, ``, `/optimade-${encode_structure_id(id)}`)
  }
</script>

<h1 style="margin-top: 0">OPTIMADE Explorer</h1>

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
    disabled={loading || !structure_id}
  >
    {loading ? `Loading...` : `Fetch`}
  </button>
</div>

<div class="main-layout full-bleed">
  <div class="db-column">
    <h3>
      Databases <span style="font-weight: lighter"
      >({available_dbs.length || available_providers.length})</span>
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
        {#each available_dbs.length > 0 ? available_dbs : available_providers as
          { id, attributes }
          (id)
        }
          <div class:selected={id === selected_db}>
            <button
              class="db-select"
              {@attach tooltip({ content: attributes.name })}
              onclick={() => {
                selected_db = id
                input_value = ``
              }}
            >
              <Icon icon="Database" /> {id}
            </button>
            <a
              href={attributes.base_url}
              title="API"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon icon="Link" />
            </a>
            {#if attributes.homepage}
              <a
                href={attributes.homepage}
                title="Home"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon icon="Globe" />
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
        Suggested Structures <span style="font-weight: lighter"
        >({suggested_structures.length})</span>
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
                <span style="font-weight: lighter">{@html formula}</span>
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

  <div class="structure-column" style="display: grid">
    {#if error}
      <div class="error-message">
        <p>{error}</p>
      </div>
    {/if}

    {#if loading}
      <p>Loading structure from {db_config?.attributes.name}...</p>
    {/if}

    {#if structure}
      <h2 style="margin: 0 2pt 10pt">
        {@html pretty_formula}
        {#if structure_id}
          <span class="structure-id">({structure_id})</span>
        {/if}
      </h2>
      <Structure {structure} style="width: 100%; height: auto" />
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
  .fetch-button {
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
  .db-column, .suggestions-column, .structure-column {
    max-height: inherit;
  }
  .db-column h3, .suggestions-column h3 {
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
  .structure-id {
    font-weight: lighter;
    color: var(--text-color-muted);
  }
  .error-message {
    text-align: center;
    color: #ff6b6b;
    margin: 1em 0;
  }
  .retry-button {
    padding: 0.4em 0.8em;
    font-size: 0.9em;
    border-radius: 4pt;
    border: 1px solid var(--border-color);
    background: var(--btn-bg);
  }
  @media (max-width: 1250px) {
    .main-layout {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto 1fr;
      height: auto;
    }
    .structure-column {
      grid-column: 1 / -1;
      order: -1;
    }
    .db-column h3, .suggestions-column h3 {
      position: static;
    }
  }
</style>
