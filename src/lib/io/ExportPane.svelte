<script lang="ts">
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { clamp } from '$lib/math'
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import { ViewerPane, create_clipboard_feedback } from '$lib/overlays'
  import type { ExportItem, ExportSection } from './types'
  import { sanitize_html } from '$lib/sanitize'
  import type { Snippet } from 'svelte'
  import { tooltip } from 'svelte-widgets/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  // mdi:export-variant is not included in svelte-widgets' generated icon set.
  const export_variant = {
    viewBox: `0 0 24 24`,
    d: `M12,1L8,5H11V14H13V5H16M18,23H6C4.89,23 4,22.1 4,21V9A2,2 0 0,1 6,7H9V9H6V21H18V9H15V7H18A2,2 0 0,1 20,9V21A2,2 0 0,1 18,23Z`,
  }

  let {
    export_pane_open = $bindable(false),
    sections = [],
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    dpi_range = [50, 600],
    icon_style = ``,
    toggle_props = {},
    pane_props = {},
    header = undefined,
    children = undefined,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    export_pane_open?: boolean
    sections?: ExportSection[]
    png_dpi?: number
    dpi_range?: readonly [number, number]
    icon_style?: string
    toggle_props?: PaneToggleProps
    pane_props?: PaneProps
    // Pane-specific controls rendered above the sections (e.g. a frame range shared by them)
    header?: Snippet
    // Pane-specific extras rendered below the sections (e.g. video export controls)
    children?: Snippet
  } = $props()

  const pane_id = $props.id()

  // Clamp DPI into dpi_range on input change (fires on blur, before any download click)
  function clamp_dpi(): void {
    const [min_dpi, max_dpi] = dpi_range
    if (typeof png_dpi !== `number` || !Number.isFinite(png_dpi)) png_dpi = DEFAULT_PNG_DPI
    else png_dpi = Math.round(clamp(png_dpi, min_dpi, max_dpi))
  }

  // Copy-to-clipboard with temporary ✅ feedback. Clicks don't overlap, so one label
  // is enough to name the failing item in the shared handler's error report.
  let copying_label = ``
  const { copied, copy } = create_clipboard_feedback(1000, (error) => {
    console.error(`Failed to copy ${copying_label} to clipboard`, error)
  })
  const handle_copy = async (item: ExportItem, key: string) => {
    if (item.disabled) return
    const text = await item.copy_text?.()
    if (!text) return
    copying_label = item.label
    void copy(text, key)
  }
</script>

<ViewerPane
  bind:open={export_pane_open}
  pane_name="export options"
  class_prefix="export"
  pane_props={{
    ...rest,
    ...pane_props,
    class: [rest.class, pane_props?.class],
  }}
  {toggle_props}
  closed_icon={export_variant}
  {icon_style}
>
  {@render header?.()}
  {#each sections as section, sec_idx (section.title ?? sec_idx)}
    {#if section.title}
      <h4
        {@attach section.tooltip
          ? tooltip({ allow_html: true, content: sanitize_html(section.tooltip) })
          : () => {}}
      >
        {section.title}
      </h4>
    {/if}
    <div class="export-grid">
      {#each section.items as item, item_idx (item.label)}
        {@const copy_key = `${sec_idx}-${item_idx}`}
        <!-- not a <label>: it would forward label-text clicks to the first (download) button -->
        {@const why = item.disabled ? item.disabled_reason : undefined}
        {@const hint_id = why ? `${pane_id}-${copy_key}-hint` : undefined}
        {@const why_suffix = why ? ` — ${why}` : ``}
        <span class="export-item" class:disabled={item.disabled}>
          {#if item.hint}
            <span {@attach tooltip({ allow_html: true, content: sanitize_html(item.hint) })}
              >{item.label}</span
            >
          {:else}
            {item.label}
          {/if}
          {#if item.on_download}
            <button
              type="button"
              onclick={item.on_download}
              disabled={item.disabled ?? false}
              aria-label={`Download ${item.label}`}
              aria-describedby={hint_id}
              title={`Download ${item.label}${
                item.show_dpi ? ` (${png_dpi} DPI)` : ``
              }${why_suffix}`}
            >
              ⬇
            </button>
          {/if}
          {#if item.copy_text}
            <button
              type="button"
              onclick={() => handle_copy(item, copy_key)}
              disabled={item.disabled ?? false}
              aria-label="Copy {item.label} to clipboard"
              aria-describedby={hint_id}
              title={`Copy ${item.label} to clipboard${why_suffix}`}
            >
              {copied.has(copy_key) ? `✅` : `📋`}
            </button>
          {/if}
          {#if why}<small id={hint_id} class="disabled-reason">{why}</small>{/if}
          {#if item.show_dpi}
            <span class="dpi-input"
              >(DPI: <input
                type="number"
                min={dpi_range[0]}
                max={dpi_range[1]}
                bind:value={png_dpi}
                onchange={clamp_dpi}
                title="Export resolution in dots per inch"
              />)</span
            >
          {/if}
        </span>
      {/each}
    </div>
  {/each}
  {@render children?.()}
</ViewerPane>

<style>
  h4 {
    display: flex;
    align-items: center;
    margin: 0;
  }
  .export-grid {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4pt 10pt;
    font-size: 0.95em;
  }
  .export-item {
    display: flex;
    align-items: center;
    gap: 4pt;
    white-space: nowrap;
    &.disabled {
      opacity: 0.6;
    }
  }
  .disabled-reason {
    font-size: 0.85em;
    opacity: 0.8;
    white-space: normal;
  }
  .export-grid button {
    min-width: 1.9em;
    height: 1.6em;
    padding: 0 4pt;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .export-grid input[type='number'] {
    width: 3.5em;
  }
  .dpi-input {
    display: inline-flex;
    align-items: center;
    gap: 2pt;
    white-space: nowrap;
  }
</style>
