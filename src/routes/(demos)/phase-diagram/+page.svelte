<script lang="ts">
  import FilePicker from '#lib/FilePicker.svelte'
  import { as_text, dropped_file_url, file_drop_zone, load_from_url } from '#lib/io/index.js'
  import type {
    BinaryPhaseDiagram,
    CompUnit,
    DiagramCursor,
    TempUnit,
  } from '#lib/phase-diagram/index.js'
  import {
    IsobaricBinaryPhaseDiagram,
    parse_phase_diagram_svg,
    provenance_caption,
    temperature_extent,
  } from '#lib/phase-diagram/index.js'
  import type { AxisConfig } from '#lib/plot/index.js'
  import type { TdbParseResult } from '#site/phase-diagrams/tdb-parse.js'
  import { get_system_name, parse_tdb } from '#site/phase-diagrams/tdb-parse.js'
  import TdbInfoPanel from '#site/phase-diagrams/TdbInfoPanel.svelte'
  import { to_error } from 'svelte-widgets/utils'
  import {
    all_phase_diagram_files,
    binary_diagrams,
    find_precomputed_diagram,
    observations_for,
  } from '#site/phase-diagrams.js'
  import {
    file_param,
    latest_load,
    loaded_fixture,
    set_file_param,
  } from '#site/state.svelte.js'
  import { onMount } from 'svelte'

  // Track currently loaded diagram
  let current_data = $state.raw<BinaryPhaseDiagram | null>(null)
  let current_file = $state<string>(``)
  let loading = $state(false)
  let error_message = $state<string | null>(null)
  // Display units shared by every diagram on the page
  let temp_unit = $state<TempUnit>(`K`)
  let comp_unit = $state<CompUnit>(`at%`)

  // Comparison: a hand-built Ag-Cu reference vs a synthetic model diagram of the same system
  const { 'Ag-Cu': ag_cu, 'Ag-Cu-model': ag_cu_model } = binary_diagrams
  const ag_cu_observations = observations_for(ag_cu.components)
  // Side by side: one cursor and one pair of axes bound to both diagrams
  let cursor = $state<DiagramCursor | null>(null)
  let x_axis = $state<AxisConfig>({})
  let y_axis = $state<AxisConfig>({ range: temperature_extent([ag_cu, ag_cu_model]) })

  // Consolidated TDB file state
  interface TdbState {
    result: TdbParseResult
    system_name: string
    precomputed_data: BinaryPhaseDiagram | null
  }
  let tdb = $state<TdbState | null>(null)

  const has_ext = (name: string, ext: string) => name.toLowerCase().endsWith(ext)

  // Only the newest picker load (or a drop, which cancels them all) may write state
  const loads = latest_load()

  // Parse fetched or dropped content by filename. TDB files are parsed but not solved; a
  // matching precomputed diagram (if any) is shown instead. Throws on malformed content.
  function apply_content(content: string | ArrayBuffer, filename: string, sync_url = true) {
    const text = as_text(content)
    if (has_ext(filename, `.tdb`)) {
      const result = parse_tdb(text)
      const system_name = get_system_name(
        result.data.elements.map((element) => element.symbol),
      )
      const precomputed_data = find_precomputed_diagram(system_name) ?? null
      tdb = { result, system_name, precomputed_data }
      if (precomputed_data) current_data = precomputed_data
    } else {
      tdb = null
      current_data = has_ext(filename, `.svg`)
        ? parse_phase_diagram_svg(text)
        : (JSON.parse(text) as BinaryPhaseDiagram)
    }
    current_file = filename
    if (sync_url) set_file_param(filename)
  }

  // Load a picker entry: built-in diagrams come precomputed from #site/phase-diagrams, the
  // rest (TDB, SVG, JSON, gzipped or not) are fetched and decompressed by #lib/io
  async function load_file(url: string, filename: string, sync_url = true): Promise<void> {
    const is_current = loads.start()
    loading = true
    error_message = null
    tdb = null
    try {
      if (url.startsWith(`builtin:`)) {
        const system = url.slice(`builtin:`.length)
        const diagram = find_precomputed_diagram(system)
        if (!diagram) throw new Error(`Unknown built-in phase diagram: ${system}`)
        current_data = diagram
        current_file = filename
        if (sync_url) set_file_param(filename)
      } else {
        await load_from_url(url, (content) => {
          if (is_current()) apply_content(content, filename, sync_url)
        })
      }
    } catch (exc) {
      if (is_current()) error_message = `Failed to load: ${to_error(exc).message}`
    } finally {
      if (is_current()) loading = false
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

<h1 id="isobaric-binary-phase-diagram">Isobaric Binary Phase Diagram</h1>

<p class="demo-intro">
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
    for Al-Fe, Al-Mg, and Pb-Sn. Diagrams use the <code>binary-phase-diagram/2</code> JSON format:
    temperatures in K, compositions as mole fractions, phases referenced by id.
  </p>
</details>

<div
  class={['diagram-container bleed-1400', { loading }]}
  ondropcapture={handle_builtin_drop}
  {@attach file_drop_zone({
    allow: () => true,
    max_files: 1,
    on_drop: (content, filename, metadata) => {
      loads.cancel()
      error_message = null
      apply_content(content, filename, false)
      set_file_param(loaded_fixture(metadata)) // a dropped local file has no fixture to name
    },
    on_error: (msg) => (error_message = msg),
    set_loading: (value) => (loading = value),
  })}
  role="region"
  aria-label="Phase diagram viewer - drag and drop files here"
>
  {#if loading}
    <div class="demo-loading-overlay">Loading...</div>
  {/if}
  {#if error_message}
    <div class="demo-error-message">{error_message}</div>
  {/if}
  {#if current_data}
    <h3 class="diagram-title">{current_data.components?.join(`-`)}</h3>
    {#if current_data.provenance}
      <p class="diagram-source">{provenance_caption(current_data)}</p>
    {/if}
    <IsobaricBinaryPhaseDiagram
      data={current_data}
      observations={observations_for(current_data.components ?? [])}
      bind:temp_unit
      bind:comp_unit
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

<h2 id="comparison-overlay">Comparison overlay</h2>
<p>
  A second diagram of the same components draws as dashed boundaries over the first, with
  experimental observations (error bars in T and x, colored by status) on top. Hover to see
  both diagrams' phase sets and lever rules at the cursor; legend entries toggle each layer.
</p>
<IsobaricBinaryPhaseDiagram
  data={ag_cu}
  overlay={ag_cu_model}
  observations={ag_cu_observations}
  bind:temp_unit
  bind:comp_unit
  style="height: 550px"
  class="bleed-1400"
/>

<h2 id="side-by-side">Side by side</h2>
<p>
  Two diagrams sharing one <code>cursor</code> and the same axes: the hovered (x, T) is marked in
  both, each showing its own phase set there.
</p>
<div class="side-by-side bleed-1400">
  {#each [ag_cu, ag_cu_model] as data, idx (idx)}
    <IsobaricBinaryPhaseDiagram
      {data}
      observations={ag_cu_observations}
      bind:cursor
      bind:x_axis
      bind:y_axis
      bind:temp_unit
      bind:comp_unit
      style="height: 450px"
    />
  {/each}
</div>

<style>
  .side-by-side {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 1em;
    margin-block: 1em 2em;
  }
  .diagram-source {
    text-align: center;
    margin: -0.25em 0 0.5em;
    font-size: 0.85em;
    color: var(--text-color-muted, #aaa);
  }
  .diagram-container {
    margin-block: 2em; /* not margin shorthand: .bleed-1400 sets margin-left */
    position: relative;
  }
  .diagram-container.loading {
    opacity: 0.7;
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
