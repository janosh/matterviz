<script lang="ts">
  import { Structure } from '$lib'
  import { parse_structure_file } from '$lib/io/parse'
  import type { AnyStructure, PymatgenStructure } from '$lib/structure'
  import { PeriodicTableDemo, structures } from '$site'

  interface FileInfo {
    name: string
    content: string
    formatted_name: string
    type: string
    structure_type: `crystal` | `molecule` | `unknown`
  }

  const structure_files_raw = import.meta.glob(`$site/structures/*.{poscar,xyz,cif}`, {
    eager: true,
    query: `?raw`,
    import: `default`,
  }) as Record<string, string>

  let mp_id: string = `mp-756175`
  let structure: AnyStructure | undefined = $derived(
    structures.find((struct) => struct.id === mp_id),
  )

  const get_file_type = (filename: string) =>
    filename.split(`.`).pop()?.toUpperCase() ?? `FILE`

  const format_filename = (filename: string) => {
    if (filename.length <= 15) return filename

    // Try to break at hyphens or underscores
    const parts: string[] = filename.split(/[-_]/)
    if (parts.length > 1) {
      const mid_point: number = Math.ceil(parts.length / 2)
      return parts.slice(0, mid_point).join(`-`) + `\n` + parts.slice(mid_point).join(`-`)
    }

    // Fallback: break in the middle
    const mid: number = Math.floor(filename.length / 2)
    return filename.slice(0, mid) + `\n` + filename.slice(mid)
  }

  const detect_structure_type = (filename: string, content: string) => {
    // returns crystal if file contains a cell, else molecule
    if (filename.endsWith(`.json`)) {
      try {
        const parsed = JSON.parse(content)
        return (parsed as { lattice?: unknown }).lattice ? `crystal` : `molecule`
      } catch {
        return `unknown`
      }
    }

    // for now,CIF files always represent crystals with lattice
    if (filename.toLowerCase().endsWith(`.cif`)) return `crystal`

    // POSCAR files always represent crystals with lattice
    if (filename.toLowerCase().includes(`poscar`) || filename === `POSCAR`) {
      return `crystal`
    }

    // XYZ files: try to detect lattice info from content
    if (filename.endsWith(`.xyz`)) {
      try {
        // Simple heuristic: check for lattice information in XYZ comment line
        const lines = content.trim().split(/\r?\n/)
        if (lines.length >= 2 && lines[1].includes(`Lattice=`)) {
          return `crystal`
        }
        return `molecule`
      } catch {
        return `unknown`
      }
    }

    return `unknown`
  }

  // Create file objects from glob imports and structures
  const sample_files: FileInfo[] = [
    // Non-JSON files from glob import
    ...Object.entries(structure_files_raw).map(([path, content]: [string, string]) => ({
      name: path.split(`/`).pop() as string,
      content: content,
    })),
    // JSON files from structures import
    ...structures.map((s: PymatgenStructure & { id: string }) => ({
      name: `${s.id}.json`,
      content: JSON.stringify(s, null, 2),
    })),
  ].map(
    (file: { name: string; content: string }): FileInfo => ({
      ...file,
      formatted_name: format_filename(file.name),
      type: get_file_type(file.name),
      structure_type: detect_structure_type(file.name, file.content),
    }),
  )

  let dragged_file_content: string = $state(``)
  let is_dragging: boolean = $state(false)
  let last_loaded_file_content: string = $state(``)
  let last_loaded_filename: string = $state(``)
  let active_structure_filter = $state<string | null>(null)
  let active_format_filter = $state<string | null>(null)
  let editable_content: string = $state(``)
  let parsing_error: string = $state(``)
  let is_user_editing: boolean = $state(false)

  // Filter files based on active filters
  let filtered_files = $derived(
    sample_files.filter((file) => {
      if (active_structure_filter) return file.structure_type === active_structure_filter
      if (active_format_filter) return file.type.toLowerCase() === active_format_filter
      return true
    }),
  )

  const toggle_filter = (type: `structure` | `format`, filter: string) => {
    if (type === `structure`) {
      active_structure_filter = active_structure_filter === filter ? null : filter
      active_format_filter = null
    } else {
      active_format_filter = active_format_filter === filter ? null : filter
      active_structure_filter = null
    }
  }

  // Auto-update textarea content when structure changes (but not during editing)
  $effect(() => {
    if (is_user_editing) return

    const new_content = (() => {
      if (is_dragging && dragged_file_content) return dragged_file_content
      if (last_loaded_file_content) return last_loaded_file_content
      if (structure) return JSON.stringify(structure, null, 2)
      return `No structure loaded`
    })()

    if (new_content !== editable_content) {
      editable_content = new_content
      parsing_error = ``
    }
  })

  // Set initial filename for new structures
  $effect(() => {
    if (structure?.id && !last_loaded_filename) {
      last_loaded_filename = `${structure.id}.json`
    }
  })

  // Debounced parsing function
  let parse_timeout: ReturnType<typeof setTimeout>
  const parse_user_content = () => {
    clearTimeout(parse_timeout)
    parse_timeout = setTimeout(() => {
      if (!editable_content || editable_content === `No structure loaded`) return

      try {
        parsing_error = ``
        const filename = last_loaded_filename || `structure.json`
        handle_structure_file_drop(editable_content, filename)
      } catch (error) {
        parsing_error = `Parsing error: ${error instanceof Error ? error.message : String(error)}`
      }
    }, 500)
  }

  const handle_drag_start = (file: FileInfo, event: DragEvent) => {
    is_dragging = true
    dragged_file_content = file.content

    // Set drag data for our custom carousel format
    event.dataTransfer?.setData(`text/plain`, file.content)
    event.dataTransfer?.setData(
      `application/json`,
      JSON.stringify({ name: file.name, content: file.content, type: file.type }),
    )
  }

  const handle_drag_end = () => {
    is_dragging = false
    dragged_file_content = ``
  }

  // Handle custom file drops including our carousel format
  const handle_structure_file_drop = (content: string, filename: string) => {
    try {
      // Check if this is from our file carousel (wrapped JSON format)
      if (
        content.includes(`"name"`) &&
        content.includes(`"content"`) &&
        content.includes(`"type"`)
      ) {
        try {
          const file_info = JSON.parse(content)
          if (file_info.name && file_info.content && file_info.type) {
            // Extract the actual content and recurse
            return handle_structure_file_drop(file_info.content, file_info.name)
          }
        } catch {
          // Not our format, continue with normal parsing
        }
      }

      // Try to parse as JSON first
      try {
        const parsed_json: AnyStructure = JSON.parse(content)
        structure = parsed_json
        last_loaded_file_content = content
        last_loaded_filename = filename
        return
      } catch {
        // Not JSON, try other formats
      }

      // Try to parse as structure file (POSCAR, XYZ, CIF, etc.)
      const parsed_struct = parse_structure_file(content, filename)
      if (parsed_struct) {
        // Convert ParsedStructure to the expected format
        const converted_structure: AnyStructure = {
          sites: parsed_struct.sites,
          charge: 0,
          ...(parsed_struct.lattice && {
            lattice: {
              matrix: parsed_struct.lattice.matrix,
              pbc: [true, true, true],
              a: parsed_struct.lattice.a,
              b: parsed_struct.lattice.b,
              c: parsed_struct.lattice.c,
              alpha: parsed_struct.lattice.alpha,
              beta: parsed_struct.lattice.beta,
              gamma: parsed_struct.lattice.gamma,
              volume: parsed_struct.lattice.volume,
            },
          }),
        }

        structure = converted_structure
        last_loaded_file_content = content
        last_loaded_filename = filename
      } else {
        console.error(`Failed to parse structure file: ${filename}`)
        parsing_error = `Failed to parse structure file. Supported formats: JSON, POSCAR, XYZ, CIF`
      }
    } catch (error) {
      console.error(`Error processing file:`, error)
      parsing_error = `Error processing file: ${error}`
    }
  }
</script>

<h1 style="margin: 0;">Elementari</h1>

<p>
  <code>elementari</code> is a toolkit for building interactive web UIs for materials science:
  periodic tables, 3d crystal structures (and molecules), Bohr atoms, nuclei, heatmaps, scatter
  plots. Check out some of the examples in the navigation bar above.
</p>

<h2>Structure Viewer</h2>

<Structure
  {structure}
  scene_props={{ auto_rotate: 0.5 }}
  on_file_drop={handle_structure_file_drop}
/>

<h2>Try dragging files onto the structure viewer</h2>

<p>
  Either from the set of example files or drag a local <code>extXYZ</code>,
  <code>POSCAR</code>, <code>CIF</code>, <code>pymatgen</code> JSON files, or compressed versions
  of these files onto the structure viewer. You can also edit the structure content in the
  textarea below. Changes will automatically update the 3D viewer.
</p>

<div class="files-and-textearea">
  <div class="file-carousel">
    <div class="legend">
      {#each [[`structure`, `crystal`, `🔷 Crystal`], [`structure`, `molecule`, `🧬 Molecule`], [`format`, `cif`, `CIF`], [`format`, `xyz`, `XYZ`], [`format`, `poscar`, `POSCAR`], [`format`, `json`, `JSON`]] as [filter_type, key, label], idx ([filter_type, key, label])}
        {@const is_active =
          filter_type === `structure`
            ? active_structure_filter === key
            : active_format_filter === key}
        {@const is_format = filter_type === `format`}
        {#if idx === 2}&emsp;{/if}
        <span
          class="legend-item"
          class:format-item={is_format}
          class:active={is_active}
          onclick={() => toggle_filter(filter_type as `structure` | `format`, key)}
          onkeydown={(e) =>
            (e.key === `Enter` || e.key === ` `) &&
            toggle_filter(filter_type as `structure` | `format`, key)}
          role="button"
          tabindex="0"
          title="Filter to show only {is_format ? `${label} files` : `${key} structures`}"
        >
          {#if is_format}<span class="format-circle {key}-color"></span>{/if}
          {label}
        </span>
      {/each}
      {#if active_structure_filter || active_format_filter}
        <button
          class="clear-filter"
          onclick={() => {
            active_structure_filter = null
            active_format_filter = null
          }}
          title="Clear all filters"
        >
          ✕
        </button>
      {/if}
    </div>
    {#each filtered_files as file (file.name)}
      {@const icon = { crystal: `🔷`, molecule: `🧬`, unknown: `❓` }[
        file.structure_type
      ]}
      <div
        class="file-item {file.type.toLowerCase()}-file"
        class:active={file.name === last_loaded_filename}
        draggable="true"
        ondragstart={(event) => handle_drag_start(file, event)}
        ondragend={handle_drag_end}
        role="button"
        tabindex="0"
        title="Drag this {file.type} file to the structure viewer"
      >
        <div class="drag-handle">
          <div class="drag-bar"></div>
          <div class="drag-bar"></div>
          <div class="drag-bar"></div>
        </div>
        <div class="file-name">
          {file.name}&nbsp;{icon}
        </div>
      </div>
    {/each}
  </div>

  <div class="textarea-container">
    <textarea
      bind:value={editable_content}
      onfocus={() => (is_user_editing = true)}
      onblur={() => setTimeout(() => (is_user_editing = false), 1000)}
      oninput={() => {
        is_user_editing = true
        parse_user_content()
      }}
      placeholder="Structure content will appear here..."
      class="content-preview"
      class:error={parsing_error}
    ></textarea>
    {#if parsing_error}
      <div class="parsing-error">{parsing_error}</div>
    {/if}
  </div>
</div>

<p>
  The 3d structure viewer is built on the declarative <a href="https://threejs.org"
    >three.js</a
  >
  wrapper <a href="https://threlte.xyz"><code>threlte</code></a>. It gets Svelte-compiled
  for great performance (even on supercells with 100+ atoms), is split up into
  <code>Bond</code>, <code>Lattice</code>, <code>Scene</code> and <code>Site</code>
  components for easy extensibility. You can pass various click, drag and touch event handlers
  for rich interactivity as well as inject custom HTML into tooltips using child components.
  This one shows the
  <a href="https://materialsproject.org">Materials Project</a>
  structure for <a href="https://materialsproject.org/materials/{mp_id}">{mp_id}</a> but you
  can select others below.
</p>

<h2>Periodic Table</h2>

<PeriodicTableDemo />

<style>
  h1 {
    text-align: center;
    font-size: clamp(20pt, 5.5vw, 42pt);
  }
  h2 {
    text-align: center;
  }
  p {
    max-width: var(--max-text-width);
    margin: 1em auto;
    text-align: center;
  }
  .files-and-textearea {
    display: flex;
    gap: 2em;
    max-width: 1400px;
    margin: auto;
  }
  .file-carousel {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    flex: 1;
    align-content: start;
  }
  .legend {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.8em;
    font-size: 0.6em;
    opacity: 0.8;
    margin: 0 0 0.5em;
  }
  .legend-item {
    cursor: pointer;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }
  .legend-item:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }
  .legend-item.active {
    opacity: 1;
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.5);
    font-weight: bold;
  }
  .clear-filter {
    border: 1px solid rgba(255, 255, 255, 0.3);
    box-sizing: border-box;
    border-radius: 50%;
    cursor: pointer;
    font-size: inherit;
    transition: all 0.2s ease;
    width: 1.5em;
    height: 1.5em;
    display: flex;
    justify-content: center;
  }
  .clear-filter:hover {
    background: rgba(255, 100, 100, 0.2);
    border-color: rgba(255, 100, 100, 0.5);
    color: #ff6666;
  }
  .format-item {
    display: flex;
    align-items: center;
    gap: 0.3em;
  }
  .format-circle {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .cif-color {
    background-color: rgba(100, 149, 237, 0.8);
  }
  .xyz-color {
    background-color: rgba(50, 205, 50, 0.8);
  }
  .poscar-color {
    background-color: rgba(255, 140, 0, 0.8);
  }
  .json-color {
    background-color: rgba(138, 43, 226, 0.8);
  }
  .file-item {
    display: flex;
    align-items: center;
    padding: 4pt 8pt;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 20px;
    cursor: grab;
    background: rgba(255, 255, 255, 0.1);
    transition: all 0.2s ease;
    gap: 0.5em;
  }
  .file-item.active {
    border-color: #00ff00;
    background: rgba(0, 255, 0, 0.15);
    box-shadow: 0 0 8px rgba(0, 255, 0, 0.3);
  }
  .file-item:active {
    cursor: grabbing;
  }
  .file-item:hover {
    border-color: #007acc;
    background: rgba(0, 122, 204, 0.2);
    filter: brightness(1.1);
  }
  .cif-file {
    background: rgba(100, 149, 237, 0.08);
    border-color: rgba(100, 149, 237, 0.2);
  }
  .xyz-file {
    background: rgba(50, 205, 50, 0.08);
    border-color: rgba(50, 205, 50, 0.2);
  }
  .poscar-file {
    background: rgba(255, 140, 0, 0.08);
    border-color: rgba(255, 140, 0, 0.2);
  }
  .json-file {
    background: rgba(138, 43, 226, 0.08);
    border-color: rgba(138, 43, 226, 0.2);
  }
  .drag-handle {
    display: flex;
    flex-direction: column;
    gap: 2px;
    opacity: 0.6;
  }
  .drag-bar {
    width: 12px;
    height: 2px;
    background: currentColor;
    border-radius: 1px;
  }
  .file-name {
    font-size: 0.7em;
    line-height: 1.1;
  }
  .textarea-container {
    flex: 1;
    position: relative;
  }
  textarea.content-preview {
    margin: 0;
    border-radius: 5pt;
    font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    resize: none;
    box-sizing: border-box;
    padding: 6pt 9pt;
    border: 1px solid rgba(255, 255, 255, 0.1);
    min-height: 300px;
    height: 100%;
  }
  textarea.content-preview:focus {
    outline: none;
    border-color: rgba(0, 122, 204, 0.6);
    background: rgba(255, 255, 255, 0.08);
  }
  textarea.content-preview.error {
    border-color: rgba(255, 100, 100, 0.6);
    background: rgba(255, 100, 100, 0.05);
  }
  .parsing-error {
    position: absolute;
    bottom: 4px;
    left: 4px;
    right: 4px;
    background: rgba(255, 100, 100, 0.9);
    color: white;
    font-size: 0.65rem;
    padding: 4px 6px;
    border-radius: 3px;
    z-index: 10;
  }

  @media (max-width: 768px) {
    .files-and-textearea {
      flex-direction: column;
      gap: 1rem;
      min-height: 400px;
    }
    .file-carousel {
      max-height: 200px;
      gap: 0.3rem;
    }
    .legend {
      font-size: 0.5em;
      margin-bottom: 0.3em;
      gap: 0.6em;
    }
    .legend-item {
      padding: 0.1em 0.3em;
    }
    .clear-filter {
      width: 1.5em;
      height: 1.5em;
    }
    .format-circle {
      width: 6px;
      height: 6px;
    }
    .file-item {
      min-height: 32px;
      padding: 0.4rem 0.6rem;
      gap: 0.5rem;
    }
    .drag-handle {
      gap: 1px;
    }
    .drag-bar {
      width: 10px;
      height: 1.5px;
    }
    .file-name {
      font-size: 0.7rem;
      line-height: 1.1;
    }
  }
</style>
