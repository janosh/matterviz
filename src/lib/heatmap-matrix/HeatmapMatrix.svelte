<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { is_color, pick_contrast_color } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import * as d3_sc from 'd3-scale-chromatic'
  import { onDestroy, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import type { AxisItem, CellContext, HeatmapTooltipProp } from './index'
  import { make_color_override_key } from './shared'

  type CellValue = number | string | null

  let {
    // Data props
    x_items,
    y_items,
    values = [],
    color_scale = $bindable(`interpolateViridis`),
    color_scale_range = [null, null],
    color_overrides = {},
    missing_color = `transparent`,
    log = false,
    // Interaction props
    active_cell = $bindable(null),
    disabled = false,
    onclick,
    ondblclick,
    // Display props
    tile_size = `6px`,
    gap = `0px`,
    hide_empty = false,
    show_x_labels = true,
    show_y_labels = true,
    stagger_axis_labels = `auto`,
    symmetric = false,
    symmetric_label_position = `diagonal`,
    label_style = ``,
    // Snippet props
    tooltip = false,
    cell,
    x_label_cell,
    y_label_cell,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `onclick` | `ondblclick`> & {
    x_items: AxisItem[]
    y_items: AxisItem[]
    values?:
      | CellValue[][]
      | Record<string, Record<string, CellValue>>
    color_scale?: D3InterpolateName | ((val: number) => string)
    color_scale_range?: [number | null, number | null]
    color_overrides?: Record<string, string>
    missing_color?: string
    log?: boolean
    active_cell?: { x_idx: number; y_idx: number } | null
    disabled?: boolean
    onclick?: (cell: CellContext) => void
    ondblclick?: (cell: CellContext) => void
    tile_size?: string
    gap?: string
    // false: show all rows/cols. 'compact': remove all-null rows/cols.
    // 'gaps': keep grid positions but hide all-null rows/cols (preserves alignment).
    hide_empty?: false | `compact` | `gaps`
    show_x_labels?: boolean
    show_y_labels?: boolean
    stagger_axis_labels?: boolean | `auto`
    symmetric?: boolean
    symmetric_label_position?: `diagonal` | `edge`
    label_style?: string
    tooltip?: HeatmapTooltipProp
    cell?: Snippet<[CellContext]>
    x_label_cell?: Snippet<[{ item: AxisItem; idx: number }]>
    y_label_cell?: Snippet<[{ item: AxisItem; idx: number }]>
    children?: Snippet
  } = $props()

  // === Value resolution ===
  let x_keys = $derived(x_items.map((item) => item.key ?? item.label))
  let y_keys = $derived(y_items.map((item) => item.key ?? item.label))

  let get_value = $derived.by(() => {
    if (Array.isArray(values)) {
      const matrix_values = values as CellValue[][]
      return (x_idx: number, y_idx: number): CellValue =>
        matrix_values[y_idx]?.[x_idx] ?? null
    }
    // Record<y_key, Record<x_key, value>>
    const record = values as Record<string, Record<string, CellValue>>
    return (x_idx: number, y_idx: number): CellValue => {
      const y_key = y_keys[y_idx]
      const x_key = x_keys[x_idx]
      return record[y_key]?.[x_key] ?? null
    }
  })

  // === Visibility filtering ===
  // Single pass to find which columns and rows have at least one non-null value
  let { vis_x, vis_y } = $derived.by(() => {
    const all_x = Array.from({ length: x_items.length }, (_, idx) => idx)
    const all_y = Array.from({ length: y_items.length }, (_, idx) => idx)
    if (!hide_empty) return { vis_x: all_x, vis_y: all_y }

    const col_has_data = new Array(x_items.length).fill(false)
    const row_has_data = new Array(y_items.length).fill(false)
    for (let y_idx = 0; y_idx < y_items.length; y_idx++) {
      for (let x_idx = 0; x_idx < x_items.length; x_idx++) {
        if (get_value(x_idx, y_idx) !== null) {
          col_has_data[x_idx] = true
          row_has_data[y_idx] = true
        }
      }
    }
    return {
      vis_x: all_x.filter((idx) => col_has_data[idx]),
      vis_y: all_y.filter((idx) => row_has_data[idx]),
    }
  })

  // === Color computation ===
  let color_scale_fn = $derived.by(() => {
    if (typeof color_scale === `function`) return color_scale
    const named_scale = d3_sc[color_scale]
    return typeof named_scale === `function` ? named_scale : d3_sc.interpolateViridis
  })

  // Single-pass min/max to avoid spreading large arrays into Math.min/max
  let [auto_min, auto_max] = $derived.by(() => {
    let min = Infinity
    let max = -Infinity
    for (let y_idx = 0; y_idx < y_items.length; y_idx++) {
      for (let x_idx = 0; x_idx < x_items.length; x_idx++) {
        if (symmetric && x_idx > y_idx) continue
        const val = get_value(x_idx, y_idx)
        if (typeof val === `number` && Number.isFinite(val) && (!log || val > 0)) {
          if (val < min) min = val
          if (val > max) max = val
        }
      }
    }
    return min <= max ? [min, max] as const : [0, 1] as const
  })

  let cs_min = $derived(color_scale_range[0] ?? auto_min)
  let cs_max = $derived(color_scale_range[1] ?? auto_max)

  // Map a single value to a background color
  function value_to_color(val: CellValue): string | null {
    if (val === null) return missing_color || null
    if (typeof val === `string`) {
      if (is_color(val)) return val
      return missing_color || null
    }
    if (!Number.isFinite(val) || !color_scale_fn) return missing_color || null
    if (log && val <= 0) return missing_color || null

    const span = cs_max - cs_min
    if (!Number.isFinite(span) || span === 0) return color_scale_fn(0.5)

    let normalized = (val - cs_min) / span
    if (log) {
      const is_descending_range = cs_min > cs_max
      const lower_bound = Math.min(cs_min, cs_max)
      const upper_bound = Math.max(cs_min, cs_max)
      if (upper_bound <= 0) return missing_color || null
      const safe_lower_bound = Math.max(lower_bound, Number.MIN_VALUE)
      const safe_value = Math.max(val, safe_lower_bound)
      const log_min = Math.log(safe_lower_bound)
      const log_max = Math.log(upper_bound)
      if (
        !Number.isFinite(log_min) || !Number.isFinite(log_max) || log_max === log_min
      ) {
        return color_scale_fn(0.5)
      }
      const log_normalized = (Math.log(safe_value) - log_min) / (log_max - log_min)
      normalized = is_descending_range ? 1 - log_normalized : log_normalized
    }
    if (!Number.isFinite(normalized)) return missing_color || null
    return color_scale_fn(Math.max(0, Math.min(1, normalized)))
  }

  // Batch compute background colors as a flat array indexed by y_idx * n_x + x_idx.
  // Text colors are only computed when a cell snippet is provided (otherwise cells have no text).
  let n_x = $derived(x_items.length)
  let bg_flat = $derived.by(() => {
    const n_y = y_items.length
    const colors = new Array<string | null>(n_x * n_y)
    for (let y_idx = 0; y_idx < n_y; y_idx++) {
      const row_offset = y_idx * n_x
      for (let x_idx = 0; x_idx < n_x; x_idx++) {
        if (symmetric && x_idx > y_idx) {
          colors[row_offset + x_idx] = null
          continue
        }
        const override_key = make_color_override_key(x_keys[x_idx], y_keys[y_idx])
        colors[row_offset + x_idx] = override_key in color_overrides
          ? color_overrides[override_key]
          : value_to_color(get_value(x_idx, y_idx))
      }
    }
    return colors
  })

  // Only compute text colors if a cell snippet is provided (cells render content that needs contrast)
  let text_flat = $derived.by(() => {
    if (!cell) return null
    return bg_flat.map((bg: string | null) =>
      bg ? pick_contrast_color({ bg_color: bg }) : null
    )
  })

  // Look up bg color by indices
  function get_bg(x_idx: number, y_idx: number): string | null {
    return bg_flat[y_idx * n_x + x_idx]
  }

  // === Cell context builder (only called for clicks, not per-hover) ===
  function build_cell_context(x_idx: number, y_idx: number): CellContext {
    return {
      x_item: x_items[x_idx],
      y_item: y_items[y_idx],
      x_idx,
      y_idx,
      value: get_value(x_idx, y_idx),
      bg_color: get_bg(x_idx, y_idx),
    }
  }

  // === Fully imperative hover management ===
  // ZERO $state writes during mouseover — all DOM updates are direct.
  // This avoids Svelte's reactive flush which would re-evaluate effects.
  const is_browser = typeof window !== `undefined`
  let tooltip_div: HTMLDivElement | undefined = $state()
  let active_cell_raf = 0 // rAF handle for deferred active_cell update
  let click_timeout_id: ReturnType<typeof setTimeout> | null = null
  const dblclick_delay_ms = 250
  let last_hover_x = -1
  let last_hover_y = -1

  // In symmetric mode, labels can either stay on outer edges ('edge')
  // or move toward the missing triangle and hug the diagonal ('diagonal').
  let use_diagonal_symmetric_labels = $derived(
    symmetric && symmetric_label_position === `diagonal`,
  )
  let use_staggered_x_labels = $derived(
    stagger_axis_labels === true ||
      (stagger_axis_labels === `auto` && vis_x.length >= 24),
  )
  let use_staggered_y_labels = $derived(
    stagger_axis_labels === true ||
      (stagger_axis_labels === `auto` && vis_y.length >= 24),
  )
  let use_side_split_x_labels = $derived(
    use_staggered_x_labels && !use_diagonal_symmetric_labels,
  )
  let use_side_split_y_labels = $derived(use_staggered_y_labels)
  // For 'gaps' mode: explicit grid placement to preserve positional alignment
  let gaps_mode = $derived(hide_empty === `gaps`)
  let visible_col_count = $derived(gaps_mode ? x_items.length : vis_x.length)
  let visible_row_count = $derived(gaps_mode ? y_items.length : vis_y.length)

  let vis_x_pos_map = $derived.by(() => {
    const position_map = new SvelteMap<number, number>()
    for (const [vis_pos, item_idx] of vis_x.entries()) {
      position_map.set(item_idx, vis_pos)
    }
    return position_map
  })

  let vis_y_pos_map = $derived.by(() => {
    const position_map = new SvelteMap<number, number>()
    for (const [vis_pos, item_idx] of vis_y.entries()) {
      position_map.set(item_idx, vis_pos)
    }
    return position_map
  })

  function get_vis_col(item_idx: number): number | null {
    if (gaps_mode) return item_idx
    return vis_x_pos_map.get(item_idx) ?? null
  }

  function get_vis_row(item_idx: number): number | null {
    if (gaps_mode) return item_idx
    return vis_y_pos_map.get(item_idx) ?? null
  }

  function x_label_diag_grid_row(x_idx: number): number | undefined {
    const vis_row = get_vis_row(x_idx)
    if (vis_row === null) return undefined
    // Place x label in first missing cell above diagonal for this column.
    // For the first column, this clamps to top label row.
    return Math.max(1, vis_row + 1)
  }

  function x_label_diag_grid_col(x_idx: number): number | undefined {
    const vis_col = get_vis_col(x_idx)
    if (vis_col === null) return undefined
    return vis_col + 2
  }

  function y_label_edge_grid_row(y_idx: number): number | undefined {
    const vis_row = get_vis_row(y_idx)
    if (vis_row === null) return undefined
    return vis_row + 2
  }

  function x_label_grid_col(x_idx: number): number | undefined {
    if (use_diagonal_symmetric_labels) return x_label_diag_grid_col(x_idx)
    return cell_grid_col(x_idx)
  }

  function x_label_grid_row(x_idx: number): number | undefined {
    if (use_diagonal_symmetric_labels) return x_label_diag_grid_row(x_idx)
    if (use_side_split_x_labels && x_idx % 2 !== 0) return visible_row_count + 2
    return 1
  }

  function y_label_grid_col(y_idx: number): number {
    if (use_side_split_y_labels && y_idx % 2 !== 0) return visible_col_count + 2
    return 1
  }

  function cell_grid_col(x_idx: number): number | undefined {
    const vis_col = get_vis_col(x_idx)
    if (vis_col === null) return undefined
    return vis_col + 2
  }

  function cell_grid_row(y_idx: number): number | undefined {
    const vis_row = get_vis_row(y_idx)
    if (vis_row === null) return undefined
    return vis_row + 2
  }

  function schedule_raf(callback: () => void): number {
    if (!is_browser) {
      callback()
      return 0
    }
    return window.requestAnimationFrame(callback)
  }

  function cancel_raf(raf_handle: number): void {
    if (!is_browser || raf_handle === 0) return
    window.cancelAnimationFrame(raf_handle)
  }

  function clear_pending_click(): void {
    if (click_timeout_id === null) return
    clearTimeout(click_timeout_id)
    click_timeout_id = null
  }

  function parse_cell_indices(
    cell_el: HTMLElement,
  ): { x_idx: number; y_idx: number } | null {
    const x_value = Number(cell_el.dataset.x)
    const y_value = Number(cell_el.dataset.y)
    if (!Number.isInteger(x_value) || !Number.isInteger(y_value)) return null
    return { x_idx: x_value, y_idx: y_value }
  }

  function get_cell_context_from_event(
    event: MouseEvent | KeyboardEvent,
  ): CellContext | null {
    const cell_el = get_cell_el(event as MouseEvent)
    if (!cell_el) return null
    const indices = parse_cell_indices(cell_el)
    if (!indices) return null
    return build_cell_context(indices.x_idx, indices.y_idx)
  }

  function trigger_click(cell_context: CellContext): void {
    if (!onclick) return
    if (!ondblclick) {
      onclick(cell_context)
      return
    }
    clear_pending_click()
    click_timeout_id = setTimeout(() => {
      onclick(cell_context)
      click_timeout_id = null
    }, dblclick_delay_ms)
  }

  function get_cell_el(event: MouseEvent): HTMLElement | null {
    const target_node = event.target
    if (!(target_node instanceof Element)) return null
    if (target_node instanceof HTMLElement && target_node.dataset.x !== undefined) {
      return target_node
    }
    const closest_cell = target_node.closest(`[data-x][data-y]`)
    return closest_cell instanceof HTMLElement ? closest_cell : null
  }

  // Write default tooltip content imperatively (no reactive state)
  function update_tooltip_content(
    td: HTMLElement,
    x_idx: number,
    y_idx: number,
  ): void {
    const x_label = x_items[x_idx]?.label ?? ``
    const y_label = y_items[y_idx]?.label ?? ``
    const val = get_value(x_idx, y_idx)
    const value_str = val === null || val === undefined
      ? ``
      : typeof val === `number`
      ? format_num(val)
      : String(val)
    td.textContent = value_str
      ? `${x_label} - ${y_label}: ${value_str}`
      : `${x_label} - ${y_label}`
  }

  function handle_mouseover(event: MouseEvent) {
    if (disabled) return
    const cell_el = get_cell_el(event)
    if (!cell_el) return
    const indices = parse_cell_indices(cell_el)
    if (!indices) return
    const { x_idx, y_idx } = indices

    // Ignore redundant enters on the same cell (can happen with nested children)
    if (last_hover_x === x_idx && last_hover_y === y_idx) {
      return
    }
    last_hover_x = x_idx
    last_hover_y = y_idx

    // Defer bindable writes out of the hot mouseover path
    cancel_raf(active_cell_raf)
    active_cell_raf = schedule_raf(() => {
      active_cell = { x_idx, y_idx }
    })

    if (tooltip === false || !tooltip_div) return

    // Use viewport coordinates to avoid forced layout reads on large grids
    tooltip_div.style.left = `${event.clientX + 10}px`
    tooltip_div.style.top = `${event.clientY + 12}px`
    tooltip_div.classList.add(`visible`)

    if (typeof tooltip === `function`) {
      tooltip_cell = build_cell_context(x_idx, y_idx)
    } else {
      update_tooltip_content(tooltip_div, x_idx, y_idx)
    }
  }

  function handle_mouseout(event: MouseEvent) {
    if (disabled) return
    const related = event.relatedTarget as HTMLElement | null
    if (related?.closest?.(`[data-x][data-y]`)) return
    // Clear active state imperatively
    last_hover_x = -1
    last_hover_y = -1
    tooltip_div?.classList.remove(`visible`)
    // Defer reactive cleanup to rAF
    cancel_raf(active_cell_raf)
    active_cell_raf = schedule_raf(() => {
      active_cell = null
      tooltip_cell = null
    })
  }

  function handle_click(event: MouseEvent) {
    if (disabled || !onclick) return
    const cell_context = get_cell_context_from_event(event)
    if (!cell_context) return
    trigger_click(cell_context)
  }

  function handle_dblclick(event: MouseEvent) {
    if (disabled || !ondblclick) return
    const cell_context = get_cell_context_from_event(event)
    if (!cell_context) return
    clear_pending_click()
    ondblclick(cell_context)
  }

  function handle_cell_keydown(key_event: KeyboardEvent): void {
    if (disabled || (key_event.key !== `Enter` && key_event.key !== ` `)) return
    key_event.preventDefault()
    const cell_context = get_cell_context_from_event(key_event)
    if (!cell_context) return
    if (onclick) {
      trigger_click(cell_context)
      return
    }
    ondblclick?.(cell_context)
  }

  let has_interaction_handlers = $derived(
    !disabled && (Boolean(onclick) || Boolean(ondblclick)),
  )

  // Tooltip state: only used for custom tooltip snippets (function tooltips)
  let tooltip_cell: CellContext | null = $state(null)

  onDestroy(() => {
    cancel_raf(active_cell_raf)
    clear_pending_click()
  })
</script>

<div
  {...rest}
  class="heatmap-matrix {rest.class ?? ``}"
  style:--n-cols={gaps_mode ? x_items.length : vis_x.length}
  style:--n-rows={gaps_mode ? y_items.length : vis_y.length}
  style:--extra-right-y={use_side_split_y_labels ? 1 : 0}
  style:--extra-bottom-x={use_side_split_x_labels ? 1 : 0}
  style:--right-y-track={use_side_split_y_labels ? `max-content` : `0`}
  style:--bottom-x-track={use_side_split_x_labels ? `max-content` : `0`}
  style:--tile-size={tile_size}
  style:gap
  onmouseover={handle_mouseover}
  onmouseout={handle_mouseout}
  onclick={handle_click}
  ondblclick={handle_dblclick}
>
  <!-- Top-left corner spacer (when both axes have labels) -->
  {#if show_x_labels && show_y_labels}
    <div class="corner"></div>
  {/if}

  <!-- X-axis labels (top row) -->
  {#if show_x_labels}
    {#each vis_x as x_idx (x_items[x_idx].key ?? x_items[x_idx].label)}
      {@const item = x_items[x_idx]}
      <div
        class="x-label"
        class:x-edge-top={use_side_split_x_labels && x_idx % 2 === 0}
        class:x-edge-bottom={use_side_split_x_labels && x_idx % 2 !== 0}
        style={label_style || undefined}
        style:grid-column={x_label_grid_col(x_idx)}
        style:grid-row={x_label_grid_row(x_idx)}
        title={x_label_cell ? undefined : item.label}
      >
        {#if x_label_cell}
          {@render x_label_cell({ item, idx: x_idx })}
        {:else}
          {item.label}
        {/if}
      </div>
    {/each}
  {/if}

  <!-- Grid rows: y-label + cells -->
  {#each vis_y as y_idx (y_items[y_idx].key ?? y_items[y_idx].label)}
    {@const y_item = y_items[y_idx]}
    {#if show_y_labels}
      <div
        class="y-label"
        class:y-edge-left={use_side_split_y_labels && y_idx % 2 === 0}
        class:y-edge-right={use_side_split_y_labels && y_idx % 2 !== 0}
        style={label_style || undefined}
        style:grid-row={y_label_edge_grid_row(y_idx)}
        style:grid-column={y_label_grid_col(y_idx)}
        title={y_label_cell ? undefined : y_item.label}
      >
        {#if y_label_cell}
          {@render y_label_cell({ item: y_item, idx: y_idx })}
        {:else}
          {y_item.label}
        {/if}
      </div>
    {/if}

    <!-- Cells for this row -->
    {#each vis_x as x_idx (x_items[x_idx].key ?? x_items[x_idx].label)}
      {@const bg = bg_flat[y_idx * n_x + x_idx]}
      {@const should_render = !symmetric || x_idx <= y_idx}
      {#if should_render}
        <div
          class="cell"
          data-x={x_idx}
          data-y={y_idx}
          role={has_interaction_handlers ? `button` : undefined}
          tabindex={has_interaction_handlers ? 0 : undefined}
          style:background-color={bg}
          style:color={text_flat?.[y_idx * n_x + x_idx]}
          style:grid-column={cell_grid_col(x_idx)}
          style:grid-row={cell_grid_row(y_idx)}
          onkeydown={handle_cell_keydown}
        >
          {#if cell}
            {@render cell(build_cell_context(x_idx, y_idx))}
          {/if}
        </div>
      {:else}
        <div
          class="cell empty"
          style:grid-column={cell_grid_col(x_idx)}
          style:grid-row={cell_grid_row(y_idx)}
        >
        </div>
      {/if}
    {/each}
  {/each}

  <!-- Tooltip: always in DOM, visibility toggled imperatively via classList -->
  {#if tooltip !== false}
    <div class="tooltip" bind:this={tooltip_div}>
      {#if typeof tooltip === `function` && tooltip_cell}
        {@render tooltip(tooltip_cell)}
      {/if}
    </div>
  {/if}

  {@render children?.()}
</div>

<style>
  .heatmap-matrix {
    display: grid;
    grid-template-columns:
      max-content repeat(
      var(--n-cols),
      minmax(var(--tile-size, 6px), 1fr)
    ) var(--right-y-track, 0);
    grid-template-rows:
      max-content repeat(
      var(--n-rows),
      minmax(var(--tile-size, 6px), 1fr)
    ) var(--bottom-x-track, 0);
    position: relative;
    width: min(100%, var(--heatmap-max-width, 1200px));
    max-width: var(--heatmap-max-width, 1200px);
    aspect-ratio: calc(
      (
        var(--n-cols) + 1 + var(--extra-right-y, 0)
      )
        / (
        var(--n-rows) + 1 + var(--extra-bottom-x, 0)
      )
    );
    overflow: auto;
  }
  .corner {
    min-width: 0; /* spacer in top-left when both axes have labels */
  }
  .cell {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
  }
  .cell.empty {
    pointer-events: none;
  }
  .x-label,
  .y-label {
    font-size: clamp(10px, calc(var(--tile-size, 6px) * 0.75), 24px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .x-label {
    overflow: visible;
    text-overflow: clip;
    align-items: flex-end;
    padding: 2px;
  }
  .x-label.x-edge-top {
    min-height: 1.6em;
    align-items: flex-end;
  }
  .x-label.x-edge-bottom {
    min-height: 1.6em;
    align-items: flex-start;
  }
  .y-label {
    padding: 0 2px;
  }
  .y-label.y-edge-left,
  .y-label.y-edge-right {
    min-width: 1.6em;
  }
  .y-label.y-edge-left {
    justify-content: flex-end;
    text-align: right;
  }
  .y-label.y-edge-right {
    justify-content: flex-start;
    text-align: left;
  }
  .tooltip {
    display: none;
    position: fixed;
    transform: none;
    background: var(
      --tooltip-bg,
      light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85))
    );
    color: var(--tooltip-color, light-dark(#222, #eee));
    padding: var(--tooltip-padding, 4px 6px);
    border-radius: var(--tooltip-border-radius, var(--border-radius, 3pt));
    font-size: var(--tooltip-font-size, 12px);
    text-align: var(--tooltip-text-align, center);
    line-height: var(--tooltip-line-height, 1.2);
    z-index: var(--tooltip-z-index, 10);
    pointer-events: none;
    box-shadow: var(
      --tooltip-shadow,
      light-dark(0 2px 8px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.4))
    );
    white-space: nowrap;
  }
  .tooltip.visible {
    display: block;
  }
  .tooltip::before {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid
      var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)));
  }
</style>
