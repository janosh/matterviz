<script lang="ts">
  import { Structure } from '$lib'
  import { parse_structure_file, type ParsedStructure } from '$lib/parsers'
  import type { Atoms, PymatgenStructure } from '$lib/structure'
  import { structures } from '$site'
  import TableDemo from './(demos)/periodic-table/+page.svelte'

  interface FileInfo {
    name: string
    content: string
    formatted_name: string
    type: string
    structure_type: `crystal` | `molecule` | `unknown`
  }

  const structure_files_raw = import.meta.glob(`$site/structures/*.{poscar,xyz}`, {
    eager: true,
    query: `?raw`,
    import: `default`,
  }) as Record<string, string>

  let mp_id: string = `mp-756175`
  let structure: Atoms | undefined = $derived(
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

    // POSCAR files always represent crystals with lattice
    if (filename.toLowerCase().includes(`poscar`) || filename === `POSCAR`) {
      return `crystal`
    }

    // XYZ files: parse to check for lattice info
    if (filename.endsWith(`.xyz`)) {
      try {
        const parsed: ParsedStructure | null = parse_structure_file(content, filename)
        return parsed?.lattice ? `crystal` : `molecule`
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

  // Set initial filename based on the default structure
  $effect(() => {
    if (structure?.id && !last_loaded_filename) {
      last_loaded_filename = `${structure.id}.json`
    }
  })

  // Show either dragged content, last loaded file content, or current structure content
  let displayed_content: string = $derived.by(() => {
    if (is_dragging && dragged_file_content) return dragged_file_content
    if (last_loaded_file_content) return last_loaded_file_content
    if (structure) return JSON.stringify(structure, null, 2)
    return `No structure loaded`
  })

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
        const parsed_json: Atoms = JSON.parse(content)
        structure = parsed_json
        last_loaded_file_content = content
        last_loaded_filename = filename
        return
      } catch {
        // Not JSON, try other formats
      }

      // Try to parse as structure file (POSCAR, XYZ, etc.)
      const parsed_struct = parse_structure_file(content, filename)
      if (parsed_struct) {
        // Convert ParsedStructure to the expected format
        const converted_structure: Atoms = {
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
        alert(`Failed to parse structure file. Supported formats: JSON, POSCAR, XYZ`)
      }
    } catch (error) {
      console.error(`Error processing file:`, error)
      alert(`Error processing file: ${error}`)
    }
  }
</script>

<h1>Elementari</h1>

<p>
  <code>elementari</code> is a toolkit for building interactive web UIs for materials science:
  periodic tables, 3d crystal structures (and molecules), Bohr atoms, nuclei, heatmaps, scatter
  plots. Check out some of the examples in the navigation bar above.
</p>

<h2>Periodic Table</h2>

<TableDemo />

<h2>Structure Viewer</h2>

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

<Structure
  {structure}
  scene_props={{ auto_rotate: 0.5 }}
  on_file_drop={handle_structure_file_drop}
/>

<h2>Try dragging files onto the structure viewer</h2>

<p>
  Or drag a local <code>extXYZ</code>, <code>POSCAR</code> or <code>pymatgen</code> JSON files
  onto the structure viewer.
</p>

<div class="files-and-content">
  <div class="file-carousel">
    {#each sample_files as file (file.name)}
      {@const icon = { crystal: `🔷`, molecule: `🧬`, unknown: `❓` }[
        file.structure_type
      ]}
      <div
        class="file-item"
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

  <textarea
    readonly
    value={displayed_content}
    placeholder="Structure content will appear here..."
    class="content-preview"
  ></textarea>
</div>

<style>
  h1 {
    text-align: center;
    font-size: clamp(20pt, 5.5vw, 42pt);
  }
  h2 {
    text-align: center;
  }
  p {
    max-width: 40em;
    margin: 2em auto 3em;
    text-align: center;
  }
  .files-and-content {
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
  .file-item:hover {
    border-color: #007acc;
    background: rgba(0, 122, 204, 0.2);
    transform: translateY(-1px);
  }
  .file-item.active {
    border-color: #00ff00;
    background: rgba(0, 255, 0, 0.15);
    box-shadow: 0 0 8px rgba(0, 255, 0, 0.3);
  }
  .file-item:active {
    cursor: grabbing;
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
  textarea.content-preview {
    flex: 1;
    margin: 0;
    border-radius: 5pt;
    font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.05);
    resize: none;
    box-sizing: border-box;
    padding: 6pt 9pt;
  }

  @media (max-width: 768px) {
    .files-and-content {
      flex-direction: column;
      gap: 1rem;
      min-height: 400px;
    }
    .file-carousel {
      max-height: 200px;
      gap: 0.3rem;
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
