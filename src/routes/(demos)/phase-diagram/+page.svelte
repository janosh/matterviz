<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { FilePicker } from '$lib'
  import { decompress_data } from '$lib/io/decompress'
  import type { PhaseDiagramData, TdbParseResult } from '$lib/phase-diagram'
  import { IsobaricBinaryPhaseDiagram, TdbInfoPanel } from '$lib/phase-diagram'
  import {
    all_phase_diagram_files,
    find_precomputed_url,
    load_binary_phase_diagram,
  } from '$site/phase-diagrams'

  // Track currently loaded diagram
  let current_data = $state<PhaseDiagramData | null>(null)
  let current_file = $state<string>(``)
  let loading = $state(false)
  let error_message = $state<string | null>(null)

  // Consolidated TDB file state
  interface TdbState {
    result: TdbParseResult
    system_name: string
    precomputed_url: string | null
    is_loaded: boolean
  }
  let tdb = $state<TdbState | null>(null)

  // Helper to check file type from filename
  const has_ext = (name: string, ext: string) => name.toLowerCase().endsWith(ext)
  const is_tdb = (name: string) => has_ext(name, `.tdb`)
  const is_gzipped = (name: string) => has_ext(name, `.gz`)

  // Helper for consistent error formatting
  const format_error = (context: string, exc: unknown) =>
    `${context}: ${exc instanceof Error ? exc.message : String(exc)}`

  // Version counter to prevent race conditions in async file loading
  let load_version = $state(0)

  // Sync URL parameter to current file on load
  $effect(() => {
    if (!browser) return
    const file_param = page.url.searchParams.get(`file`)
    if (file_param && file_param !== current_file) {
      // Find the file in our list
      const file_info = all_phase_diagram_files.find((f) => f.name === file_param)
      if (file_info?.url) {
        // Increment version to invalidate any in-flight requests
        const this_version = ++load_version

        // Don't update URL param since we're loading from it
        if (is_tdb(file_param)) {
          // Handle TDB files specially - fetch and parse
          fetch(file_info.url)
            .then((res) => res.text())
            .then((content) => {
              // Only process if this is still the latest request
              if (load_version === this_version) handle_tdb_file(content, file_param)
            })
            .catch((exc) => {
              if (load_version === this_version) {
                error_message = format_error(`Failed to load TDB file`, exc)
              }
            })
        } else {
          load_diagram(file_info.url, file_param, false)
        }
      }
    }
  })

  // Update URL when current file changes
  function update_url(filename: string): void {
    if (!browser) return
    page.url.searchParams.set(`file`, filename)
    goto(`${page.url.pathname}?${page.url.searchParams.toString()}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    })
  }

  // Load a phase diagram from URL
  // Returns true if diagram loaded successfully, false otherwise
  // preserve_tdb: when true, keeps tdb state (used when loading pre-computed data for a TDB file)
  async function load_diagram(
    url: string,
    filename: string,
    update_url_param: boolean = true,
    preserve_tdb: boolean = false,
  ): Promise<boolean> {
    loading = true
    error_message = null
    if (!preserve_tdb) tdb = null
    try {
      const data = await load_binary_phase_diagram(url)
      if (data) {
        current_data = data
        current_file = filename
        if (update_url_param) update_url(filename)
        return true
      } else {
        error_message = `Failed to parse phase diagram data`
        return false
      }
    } catch (exc) {
      error_message = format_error(`Failed to load diagram`, exc)
      return false
    } finally {
      loading = false
    }
  }

  // Handle TDB file parsing and auto-load precomputed diagram if available
  // Uses dynamic import to lazy-load the TDB parser (~370 lines) only when needed
  async function handle_tdb_file(content: string, filename: string): Promise<void> {
    const { parse_tdb, get_system_name } = await import(`$lib/phase-diagram/parse.js`)
    const result = parse_tdb(content)
    if (!result.success || !result.data) {
      error_message = result.error || `Failed to parse TDB file`
      return
    }

    const system_name = get_system_name(result.data.elements.map((el) => el.symbol))
    const precomputed_url = find_precomputed_url(system_name) ?? null

    tdb = { result, system_name, precomputed_url, is_loaded: false }
    current_file = filename
    update_url(filename)

    // Auto-load pre-computed diagram if available (preserve tdb state to show info panel)
    if (precomputed_url) {
      const name = `${system_name}.json.gz`
      const success = await load_diagram(precomputed_url, name, true, true)
      if (tdb) tdb.is_loaded = success
    }
  }

  // Handle URL drop from FilePicker
  async function handle_url_file_drop(url: string, file: File): Promise<boolean> {
    if (!url.startsWith(`/`)) return false

    if (is_tdb(file.name)) {
      try {
        const response = await fetch(url)
        if (!response.ok) {
          error_message =
            `Failed to load TDB file: HTTP ${response.status} ${response.statusText}`
          return true
        }
        const content = await response.text()
        await handle_tdb_file(content, file.name)
      } catch (exc) {
        error_message = format_error(`Failed to load TDB file`, exc)
      }
      return true
    }

    load_diagram(url, file.name || url.split(`/`).pop() || `unknown`)
    return true
  }

  // Parse file content as phase diagram data
  async function parse_file_content(
    content: string | ArrayBuffer,
    filename: string,
  ): Promise<void> {
    if (is_tdb(filename)) {
      if (typeof content === `string`) await handle_tdb_file(content, filename)
      return
    }

    // Handle JSON/gzipped JSON files
    let json_string: string
    if (typeof content === `string`) {
      json_string = content
    } else {
      // Decompress gzipped content using shared utility
      json_string = await decompress_data(content, `gzip`)
    }

    current_data = JSON.parse(json_string) as PhaseDiagramData
    current_file = filename
    update_url(filename)
    tdb = null
  }

  // Handle direct file drop (local files)
  function handle_direct_file_drop(file: File): void {
    const reader = new FileReader()
    reader.onload = async (load_event) => {
      try {
        const content = load_event.target?.result
        if (content) {
          await parse_file_content(content, file.name)
        }
      } catch (exc) {
        error_message = format_error(`Failed to parse file`, exc)
      }
    }

    if (is_gzipped(file.name)) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  }

  // Main file drop handler
  function handle_file_drop(event: DragEvent): void {
    event.preventDefault()
    error_message = null

    // First check for URL data from FilePicker (internal drag)
    const url = event.dataTransfer?.getData(`text/plain`)
    const json_data = event.dataTransfer?.getData(`application/json`)

    if (url && json_data) {
      // Internal drag from FilePicker - parse the JSON to get file info
      try {
        const file_info = JSON.parse(json_data) as { name: string; url: string }
        // Create a minimal File-like object for compatibility
        const pseudo_file = new File([], file_info.name)
        handle_url_file_drop(url, pseudo_file)
        return
      } catch {
        // Fall through to file handling
      }
    }

    // Handle direct file drop from filesystem
    const file = event.dataTransfer?.files[0]
    if (!file) return

    handle_direct_file_drop(file)
  }

  function handle_drag_over(event: DragEvent): void {
    event.preventDefault()
  }

  async function load_precomputed(): Promise<void> {
    if (tdb?.precomputed_url) {
      const name = `${tdb.system_name}.json.gz`
      const success = await load_diagram(tdb.precomputed_url, name, true, true)
      if (tdb) tdb.is_loaded = success
    }
  }

  // Load example A-B eutectic diagram as default when no other diagram is loaded
  const example_file_name = `A-B.json.gz`
  $effect(() => {
    if (browser && !current_data && !loading) {
      // Find A-B example in the file list
      const example_file = all_phase_diagram_files.find(
        (file) => file.name === example_file_name,
      )
      if (example_file?.url) {
        load_diagram(example_file.url, example_file_name, false)
      }
    }
  })
</script>

<h1>Isobaric Binary Phase Diagram</h1>

<p>
  Interactive binary temperature-composition phase diagram. Hover over different regions
  to see phase information. Drag and drop phase diagram files (<code>.json</code>,
  <code>.json.gz</code>) onto the viewer to load them.
</p>

<h2>Binary Phase Diagrams</h2>

<FilePicker
  files={all_phase_diagram_files}
  active_files={current_file ? [current_file] : []}
  style="margin-bottom: 1em"
  on_click={async (file) => {
    if (!file.url) return
    if (is_tdb(file.name)) {
      try {
        const res = await fetch(file.url)
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        await handle_tdb_file(await res.text(), file.name)
      } catch (exc) {
        error_message = format_error(`Failed to load TDB file`, exc)
      }
    } else {
      load_diagram(file.url, file.name)
    }
  }}
/>

<details class="tdb-info">
  <summary>About this data</summary>
  <p>
    The phase diagrams shown here use <strong>simplified/approximate data</strong> for
    demonstration purposes. They illustrate typical phase diagram features (eutectics,
    peritectics, intermetallic compounds) but are not thermodynamically accurate. For
    research applications, compute phase diagrams from validated TDB files using
    <a href="https://pycalphad.org">pycalphad</a> or similar CALPHAD software.
  </p>
  <p>
    <strong>TDB files</strong> contain CALPHAD model parameters (Gibbs energy functions
    and interaction coefficients) but not the phase diagram itself. Computing phase
    boundaries requires Gibbs energy minimization at thousands of temperature-composition
    points. When you drop a TDB file here, we parse it and display any matching
    pre-computed diagram. The included TDB files (Al-Fe, Al-Mg, Pb-Sn) have demo data
    available.
  </p>
</details>

<div
  class="diagram-container"
  class:loading
  ondrop={handle_file_drop}
  ondragover={handle_drag_over}
  role="region"
  aria-label="Phase diagram viewer - drag and drop files here"
>
  {#if loading}
    <div class="loading-overlay">Loading...</div>
  {/if}
  {#if error_message}
    <div class="error-message">{error_message}</div>
  {/if}
  {#if current_data}
    {#if current_data.title}
      <h3 class="diagram-title">{current_data.title}</h3>
    {/if}
    <IsobaricBinaryPhaseDiagram data={current_data} style="height: 600px" />
  {:else}
    <p style="text-align: center; color: #888; padding: 2em">
      Loading phase diagram...
    </p>
  {/if}
  {#if tdb}
    <TdbInfoPanel
      result={tdb.result}
      system_name={tdb.system_name}
      has_precomputed={tdb.precomputed_url !== null}
      is_precomputed_loaded={tdb.is_loaded}
      on_load_precomputed={load_precomputed}
      style="margin: 0.5em"
    />
  {/if}
</div>

<style>
  .diagram-container {
    margin: 2em 0;
    position: relative;
  }
  .diagram-container.loading {
    opacity: 0.7;
  }
  .loading-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 1em 2em;
    border-radius: 8px;
    z-index: 10;
  }
  .error-message {
    background: rgba(255, 0, 0, 0.1);
    color: #d32f2f;
    padding: 0.5em 1em;
    border-radius: 4px;
    margin: 0.5em;
  }
  .diagram-title {
    text-align: center;
    margin: 0 0 0.5em;
    font-weight: 600;
  }
  h2 {
    margin-top: 2em;
    border-bottom: 1px solid var(--border-color, #444);
    padding-bottom: 0.5em;
  }
  .tdb-info {
    margin: 0.5em 0 1em;
    padding: 0.25em 0.75em;
    background: var(--surface-bg, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-color, #444);
    border-radius: 6px;
  }
  .tdb-info summary {
    cursor: pointer;
    font-weight: 500;
    font-size: 0.85em;
    color: var(--text-color-muted, #aaa);
  }
  .tdb-info summary:hover {
    color: var(--text-color, #fff);
  }
  .tdb-info p {
    margin: 0.75em 0 0;
    font-size: 0.95em;
    line-height: 1.5;
  }
  .tdb-info a {
    color: var(--accent-color, #6366f1);
  }
</style>
