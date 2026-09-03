<script lang="ts">
  import { contrast_text_color, resolve_backdrop, watch_css_color } from '$lib/colors'
  import type { FileInfo, FileTypePaint } from '$lib/io'
  import {
    DEFAULT_FILE_TYPE_PAINTS,
    ext_of,
    FALLBACK_FILE_TYPE_PAINT,
    strip_compression_extensions,
  } from '$lib/io'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    files = [],
    active_files = [],
    show_category_filters = false,
    on_drag_start,
    on_click,
    file_type_paints = DEFAULT_FILE_TYPE_PAINTS,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    files?: FileInfo[]
    active_files?: string[]
    show_category_filters?: boolean
    on_drag_start?: (file: FileInfo, event: DragEvent) => void
    on_click?: (file: FileInfo, event: MouseEvent | KeyboardEvent) => void
    // Per-file-type fills. `badge` paints the uppercase type chip, `item` the file row.
    // Build them with `file_type_paint(badge)` to derive the row wash from the badge.
    file_type_paints?: Record<string, FileTypePaint>
  } = $props()

  const paint_for = (type: string): FileTypePaint =>
    file_type_paints[type] ?? FALLBACK_FILE_TYPE_PAINT

  let root: HTMLDivElement | undefined = $state()
  const backdrop = resolve_backdrop(() => root)
  // One theme/ancestor observer for the whole picker rather than one per badge: it bumps a
  // counter every badge attachment reads, so all badges re-read their computed color at once
  let style_epoch = $state(0)
  $effect(() => {
    if (!root) return
    return watch_css_color(root, () => style_epoch++)
  })
  const badge_contrast = (bg_color: string) => (node: HTMLElement) => {
    void style_epoch
    node.style.color = contrast_text_color({
      background: getComputedStyle(node).backgroundColor || bg_color,
      backdrop: backdrop.current,
    })
  }
  // At most one filter is active at a time: category and type filters are mutually exclusive
  let active_filter = $state<{ kind: `category` | `type`; value: string } | null>(null)
  const is_filter_active = (kind: `category` | `type`, value: string) =>
    effective_filter?.kind === kind && effective_filter.value === value
  const toggle_filter = (kind: `category` | `type`, value: string) => {
    active_filter = is_filter_active(kind, value) ? null : { kind, value }
  }

  // File type from the explicit `type`, else the extension (ignoring compression suffixes);
  // ext_of returns an extensionless name (POSCAR, INCAR, ...) whole, so it is its own type
  const get_base_file_type = (file: FileInfo): string => {
    if (file.type) return file.type.toLowerCase()
    return ext_of(strip_compression_extensions(file.name)) || `file`
  }
  const get_category_id = (file: FileInfo): string =>
    file.category ? `${file.category_icon ?? ``} ${file.category}`.trim() : `(uncategorized)`

  let filtered_files = $derived(
    files.filter((file) => {
      if (!effective_filter) return true
      const file_value =
        effective_filter.kind === `category` ? get_category_id(file) : get_base_file_type(file)
      return file_value === effective_filter.value
    }),
  )
  // A filter with a single option can't narrow anything, so it isn't offered
  const filter_options = (values: string[]): string[] => {
    const uniq = [...new Set(values)].toSorted()
    return uniq.length > 1 ? uniq : []
  }
  let format_filters = $derived(filter_options(files.map(get_base_file_type)))
  let category_filters = $derived(
    show_category_filters ? filter_options(files.map(get_category_id)) : [],
  )
  // A new `files` set can retire the active filter's value, leaving an empty picker whose chip
  // is gone from the legend. Derived, not an effect, so no render sees the stale filter.
  const effective_filter = $derived.by(() => {
    if (!active_filter) return null
    const offered = active_filter.kind === `category` ? category_filters : format_filters
    return offered.includes(active_filter.value) ? active_filter : null
  })

  const handle_drag_start = (file: FileInfo) => (event: DragEvent) => {
    const url = file.url || file.name
    const payload = {
      name: file.name,
      url,
      type: get_base_file_type(file),
      category: file.category,
    }
    event.dataTransfer?.setData(`application/json`, JSON.stringify(payload))
    event.dataTransfer?.setData(`text/plain`, url)
    on_drag_start?.(file, event)
  }
</script>

{#snippet filter_button(kind: `category` | `type`, value: string, label = value)}
  {@const is_active = is_filter_active(kind, value)}
  <button
    type="button"
    class={['legend-item', { active: is_active, 'format-item': kind === `type` }]}
    onclick={() => toggle_filter(kind, value)}
    aria-pressed={is_active}
    {@attach tooltip({
      content: `Filter to show only ${label}${kind === `type` ? ` files` : ``}`,
    })}
  >
    {#if kind === `type`}
      <span class="format-circle" style:background-color={paint_for(value).badge}></span>
    {/if}
    {label}
  </button>
{/snippet}

<div bind:this={root} {...rest} class={[`file-picker`, rest.class]}>
  {#if category_filters.length > 0 || format_filters.length > 0 || effective_filter}
    <div class="legend" role="group" aria-label="Filter files">
      {#each category_filters as category (category)}
        {@render filter_button(`category`, category)}
      {/each}
      {#if category_filters.length > 0 && format_filters.length > 0}
        <span class="divider"></span>
      {/if}
      {#each format_filters as format (format)}
        {@render filter_button(`type`, format, format.toUpperCase())}
      {/each}
      {#if effective_filter}
        <button
          type="button"
          class="clear-filter"
          aria-label="Clear file filter"
          onclick={() => (active_filter = null)}
          {@attach tooltip({ content: `Clear all filters` })}
        >
          ✕
        </button>
      {/if}
    </div>
  {/if}

  {#each filtered_files as file (file.name)}
    {@const base_type = get_base_file_type(file)}
    {@const paint = paint_for(base_type)}
    {@const is_active = active_files.includes(file.name)}
    <div
      class={['file-item', { active: is_active }]}
      style:background-color={paint.item}
      draggable="true"
      ondragstart={handle_drag_start(file)}
      onclick={(event) => on_click?.(file, event)}
      onkeydown={(event) => {
        if (event.key !== `Enter` && event.key !== ` `) return
        event.preventDefault()
        on_click?.(file, event)
      }}
      role="button"
      tabindex="0"
      aria-current={is_active || undefined}
      title={on_click
        ? `Click to load or drag this ${base_type.toUpperCase()} file`
        : `Drag this ${base_type.toUpperCase()} file`}
    >
      {#if file.label}
        <span
          class="file-type-badge"
          style:background-color={paint.badge}
          {@attach badge_contrast(paint.badge)}>{base_type.toUpperCase()}</span
        >
      {/if}
      <div class="file-name">
        {file.category && file.category_icon ? `${file.category_icon} ` : ``}{file.label ??
          file.name}
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
    -webkit-user-select: text;
    user-select: text;
  }
  .legend {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2pt 5pt;
    font-size: 0.6em;
    opacity: 0.8;
    margin: 0 0 0.5em;
  }
  .divider {
    width: 1px;
    align-self: stretch;
    background: light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.2));
    margin-inline: 0.3em;
  }
  .legend-item {
    font: inherit;
    color: inherit;
    background: transparent;
    cursor: pointer;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    transition: all 0.2s ease;
    border: 1px solid transparent;
    &:hover {
      opacity: 1;
      background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.1));
      border-color: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.3));
    }
    &.active {
      opacity: 1;
      background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.2));
      border-color: light-dark(rgba(0, 0, 0, 0.25), rgba(255, 255, 255, 0.5));
      font-weight: bold;
    }
  }
  .clear-filter {
    background-color: var(--btn-bg);
    border-radius: 50%;
    display: flex;
    place-content: center;
    &:hover {
      background-color: var(--btn-bg-hover);
    }
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
    /* a long fixture name wraps inside its chip instead of widening a phone page */
    max-width: 100%;
    min-width: 0;
    padding: 2pt 8pt;
    border: 1px solid light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    border-radius: 9px;
    cursor: grab;
    background: light-dark(rgba(0, 0, 0, 0.02), rgba(255, 255, 255, 0.1));
    transition: all 0.2s ease;
    gap: 4pt;
    &:has(.file-type-badge) {
      padding-left: 3pt;
    }
    &.active {
      border-color: var(--success-color, #00ff00);
      background: light-dark(rgba(0, 255, 0, 0.12), rgba(0, 255, 0, 0.2));
      box-shadow: 0 0 8px light-dark(rgba(0, 255, 0, 0.25), rgba(0, 255, 0, 0.35));
    }
    &:active {
      cursor: grabbing;
    }
    &:hover {
      border-color: var(--accent-color, #007acc);
      background: light-dark(rgba(0, 122, 204, 0.15), rgba(0, 122, 204, 0.25));
      filter: brightness(1.1);
    }
  }
  .file-type-badge {
    font-size: 0.5em;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 1px 5px;
    border-radius: 10px;
    white-space: nowrap;
    line-height: 1.4;
  }
  .file-name {
    font-size: 0.7em;
    line-height: 1.1;
    white-space: pre-line;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
