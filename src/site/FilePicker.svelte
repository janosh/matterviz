<script lang="ts">
  import type { FileInfo } from '$site'

  interface Props {
    files: FileInfo[]
    active_files?: string[]
    show_category_filters?: boolean
    category_labels?: Record<string, string>
    on_drag_start?: (file: FileInfo, event: DragEvent) => void
    on_drag_end?: () => void
    type_mapper?: (filename: string) => string
    file_type_colors?: Record<string, string>
    [key: string]: unknown
  }
  let {
    files,
    active_files = [],
    show_category_filters = false,
    category_labels = {},
    on_drag_start,
    on_drag_end,
    type_mapper,
    file_type_colors = {
      cif: `rgba(100, 149, 237, 0.8)`,
      xyz: `rgba(50, 205, 50, 0.8)`,
      extxyz: `rgba(50, 205, 50, 0.8)`,
      poscar: `rgba(255, 140, 0, 0.8)`,
      json: `rgba(138, 43, 226, 0.8)`,
      traj: `rgba(255, 192, 203, 0.8)`,
      hdf5: `rgba(255, 69, 0, 0.8)`,
      gz: `rgba(169, 169, 169, 0.8)`,
      md: `rgba(255, 215, 0, 0.8)`,
      yaml: `rgba(255, 0, 255, 0.8)`,
      xdatcar: `rgba(255, 215, 0, 0.8)`,
    },
    ...rest
  }: Props = $props()

  let active_category_filter = $state<string | null>(null)
  let active_type_filter = $state<string | null>(null)
  type FilterKind = `category` | `type`

  // Helper function to get the base file type (removing .gz extension)
  const get_base_file_type = (filename: string): string => {
    // Use custom type mapper if provided
    if (type_mapper) return type_mapper(filename)

    let base_name = filename.toLowerCase()
    // Remove .gz extension if present
    if (base_name.endsWith(`.gz`)) base_name = base_name.slice(0, -3)

    return base_name.split(`.`).pop() || `file`
  }

  // Filter files based on active filters
  let filtered_files = $derived(
    files.filter((file) => {
      if (active_category_filter && file.category) {
        return file.category === active_category_filter
      }
      if (active_type_filter) {
        const normalized_type = get_base_file_type(file.name)
        return normalized_type === active_type_filter
      }
      return true
    }),
  )

  const toggle_filter = (kind: FilterKind, filter: string) => {
    if (kind === `category`) {
      active_category_filter = active_category_filter === filter ? null : filter
      active_type_filter = null
    } else {
      active_type_filter = active_type_filter === filter ? null : filter
      active_category_filter = null
    }
  }

  const handle_drag_start = (file: FileInfo) => (event: DragEvent) => {
    const file_url = file.url || file.name // Get the URL to drag (falling back to name)

    const payload = JSON.stringify({
      name: file.name,
      url: file_url,
      type: file.type || get_base_file_type(file.name),
      category: file.category,
    })
    // Set file data as JSON for applications that can handle it
    event.dataTransfer?.setData(`application/json`, payload)

    // Also set plain text as fallback for external applications
    event.dataTransfer?.setData(`text/plain`, file_url)

    on_drag_start?.(file, event)
  }

  // Get unique file types for format filters
  let uniq_formats = $derived(
    [...new Set(files.map((file) => get_base_file_type(file.name)))].sort(),
  )

  // Get unique category types for category filters
  let uniq_categories = $derived(
    show_category_filters
      ? [...new Set(files.map((file) => file.category))].sort().filter(Boolean)
      : [],
  )
</script>

<div class="file-picker" {...rest}>
  <div class="legend">
    {#if show_category_filters}
      {#each uniq_categories as category (category)}
        {@const is_active = active_category_filter === category}
        <span
          class="legend-item"
          class:active={is_active}
          onclick={() => category && toggle_filter(`category`, category)}
          onkeydown={(evt) =>
          (evt.key === `Enter` || evt.key === ` `) &&
          category &&
          toggle_filter(`category`, category)}
          role="button"
          tabindex="0"
          title="Filter to show only {category}"
        >
          {(category && category_labels[category]) || category}
        </span>
      {/each}
      {#if uniq_categories.length > 0 && uniq_formats.length > 0}&emsp;{/if}
    {/if}

    {#each uniq_formats as format (format)}
      {@const is_active = active_type_filter === format}
      <span
        class="legend-item format-item"
        class:active={is_active}
        onclick={() => toggle_filter(`type`, format)}
        onkeydown={(evt) =>
        (evt.key === `Enter` || evt.key === ` `) && toggle_filter(`type`, format)}
        role="button"
        tabindex="0"
        title="Filter to show only {format.toUpperCase()} files"
      >
        <span
          class="format-circle"
          style:background-color={file_type_colors[format]}
        ></span> {format.toUpperCase()}
      </span>
    {/each}

    {#if active_category_filter || active_type_filter}
      <button
        title="Clear all filters"
        class="clear-filter"
        onclick={() => {
          active_category_filter = null
          active_type_filter = null
        }}
      >
        ✕
      </button>
    {/if}
  </div>

  {#each filtered_files as file (file.name)}
    {@const base_type = get_base_file_type(file.name)}
    {@const is_compressed = file.name.toLowerCase().endsWith(`.gz`)}
    <div
      class="file-item"
      class:active={active_files.includes(file.name)}
      class:compressed={is_compressed}
      style:background-color={file_type_colors[base_type]?.replace(`0.8`, `0.08`)}
      draggable="true"
      ondragstart={handle_drag_start(file)}
      ondragend={() => on_drag_end?.()}
      role="button"
      tabindex="0"
      title="Drag this {base_type.toUpperCase()} file"
    >
      <div class="drag-handle">
        <div class="drag-bar"></div>
        <div class="drag-bar"></div>
        <div class="drag-bar"></div>
      </div>
      <div class="file-name">
        {file.name}{file.category ? `\u00A0${file.category}` : ``}
        {#if is_compressed}<span class="compression-indicator">📦</span>{/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .file-picker {
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
    background-color: var(--btn-bg);
    border-radius: 50%;
    display: flex;
    place-content: center;
  }
  .clear-filter:hover {
    background-color: var(--btn-hover-bg);
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
</style>
