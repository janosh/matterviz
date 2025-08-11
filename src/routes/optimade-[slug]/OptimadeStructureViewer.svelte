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
  let selected_db = $state(`mp`)
  let available_dbs = $state<OptimadeDatabase[]>([])
  let input_value = $state(``)
  let suggested_structures = $state<OptimadeStructure[]>([])
  let loading_suggestions = $state(false)

  $effect(() => {
    const decoded_slug = decode_structure_id(page.params.slug ?? ``)
    input_value = decoded_slug
    detect_provider_from_slug(decoded_slug).then((provider) => {
      if (provider) {
        selected_db = provider
        input_value = decoded_slug.startsWith(`${provider}-`)
          ? decoded_slug
          : `${provider}-${decoded_slug}`
      }
    })
  })

  $effect(() => {
    fetch_optimade_providers().then((providers) => available_providers = providers)
  })

  let structure_id = $derived(input_value.trim())
  let db_config = $derived(available_providers.find((p) => p.id === selected_db))
  let pretty_formula = $derived(structure ? get_electro_neg_formula(structure) : ``)

  $effect(() => {
    if (structure_id && selected_db) load_structure_data()
    if (selected_db) {
      load_suggested_structures()
      load_databases()
    }
  })

  async function load_structure_data() {
    loading = true
    error = null
    try {
      const data = await fetch_optimade_structure(structure_id, selected_db)
      structure = data ? optimade_to_pymatgen(data) : null
      if (!structure) {
        error = data
          ? `Failed to convert structure data`
          : `Structure ${structure_id} not found`
      }
    } catch (err) {
      error = `Failed to load structure data: ${err}`
    } finally {
      loading = false
    }
  }

  async function load_databases() {
    try {
      available_dbs = await fetch_provider_databases(selected_db)
    } catch {
      available_dbs = []
    }
  }

  async function load_suggested_structures() {
    loading_suggestions = true
    try {
      suggested_structures = await fetch_suggested_structures(selected_db, 12)
    } catch {
      suggested_structures = []
    } finally {
      loading_suggestions = false
    }
  }

  async function navigate_to_structure(id: string) {
    input_value = id
    await load_structure_data()
    // Update URL without navigation to preserve scroll position
    history.pushState({}, ``, `/optimade-${encode_structure_id(id)}`)
  }
</script>

<h1 style="margin-top: 0">OPTIMADE Explorer</h1>

<div class="input-section">
  <input
    class="structure-input"
    placeholder="Enter structure ID"
    bind:value={input_value}
    onkeydown={async (event) => {
      if (event.key === `Enter`) await navigate_to_structure(structure_id)
    }}
  />
  <button
    class="fetch-button"
    onclick={() => navigate_to_structure(structure_id)}
    disabled={loading}
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
              if (available_dbs.length === 0) selected_db = id
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
      <h2>
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
    cursor: pointer;
  }
  .fetch-button:hover {
    background: var(--btn-hover-bg);
  }
  .main-layout {
    display: grid;
    grid-template-columns: minmax(250px, 280px) minmax(280px, 320px) 1fr;
    gap: clamp(1em, 2vw, 1.5em);
    height: calc(100vh - 180px);
  }
  .db-column, .suggestions-column, .structure-column {
    overflow-y: auto;
  }
  .db-column h3, .suggestions-column h3 {
    margin: 0 0 0.75em;
    font-size: 1.1em;
    position: sticky;
    top: 0;
    background: var(--bg-color);
    padding: 0.5em 0 0 0;
    z-index: 1;
  }
  .db-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4em;
    overflow-y: auto;
    height: 100%;
  }
  .db-grid div {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.3em 0.5em;
    border: 1px solid var(--border-color);
    border-radius: 4pt;
  }
  .db-grid div:hover {
    background: var(--surface-bg-hover);
  }
  .db-grid div.selected {
    border: 1px solid var(--accent-color);
    color: var(--accent-color);
  }
  .db-select {
    display: flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
    background: none;
    font: inherit;
    flex: 1;
  }
  .db-grid a {
    padding: 2pt;
    color: var(--text-color-muted);
    border-radius: 3pt;
    font-size: 0.8em;
  }
  .db-grid a:hover {
    background: var(--surface-bg-hover);
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
    cursor: pointer;
    background: none;
    font: inherit;
    text-align: left;
  }
  .structure-suggestions button:hover {
    background: var(--surface-bg-hover);
  }
  .structure-column h2 {
    margin: 0 2pt 10pt;
    font-size: 1.5em;
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
    .db-column h3,
    .suggestions-column h3 {
      position: static;
    }
  }
</style>
