<script lang="ts">
  import { Structure } from '$lib'
  import { parse_structure_file } from '$lib/io/parse'
  import type { AnyStructure, PymatgenStructure } from '$lib/structure'
  import type { FileInfo } from '$site'
  import { FileCarousel, PeriodicTableDemo } from '$site'
  import { structures } from '$site/structures'
  import { onMount } from 'svelte'

  const structure_files_raw = import.meta.glob(
    `$site/structures/*.{poscar,xyz,cif,yaml}`,
    { eager: true, query: `?raw`, import: `default` },
  ) as Record<string, string>

  // Structure viewer state as arrays
  const mp_id = `mp-756175`
  const cif_file_content =
    structure_files_raw[`/src/site/structures/Li4Fe3Mn1(PO4)4.cif`]

  let viewer_structures = $state<(AnyStructure | undefined)[]>([undefined, undefined])
  let active_files = $state<string[]>([`${mp_id}.json`, `Li4Fe3Mn1(PO4)4.cif`])

  const viewer_titles = [mp_id, `Li4Fe3Mn1(PO4)4.cif`]

  // Initialize structures once on mount to avoid reactive loops
  onMount(() => {
    // Load MP structure
    viewer_structures[0] = structures.find((struct) => struct.id === mp_id)

    // Load CIF structure
    if (cif_file_content) {
      try {
        const structure = parse_any_structure(cif_file_content, `Li4Fe3Mn1(PO4)4.cif`)
        if (structure) viewer_structures[1] = structure
      } catch (error) {
        console.error(`Failed to parse CIF file:`, error)
      }
    }
  })

  const get_file_type = (filename: string) =>
    filename.split(`.`).pop()?.toUpperCase() ?? `FILE`

  const format_filename = (filename: string) => {
    if (filename.length <= 15) return filename

    // Try to break at hyphens or underscores
    const parts: string[] = filename.split(/[-_]/)
    if (parts.length > 1) {
      const mid_point: number = Math.ceil(parts.length / 2)
      return parts.slice(0, mid_point).join(`-`) + `\n` +
        parts.slice(mid_point).join(`-`)
    }

    // Fallback: break in the middle
    const mid: number = Math.floor(filename.length / 2)
    return filename.slice(0, mid) + `\n` + filename.slice(mid)
  }

  const detect_structure_type = (
    filename: string,
    content: string,
  ): `crystal` | `molecule` | `unknown` => {
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

    // YAML files: phonopy files always represent crystal structures with lattices
    if (
      filename.toLowerCase().endsWith(`.yaml`) ||
      filename.toLowerCase().endsWith(`.yml`)
    ) {
      const is_phonopy = content.includes(`phono3py:`) || content.includes(`phonopy:`)
      // Check if it's a phonopy file by looking for phonopy-specific content
      if (is_phonopy) return `crystal`
      return `unknown`
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
    ...Object.entries(structure_files_raw).map((
      [path, content]: [string, string],
    ) => ({
      name: path.split(`/`).pop() as string,
      content: content,
    })),
    // JSON files from structures import
    ...structures
      .filter((s): s is PymatgenStructure & { id: string } => Boolean(s.id))
      .map((s) => ({
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

  let editable_content: string = $state(``)
  let parsing_error: string = $state(``)
  let is_user_editing: boolean = $state(false)

  // Auto-update textarea content when structure changes (but not during editing)
  $effect(() => {
    if (is_user_editing) return

    const new_content = (() => {
      if (is_dragging && dragged_file_content) return dragged_file_content
      if (last_loaded_file_content) return last_loaded_file_content
      if (viewer_structures[0]) return JSON.stringify(viewer_structures[0], null, 2)
      return `No structure loaded`
    })()

    if (new_content !== editable_content) {
      editable_content = new_content
      parsing_error = ``
    }
  })

  // Set initial filename for new structures
  $effect(() => {
    const first_structure = viewer_structures.find((s) => s?.id)
    if (first_structure?.id && !last_loaded_filename) {
      last_loaded_filename = `${first_structure.id}.json`
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
        structure_handlers[0](editable_content, filename)
      } catch (error) {
        parsing_error = `Parsing error: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    }, 500)
  }

  // Universal parser that handles JSON and structure files
  const parse_any_structure = (
    content: string,
    filename: string,
  ): AnyStructure | null => {
    // Try JSON first
    try {
      return JSON.parse(content) as AnyStructure
    } catch {
      // Try structure file formats
      const parsed = parse_structure_file(content, filename)
      return parsed
        ? {
          sites: parsed.sites,
          charge: 0,
          ...(parsed.lattice && {
            lattice: { ...parsed.lattice, pbc: [true, true, true] },
          }),
        }
        : null
    }
  }

  // Simplified file drop handler
  const create_file_drop_handler =
    (viewer_idx: number) => (content: string, filename: string) => {
      try {
        const structure = parse_any_structure(content, filename)
        if (structure) {
          viewer_structures[viewer_idx] = structure
          active_files[viewer_idx] = filename
          last_loaded_file_content = content
          last_loaded_filename = filename
        } else {
          parsing_error =
            `Failed to parse file. Supported: JSON, POSCAR, XYZ, CIF, YAML`
        }
      } catch (error) {
        parsing_error = `Error: ${error}`
      }
    }

  // Create handlers for each viewer
  const structure_handlers = [
    create_file_drop_handler(0),
    create_file_drop_handler(1),
  ]
</script>

<h1 style="margin: 0">MatterViz</h1>

<p>
  <code>matterviz</code> is a toolkit for building interactive web UIs for materials
  science: periodic tables, 3d crystal structures (and molecules), Bohr atoms, nuclei,
  heatmaps, scatter plots. Check out some of the examples in the navigation bar above.
</p>

<h2>Structure Viewers</h2>

<div class="structure-viewers">
  {#each viewer_structures as structure, idx (idx)}
    <div class="structure-viewer">
      <h3>{viewer_titles[idx]}</h3>
      <Structure
        {structure}
        scene_props={{ auto_rotate: 0.5 }}
        on_file_drop={structure_handlers[idx]}
        style="--struct-height: 400px"
      />
    </div>
  {/each}
</div>

<h2>Try dragging files onto the structure viewers</h2>

<p>
  Either from the set of example files or drag a local <code>extXYZ</code>,
  <code>POSCAR</code>, <code>CIF</code>, <code>YAML</code>, <code>pymatgen</code> JSON
  files, or compressed versions of these files onto either structure viewer. You can also
  edit the structure content in the textarea below. Changes will automatically update both
  3D viewers.
</p>

<div class="files-and-textearea">
  <FileCarousel files={sample_files} {active_files} show_structure_filters />

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
  >three.js</a>
  wrapper <a href="https://threlte.xyz"><code>threlte</code></a>. It gets Svelte-compiled
  for great performance (even on supercells with 100+ atoms), is split up into
  <code>Bond</code>, <code>Lattice</code>, <code>Scene</code> and <code>Site</code>
  components for easy extensibility. You can pass various click, drag and touch event
  handlers for rich interactivity as well as inject custom HTML into tooltips using child
  components. These show
  <a href="https://materialsproject.org">Materials Project</a>
  structure for <a href="https://materialsproject.org/materials/{mp_id}">{mp_id}</a>
  and a lithium iron manganese phosphate structure from a CIF file.
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
  .structure-viewers {
    display: flex;
    gap: 2em;
    max-width: 1400px;
    margin: 2em auto;
    text-align: center;
  }
  .structure-viewer {
    flex: 1;
  }
  .structure-viewer h3 {
    margin: 0 0 1ex;
  }
  .files-and-textearea {
    display: flex;
    gap: 2em;
    max-width: 1400px;
    margin: auto;
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
    .structure-viewers {
      flex-direction: column;
      gap: 1rem;
    }
    .files-and-textearea {
      flex-direction: column;
      gap: 1rem;
      min-height: 400px;
    }
  }
</style>
