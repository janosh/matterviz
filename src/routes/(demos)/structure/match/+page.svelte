<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import EmptyState from '$lib/EmptyState.svelte'
  import FilePicker from '$lib/FilePicker.svelte'
  import type { Crystal } from '$lib/structure'
  import { Structure } from '$lib/structure'
  import {
    get_structure_rms_dist,
    is_ok,
    match_structures,
    match_structures_anonymous,
    type MatcherOptions,
  } from '$lib/structure/ferrox-wasm'
  import { parse_structure_file } from '$lib/structure/parse'
  import { structure_files, structure_map } from '$site/structures'
  import { onMount } from 'svelte'

  interface MatchResult {
    id: string
    rms: number | null
    max_dist: number | null
    matches: boolean
    error?: string
  }

  // Uploaded and perturbed structures
  let uploaded = $state<Map<string, Crystal>>(new Map())
  let perturbed = $state<Map<string, Crystal>>(new Map())

  // Helper to look up structure by ID from any source
  function get_structure(id: string | null): Crystal | null {
    if (!id) return null
    return structure_map.get(id) ?? uploaded.get(id) ?? perturbed.get(id) ?? null
  }

  // Reference structure
  let reference_id = $state<string | null>(null)
  const reference = $derived(get_structure(reference_id))

  // Candidates
  let candidate_ids = $state<string[]>([])

  // Matcher options
  let latt_len_tol = $state(0.2)
  let site_pos_tol = $state(0.3)
  let angle_tol = $state(5.0)
  let primitive_cell = $state(true)
  let scale = $state(true)
  let anonymous = $state(false)

  // Results
  let results = $state<MatchResult[]>([])
  let selected_id = $state<string | null>(null)
  let loading = $state(false)
  let wasm_ready = $state(false)
  let wasm_error = $state<string | null>(null)

  const selected_candidate = $derived(get_structure(selected_id))

  // Extract ID from file object (strips extension for regular files)
  function get_id_from_file(file: { name: string }): string {
    if (file.name.startsWith(`upload:`) || file.name.startsWith(`perturb:`)) {
      return file.name
    }
    return file.name.replace(/\.[^/.]+$/, ``)
  }

  // File list with uploaded and perturbed files appended
  const all_files = $derived([
    ...structure_files,
    ...[...uploaded.keys()].map((id) => ({
      name: id,
      url: ``,
      category: `Uploaded`,
      category_icon: `📤`,
    })),
    ...[...perturbed.keys()].map((id) => ({
      name: id,
      url: ``,
      category: `Perturbed`,
      category_icon: `🔀`,
    })),
  ])

  // Map candidate IDs back to file names for FilePicker highlighting
  const active_file_names = $derived(
    candidate_ids.map((id) =>
      all_files.find((f) => get_id_from_file(f) === id)?.name ?? id
    ),
  )

  onMount(async () => {
    try {
      const { ensure_ferrox_wasm_ready } = await import(`$lib/structure/ferrox-wasm`)
      await ensure_ferrox_wasm_ready()
      init_perturbed_examples()
      wasm_ready = true
    } catch (exc) {
      wasm_error = `WASM initialization failed: ${exc}`
    }
  })

  // URL Sync
  let url_initialized = $state(false)

  $effect(() => {
    if (!browser || url_initialized) return
    const params = page.url.searchParams
    reference_id = params.get(`ref`) ?? null
    candidate_ids = params.get(`candidates`)?.split(`,`).filter(Boolean) ?? []
    // Parse numeric params with NaN guard, falling back to defaults
    const parse_float_safe = (val: string | null, fallback: number): number => {
      if (val === null) return fallback
      const parsed = parseFloat(val)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    latt_len_tol = parse_float_safe(params.get(`latt_tol`), 0.2)
    site_pos_tol = parse_float_safe(params.get(`site_tol`), 0.3)
    angle_tol = parse_float_safe(params.get(`angle_tol`), 5.0)
    primitive_cell = params.get(`primitive`) !== `false`
    scale = params.get(`scale`) !== `false`
    anonymous = params.get(`anon`) === `true`
    url_initialized = true
  })

  $effect(() => {
    if (!browser || !url_initialized) return
    const params = new URLSearchParams()
    if (reference_id) params.set(`ref`, reference_id)
    if (candidate_ids.length) params.set(`candidates`, candidate_ids.join(`,`))
    if (latt_len_tol !== 0.2) params.set(`latt_tol`, String(latt_len_tol))
    if (site_pos_tol !== 0.3) params.set(`site_tol`, String(site_pos_tol))
    if (angle_tol !== 5.0) params.set(`angle_tol`, String(angle_tol))
    if (!primitive_cell) params.set(`primitive`, `false`)
    if (!scale) params.set(`scale`, `false`)
    if (anonymous) params.set(`anon`, `true`)

    const query = params.toString()
    const base_path = `/structure/match`
    const target = query ? `${base_path}?${query}` : base_path
    const current_url = `${location.pathname}${location.search}`
    if (current_url === target) return
    goto(target, { replaceState: true, keepFocus: true, noScroll: true })
  })

  // Auto-matching
  let debounce_timer: ReturnType<typeof setTimeout>

  $effect(() => {
    const deps = [
      wasm_ready,
      reference,
      candidate_ids,
      uploaded,
      latt_len_tol,
      site_pos_tol,
      angle_tol,
      primitive_cell,
      scale,
      anonymous,
    ]
    void deps
    if (!wasm_ready || !reference || candidate_ids.length === 0) {
      results = []
      return
    }
    clearTimeout(debounce_timer)
    debounce_timer = setTimeout(() => run_matching(), 300)
  })

  async function run_matching() {
    if (!reference) return
    loading = true
    results = []

    const options: MatcherOptions = {
      latt_len_tol,
      site_pos_tol,
      angle_tol,
      primitive_cell,
      scale,
      element_only: anonymous,
    }

    const match_fn = anonymous ? match_structures_anonymous : match_structures
    const new_results: MatchResult[] = []

    for (const id of candidate_ids) {
      const candidate = get_structure(id)
      if (!candidate) continue

      try {
        // Disable primitive_cell for perturbed structures (perturbation breaks symmetry,
        // causing different primitive reductions for reference vs perturbed)
        const is_perturbed_structure = id.startsWith(`perturb:`)
        const opts = is_perturbed_structure
          ? { ...options, primitive_cell: false }
          : options
        const [rms_result, match_result] = await Promise.all([
          get_structure_rms_dist(reference, candidate, opts),
          match_fn(reference, candidate, opts),
        ])

        const error = !is_ok(rms_result)
          ? rms_result.error
          : !is_ok(match_result)
          ? match_result.error
          : undefined

        const rms_data = is_ok(rms_result) ? rms_result.ok : null
        new_results.push({
          id,
          rms: rms_data?.rms ?? null,
          max_dist: rms_data?.max_dist ?? null,
          matches: is_ok(match_result) && match_result.ok,
          error,
        })
      } catch (exc) {
        new_results.push({
          id,
          rms: null,
          max_dist: null,
          matches: false,
          error: String(exc),
        })
      }
    }

    new_results.sort((a, b) => (a.rms ?? Infinity) - (b.rms ?? Infinity))
    results = new_results
    loading = false
    if (new_results.length > 0 && !selected_id) selected_id = new_results[0].id
  }

  function handle_file_click(file: { name: string }) {
    const id = get_id_from_file(file)
    if (candidate_ids.includes(id)) {
      candidate_ids = candidate_ids.filter((cid) => cid !== id)
      if (selected_id === id) selected_id = null
    } else {
      candidate_ids = [...candidate_ids, id]
    }
  }

  function handle_file_dblclick(file: { name: string }) {
    reference_id = get_id_from_file(file)
  }

  function select_all() {
    candidate_ids = all_files
      .map(get_id_from_file)
      .filter((id) => id !== reference_id)
  }

  async function handle_upload(event: Event) {
    const input = event.target as HTMLInputElement
    for (const file of input.files ?? []) {
      const content = await file.text()
      const parsed = parse_structure_file(content, file.name)
      if (parsed && `sites` in parsed && parsed.lattice) {
        const id = `upload:${file.name}`
        uploaded = new Map([...uploaded, [id, parsed as Crystal]])
        candidate_ids = [...candidate_ids, id]
      }
    }
    input.value = ``
  }

  async function handle_drop(event: DragEvent, target: `reference` | `comparison`) {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return

    for (const file of files) {
      const content = await file.text()
      const parsed = parse_structure_file(content, file.name)
      if (parsed && `sites` in parsed && parsed.lattice) {
        const id = `upload:${file.name}`
        uploaded = new Map([...uploaded, [id, parsed as Crystal]])
        if (target === `reference`) {
          reference_id = id
        } else {
          candidate_ids = [...candidate_ids, id]
          selected_id = id
        }
      }
    }
  }

  function format_num(val: number | null | undefined): string {
    if (val == null) return `—` // em dash indicates no match possible
    return val.toFixed(4)
  }

  // Create a perturbed copy of a structure with small random fractional coordinate displacements
  // The distance parameter is approximately the RMS displacement in Angstroms
  function perturb_structure(struct: Crystal, distance: number): Crystal {
    const lattice = struct.lattice.matrix
    // Approximate fractional displacement magnitude from Cartesian distance
    const avg_lattice_length =
      (Math.sqrt(lattice[0][0] ** 2 + lattice[0][1] ** 2 + lattice[0][2] ** 2) +
        Math.sqrt(lattice[1][0] ** 2 + lattice[1][1] ** 2 + lattice[1][2] ** 2) +
        Math.sqrt(lattice[2][0] ** 2 + lattice[2][1] ** 2 + lattice[2][2] ** 2)) /
      3
    const frac_magnitude = distance / avg_lattice_length

    return {
      ...struct,
      sites: struct.sites.map((site) => {
        // Random fractional displacement
        const da = (Math.random() - 0.5) * 2 * frac_magnitude
        const db = (Math.random() - 0.5) * 2 * frac_magnitude
        const dc = (Math.random() - 0.5) * 2 * frac_magnitude

        // Apply fractional displacement and wrap to [0, 1)
        const abc: [number, number, number] = [
          ((site.abc[0] + da) % 1 + 1) % 1,
          ((site.abc[1] + db) % 1 + 1) % 1,
          ((site.abc[2] + dc) % 1 + 1) % 1,
        ]

        // Recalculate Cartesian coordinates from fractional
        const xyz: [number, number, number] = [
          abc[0] * lattice[0][0] + abc[1] * lattice[1][0] + abc[2] * lattice[2][0],
          abc[0] * lattice[0][1] + abc[1] * lattice[1][1] + abc[2] * lattice[2][1],
          abc[0] * lattice[0][2] + abc[1] * lattice[1][2] + abc[2] * lattice[2][2],
        ]

        return { ...site, abc, xyz }
      }),
    }
  }

  function add_perturbed_version() {
    if (!reference || !reference_id) return
    const base_id = reference_id.replace(/^perturb:\d+:/, ``)
    // Use endsWith to avoid overcounting when base_id is a substring of another ID
    const count =
      [...perturbed.keys()].filter((id) => id.endsWith(`:${base_id}`)).length
    const id = `perturb:${count + 1}:${base_id}`
    // Increasing displacement for each perturbed version (0.05Å, 0.10Å, 0.15Å, ...)
    const perturbed_struct = perturb_structure(reference, 0.05 * (count + 1))
    perturbed = new Map([...perturbed, [id, perturbed_struct]])
    candidate_ids = [...candidate_ids, id]
  }

  // Generate initial perturbed examples when WASM is ready
  function init_perturbed_examples() {
    const example_ids = [`mp-1`, `Cu-FCC`, `Fe-BCC`]
    const distances = [0.05, 0.1, 0.15] // Displacement in Angstroms
    for (const base_id of example_ids) {
      const struct = structure_map.get(base_id)
      if (!struct) continue
      for (const [idx, dist] of distances.entries()) {
        const id = `perturb:${idx + 1}:${base_id}`
        perturbed = new Map([...perturbed, [id, perturb_structure(struct, dist)]])
      }
    }
  }
</script>

<h1>Structure Matching</h1>
<p class="intro">
  <strong>Double-click</strong> = reference, <strong>single-click</strong> = candidate.
  Use <strong>+Noise</strong> to create perturbed copies showing non-zero RMS values.
</p>

{#if wasm_error}
  <p class="error">{wasm_error}</p>
{:else if !wasm_ready}
  <p class="loading">Loading WASM...</p>
{/if}

<div class="layout bleed-1400">
  <aside class="sidebar">
    <div class="sidebar-header">
      <button onclick={select_all} title="Add all structures as candidates">All</button>
      <button
        onclick={() => {
          candidate_ids = []
          selected_id = null
        }}
        title="Clear all candidates"
      >
        Clear
      </button>
      <button
        onclick={add_perturbed_version}
        disabled={!reference}
        title="Create perturbed copy of reference with random displacements"
      >
        +Noise
      </button>
      <label class="upload-btn" title="Upload structure files">+ <input
          type="file"
          accept=".json,.cif,.poscar,.xyz,.extxyz,.yaml,.yml"
          multiple
          onchange={handle_upload}
        /></label>
    </div>
    <FilePicker
      files={all_files}
      active_files={active_file_names}
      layout="vertical"
      show_category_filters
      on_click={(file) => handle_file_click(file)}
      on_dblclick={(file) => handle_file_dblclick(file)}
      type_mapper={(file) => {
        const id = get_id_from_file(file)
        if (id === reference_id) return `reference`
        return file.name.split(`.`).pop() ?? `file`
      }}
      file_type_colors={{ reference: `rgba(255, 193, 7, 0.9)` }}
    />
    <div class="legend">
      <span><b style="color: var(--warning-color)">■</b> Reference</span>
      <span><b style="color: var(--success-color)">■</b> Candidate</span>
    </div>
  </aside>

  <main>
    <div class="viewers">
      <div
        class="viewer"
        role="region"
        aria-label="Reference drop zone"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => handle_drop(e, `reference`)}
      >
        <span class="viewer-label">Ref: {reference_id ?? `(none)`}</span>
        {#if reference}
          <Structure structure={reference} style="height: 340px" />
        {:else}
          <EmptyState message="Double-click or drop" style="height: 340px" />
        {/if}
      </div>
      <div
        class="viewer"
        role="region"
        aria-label="Comparison drop zone"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => handle_drop(e, `comparison`)}
      >
        <span class="viewer-label">Cmp: {
            selected_id?.replace(`upload:`, ``) ?? `(none)`
          }</span>
        {#if selected_candidate}
          <Structure structure={selected_candidate} style="height: 340px" />
        {:else}
          <EmptyState message="Click result or drop" style="height: 340px" />
        {/if}
      </div>
    </div>

    <details class="options" open>
      <summary>Options</summary>
      <div class="options-row">
        <label>Latt <input
            type="number"
            bind:value={latt_len_tol}
            min="0.01"
            max="1"
            step="0.01"
          /></label>
        <label>Site <input
            type="number"
            bind:value={site_pos_tol}
            min="0.01"
            max="1"
            step="0.01"
          /></label>
        <label>Angle <input
            type="number"
            bind:value={angle_tol}
            min="0.1"
            max="15"
            step="0.1"
          /></label>
        <label><input type="checkbox" bind:checked={primitive_cell} /> Prim</label>
        <label><input type="checkbox" bind:checked={scale} /> Scale</label>
        <label><input type="checkbox" bind:checked={anonymous} /> Anon</label>
      </div>
    </details>

    <h3>
      Results {#if loading}⏳{/if}
      {#if results.length}({results.length}){/if}
    </h3>
    {#if results.length > 0}
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Structure</th>
            <th title="Root Mean Square distance (Å)">RMS</th>
            <th title="Maximum site distance (Å)">Max</th>
            <th title="Match status: ✓ = match, ✗ = no match">Match</th>
          </tr>
        </thead>
        <tbody>
          {#each results as r, idx (r.id)}
            <tr
              class:selected={r.id === selected_id}
              class:err={!!r.error}
              onclick={() => (selected_id = r.id)}
            >
              <td>{idx + 1}</td>
              <td class="mono">{r.id.replace(`upload:`, ``)}</td>
              <td
                class="mono"
                title={r.rms == null
                ? `Incompatible structures`
                : `RMS distance: ${r.rms.toFixed(4)} Å`}
              >
                {format_num(r.rms)}
              </td>
              <td
                class="mono"
                title={r.max_dist == null
                ? `Incompatible structures`
                : `Max distance: ${r.max_dist.toFixed(4)} Å`}
              >
                {format_num(r.max_dist)}
              </td>
              <td>{#if r.error}❌{:else if r.matches}✓{:else}✗{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if !reference}
      <p class="hint">Double-click a structure to set reference</p>
    {:else if candidate_ids.length === 0}
      <p class="hint">Click structures to add candidates</p>
    {:else if !loading}
      <p class="hint">Matching...</p>
    {/if}
  </main>
</div>

<style>
  .intro {
    text-align: center;
    font-size: 0.9em;
    color: var(--text-muted);
    margin-bottom: 0.5em;
  }
  .error {
    text-align: center;
    color: var(--error-color);
  }
  .loading {
    text-align: center;
    color: var(--text-muted);
  }
  .hint {
    color: var(--text-muted);
    font-size: 0.9em;
  }

  .layout {
    display: grid;
    grid-template-columns: 180px minmax(0, 900px);
    gap: 0.8em;
    justify-content: center;
    align-items: start;
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .sidebar {
      max-height: 200px;
    }
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    max-height: min(80vh, 600px);
    overflow-y: auto;
  }
  .sidebar :global(.file-picker) {
    flex: 0 1 auto !important;
    max-height: none;
  }
  .sidebar-header {
    display: flex;
    gap: 0.3em;
  }
  .sidebar-header button, .upload-btn {
    padding: 0.2em 0.5em;
    font-size: 0.75em;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--surface-bg);
    cursor: pointer;
  }
  .sidebar-header button:hover:not(:disabled), .upload-btn:hover {
    background: var(--hover-bg);
  }
  .sidebar-header button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .upload-btn input {
    display: none;
  }
  .legend {
    font-size: 0.7em;
    color: var(--text-muted);
    display: flex;
    gap: 0.8em;
  }

  main {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }

  .viewers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5em;
  }
  @media (max-width: 600px) {
    .viewers {
      grid-template-columns: 1fr;
    }
  }
  .viewer {
    position: relative;
  }
  .viewer-label {
    position: absolute;
    top: 4px;
    left: 8px;
    font-size: 0.75em;
    color: var(--text-muted);
    z-index: 1;
    background: var(--surface-bg);
    padding: 0 4px;
    border-radius: 3px;
  }

  .options summary {
    cursor: pointer;
    font-size: 0.85em;
    font-weight: 500;
  }
  .options-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6em;
    margin-top: 0.3em;
    font-size: 0.85em;
  }
  .options-row label {
    display: flex;
    align-items: center;
    gap: 0.2em;
  }
  .options-row input[type='number'] {
    width: 55px;
  }
  .options-row input[type='checkbox'] {
    margin: 0;
  }

  h3 {
    margin: 0.5em 0 0.3em;
    font-size: 1em;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
  }
  th, td {
    padding: 0.25em 0.5em;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }
  th {
    font-weight: 600;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--hover-bg);
  }
  tbody tr.selected {
    background: var(--accent-bg);
  }
  tbody tr.err {
    color: var(--error-color);
  }
  .mono {
    font-family: monospace;
  }
</style>
