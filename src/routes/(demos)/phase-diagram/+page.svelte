<script lang="ts">
  import FilePicker from '$lib/FilePicker.svelte'
  import { as_text, dropped_file_url, file_drop_zone, load_from_url } from '$lib/io'
  import type { DiagramInput, PhaseDiagramData } from '$lib/phase-diagram'
  import {
    build_diagram,
    IsobaricBinaryPhaseDiagram,
    parse_phase_diagram_svg,
  } from '$lib/phase-diagram'
  import type { TdbParseResult } from '$site/phase-diagrams/tdb-parse'
  import { get_system_name, parse_tdb } from '$site/phase-diagrams/tdb-parse'
  import TdbInfoPanel from '$site/phase-diagrams/TdbInfoPanel.svelte'
  import { to_error } from '$lib/utils'
  import { all_phase_diagram_files, find_precomputed_diagram } from '$site/phase-diagrams'
  import { file_param, set_file_param } from '$site/state.svelte'
  import { onMount } from 'svelte'

  // Track currently loaded diagram
  let current_data = $state<PhaseDiagramData | null>(null)
  let current_file = $state<string>(``)
  let loading = $state(false)
  let error_message = $state<string | null>(null)
  let current_diagram_input = $state<DiagramInput | null>(null)

  // Consolidated TDB file state
  interface TdbState {
    result: TdbParseResult
    system_name: string
    precomputed_data: PhaseDiagramData | null
  }
  let tdb = $state<TdbState | null>(null)

  const has_ext = (name: string, ext: string) => name.toLowerCase().endsWith(ext)

  // Stale-load guard: every load gets a token and only the newest one may write state
  let active_load: symbol | null = null

  // Parse fetched or dropped content by filename. TDB files are parsed but not solved; a
  // matching precomputed diagram (if any) is shown instead. Throws on malformed content.
  function apply_content(content: string | ArrayBuffer, filename: string, sync_url = true) {
    const text = as_text(content)
    // Drop any earlier SVG import: the viewer prefers a rebuilt diagram_input over data
    current_diagram_input = null
    if (has_ext(filename, `.tdb`)) {
      const result = parse_tdb(text)
      const system_name = get_system_name(result.data.elements.map((el) => el.symbol))
      const precomputed_data = find_precomputed_diagram(system_name) ?? null
      tdb = { result, system_name, precomputed_data }
      if (precomputed_data) current_data = precomputed_data
    } else {
      tdb = null
      if (has_ext(filename, `.svg`)) {
        current_diagram_input = parse_phase_diagram_svg(text)
        current_data = build_diagram(current_diagram_input)
      } else current_data = JSON.parse(text) as PhaseDiagramData
    }
    current_file = filename
    if (sync_url) set_file_param(filename)
  }

  // Load a picker entry: built-in diagrams come precomputed from $site/phase-diagrams, the
  // rest (TDB, SVG, JSON, gzipped or not) are fetched and decompressed by $lib/io
  async function load_file(url: string, filename: string, sync_url = true): Promise<void> {
    const token = Symbol(filename)
    active_load = token
    loading = true
    error_message = null
    tdb = null
    try {
      if (url.startsWith(`builtin:`)) {
        const system = url.slice(`builtin:`.length)
        const diagram = find_precomputed_diagram(system)
        if (!diagram) throw new Error(`Unknown built-in phase diagram: ${system}`)
        current_diagram_input = null
        current_data = diagram
        current_file = filename
        if (sync_url) set_file_param(filename)
      } else {
        await load_from_url(url, (content) => {
          if (active_load === token) apply_content(content, filename, sync_url)
        })
      }
    } catch (exc) {
      if (active_load === token) error_message = `Failed to load: ${to_error(exc).message}`
    } finally {
      if (active_load === token) loading = false
    }
  }

  // FilePicker drags carry the entry's URL; built-in diagrams have no fetchable URL, so claim
  // those before file_drop_zone (which fetches every URL drop) sees them
  function handle_builtin_drop(event: DragEvent): void {
    const url = dropped_file_url(event)
    if (!url?.startsWith(`builtin:`)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const entry = all_phase_diagram_files.find((file) => file.url === url)
    void load_file(url, entry?.name ?? url)
  }

  // ?file= deep link, else the example A-B eutectic diagram
  onMount(() => {
    const requested = file_param()
    const target =
      all_phase_diagram_files.find((file) => file.name === requested) ??
      all_phase_diagram_files.find((file) => file.name === `A-B.json`)
    if (target?.url) void load_file(target.url, target.name, false)
  })
</script>

<h1>Isobaric Binary Phase Diagram</h1>

<p>
  Drop <code>.json</code>, <code>.json.gz</code>, <code>.svg</code>, or <code>.tdb</code> files onto
  the viewer.
</p>

<FilePicker
  files={all_phase_diagram_files}
  active_files={current_file ? [current_file] : []}
  style="margin-bottom: 1em"
  on_click={(file) => file.url && load_file(file.url, file.name)}
/>

<details class="tdb-info">
  <summary>About this data</summary>
  <p>
    <strong>Demo only:</strong> the included boundaries are approximate, not thermodynamically
    accurate. Compute research diagrams from validated TDB files with
    <a href="https://pycalphad.org">pycalphad</a> or similar CALPHAD software.
  </p>
  <p>
    Dropped TDB files are parsed but not solved; matching precomputed diagrams are available
    for Al-Fe, Al-Mg, and Pb-Sn.
  </p>
</details>

<div
  class={['diagram-container', { loading }]}
  ondropcapture={handle_builtin_drop}
  {@attach file_drop_zone({
    allow: () => true,
    max_files: 1,
    on_drop: (content, filename) => apply_content(content, filename),
    on_error: (msg) => (error_message = msg),
    set_loading: (value) => (loading = value),
  })}
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
    <IsobaricBinaryPhaseDiagram
      data={current_data}
      bind:diagram_input={current_diagram_input}
      style="height: 600px"
    />
  {/if}
  {#if tdb}
    <TdbInfoPanel
      result={tdb.result}
      system_name={tdb.system_name}
      has_precomputed={tdb.precomputed_data !== null}
      is_precomputed_loaded={tdb.precomputed_data !== null &&
        current_data === tdb.precomputed_data}
      on_load_precomputed={() => {
        if (tdb?.precomputed_data) current_data = tdb.precomputed_data
      }}
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
