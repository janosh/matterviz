<script lang="ts">
  import type { FileInfo } from '$site'

  interface Props {
    files: FileInfo[]
    active_files?: string[]
    show_structure_filters?: boolean
    on_drag_start?: (file: FileInfo, event: DragEvent) => void
    on_drag_end?: () => void
  }
  let {
    files,
    active_files = [],
    show_structure_filters = false,
    on_drag_start,
    on_drag_end,
  }: Props = $props()

  let active_structure_filter = $state<string | null>(null)
  let active_format_filter = $state<string | null>(null)

  // Helper function to get the base file type (removing .gz extension)
  const get_base_file_type = (filename: string): string => {
    let base_name = filename
    // Remove .gz extension if present
    if (base_name.toLowerCase().endsWith(`.gz`)) base_name = base_name.slice(0, -3)

    const type = base_name.split(`.`).pop()?.toLowerCase() || `file`

    // Normalize trajectory-related types to just 'traj'
    if (
      type.endsWith(`traj`) ||
      base_name.includes(`_traj`) ||
      base_name.includes(`-traj`) ||
      base_name.toLowerCase().includes(`xdatcar`)
    ) return `traj`

    // Normalize HDF5 files
    if ([`h5`, `hdf5`].includes(type)) return `h5`

    return type
  }

  // Filter files based on active filters
  let filtered_files = $derived(
    files.filter((file) => {
      if (active_structure_filter && file.structure_type) {
        return file.structure_type === active_structure_filter
      }
      if (active_format_filter) {
        const normalized_type = get_base_file_type(file.name)
        return normalized_type === active_format_filter
      }
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

  const handle_drag_start = (file: FileInfo, event: DragEvent) => {
    // For compressed files, remove the .gz extension from the filename since the content is already decompressed
    const filename = file.name.toLowerCase().endsWith(`.gz`)
      ? file.name.slice(0, -3)
      : file.name

    const is_binary = file.content_type === `binary`

    if (is_binary && file.content instanceof ArrayBuffer) {
      // For binary files, create a temporary URL for drag transfer
      // This avoids expensive base64 conversion during drag operations
      const blob = new Blob([file.content], { type: `application/octet-stream` })
      const temp_url = URL.createObjectURL(blob)

      // Store both the blob URL and metadata for the receiver
      event.dataTransfer?.setData(
        `application/x-matterviz-file`,
        JSON.stringify({
          name: filename,
          content_url: temp_url, // Temporary blob URL instead of data URL
          type: file.type,
          is_binary: true,
        }),
      )

      // Clean up the temporary URL after drag completes
      setTimeout(() => URL.revokeObjectURL(temp_url), 5000)
    } else {
      // For text files, use the original approach
      event.dataTransfer?.setData(
        `application/x-matterviz-file`,
        JSON.stringify({
          name: filename,
          content: file.content as string,
          type: file.type,
          is_binary: false,
        }),
      )

      // Also set plain text as fallback for external applications
      event.dataTransfer?.setData(`text/plain`, file.content as string)
    }

    on_drag_start?.(file, event)
  }

  // Get unique file types for format filters
  let unique_formats = $derived(
    [...new Set(files.map((f) => get_base_file_type(f.name)))].sort(),
  )

  // Get unique structure types for structure filters
  let unique_structure_types = $derived(
    show_structure_filters
      ? [...new Set(files.map((f) => f.structure_type).filter(Boolean))].sort()
      : [],
  )
</script>

<div class="file-carousel">
  <div class="legend">
    {#if show_structure_filters}
      {#each unique_structure_types as structure_type (structure_type)}
        {@const is_active = active_structure_filter === structure_type}
        {@const icon = structure_type
        ? { crystal: `🔷`, molecule: `🧬`, unknown: `❓` }[structure_type] || `📄`
        : `📄`}
        <span
          class="legend-item"
          class:active={is_active}
          onclick={() => structure_type && toggle_filter(`structure`, structure_type)}
          onkeydown={(e) =>
          (e.key === `Enter` || e.key === ` `) &&
          structure_type &&
          toggle_filter(`structure`, structure_type)}
          role="button"
          tabindex="0"
          title="Filter to show only {structure_type} structures"
        >
          {icon} {structure_type}
        </span>
      {/each}
      {#if unique_structure_types.length > 0 && unique_formats.length > 0}&emsp;{/if}
    {/if}

    {#each unique_formats as format (format)}
      {@const is_active = active_format_filter === format}
      <span
        class="legend-item format-item"
        class:active={is_active}
        onclick={() => toggle_filter(`format`, format)}
        onkeydown={(e) =>
        (e.key === `Enter` || e.key === ` `) && toggle_filter(`format`, format)}
        role="button"
        tabindex="0"
        title="Filter to show only {format.toUpperCase()} files"
      >
        <span class="format-circle {format}-color"></span> {format.toUpperCase()}
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
    {@const icon = file.structure_type
      ? { crystal: `🔷`, molecule: `🧬`, unknown: `❓` }[file.structure_type]
      : ``}
    {@const base_type = get_base_file_type(file.name)}
    {@const is_compressed = file.name.toLowerCase().endsWith(`.gz`)}
    <div
      class="file-item {base_type}-file"
      class:active={active_files.includes(file.name)}
      class:compressed={is_compressed}
      draggable="true"
      ondragstart={(event) => handle_drag_start(file, event)}
      ondragend={() => {
        on_drag_end?.()
      }}
      role="button"
      tabindex="0"
      title="Drag this {is_compressed
        ? `compressed `
        : ``}{base_type.toUpperCase()} file to the viewer"
    >
      <div class="drag-handle">
        <div class="drag-bar"></div>
        <div class="drag-bar"></div>
        <div class="drag-bar"></div>
      </div>
      <div class="file-name">
        {file.formatted_name || file.name}&nbsp;{icon}
        {#if is_compressed}<span class="compression-indicator">📦</span>{/if}
      </div>
    </div>
  {/each}
</div>

<style>
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
    color: var(--error-color, #ff6666);
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
  .traj-color {
    background-color: rgba(255, 192, 203, 0.8);
  }
  .h5-color {
    background-color: rgba(255, 69, 0, 0.8);
  }
  .gz-color {
    background-color: rgba(169, 169, 169, 0.8);
  }
  .md-color {
    background-color: rgba(255, 215, 0, 0.8);
  }
  .yaml-color {
    background-color: rgba(255, 0, 255, 0.8);
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
    border-color: var(--success-color, #00ff00);
    background: rgba(0, 255, 0, 0.15);
    box-shadow: 0 0 8px rgba(0, 255, 0, 0.3);
  }
  .file-item:active {
    cursor: grabbing;
  }
  .file-item:hover {
    border-color: var(--accent-color, #007acc);
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
  .traj-file {
    background: rgba(255, 192, 203, 0.08);
    border-color: rgba(255, 192, 203, 0.2);
  }
  .h5-file {
    background: rgba(255, 69, 0, 0.08);
    border-color: rgba(255, 69, 0, 0.2);
  }
  .gz-file {
    background: rgba(169, 169, 169, 0.08);
    border-color: rgba(169, 169, 169, 0.2);
  }
  .md-file {
    background: rgba(255, 215, 0, 0.08);
    border-color: rgba(255, 215, 0, 0.2);
  }
  .yaml-file {
    background: rgba(255, 0, 255, 0.08);
    border-color: rgba(255, 0, 255, 0.2);
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
    white-space: pre-line;
  }
  .compression-indicator {
    opacity: 0.7;
    font-size: 0.8em;
    margin-left: 0.2em;
  }
  .file-item.compressed {
    border-style: dashed;
    opacity: 0.9;
  }
  .file-item.compressed:hover {
    opacity: 1;
  }

  @media (max-width: 768px) {
    .file-carousel {
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
