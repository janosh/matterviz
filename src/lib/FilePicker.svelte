<script lang="ts">
  import type { FileInfo } from '$lib'
  import { tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    files = [],
    active_files = [],
    show_category_filters = false,
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
  }: HTMLAttributes<HTMLDivElement> & {
    files?: FileInfo[]
    active_files?: string[]
    show_category_filters?: boolean
    on_drag_start?: (file: FileInfo, event: DragEvent) => void
    on_drag_end?: () => void
    type_mapper?: (file: FileInfo) => string
    file_type_colors?: Record<string, string>
  } = $props()

  let active_category_filter = $state<string | null>(null)
  let active_type_filter = $state<string | null>(null)
  type FilterKind = `category` | `type`

  // Helper function to get the base file type (removing .gz extension)
  const get_base_file_type = (file: FileInfo): string => {
    // Use custom type mapper if provided
    if (type_mapper) return type_mapper(file)

    let base_name = file.name.toLowerCase()
    // Remove .gz extension if present
    if (base_name.endsWith(`.gz`)) base_name = base_name.slice(0, -3)

    return base_name.split(`.`).pop() || `file`
  }

  // Helper function to create normalized category identifier for filtering
  const get_category_id = (file: FileInfo): string => {
    if (!file.category) return `(uncategorized)`
    return `${file.category_icon ?? ``} ${file.category}`.trim()
  }

  // Filter files based on active filters
  let filtered_files = $derived(
    files.filter((file) => {
      if (active_category_filter) {
        return get_category_id(file) === active_category_filter
      }
      if (active_type_filter) {
        const normalized_type = get_base_file_type(file)
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
      type: file.type || get_base_file_type(file),
      category: file.category,
    })
    // Set file data as JSON for applications that can handle it
    event.dataTransfer?.setData(`application/json`, payload)

    // Also set plain text as fallback for external applications
    event.dataTransfer?.setData(`text/plain`, file_url)

    on_drag_start?.(file, event)
  }

  // Get unique file types/categories for format/category filters
  let uniq_formats = $derived([...new Set(files.map(get_base_file_type))].sort())
  let uniq_categories = $derived(
    [...new Set(files.map(get_category_id))].filter(Boolean).sort(),
  )
</script>

<div class="file-picker" {...rest}>
  <div class="legend">
    {#each show_category_filters ? uniq_categories : [] as category (category)}
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
        aria-pressed={is_active}
        {@attach tooltip({ content: `Filter to show only ${category}` })}
      >
        {category}
      </span>
    {/each}
    {#if uniq_categories.length > 0 && uniq_formats.length > 0}&emsp;{/if}

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
        {@attach tooltip({ content: `Filter to show only ${format.toUpperCase()} files` })}
      >
        <span
          class="format-circle"
          style:background-color={file_type_colors[format]}
        ></span> {format.toUpperCase()}
      </span>
    {/each}

    {#if active_category_filter || active_type_filter}
      <button
        {@attach tooltip({ content: `Clear all filters` })}
        class="clear-filter"
        onclick={() => [active_category_filter, active_type_filter] = [null, null]}
      >
        ✕
      </button>
    {/if}
  </div>

  {#each filtered_files as file (file.name)}
    {@const base_type = get_base_file_type(file)}
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
      <div class="file-name">
        {file.category ? `${file.category_icon} ` : ``}{file.name}
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
    background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.1));
    border-color: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.3));
  }
  .legend-item.active {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.2));
    border-color: light-dark(rgba(0, 0, 0, 0.25), rgba(255, 255, 255, 0.5));
    font-weight: bold;
  }
  .clear-filter {
    background-color: var(--btn-bg);
    border-radius: 50%;
    display: flex;
    place-content: center;
  }
  .clear-filter:hover {
    background-color: var(--btn-bg-hover);
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
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 20px;
    cursor: grab;
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.1));
    transition: all 0.2s ease;
    gap: 0.5em;
  }
  .file-item.active {
    border-color: var(--success-color, #00ff00);
    background: light-dark(rgba(0, 255, 0, 0.12), rgba(0, 255, 0, 0.2));
    box-shadow: 0 0 8px light-dark(rgba(0, 255, 0, 0.25), rgba(0, 255, 0, 0.35));
  }
  .file-item:active {
    cursor: grabbing;
  }
  .file-item:hover {
    border-color: var(--accent-color, #007acc);
    background: light-dark(rgba(0, 122, 204, 0.15), rgba(0, 122, 204, 0.25));
    filter: brightness(1.1);
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
