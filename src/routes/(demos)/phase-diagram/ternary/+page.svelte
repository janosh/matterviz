<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import FilePicker from '$lib/FilePicker.svelte'
  import { decompress_data } from '$lib/io/decompress'
  import type { TernaryPhaseDiagramData } from '$lib/phase-diagram'
  import { IsobaricTernaryPhaseDiagram } from '$lib/phase-diagram'
  import {
    load_ternary_phase_diagram,
    ternary_phase_diagram_files,
  } from '$site/ternary-phase-diagrams'

  // Track currently loaded diagram
  let current_data = $state<TernaryPhaseDiagramData | null>(null)
  let current_file = $state<string>(``)
  let loading = $state(false)
  let error_message = $state<string | null>(null)

  // Helper to check file type from filename
  const is_gzipped = (name: string) => name.toLowerCase().endsWith(`.gz`)

  // Helper for consistent error formatting
  const format_error = (context: string, exc: unknown) =>
    `${context}: ${exc instanceof Error ? exc.message : String(exc)}`

  // Token for race condition protection - each load gets a unique Symbol
  let active_load: symbol | null = null

  // Check if this load is still the active one (not superseded)
  const is_stale = (token: symbol) => active_load !== token

  // Sync URL parameter to current file on load
  $effect(() => {
    if (!browser) return
    const file_param = page.url.searchParams.get(`file`)
    if (file_param && file_param !== current_file) {
      const file_info = ternary_phase_diagram_files.find((f) => f.name === file_param)
      if (file_info?.url) load_file(file_info.url, file_param, false)
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

  // Unified file loader with race condition protection
  async function load_file(
    url: string,
    filename: string,
    update_url_param: boolean = true,
  ): Promise<boolean> {
    const token = Symbol()
    active_load = token
    loading = true
    error_message = null

    try {
      const data = await load_ternary_phase_diagram(url)
      if (is_stale(token)) return false
      if (!data) {
        error_message = `Failed to parse ternary phase diagram data`
        return false
      }
      current_data = data
      current_file = filename
      if (update_url_param) update_url(filename)
      return true
    } catch (exc) {
      if (is_stale(token)) return false
      error_message = format_error(`Failed to load`, exc)
      return false
    } finally {
      if (!is_stale(token)) loading = false
    }
  }

  // Handle URL drop from FilePicker
  async function handle_url_file_drop(url: string, file: File): Promise<boolean> {
    if (!url.startsWith(`/`)) return false
    await load_file(url, file.name || url.split(`/`).pop() || `unknown`)
    return true
  }

  // Parse file content as phase diagram data (for local file drops)
  async function parse_file_content(
    content: string | ArrayBuffer,
    filename: string,
  ): Promise<void> {
    loading = true
    error_message = null
    try {
      // Handle JSON/gzipped JSON files
      const json_string = typeof content === `string`
        ? content
        : await decompress_data(content, `gzip`)
      current_data = JSON.parse(json_string) as TernaryPhaseDiagramData
      current_file = filename
      update_url(filename)
    } catch (exc) {
      console.error(`Failed to parse file "${filename}":`, exc)
      error_message = format_error(`Failed to parse ${filename}`, exc)
    } finally {
      loading = false
    }
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
      } catch (exc) {
        console.debug(
          `Failed to parse internal drag data, falling through to file handling ${exc}`,
        )
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

  // Load default diagram when no other diagram is loaded
  const default_file_name = `A-B-C-schematic.json.gz`
  $effect(() => {
    if (browser && !current_data && !loading) {
      const default_file = ternary_phase_diagram_files.find(
        (f) => f.name === default_file_name,
      )
      if (default_file?.url) load_file(default_file.url, default_file_name, false)
    }
  })

  // State for demonstration
  let slice_temperature = $state<number | undefined>(undefined)
  let slice_ratio = $state(0.5)
  let region_opacity = $state(0.6)
  let render_mode = $state<`transparent` | `solid`>(`transparent`)

  // Initialize slice temperature when data loads
  $effect(() => {
    if (current_data && slice_temperature === undefined) {
      slice_temperature =
        (current_data.temperature_range[0] + current_data.temperature_range[1]) / 2
    }
  })
</script>

<h1>Isobaric Ternary Phase Diagram</h1>

<p>
  Interactive 3D visualization of ternary phase diagrams. The triangular prism shows
  composition (triangular base) vs temperature (vertical axis). Drag and drop phase
  diagram files (<code>.json</code>, <code>.json.gz</code>) onto the viewer to load them.
</p>

<h2>Ternary Phase Diagrams</h2>

<FilePicker
  files={ternary_phase_diagram_files}
  active_files={current_file ? [current_file] : []}
  style="margin-bottom: 1em"
  on_click={(file) => file.url && load_file(file.url, file.name)}
/>

<details class="data-info">
  <summary>About this data</summary>
  <p>
    The ternary phase diagrams shown here use <strong>simplified/schematic data</strong>
    for demonstration purposes. They illustrate typical ternary phase diagram features
    (three-phase equilibria, liquidus surfaces, solid solution regions) but are not
    thermodynamically accurate.
  </p>
  <p>
    For research applications, compute ternary phase diagrams from validated TDB files
    using <a href="https://pycalphad.org">pycalphad</a> or similar CALPHAD software.
  </p>
</details>

<div
  class="diagram-container"
  class:loading
  ondrop={handle_file_drop}
  ondragover={handle_drag_over}
  role="region"
  aria-label="Ternary phase diagram viewer - drag and drop files here"
>
  {#if loading}
    <div class="loading-overlay">Loading...</div>
  {/if}
  {#if error_message}
    <div class="error-message">{error_message}</div>
  {/if}
  {#if current_data}
    <IsobaricTernaryPhaseDiagram
      data={current_data}
      bind:slice_temperature
      bind:slice_ratio
      bind:region_opacity
      bind:render_mode
      show_isothermal_panel={true}
      show_vertical_panel={false}
      style="height: 700px"
    />
  {/if}
</div>

{#if current_data && slice_temperature !== undefined}
  <h2>Current State</h2>

  <div class="state-display">
    <div>
      <strong>Slice Temperature:</strong>
      {slice_temperature.toFixed(0)}
      {current_data.temperature_unit ?? `K`}
    </div>
    <div>
      <strong>Slice Ratio ({current_data.components[0]}:{
          current_data.components[1]
        }):</strong>
      {(slice_ratio * 100).toFixed(0)}:{((1 - slice_ratio) * 100).toFixed(0)}
    </div>
    <div><strong>Region Opacity:</strong> {region_opacity.toFixed(2)}</div>
    <div><strong>Render Mode:</strong> {render_mode}</div>
  </div>
{/if}

<h2>Features</h2>

<ul>
  <li>
    <strong>Isothermal sections:</strong> View 2D phase diagrams at constant temperature
  </li>
  <li>
    <strong>Pseudo-binary sections:</strong> View 2D cross-sections at constant A:B ratios
  </li>
  <li><strong>Interactive slicing:</strong> Drag the slice plane or use sliders</li>
  <li><strong>Hover tooltips:</strong> See phase information on hover</li>
  <li><strong>Configurable rendering:</strong> Transparent or solid phase regions</li>
</ul>

<h2>Usage</h2>

<pre>
<code class="language-svelte">&lt;script&gt;
  import &#123; IsobaricTernaryPhaseDiagram &#125; from 'matterviz/phase-diagram'
  import type &#123; TernaryPhaseDiagramData &#125; from 'matterviz/phase-diagram'

  const data: TernaryPhaseDiagramData = &#123;
    components: ['Fe', 'Cr', 'Ni'],
    temperature_range: [1000, 1800],
    regions: [
      &#123;
        id: 'liquid',
        name: 'Liquid',
        vertices: [...], // [comp_A, comp_B, comp_C, T]
        faces: [...],    // Triangle indices
      &#125;,
      // ... more regions
    ],
  &#125;
&lt;/script&gt;

&lt;IsobaricTernaryPhaseDiagram &#123;data&#125; /&gt;
</code></pre>

<style>
  .diagram-container {
    margin: 2em 0;
    position: relative;
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    overflow: hidden;
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
  .data-info {
    margin: 0.5em 0 1em;
    padding: 0.25em 0.75em;
    background: var(--surface-bg, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-color, #444);
    border-radius: 6px;
  }
  .data-info summary {
    cursor: pointer;
    font-weight: 500;
    font-size: 0.85em;
    color: var(--text-color-muted, #aaa);
  }
  .data-info summary:hover {
    color: var(--text-color, #fff);
  }
  .data-info p {
    margin: 0.75em 0 0;
    font-size: 0.95em;
    line-height: 1.5;
  }
  .data-info a {
    color: var(--accent-color, #6366f1);
  }
  .state-display {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1em;
    padding: 1em;
    background: var(--surface-bg, rgba(255, 255, 255, 0.05));
    border-radius: 8px;
    margin: 1em 0;
  }
  h2 {
    margin-top: 2em;
    border-bottom: 1px solid var(--border-color, #444);
    padding-bottom: 0.5em;
  }
  ul {
    line-height: 1.8;
  }
</style>
