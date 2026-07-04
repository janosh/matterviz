<script lang="ts">
  import type { PaneProps, PaneToggleProps } from '$lib/overlays'
  import type { ExportItem, ExportSection } from './types'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { sanitize_html } from '$lib/sanitize'
  import { type ComponentProps, onDestroy, type Snippet } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    export_pane_open = $bindable(false),
    sections = [],
    png_dpi = $bindable(150),
    dpi_range = [50, 600],
    icon_style = ``,
    toggle_props = {},
    pane_props = {},
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
    // Pane-specific extras rendered below the sections (e.g. video export controls)
    children?: Snippet
  } = $props()

  // Clamp DPI into dpi_range on input change (fires on blur, before any download click)
  function clamp_dpi(): void {
    const [min_dpi, max_dpi] = dpi_range
    if (typeof png_dpi !== `number` || !Number.isFinite(png_dpi)) png_dpi = 150
    else png_dpi = Math.round(Math.min(max_dpi, Math.max(min_dpi, png_dpi)))
  }

  // Copy-to-clipboard with temporary ✅ feedback; copy_text runs only on click
  let copied_key = $state<string | null>(null)
  let copied_timeout: ReturnType<typeof setTimeout> | undefined
  async function handle_copy(item: ExportItem, key: string): Promise<void> {
    if (item.disabled) return
    const text = item.copy_text?.()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      copied_key = key
      clearTimeout(copied_timeout)
      copied_timeout = setTimeout(() => (copied_key = null), 1000)
    } catch (error) {
      console.error(`Failed to copy ${item.label} to clipboard`, error)
    }
  }
  onDestroy(() => clearTimeout(copied_timeout))
</script>

<DraggablePane
  bind:show={export_pane_open}
  open_icon="Cross"
  closed_icon="Export"
  {icon_style}
  pane_props={{
    ...rest,
    ...pane_props,
    class: `export-pane ${rest.class ?? ``} ${pane_props?.class ?? ``}`.trim(),
  }}
  {toggle_props}
>
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
        <span class="export-item">
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
              title={`Download ${item.label}${item.show_dpi ? ` (${png_dpi} DPI)` : ``}`}
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
              title="Copy {item.label} to clipboard"
            >
              {copied_key === copy_key ? `✅` : `📋`}
            </button>
          {/if}
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
</DraggablePane>

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
